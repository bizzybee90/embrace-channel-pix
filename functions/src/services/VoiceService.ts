import * as admin from 'firebase-admin';
import { VertexAI } from '@google-cloud/vertexai';



// Initialize Vertex AI
// Note: Requires project_id and location. Cloud Functions usually provide GCLOUD_PROJECT env var.
// For location, we default to europe-west2 as per requirements, but Gemini availability affects this.
// Gemini 1.5 Pro is available in europe-west2.
const vertexAI = new VertexAI({
    project: process.env.GCLOUD_PROJECT,
    location: 'europe-west2'
});

const model = vertexAI.preview.getGenerativeModel({
    model: 'gemini-1.5-pro-preview-0409' // Or 'gemini-1.5-pro-001'
});

export class VoiceService {
    /**
     * Analyzes recent sent emails to build a voice profile.
     * "The Psychologist"
     */
    static async learnUserVoice(workspaceId: string): Promise<void> {
        const db = admin.firestore();
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
        const text = response.candidates?.[0].content.parts[0].text;

        if (!text) throw new Error('Failed to generate voice profile');

        // Clean markdown code blocks if present
        const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const profile = JSON.parse(jsonStr);

        // 3. Save to Settings
        await db.collection('workspaces').doc(workspaceId)
            .collection('settings').doc('voice_profile')
            .set({
                ...profile,
                updated_at: admin.firestore.FieldValue.serverTimestamp()
            });

        console.log(`Voice profile saved for ${workspaceId}`);
    }
}
