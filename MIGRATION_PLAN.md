# Migration Plan: Supabase & Aurinko to Google Native Stack

This document outlines the steps to migrate the Escalation Hub from the current Lovable/Supabase/Aurinko stack to a purely Google Native Stack (Firebase + Gmail API).

## 1. Overview
The goal is to remove dependencies on third-party aggregators (Aurinko) and external backend-as-a-service providers (Supabase) in favor of a direct, scalable Google Cloud architecture.

- **Frontend**: React (Vite) hosted on Firebase Hosting.
- **Backend Logic**: Firebase Cloud Functions (Node.js).
- **Database**: Firestore (NoSQL).
- **Auth**: Firebase Authentication.
- **Email Integration**: Direct Gmail API v1 reference.

## 2. Identified Dependencies

### A. Aurinko (Email Sync & Auth)
These files and functions currently handle email synchronization via Aurinko and need to be replaced with direct Gmail API logic.

**Backend (Supabase Edge Functions to be removed):**
- `supabase/functions/aurinko-auth-callback/`
- `supabase/functions/aurinko-auth-start/`
- `supabase/functions/aurinko-exchange-token/`
- `supabase/functions/aurinko-webhook/`
- `supabase/functions/refresh-aurinko-subscriptions/`

**Frontend (Components to be refactored):**
- `src/pages/EmailAuthSuccess.tsx` (Handle Google OAuth redirect instead)
- `src/components/onboarding/EmailConnectionStep.tsx` (Trigger Google Sign-In with Gmail scopes)
- `src/components/settings/EmailAccountCard.tsx`
- `src/components/settings/ChannelManagementPanel.tsx`
- `src/components/admin/QuotaMonitor.tsx` (Remove or adapt for Google Quotas)

### B. Supabase (Auth, DB, Realtime)
The entire Supabase client integration will be replaced by the Firebase Admin SDK (backend) and Firebase Client SDK (frontend).

**Configuration & Types:**
- `src/integrations/supabase/` (Delete after migration)
- `supabase/` (Full directory to be archived/deleted)
- `src/vite-env.d.ts` (Remove Supabase types)

**Core Components (Heavy Refactor Needed):**
- `src/components/AuthGuard.tsx` -> Switch to `onAuthStateChanged` from Firebase.
- All Data Fetching logic using `supabase.from(...)` -> Switch to `collection(...).doc(...)` (Firestore).
- Realtime subscriptions -> Switch to `onSnapshot` (Firestore).

## 3. Migration Steps

### Phase 1: Initialization (Current Step)
- [x] Identify legacy files.
- [ ] Initialize `firebase.json` and basic project structure.
- [ ] Install `firebase-admin`, `firebase-functions`, `googleapis`.

### Phase 2: Authentication & Database Setup
1.  **Setup Firebase Auth**: Enable Google Provider.
2.  **Schema Migration**: Map Relational (Postgres) data to Document (Firestore) structure.
    *   *Users* table -> `users` collection.
    *   *Conversations* -> `conversations` collection.
    *   *Messages* -> Sub-collection `conversations/{id}/messages`.
3.  **Refactor AuthGuard**: Implement Firebase Auth state listener.

### Phase 3: Gmail Integration (Replacing Aurinko)
1.  **Auth Flow**: Implement Google OAuth 2.0 flow with `https://www.googleapis.com/auth/gmail.modify` scope.
2.  **Watch Push Notifications**: Create a Cloud Function to handle Gmail `watch()` push notifications (Pub/Sub).
3.  **Sync Logic**: Create functions to fetch history/messages using `googleapis` library.

### Phase 4: Cleanup
1.  Delete `supabase/` directory.
2.  Delete `src/integrations/supabase/`.
3.  Remove unused dependencies (`@supabase/supabase-js`, etc.).

## 4. Key Architectural Changes

| Feature | Old Stack (Supabase/Aurinko) | New Stack (Firebase/Google) |
| :--- | :--- | :--- |
| **Auth** | Supabase Auth | Firebase Auth |
| **User Data** | Postgres `users` table | Firestore `users` collection |
| **Email Interface** | Aurinko Unified API | Google Gmail API (Direct) |
| **Backend** | Deno Edge Functions | Node.js Cloud Functions |
| **Realtime** | Supabase Realtime | Firestore Realtime Listeners |
