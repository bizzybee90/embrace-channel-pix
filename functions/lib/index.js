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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyDraft = exports.learnVoice = exports.syncGmailNow = exports.finishGmailAuth = exports.startGmailAuth = exports.exportCustomer = exports.deleteCustomer = exports.onConversationUpdated = exports.onEmailCreated = void 0;
const https_1 = require("firebase-functions/v2/https");
const logger = __importStar(require("firebase-functions/logger"));
const admin = __importStar(require("firebase-admin"));
const v2_1 = require("firebase-functions/v2");
const params_1 = require("firebase-functions/params");
const GDPRService_1 = require("./services/GDPRService");
const GmailService_1 = require("./services/GmailService");
const VoiceService_1 = require("./services/VoiceService");
const SafetyService_1 = require("./services/SafetyService");
// Triggers
const onEmailCreated_1 = require("./triggers/onEmailCreated");
Object.defineProperty(exports, "onEmailCreated", { enumerable: true, get: function () { return onEmailCreated_1.onEmailCreated; } });
const onConversationUpdated_1 = require("./triggers/onConversationUpdated");
Object.defineProperty(exports, "onConversationUpdated", { enumerable: true, get: function () { return onConversationUpdated_1.onConversationUpdated; } });
if (admin.apps.length === 0) {
    admin.initializeApp();
}
// Set global options for region
(0, v2_1.setGlobalOptions)({ region: "europe-west2" });
const gmailClientId = (0, params_1.defineSecret)('GMAIL_CLIENT_ID');
const gmailClientSecret = (0, params_1.defineSecret)('GMAIL_CLIENT_SECRET');
// --- GDPR Functions ---
exports.deleteCustomer = (0, https_1.onCall)(async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Unauthenticated");
    try {
        const { targetUserId, workspaceId } = request.data;
        await GDPRService_1.GDPRService.deleteCustomerData(targetUserId || request.auth.uid, workspaceId);
        return { success: true };
    }
    catch (error) {
        logger.error(error);
        throw new https_1.HttpsError("internal", "Error deleting data");
    }
});
exports.exportCustomer = (0, https_1.onCall)(async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Unauthenticated");
    try {
        const { targetUserId } = request.data;
        return await GDPRService_1.GDPRService.exportCustomerData(targetUserId || request.auth.uid);
    }
    catch (error) {
        logger.error(error);
        throw new https_1.HttpsError("internal", "Error exporting data");
    }
});
// --- Gmail Functions ---
exports.startGmailAuth = (0, https_1.onCall)({ secrets: [gmailClientId, gmailClientSecret] }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "User must be logged in.");
    const state = JSON.stringify({ userId: request.auth.uid });
    try {
        const url = GmailService_1.GmailService.generateAuthUrl(state);
        return { url };
    }
    catch (error) {
        logger.error("Error generating auth URL", error);
        throw new https_1.HttpsError("internal", "Failed to generate auth URL");
    }
});
exports.finishGmailAuth = (0, https_1.onCall)({ secrets: [gmailClientId, gmailClientSecret] }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Unauthenticated");
    const { code } = request.data;
    if (!code)
        throw new https_1.HttpsError("invalid-argument", "Missing auth code");
    try {
        await GmailService_1.GmailService.handleCallback(request.auth.uid, code);
        return { success: true };
    }
    catch (error) {
        logger.error("Auth Callback Error", error);
        throw new https_1.HttpsError("internal", "Failed to exchange code");
    }
});
exports.syncGmailNow = (0, https_1.onCall)({ secrets: [gmailClientId, gmailClientSecret] }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Unauthenticated");
    try {
        await GmailService_1.GmailService.fetchAndSyncEmails(request.auth.uid);
        return { success: true, message: "Sync started" };
    }
    catch (error) {
        logger.error("Sync Error", error);
        throw new https_1.HttpsError("internal", "Failed to sync emails");
    }
});
// --- Intelligence Functions (Brain) ---
/**
 * Trigger voice learning for a workspace.
 */
exports.learnVoice = (0, https_1.onCall)(async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Unauthenticated");
    // In strict enterprise mode, verify user belongs to workspace
    // For now, assuming request includes workspaceId and we trust/check auth.token
    const { workspaceId } = request.data;
    if (!workspaceId)
        throw new https_1.HttpsError("invalid-argument", "Missing workspaceId");
    try {
        await VoiceService_1.VoiceService.learnUserVoice(workspaceId);
        return { success: true, message: "Voice learning started" };
    }
    catch (error) {
        logger.error("Voice Learning Error", error);
        throw new https_1.HttpsError("internal", "Failed to learn voice");
    }
});
/**
 * Verify a draft for safety/hallucinations.
 */
exports.verifyDraft = (0, https_1.onCall)(async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Unauthenticated");
    const { draftText, contextData } = request.data;
    if (!draftText)
        throw new https_1.HttpsError("invalid-argument", "Missing draft text");
    try {
        return await SafetyService_1.SafetyService.verifyDraft(draftText, contextData || "");
    }
    catch (error) {
        logger.error("Safety Check Error", error);
        throw new https_1.HttpsError("internal", "Failed to verify draft");
    }
});
// --- Master Spec Agents ---
__exportStar(require("./agents/discoverCompetitors"), exports);
__exportStar(require("./agents/scrapeWebsite"), exports);
__exportStar(require("./agents/generateKnowledge"), exports);
//# sourceMappingURL=index.js.map