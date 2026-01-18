# Data Map & Schema Specification

**Goal:** Switch completely from Supabase/Aurinko to Firebase/Gmail API while keeping the Frontend `src/lib/types.ts` contracts intact.

## 1. Feature Mapping

| Frontend Requirement | Old Tool (Supabase/Aurinko) | New Tool (Google Native) | Notes |
| :--- | :--- | :--- | :--- |
| **User Sign Up/Login** | Supabase Auth (Email/Pass + OAuth) | **Firebase Auth** | Enable Google Provider & Email/Pass in Firebase Console. |
| **Session Management** | Supabase Session Context | **Firebase Auth State Listener** | Replace `AuthGuard.tsx` logic. |
| **Workspace Data** | `workspaces` table (Postgres) | **Firestore `workspaces` collection** | Root-level collection. |
| **User Profile** | `users` table (linked to auth.uid) | **Firestore `users` collection** | Keyed by `uid`. |
| **Email Connection** | Aurinko (OAuth + Sync) | **Gmail API** + **Firestore** | Store tokens securely (or rely on Firebase Auth Google scopes). |
| **Inbox Sync (History)** | Aurinko Virtual Inbox | **Gmail API `history.list`** | Cloud Function to fetch & populate Firestore. |
| **New Email Event** | Aurinko Webhook -> Supabase Edge | **Gmail Push (Pub/Sub) -> Cloud Function** | Real-time email ingestion. |
| **Conversation List** | `conversations` table | **Firestore `conversations` collection** | Realtime updates via `onSnapshot`. |
| **Message Thread** | `messages` table | **Firestore `messages` sub-collection** | `conversations/{id}/messages`. |
| **Sending Emails** | Aurinko API (`/messages`) | **Gmail API (`users.messages.send`)** | Cloud Function wraps this for security. |
| **Contacts/Customers** | `customers` table | **Firestore `customers` collection** | Global address book per workspace. |
| **Templates** | `templates` table | **Firestore `templates` collection** | Shared canned responses. |
| **File Attachments** | Supabase Storage buckets | **Firebase Storage** | Buckets for email attachments. |
| **Vector Search (RAG)** | `pgvector` in Supabase | **Emeddings + Vector Store** | *Deferred*: Use simple Firestore queries or temporary in-memory RAG for now. |

---

## 2. Firestore Schema Definition

The database will be structured to match the interfaces in `src/lib/types.ts` as closely as possible to minimize frontend refactoring.

### Collection: `workspaces`
*Root collection.*
```json
{
  "id": "workspace_123",
  "name": "Acme Corp Support",
  "slug": "acme-corp",
  "timezone": "America/New_York",
  "business_hours_start": "09:00",
  "business_hours_end": "17:00",
  "business_days": [1, 2, 3, 4, 5],
  "created_at": "TIMESTAMP"
}
```

### Collection: `users`
*Keyed by Auth UID.*
```json
{
  "id": "user_uid_123",
  "workspace_id": "workspace_123", /* active workspace */
  "email": "agent@acme.com",
  "name": "Alice Agent",
  "is_online": true,
  "status": "available", /* available, away, busy */
  "role": "manager", /* from UserRole interface */
  "created_at": "TIMESTAMP"
}
```

### Collection: `conversations`
*Matches `Conversation` interface.*
```json
{
  "id": "conv_123",
  "workspace_id": "workspace_123",
  "customer_id": "cust_123",
  "external_id": "gmail_thread_id_abc123", /* Maps to Gmail Thread ID */
  
  /* Core Display Data */
  "title": "Issue with Order #999",
  "summary_for_human": "Customer asking for refund on late delivery.",
  "channel": "email",
  "category": "order_issue",
  "priority": "high",
  "status": "open",
  
  /* AI Fields */
  "ai_confidence": 0.95,
  "ai_sentiment": "negative",
  "ai_reason_for_escalation": "Refund keywords detected.",
  "decision_bucket": "act_now", /* act_now, quick_win, auto_handled, wait */
  "why_this_needs_you": "Financial risk detected",
  "cognitive_load": "low",
  
  /* Assignment & SLA */
  "assigned_to": "user_uid_123",
  "sla_target_minutes": 60,
  "sla_due_at": "TIMESTAMP",
  "sla_status": "warning",
  
  /* Timestamps */
  "created_at": "TIMESTAMP",
  "updated_at": "TIMESTAMP",
  "last_message_at": "TIMESTAMP"
}
```

### Sub-collection: `conversations/{conv_id}/messages`
*Matches `Message` interface.*
```json
{
  "id": "msg_123", /* Firestore Auto ID */
  "external_id": "gmail_msg_id_xyz", /* Maps to Gmail Message ID */
  "conversation_id": "conv_123",
  "actor_type": "customer", /* customer, human_agent, ai_agent */
  "actor_id": "cust_123", /* or user_uid */
  "actor_name": "Bob Customer",
  "direction": "inbound", /* inbound, outbound */
  "channel": "email",
  "body": "Where is my refund?",
  "raw_payload": { ... }, /* Full Gmail JSON for debugging */
  "attachments": [
    {
      "name": "receipt.pdf",
      "path": "gs://bucket/path/to/receipt.pdf",
      "size": 1024,
      "type": "application/pdf"
    }
  ],
  "created_at": "TIMESTAMP"
}
```

### Collection: `customers`
*Matches `Customer` interface.*
```json
{
  "id": "cust_123",
  "workspace_id": "workspace_123",
  "name": "Bob Customer",
  "email": "bob@example.com",
  "phone": "+15550199",
  "tier": "regular",
  "notes": "Frequent returner",
  "custom_fields": {
    "ltv": 500
  },
  "created_at": "TIMESTAMP"
}
```

### Collection: `settings` (or `configurations`)
*Stores singleton config documents per workspace.*
- Document: `workspace_123_email_config`
  ```json
  {
    "workspace_id": "workspace_123",
    "provider": "gmail",
    "email_address": "support@acme.com",
    "history_id": "123456789", /* Last synced Gmail History ID */
    "scopes": ["..."],
    "watch_expiration": "TIMESTAMP"
  }
  ```
- Document: `workspace_123_automation`
  ```json
  {
    "auto_send_enabled": false,
    "confidence_threshold": 0.8
  }
  ```

## 3. Storage Structure (Firebase Storage)
`/workspaces/{workspace_id}/attachments/{message_id}/{filename}`

## 4. Key Logic Changes

1.  **AuthGuard**:
    - **Old**: Checks `supabase.auth.getSession()` + `ProfileContext`.
    - **New**: Listen to `auth.onAuthStateChanged()`. On login, fetch `users/{uid}` from Firestore to get `workspace_id`.

2.  **Data Fetching**:
    - **Old**: `supabase.from('conversations').select('*')`
    - **New**: `const q = query(collection(db, 'conversations'), where('workspace_id', '==', activeIds.workspace))`

3.  **Realtime Updates**:
    - **Old**: `supabase.channel(...).on(...)`
    - **New**: `onSnapshot(q, (snapshot) => { ... })`
