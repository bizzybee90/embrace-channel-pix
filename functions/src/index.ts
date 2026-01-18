import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import { setGlobalOptions } from "firebase-functions/v2";
import { defineSecret } from "firebase-functions/params";
import { GDPRService } from "./services/GDPRService";
import { GmailService } from "./services/GmailService";

admin.initializeApp();

// Set global options for region
setGlobalOptions({ region: "europe-west2" });

// Define secrets again here to ensure they are available to the function environment if needed directly,
// checking if they need to be passed to runWith/secrets option.
// In v2, we pass them as a list to the function options.
const gmailClientId = defineSecret('GMAIL_CLIENT_ID');
const gmailClientSecret = defineSecret('GMAIL_CLIENT_SECRET');

// --- GDPR Functions ---

export const deleteCustomer = onCall(async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Unauthenticated");
    try {
        const { targetUserId, workspaceId } = request.data;
        await GDPRService.deleteCustomerData(targetUserId || request.auth.uid, workspaceId);
        return { success: true };
    } catch (error) {
        logger.error(error);
        throw new HttpsError("internal", "Error deleting data");
    }
});

export const exportCustomer = onCall(async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Unauthenticated");
    try {
        const { targetUserId } = request.data;
        return await GDPRService.exportCustomerData(targetUserId || request.auth.uid);
    } catch (error) {
        logger.error(error);
        throw new HttpsError("internal", "Error exporting data");
    }
});

// --- Gmail Functions ---

/**
 * Returns the Google OAuth URL.
 */
export const startGmailAuth = onCall({ secrets: [gmailClientId, gmailClientSecret] }, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "User must be logged in to connect Gmail.");
    }

    // Create a state token encoded with userId to verify on callback (optional but good security)
    const state = JSON.stringify({ userId: request.auth.uid });

    try {
        const url = GmailService.generateAuthUrl(state);
        return { url };
    } catch (error) {
        logger.error("Error generating auth URL", error);
        throw new HttpsError("internal", "Failed to generate auth URL");
    }
});

/**
 * Exchanges the code for tokens.
 * Call this from the frontend after being redirected back from Google.
 */
export const finishGmailAuth = onCall({ secrets: [gmailClientId, gmailClientSecret] }, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Unauthenticated");
    }

    const { code } = request.data;
    if (!code) {
        throw new HttpsError("invalid-argument", "Missing auth code");
    }

    try {
        await GmailService.handleCallback(request.auth.uid, code);
        return { success: true };
    } catch (error) {
        logger.error("Auth Callback Error", error);
        throw new HttpsError("internal", "Failed to exchange code");
    }
});

/**
 * Manually triggers a sync of the authenticated user's Gmail.
 */
export const syncGmailNow = onCall({ secrets: [gmailClientId, gmailClientSecret] }, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Unauthenticated");
    }

    try {
        await GmailService.fetchAndSyncEmails(request.auth.uid);
        return { success: true, message: "Sync started" };
    } catch (error) {
        logger.error("Sync Error", error);
        // Don't expose safe errors
        throw new HttpsError("internal", "Failed to sync emails");
    }
});
