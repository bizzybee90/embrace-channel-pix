import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import { defineSecret } from "firebase-functions/params";
import { GoogleGenerativeAI } from "@google/generative-ai";

const googleApiKey = defineSecret("GOOGLE_API_KEY");

export const discoverCompetitors = onCall({ secrets: [googleApiKey], timeoutSeconds: 300 }, async (request) => {
    const db = admin.firestore();
    if (!request.auth) throw new HttpsError("unauthenticated", "User must be logged in.");

    const { location, radius_miles, industry, business_name } = request.data;
    if (!location || !radius_miles || !industry || !business_name) {
        throw new HttpsError("invalid-argument", "Missing required fields");
    }

    const apiKey = googleApiKey.value();
    const genAI = new GoogleGenerativeAI(apiKey);

    // Initialize model with Google Search tool
    const model = genAI.getGenerativeModel({
        model: "gemini-1.5-pro",
        tools: [{ googleSearchRetrieval: {} }]
    });

    const prompt = `Find 15-20 active competitors for "${business_name}" in the "${industry}" industry within ${radius_miles} miles of lat/lng: ${location.lat}, ${location.lng}. 
    Exclude directories like Yell, Yelp, etc. Focus on direct business websites.
    Return a pure JSON array (no markdown code blocks) with this structure: 
    [{ "name": "string", "url": "string", "distance_miles": number, "rating": number }]`;

    try {
        const result = await model.generateContent(prompt);
        const response = result.response;
        const text = response.text();

        // Clean markdown code blocks if present
        const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const competitors = JSON.parse(jsonStr);

        // Save to Firestore
        // Save to Firestore
        const batch = db.batch();
        const collectionRef = db.collection(`companies/${request.auth.uid}/competitors`);

        competitors.forEach((comp: any) => {
            const docRef = collectionRef.doc();
            batch.set(docRef, { ...comp, status: 'discovered', created_at: new Date().toISOString() });
        });

        await batch.commit();

        return { success: true, count: competitors.length, competitors };

    } catch (error) {
        logger.error("Competitor Discovery Error", error);
        throw new HttpsError("internal", "Failed to discover competitors");
    }
});
