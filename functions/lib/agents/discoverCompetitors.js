"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.discoverCompetitors = void 0;
const https_1 = require("firebase-functions/v2/https");
const logger = __importStar(require("firebase-functions/logger"));
const admin = __importStar(require("firebase-admin"));
const params_1 = require("firebase-functions/params");
const generative_ai_1 = require("@google/generative-ai");
const googleApiKey = (0, params_1.defineSecret)("GOOGLE_API_KEY");
exports.discoverCompetitors = (0, https_1.onCall)({ secrets: [googleApiKey], timeoutSeconds: 300 }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "User must be logged in.");
    const { location, radius_miles, industry, business_name } = request.data;
    if (!location || !radius_miles || !industry || !business_name) {
        throw new https_1.HttpsError("invalid-argument", "Missing required fields");
    }
    const apiKey = googleApiKey.value();
    const genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
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
        const db = admin.firestore();
        const batch = db.batch();
        const collectionRef = db.collection(`companies/${request.auth.uid}/competitors`);
        competitors.forEach((comp) => {
            const docRef = collectionRef.doc();
            batch.set(docRef, Object.assign(Object.assign({}, comp), { status: 'discovered', created_at: new Date().toISOString() }));
        });
        await batch.commit();
        return { success: true, count: competitors.length, competitors };
    }
    catch (error) {
        logger.error("Competitor Discovery Error", error);
        throw new https_1.HttpsError("internal", "Failed to discover competitors");
    }
});
//# sourceMappingURL=discoverCompetitors.js.map