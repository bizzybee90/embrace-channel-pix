import { onDocumentCreated } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import { VertexAI } from '@google-cloud/vertexai';


// Lazy load these inside the function
// const db = admin.firestore();
// const vertexAI ...

/**
 * "The Sorter"
 * Triggered when a new message is added to a conversation.
 * Classifies inbound emails and updates the parent conversation.
 */
export const onEmailCreated = onDocumentCreated({
    document: "conversations/{convId}/messages/{msgId}",
    region: "europe-west2"
}, async (event) => {
    const db = admin.firestore();
    const vertexAI = new VertexAI({ project: process.env.GCLOUD_PROJECT, location: 'europe-west2' });
    const model = vertexAI.preview.getGenerativeModel({ model: 'gemini-1.5-flash-preview-0514' });

    const snapshot = event.data;
    if (!snapshot) return;

    const message = snapshot.data();
    const { convId } = event.params;

    // Only process inbound messages (from customers)
    if (message.direction !== 'inbound') return;

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
        const text = response.candidates?.[0].content.parts[0].text;

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
    } catch (error) {
        console.error("Classification failed", error);
    }
});
