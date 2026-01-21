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
exports.onEmailCreated = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = __importStar(require("firebase-admin"));
const vertexai_1 = require("@google-cloud/vertexai");
// Lazy load these inside the function
// const db = admin.firestore();
// const vertexAI ...
/**
 * "The Sorter"
 * Triggered when a new message is added to a conversation.
 * Classifies inbound emails and updates the parent conversation.
 */
exports.onEmailCreated = (0, firestore_1.onDocumentCreated)("conversations/{convId}/messages/{msgId}", async (event) => {
    var _a;
    const db = admin.firestore();
    const vertexAI = new vertexai_1.VertexAI({ project: process.env.GCLOUD_PROJECT, location: 'europe-west2' });
    const model = vertexAI.preview.getGenerativeModel({ model: 'gemini-1.5-flash-preview-0514' });
    const snapshot = event.data;
    if (!snapshot)
        return;
    const message = snapshot.data();
    const { convId } = event.params;
    // Only process inbound messages (from customers)
    if (message.direction !== 'inbound')
        return;
    console.log(`Classifying message ${event.params.msgId} in conversation ${convId}`);
    // Call Gemini to classify
    const prompt = `
      Analyze this incoming email from a customer.
      
      Email Body:
      "${message.body}"

      Return JSON:
      {
        "category": "quote_request" | "booking" | "complaint" | "question" | "other",
        "priority": "high" | "medium" | "low",
        "sentiment": "positive" | "negative" | "neutral",
        "summary": "1 sentence summary"
      }
    `;
    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = (_a = response.candidates) === null || _a === void 0 ? void 0 : _a[0].content.parts[0].text;
        if (text) {
            const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
            const analysis = JSON.parse(jsonStr);
            // Update Parent Conversation
            await db.collection('conversations').doc(convId).update({
                category: analysis.category,
                priority: analysis.priority,
                ai_sentiment: analysis.sentiment,
                summary_for_human: analysis.summary,
                updated_at: admin.firestore.FieldValue.serverTimestamp(),
                // If priority is high, maybe set status?
                // For now just enrich data.
            });
            console.log(`Classified conv ${convId}: ${analysis.category}`);
        }
    }
    catch (error) {
        console.error("Classification failed", error);
    }
});
//# sourceMappingURL=onEmailCreated.js.map