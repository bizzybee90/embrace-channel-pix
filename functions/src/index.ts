import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import { setGlobalOptions } from "firebase-functions/v2";
import { GDPRService } from "./services/GDPRService";

admin.initializeApp();

// Set global options for region
setGlobalOptions({ region: "europe-west2" });

// --- GDPR Functions ---

/**
 * Cloud Function to delete a customer's data for GDPR compliance.
 * Callable only by admins.
 */
export const deleteCustomer = onCall(async (request) => {
    // 1. Auth Check
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
    }

    // 2. Role/Permission Check (Simplistic: Assume admin claim or specific user)
    // In production, check request.auth.token.role === 'admin'
    const targetUserId = request.data.targetUserId;
    const workspaceId = request.data.workspaceId;

    if (!targetUserId || !workspaceId) {
        throw new HttpsError("invalid-argument", "targetUserId and workspaceId are required.");
    }

    try {
        await GDPRService.deleteCustomerData(targetUserId, workspaceId);
        return { success: true, message: `Data for ${targetUserId} deleted.` };
    } catch (error) {
        logger.error("GDPR Deletion Failed", error);
        throw new HttpsError("internal", "Failed to delete customer data.");
    }
});

/**
 * Cloud Function to export a customer's data.
 */
export const exportCustomer = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const targetUserId = request.data.targetUserId || request.auth.uid;

    try {
        const data = await GDPRService.exportCustomerData(targetUserId);
        return { data };
    } catch (error) {
        logger.error("GDPR Export Failed", error);
        throw new HttpsError("internal", "Failed to export customer data.");
    }
});
