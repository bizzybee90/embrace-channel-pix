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
const params_1 = require("firebase-functions/params");
// Define secrets
const gmailClientId = (0, params_1.defineSecret)('GMAIL_CLIENT_ID');
const gmailClientSecret = (0, params_1.defineSecret)('GMAIL_CLIENT_SECRET');
// Redirect URI for OAuth flow
const REDIRECT_URI = 'http://localhost:5173/email-auth-success';
class GmailService {
    static async getOAuthClient() {
        const { google } = await Promise.resolve().then(() => __importStar(require('googleapis')));
        return new google.auth.OAuth2(gmailClientId.value(), gmailClientSecret.value(), REDIRECT_URI);
    }
    /**
     * Generates the URL for the user to consent to Gmail access.
     */
    static async generateAuthUrl(state) {
        const client = await this.getOAuthClient();
        const scopes = [
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/gmail.send',
            'https://www.googleapis.com/auth/gmail.modify',
            'https://www.googleapis.com/auth/userinfo.email'
        ];
        return client.generateAuthUrl({
            access_type: 'offline',
            scope: scopes,
            prompt: 'consent',
            state: state
        });
    }
    /**
     * Exchanges authorization code for tokens and saves them securely.
     */
    static async handleCallback(userId, code) {
        const db = admin.firestore();
        const client = await this.getOAuthClient();
        const { tokens } = await client.getToken(code);
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
        const { google } = await Promise.resolve().then(() => __importStar(require('googleapis')));
        const auth = new google.auth.OAuth2(gmailClientId.value(), gmailClientSecret.value());
        auth.setCredentials(tokens);
        const gmail = google.gmail({ version: 'v1', auth });
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
            const threadDetails = await gmail.users.threads.get({
                userId: 'me',
                id: threadMeta.id,
                format: 'full'
            });
            const messages = threadDetails.data.messages;
            if (!messages || messages.length === 0)
                continue;
            const lastMessage = messages[messages.length - 1];
            const headers = (_a = lastMessage.payload) === null || _a === void 0 ? void 0 : _a.headers;
            const subject = ((_b = headers === null || headers === void 0 ? void 0 : headers.find(h => h.name === 'Subject')) === null || _b === void 0 ? void 0 : _b.value) || '(No Subject)';
            const from = ((_c = headers === null || headers === void 0 ? void 0 : headers.find(h => h.name === 'From')) === null || _c === void 0 ? void 0 : _c.value) || 'Unknown';
            const conversationRef = db.collection('conversations').doc(threadMeta.id);
            const convData = {
                id: threadMeta.id,
                workspace_id: workspaceId,
                external_id: threadMeta.id,
                title: subject,
                summary_for_human: `Email from ${from}`,
                channel: 'email',
                priority: 'medium',
                status: 'open',
                updated_at: admin.firestore.FieldValue.serverTimestamp(),
                last_message_at: admin.firestore.FieldValue.serverTimestamp(),
                category: 'general',
                sla_target_minutes: 60,
                sla_status: 'safe'
            };
            batch.set(conversationRef, convData, { merge: true });
            for (const msg of messages) {
                if (!msg.id)
                    continue;
                const messageRef = conversationRef.collection('messages').doc(msg.id);
                const msgHeaders = (_d = msg.payload) === null || _d === void 0 ? void 0 : _d.headers;
                const msgFrom = ((_e = msgHeaders === null || msgHeaders === void 0 ? void 0 : msgHeaders.find(h => h.name === 'From')) === null || _e === void 0 ? void 0 : _e.value) || '';
                const isSent = (_f = msg.labelIds) === null || _f === void 0 ? void 0 : _f.includes('SENT');
                const direction = isSent ? 'outbound' : 'inbound';
                const actorType = isSent ? 'human_agent' : 'customer';
                const msgData = {
                    id: msg.id,
                    conversation_id: threadMeta.id,
                    external_id: msg.id,
                    actor_type: actorType,
                    actor_name: msgFrom,
                    direction: direction,
                    channel: 'email',
                    body: msg.snippet || '',
                    raw_payload: msg,
                    created_at: new Date(Number(msg.internalDate)).toISOString(),
                    workspace_id: workspaceId
                };
                batch.set(messageRef, msgData, { merge: true });
            }
        }
        await batch.commit();
        console.log(`Synced ${threads.length} threads for user ${userId}`);
    }
}
exports.GmailService = GmailService;
//# sourceMappingURL=GmailService.js.map