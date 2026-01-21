import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import { defineSecret } from "firebase-functions/params";
import { GoogleGenerativeAI } from "@google/generative-ai";

const googleApiKey = defineSecret("GOOGLE_API_KEY");

export const generateKnowledge = onCall({ secrets: [googleApiKey], timeoutSeconds: 540 }, async (request) => {
    const db = admin.firestore();
    if (!request.auth) throw new HttpsError("unauthenticated", "User must be logged in.");

    const { markdown_content, company_id } = request.data;
    if (!markdown_content || !company_id) {
        throw new HttpsError("invalid-argument", "Missing content or company_id");
    }

    const apiKey = googleApiKey.value();
    const genAI = new GoogleGenerativeAI(apiKey);

    // Use Gemini 1.5 Pro for high context window handling of website content
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

    const prompt = `
    Analyze the following website content for a specific business.
    
    Website Content:
    """
    ${markdown_content}
    """

    Task 1: Extract Business Information (Phone, Email, Services, Address).
    
    Task 2: GENERATE PRODUCTIVE KNOWLEDGE (FAQs).
    Goal: Create a comprehensive knowledge base of 30-50+ FAQs.
    
    Priority 1 (Gold Standard): Identify any ACTUAL FAQs present in the content. Extract them exactly as they are.
    Priority 2 (Inferred): Generate productive, high-value FAQs that a customer *would* ask, based on the services, pricing, terms, and business details found.
    - Adapt the tone to match the "Gold Standard" FAQs.
    - Cover topics like: Pricing, Booking/Ordering, Refunds, Service Areas, Specific capabilities, Hours, Support.
    
    Return ONLY a JSON object with this exact structure:
    {
      "business_info": {
        "phone": "string | null",
        "email": "string | null",
        "address": "string | null",
        "services": ["string"]
      },
      "faqs": [
        { 
            "question": "string", 
            "answer": "string",
            "type": "explicit" | "generated" // 'explicit' if found in text, 'generated' if inferred
        }
      ]
    }
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = result.response;
        const text = response.text();

        const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const data = JSON.parse(jsonStr);


        const batch = db.batch();

        // 1. Update Profile
        const profileRef = db.doc(`companies/${company_id}`);
        batch.set(profileRef, {
            business_info: data.business_info,
            knowledge_updated_at: new Date().toISOString()
        }, { merge: true });

        // 2. Batch write FAQs
        const faqCollection = db.collection(`companies/${company_id}/faqs`);

        // Delete existing auto-generated FAQs first? 
        // For now, we append/overwrite.

        data.faqs.forEach((faq: any) => {
            const docRef = faqCollection.doc();
            batch.set(docRef, {
                ...faq,
                source: 'website_scan',
                created_at: new Date().toISOString()
            });
        });

        await batch.commit();

        return { success: true, faqs_count: data.faqs.length, business_info: data.business_info };

    } catch (error) {
        logger.error("Knowledge Generation Error", error);
        throw new HttpsError("internal", "Failed to generate knowledge");
    }
});
