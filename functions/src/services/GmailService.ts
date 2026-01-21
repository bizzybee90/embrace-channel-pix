import * as admin from 'firebase-admin';
import { defineSecret } from 'firebase-functions/params';

// Define secrets
const gmailClientId = defineSecret('GMAIL_CLIENT_ID');
const gmailClientSecret = defineSecret('GMAIL_CLIENT_SECRET');

// Redirect URI for OAuth flow
const REDIRECT_URI = 'http://localhost:5173/email-auth-success';

export class GmailService {
    private static async getOAuthClient() {
        const { google } = await import('googleapis');
        return new google.auth.OAuth2(
            gmailClientId.value(),
            gmailClientSecret.value(),
            REDIRECT_URI
        );
    }

    /**
     * Generates the URL for the user to consent to Gmail access.
     */
    static async generateAuthUrl(state?: string): Promise<string> {
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
    static async handleCallback(userId: string, code: string): Promise<void> {
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
    static async fetchAndSyncEmails(userId: string): Promise<void> {
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
        const { google } = await import('googleapis');
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

            const threadDetails = await gmail.users.threads.get({
                userId: 'me',
                id: threadMeta.id,
                format: 'full'
            });

            const messages = threadDetails.data.messages;
            if (!messages || messages.length === 0) continue;

            const lastMessage = messages[messages.length - 1];
            const headers = lastMessage.payload?.headers;
            const subject = headers?.find(h => h.name === 'Subject')?.value || '(No Subject)';
            const from = headers?.find(h => h.name === 'From')?.value || 'Unknown';

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
                if (!msg.id) continue;
                const messageRef = conversationRef.collection('messages').doc(msg.id);

                const msgHeaders = msg.payload?.headers;
                const msgFrom = msgHeaders?.find(h => h.name === 'From')?.value || '';
                const isSent = msg.labelIds?.includes('SENT');
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
