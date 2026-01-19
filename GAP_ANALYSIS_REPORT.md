# Gap Analysis & Code Audit Report

**Date**: 2026-01-18
**Status**: ⚠️ SIGNIFICANT GAPS IDENTIFIED

## 1. Executive Summary
The backend migration to Firebase/Gemini is well underway with core "Intelligence" and "Security" services implemented. However, the Frontend is still heavily reliant on Supabase direct DB access and Edge Functions (`supabase.functions.invoke`). **100% of frontend data interactions currently fail** or point to non-existent backends.

## 2. Status Matrix

| Frontend Feature | Current Implementation (Legacy) | New Backend Handler | Status |
| :--- | :--- | :--- | :--- |
| **GDPR Portal** | `supabase.functions.invoke('gdpr-portal-verify')` | `functions.httpsCallable('deleteCustomer')` / `exportCustomer` | ⚠️ **Formatting Mismatch** (Frontend calls wrong function definitions) |
| **Email Connection** | `EmailConnectionStep.tsx` (Aurinko) | `functions.httpsCallable('startGmailAuth')` | ❌ **Frontend Unconnected** (Still points to Aurinko) |
| **Voice Learning** | `VoiceLearning.tsx` (Likely Supabase/Edge) | `functions.httpsCallable('learnVoice')` | ❌ **Frontend Unconnected** |
| **Draft Verification** | `DraftVerificationBadge.tsx` | `functions.httpsCallable('verifyDraft')` | ❌ **Frontend Unconnected** |
| **Conversation List** | `supabase.from('conversations').select('*')` | **Firestore SDK** (`onSnapshot`) | ❌ **Missing Adapter** (Needs Refactor to Firebase SDK) |
| **Diagnostics** | Checks `supabase.from('workspaces')` | **N/A** (Need Firebase Auth check) | ❌ **Broken Logic** |
| **Knowledge Base** | `supabase.from('faqs').delete()` | **Firestore SDK** (Direct Write if Authorized) | ⚠️ **verify rules** |
| **Onboarding** | Extensive `supabase.auth.getSession()` | **Firebase Auth** (`onAuthStateChanged`) | ❌ **Broken Auth Flow** |
| **Test Dashboard** | `supabase.functions.invoke(functionName)` | **Cloud Functions** | ⚠️ **Partial** (Function names likely mismatch) |

## 3. Detailed Component Audit

### 🚨 Critical: Auth & Session Management
- **Files**: `AuthGuard.tsx`, `Onboarding.tsx`, `useUserRole.tsx`
- **Issue**: Heavily reliant on `supabase.auth`. Examples:
    - `await supabase.auth.getSession()`
    - `const { data: { user } } = await supabase.auth.getUser()`
- **Fix**: Must obtain `auth` from `firebase/auth` and replace hooks.

### 🚨 Critical: Direct Database Access
- **Files**: `ConversationView.tsx`, `ChannelsDashboard.tsx`, `Review.tsx`, `ActivityPage.tsx`
- **Issue**: Components directly query Supabase tables.
    - `supabase.from('conversations').select(...)`
    - `supabase.channel(...).on(...)` (Realtime)
- **Fix**: Replace with Firestore `doc()`, `collection()`, `query()`, and `onSnapshot()`.

### ⚠️ Warning: Legacy Edge Functions
- **Files**: `TestDashboard.tsx`, `GDPRPortal.tsx`
- **Issue**: Generic calls to `supabase.functions.invoke('function-name')`.
- **Fix**: Update to `httpsCallable(functions, 'functionName')`. Note that Firebase function names are camelCase (e.g. `learnVoice`), while old ones might be kebab-case.

### ❓ Lovable / External Widgets
- **Files**: `src/hooks/use-mobile.tsx`, `src/hooks/use-tablet.tsx` (UI helpers)
- **Status**: Likely Safe. These seem to be UI state helpers.
- **Flag**: `src/integrations/supabase/*` contains the entire legacy client setup. This *directory* should be scheduled for deletion once migration is complete.

## 4. Next Steps Recommendation
1.  **Stop Backend Dev**: The "Brain" is ready.
2.  **Start "The Great Refactor"**:
    - Phase 1: **Auth Switch**. Replace `AuthGuard` with Firebase Auth. Nothing works without this.
    - Phase 2: **Data Adapter**. Create a `useFirestore` hook or service to abstract the database differences if we want to minimize component churn, OR refactor components one by one.
    - Phase 3: **Feature Re-wiring**. Connect `EmailConnectionStep` to `startGmailAuth`.
