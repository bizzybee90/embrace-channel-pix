import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import { defineSecret } from "firebase-functions/params";
import axios from "axios";

const firecrawlApiKey = defineSecret("FIRECRAWL_API_KEY");

export const scrapeWebsite = onCall({ secrets: [firecrawlApiKey], timeoutSeconds: 300 }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "User must be logged in.");

    const { url, company_id } = request.data;
    if (!url || !company_id) {
        throw new HttpsError("invalid-argument", "Missing url or company_id");
    }

    const apiKey = firecrawlApiKey.value();

    try {
        const response = await axios.post(
            "https://api.firecrawl.dev/v1/scrape",
            {
                url: url,
                formats: ["markdown"],
                onlyMainContent: true
            },
            {
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json"
                }
            }
        );

        if (!response.data.success) {
            throw new Error(`Firecrawl failed: ${response.data.error || 'Unknown error'}`);
        }

        const markdown = response.data.data.markdown;

        // Save raw content to Firestore for caching
        await admin.firestore()
            .collection(`companies/${company_id}/scrapes`)
            .add({
                url,
                content: markdown,
                created_at: admin.firestore.FieldValue.serverTimestamp()
            });

        return { success: true, markdown };

    } catch (error: any) {
        logger.error("Scrape Error", error.response?.data || error.message);
        throw new HttpsError("internal", "Failed to scrape website");
    }
});
