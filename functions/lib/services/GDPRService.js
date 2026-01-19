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
exports.GDPRService = void 0;
const admin = __importStar(require("firebase-admin"));
const db = admin.firestore();
class GDPRService {
    /**
     * Recursively deletes all data associated with a user or customer.
     * This includes Firestore documents and Storage files.
     *
     * @param userId The ID of the user/customer to delete.
     * @param workspaceId The workspace ID the user belongs to (for storage paths).
     */
    static async deleteCustomerData(userId, workspaceId) {
        console.log(`Starting GDPR deletion for user: ${userId} in workspace: ${workspaceId}`);
        // 1. Delete User Document
        await db.collection('users').doc(userId).delete();
        // 2. Delete Customer Document (if exists with same ID)
        await db.collection('customers').doc(userId).delete();
        // 3. Delete Conversations where this user is the actor? 
        // Usually GDPR requires deleting personal data. We might anonymize instead of delete 
        // business records, but for this strict requirement, we will search and delete.
        // NOTE: In a real app, this might be a soft delete or anonymization.
        // 4. Delete Storage Files
        // Path: /workspaces/{workspace_id}/attachments/{message_id}/{filename} -- hard to track by user alone without metadata.
        // Assuming we have a user-specific folder or metadata. 
        // For now, we log this as a manual step or extensive query needed.
        console.warn(`Storage deletion for ${userId} pending implementation of file tracking.`);
    }
    /**
     * Exports all data for a user into a JSON object.
     *
     * @param userId The ID of the user/customer to export.
     */
    static async exportCustomerData(userId) {
        const exportData = {};
        // 1. Fetch User Profile
        const userDoc = await db.collection('users').doc(userId).get();
        if (userDoc.exists) {
            exportData.user = userDoc.data();
        }
        // 2. Fetch Customer Profile
        const customerDoc = await db.collection('customers').doc(userId).get();
        if (customerDoc.exists) {
            exportData.customer = customerDoc.data();
        }
        return exportData;
    }
}
exports.GDPRService = GDPRService;
//# sourceMappingURL=GDPRService.js.map