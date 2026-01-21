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
exports.SafetyService = void 0;
class SafetyService {
    static async getModel() {
        const { VertexAI } = await Promise.resolve().then(() => __importStar(require('@google-cloud/vertexai')));
        const vertexAI = new VertexAI({
            project: process.env.GCLOUD_PROJECT,
            location: 'europe-west2'
        });
        return vertexAI.preview.getGenerativeModel({
            model: 'gemini-1.5-flash-preview-0514'
        });
    }
    /**
     * Verifies a draft against FAQs and Policies to prevent hallucinations.
     * "The Judge"
     */
    static async verifyDraft(draftText, contextData) {
        var _a;
        const prompt = `
      You are a strict Compliance Officer and Hallucination Detector.
      Your job is to verify that the following EMAIL DRAFT is accurate based ONLY on the provided KNOWLEDGE BASE (FAQs).
      
      Rules:
      1. If the draft promises a price not in the KB, flag it.
      2. If the draft invents a service not in the KB, flag it.
      3. If the draft contradicts the KB, flag it.
      4. If the draft matches the KB or is generic/safe (e.g. "I'll check for you"), pass it.

      Knowledge Base:
      ${contextData}

      Email Draft:
      ${draftText}

      Return ONLY a JSON object:
      {
        "verified": boolean,
        "issues": string[],
        "suggestions": string[]
      }
    `;
        const model = await this.getModel();
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = (_a = response.candidates) === null || _a === void 0 ? void 0 : _a[0].content.parts[0].text;
        if (!text)
            throw new Error('Failed to verify draft');
        const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(jsonStr);
    }
}
exports.SafetyService = SafetyService;
//# sourceMappingURL=SafetyService.js.map