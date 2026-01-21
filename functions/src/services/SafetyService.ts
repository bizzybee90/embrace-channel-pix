export interface DraftVerificationResult {
    verified: boolean;
    issues: string[];
    suggestions: string[];
}

export class SafetyService {
    private static async getModel() {
        const { VertexAI } = await import('@google-cloud/vertexai');
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
    static async verifyDraft(draftText: string, contextData: string): Promise<DraftVerificationResult> {
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
        const text = response.candidates?.[0].content.parts[0].text;

        if (!text) throw new Error('Failed to verify draft');

        const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(jsonStr) as DraftVerificationResult;
    }
}
