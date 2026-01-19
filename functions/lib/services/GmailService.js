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
exports.GmailService = void 0;
const admin = __importStar(require("firebase-admin"));
const googleapis_1 = require("googleapis");
const params_1 = require("firebase-functions/params");
// Define secrets
const gmailClientId = (0, params_1.defineSecret)('GMAIL_CLIENT_ID');
const gmailClientSecret = (0, params_1.defineSecret)('GMAIL_CLIENT_SECRET');
// Redirect URI for OAuth flow (configure this in Google Cloud Console)
// For local dev, this is usually http://localhost:5173/email-auth-success
// For prod, it's your hosting URL + /email-auth-success
const REDIRECT_URI = 'http://localhost:5173/email-auth-success'; // TODO: Make dynamic or env var
class GmailService {
    /**
     * Generates the URL for the user to consent to Gmail access.
     */
    static generateAuthUrl(state) {
        const scopes = [
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/gmail.send',
            'https://www.googleapis.com/auth/gmail.modify',
            'https://www.googleapis.com/auth/userinfo.email'
        ];
        return this.oauth2Client.generateAuthUrl({
            access_type: 'offline', // crucial for refresh token
            scope: scopes,
            prompt: 'consent', // force storage of refresh token
            state: state
        });
    }
    /**
     * Exchanges authorization code for tokens and saves them securely.
     */
    static async handleCallback(userId, code) {
        const db = admin.firestore();
        const { tokens } = await this.oauth2Client.getToken(code);
        // 1. Get User Profile to find Workspace (needed if we were storing config on workspace)
        // But prompt says store in users/{userId}/secrets
        // 2. Store tokens securely
        // Storing in a subcollection 'secrets' to protect from default queries
        await db.collection('users').doc(userId).collection('secrets').doc('gmail').set({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            scope: tokens.scope,
            token_type: tokens.token_type,
            expiry_date: tokens.expiry_date,
            updated_at: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`Tokens stored for user ${userId}`);
    }
    /**
     * Fetches the last 20 threads and syncs them to Firestore.
     */
    static async fetchAndSyncEmails(userId) {
        var _a, _b, _c, _d, _e, _f;
        const db = admin.firestore();
        // 1. Retrieve tokens
        const secretDoc = await db.collection('users').doc(userId).collection('secrets').doc('gmail').get();
        if (!secretDoc.exists) {
            throw new Error('No Gmail credentials found for user.');
        }
        const tokens = secretDoc.data();
        // 2. Retrieve User Workspace ID
        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.data();
        if (!userData || !userData.workspace_id) {
            throw new Error('User has no workspace assigned.');
        }
        const workspaceId = userData.workspace_id;
        // 3. Initialize Client
        const auth = new googleapis_1.google.auth.OAuth2(gmailClientId.value(), gmailClientSecret.value());
        auth.setCredentials(tokens);
        const gmail = googleapis_1.google.gmail({ version: 'v1', auth });
        // 4. Fetch Threads
        const res = await gmail.users.threads.list({
            userId: 'me',
            maxResults: 20
        });
        const threads = res.data.threads;
        if (!threads || threads.length === 0) {
            return;
        }
        // 5. Process Threads
        const batch = db.batch();
        for (const threadMeta of threads) {
            if (!threadMeta.id)
                continue;
            // Get full thread details
            const threadDetails = await gmail.users.threads.get({
                userId: 'me',
                id: threadMeta.id,
                format: 'full'
            });
            const messages = threadDetails.data.messages;
            if (!messages || messages.length === 0)
                continue;
            const lastMessage = messages[messages.length - 1]; // Most recent
            const headers = (_a = lastMessage.payload) === null || _a === void 0 ? void 0 : _a.headers;
            const subject = ((_b = headers === null || headers === void 0 ? void 0 : headers.find(h => h.name === 'Subject')) === null || _b === void 0 ? void 0 : _b.value) || '(No Subject)';
            const from = ((_c = headers === null || headers === void 0 ? void 0 : headers.find(h => h.name === 'From')) === null || _c === void 0 ? void 0 : _c.value) || 'Unknown';
            // --- Mapping to Conversation Schema ---
            // ID: Use thread ID or auto-id? existing schema implies using threadID as external_id and maybe auto-id for doc.
            // But for deduplication, using threadID as doc ID (or deterministic ID) is better.
            // Prompt says: "Save to Firestore: companies/{companyId}/conversations/{threadId}"
            // BUT we are following DATA_MAP which implies `conversations/{convId}` (root)
            // I will use `conversations/{threadId}` to ensure uniqueness and efficient lookup.
            // I will add `workspace_id` to the doc.
            const conversationRef = db.collection('conversations').doc(threadMeta.id);
            // We only create if not exists, or update timestamp?
            // Ideally we check if it exists to avoid overwriting AI analysis.
            // For 'ingestion', we usually use set with merge, or update. 
            // Let's assume basic upsert for synchronization fields.
            const convData = {
                id: threadMeta.id,
                workspace_id: workspaceId,
                external_id: threadMeta.id,
                title: subject,
                // Simple mapping for demo
                summary_for_human: `Email from ${from}`,
                channel: 'email',
                priority: 'medium', // Default
                status: 'open', // Default for new sync
                updated_at: admin.firestore.FieldValue.serverTimestamp(),
                last_message_at: admin.firestore.FieldValue.serverTimestamp(), // Approximation
                // Set defaults for required fields from schema if new
                category: 'general',
                sla_target_minutes: 60,
                sla_status: 'safe'
            };
            batch.set(conversationRef, convData, { merge: true });
            // --- Mapping to Message Schema ---
            // subcollection: conversations/{threadId}/messages
            for (const msg of messages) {
                if (!msg.id)
                    continue;
                const messageRef = conversationRef.collection('messages').doc(msg.id);
                const msgHeaders = (_d = msg.payload) === null || _d === void 0 ? void 0 : _d.headers;
                const msgFrom = ((_e = msgHeaders === null || msgHeaders === void 0 ? void 0 : msgHeaders.find(h => h.name === 'From')) === null || _e === void 0 ? void 0 : _e.value) || '';
                // Determine direction/actor
                // simplistic check: if from 'me', it's outbound. 
                // We need the user's email address to know who 'me' is properly, or checking labelIds for SENT.
                const isSent = (_f = msg.labelIds) === null || _f === void 0 ? void 0 : _f.includes('SENT');
                const direction = isSent ? 'outbound' : 'inbound';
                const actorType = isSent ? 'human_agent' : 'customer'; // Simplification
                const msgData = {
                    id: msg.id,
                    conversation_id: threadMeta.id,
                    external_id: msg.id,
                    actor_type: actorType,
                    // actor_id: ?,
                    actor_name: msgFrom,
                    direction: direction,
                    channel: 'email',
                    body: msg.snippet || '', // In real app, parse payload.body.data
                    raw_payload: msg, // Storing full payload for debugging/parsing later as requested
                    created_at: new Date(Number(msg.internalDate)).toISOString(),
                    workspace_id: workspaceId // Denormalization for security rules
                };
                batch.set(messageRef, msgData, { merge: true });
            }
        }
        await batch.commit();
        console.log(`Synced ${threads.length} threads for user ${userId}`);
    }
}
exports.GmailService = GmailService;
GmailService.oauth2Client = new googleapis_1.google.auth.OAuth2(gmailClientId.value(), gmailClientSecret.value(), REDIRECT_URI);
//# sourceMappingURL=GmailService.js.map