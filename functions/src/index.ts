import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import { setGlobalOptions } from "firebase-functions/v2";
import { defineSecret } from "firebase-functions/params";
import { GDPRService } from "./services/GDPRService";
import { GmailService } from "./services/GmailService";
import { VoiceService } from "./services/VoiceService";
import { SafetyService } from "./services/SafetyService";

// Triggers
import { onEmailCreated } from "./triggers/onEmailCreated";
import { onConversationUpdated } from "./triggers/onConversationUpdated";

if (admin.apps.length === 0) {
    admin.initializeApp();
}

// Set global options for region
setGlobalOptions({
    region: "europe-west2",
    memory: "2GiB",
    timeoutSeconds: 540,
    maxInstances: 10
});

const gmailClientId = defineSecret('GMAIL_CLIENT_ID');
const gmailClientSecret = defineSecret('GMAIL_CLIENT_SECRET');

// --- Export Triggers ---
export { onEmailCreated, onConversationUpdated };

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
export const startGmailAuth = onCall({ secrets: [gmailClientId, gmailClientSecret] }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "User must be logged in.");
    const state = JSON.stringify({ userId: request.auth.uid });
    try {
        const url = await GmailService.generateAuthUrl(state);
        return { url };
    } catch (error) {
        logger.error("Error generating auth URL", error);
        throw new HttpsError("internal", "Failed to generate auth URL");
    }
});

export const finishGmailAuth = onCall({ secrets: [gmailClientId, gmailClientSecret] }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Unauthenticated");
    const { code } = request.data;
    if (!code) throw new HttpsError("invalid-argument", "Missing auth code");
    try {
        await GmailService.handleCallback(request.auth.uid, code);
        return { success: true };
    } catch (error) {
        logger.error("Auth Callback Error", error);
        throw new HttpsError("internal", "Failed to exchange code");
    }
});

export const syncGmailNow = onCall({ secrets: [gmailClientId, gmailClientSecret] }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Unauthenticated");
    try {
        await GmailService.fetchAndSyncEmails(request.auth.uid);
        return { success: true, message: "Sync started" };
    } catch (error) {
        logger.error("Sync Error", error);
        throw new HttpsError("internal", "Failed to sync emails");
    }
});

// --- Intelligence Functions (Brain) ---

/**
 * Trigger voice learning for a workspace.
 */
export const learnVoice = onCall(async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Unauthenticated");

    // In strict enterprise mode, verify user belongs to workspace
    // For now, assuming request includes workspaceId and we trust/check auth.token
    const { workspaceId } = request.data;
    if (!workspaceId) throw new HttpsError("invalid-argument", "Missing workspaceId");

    try {
        await VoiceService.learnUserVoice(workspaceId);
        return { success: true, message: "Voice learning started" };
    } catch (error) {
        logger.error("Voice Learning Error", error);
        throw new HttpsError("internal", "Failed to learn voice");
    }
});

/**
 * Verify a draft for safety/hallucinations.
 */
export const verifyDraft = onCall(async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Unauthenticated");
    const { draftText, contextData } = request.data;

    if (!draftText) throw new HttpsError("invalid-argument", "Missing draft text");

    try {
        return await SafetyService.verifyDraft(draftText, contextData || "");
    } catch (error) {
        logger.error("Safety Check Error", error);
        throw new HttpsError("internal", "Failed to verify draft");
    }
});



// --- Master Spec Agents ---
export * from "./agents/discoverCompetitors";
export * from "./agents/scrapeWebsite";
export * from "./agents/generateKnowledge";

