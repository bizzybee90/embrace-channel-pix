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
exports.VoiceService = void 0;
const admin = __importStar(require("firebase-admin"));
const vertexai_1 = require("@google-cloud/vertexai");
const db = admin.firestore();
// Initialize Vertex AI
// Note: Requires project_id and location. Cloud Functions usually provide GCLOUD_PROJECT env var.
// For location, we default to europe-west2 as per requirements, but Gemini availability affects this.
// Gemini 1.5 Pro is available in europe-west2.
const vertexAI = new vertexai_1.VertexAI({
    project: process.env.GCLOUD_PROJECT,
    location: 'europe-west2'
});
const model = vertexAI.preview.getGenerativeModel({
    model: 'gemini-1.5-pro-preview-0409' // Or 'gemini-1.5-pro-001'
});
class VoiceService {
    /**
     * Analyzes recent sent emails to build a voice profile.
     * "The Psychologist"
     */
    static async learnUserVoice(workspaceId) {
        var _a;
        console.log(`Learning voice for workspace: ${workspaceId}`);
        // 1. Fetch last 500 SENT messages
        // DATA_MAP: conversations/{convId}/messages where workspace_id match and direction='outbound'
        // This requires a collection group query or huge fan-out.
        // For efficiency, we limit to 50 for this MVP, or 500 if indexed.
        // Assuming 'messages' is a subcollection of 'conversations'.
        const snapshot = await db.collectionGroup('messages')
            .where('workspace_id', '==', workspaceId)
            .where('direction', '==', 'outbound')
            .orderBy('created_at', 'desc')
            .limit(50) // Reduced from 500 to save tokens/time for MVP
            .get();
        if (snapshot.empty) {
            console.log('No sent emails found to analyze.');
            return;
        }
        const emailSamples = snapshot.docs.map(d => d.data().body).join('\n---\n');
        // 2. Prompt Gemini
        const prompt = `
      You are an expert Copywriter and Brand Strategist.
      Analyze the following email samples sent by this company.
      Extract a structured "Voice Profile" that describes their communication style.

      Return ONLY a JSON object with this exact schema:
      {
        "warmth_level": number (1-10),
        "formality": "formal" | "casual" | "neutral",
        "greeting_examples": string[],
        "personality_summary": string,
        "tone_keywords": string[]
      }

      Samples:
      ${emailSamples}
    `;
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = (_a = response.candidates) === null || _a === void 0 ? void 0 : _a[0].content.parts[0].text;
        if (!text)
            throw new Error('Failed to generate voice profile');
        // Clean markdown code blocks if present
        const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const profile = JSON.parse(jsonStr);
        // 3. Save to Settings
        await db.collection('workspaces').doc(workspaceId)
            .collection('settings').doc('voice_profile')
            .set(Object.assign(Object.assign({}, profile), { updated_at: admin.firestore.FieldValue.serverTimestamp() }));
        console.log(`Voice profile saved for ${workspaceId}`);
    }
}
exports.VoiceService = VoiceService;
//# sourceMappingURL=VoiceService.js.map