import * as admin from 'firebase-admin';
import { google } from 'googleapis';
import { defineSecret } from 'firebase-functions/params';

// Define secrets
const gmailClientId = defineSecret('GMAIL_CLIENT_ID');
const gmailClientSecret = defineSecret('GMAIL_CLIENT_SECRET');

const db = admin.firestore();

// Redirect URI for OAuth flow (configure this in Google Cloud Console)
// For local dev, this is usually http://localhost:5173/email-auth-success
// For prod, it's your hosting URL + /email-auth-success
const REDIRECT_URI = 'http://localhost:5173/email-auth-success'; // TODO: Make dynamic or env var

export class GmailService {
    private static oauth2Client = new google.auth.OAuth2(
        gmailClientId.value(),
        gmailClientSecret.value(),
        REDIRECT_URI
    );

    /**
     * Generates the URL for the user to consent to Gmail access.
     */
    static generateAuthUrl(state?: string): string {
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
    static async handleCallback(userId: string, code: string): Promise<void> {
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
    static async fetchAndSyncEmails(userId: string): Promise<void> {
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
        const auth = new google.auth.OAuth2(
            gmailClientId.value(),
            gmailClientSecret.value()
        );
        auth.setCredentials(tokens as any);

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
            if (!threadMeta.id) continue;

            // Get full thread details
            const threadDetails = await gmail.users.threads.get({
                userId: 'me',
                id: threadMeta.id,
                format: 'full'
            });

            const messages = threadDetails.data.messages;
            if (!messages || messages.length === 0) continue;

            const lastMessage = messages[messages.length - 1]; // Most recent
            const headers = lastMessage.payload?.headers;
            const subject = headers?.find(h => h.name === 'Subject')?.value || '(No Subject)';
            const from = headers?.find(h => h.name === 'From')?.value || 'Unknown';

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
                if (!msg.id) continue;
                const messageRef = conversationRef.collection('messages').doc(msg.id);

                const msgHeaders = msg.payload?.headers;
                const msgFrom = msgHeaders?.find(h => h.name === 'From')?.value || '';

                // Determine direction/actor
                // simplistic check: if from 'me', it's outbound. 
                // We need the user's email address to know who 'me' is properly, or checking labelIds for SENT.
                const isSent = msg.labelIds?.includes('SENT');
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
