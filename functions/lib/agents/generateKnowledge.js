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
exports.generateKnowledge = void 0;
const https_1 = require("firebase-functions/v2/https");
const logger = __importStar(require("firebase-functions/logger"));
const admin = __importStar(require("firebase-admin"));
const params_1 = require("firebase-functions/params");
const generative_ai_1 = require("@google/generative-ai");
const googleApiKey = (0, params_1.defineSecret)("GOOGLE_API_KEY");
exports.generateKnowledge = (0, https_1.onCall)({ secrets: [googleApiKey], timeoutSeconds: 540 }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "User must be logged in.");
    const { markdown_content, company_id } = request.data;
    if (!markdown_content || !company_id) {
        throw new https_1.HttpsError("invalid-argument", "Missing content or company_id");
    }
    const apiKey = googleApiKey.value();
    const genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
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
        const db = admin.firestore();
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
        data.faqs.forEach((faq) => {
            const docRef = faqCollection.doc();
            batch.set(docRef, Object.assign(Object.assign({}, faq), { source: 'website_scan', created_at: new Date().toISOString() }));
        });
        await batch.commit();
        return { success: true, faqs_count: data.faqs.length, business_info: data.business_info };
    }
    catch (error) {
        logger.error("Knowledge Generation Error", error);
        throw new https_1.HttpsError("internal", "Failed to generate knowledge");
    }
});
//# sourceMappingURL=generateKnowledge.js.map