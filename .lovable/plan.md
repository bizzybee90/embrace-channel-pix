

# Fix C: Add `speed_phase: true` to Email Import Trigger

## What

Add the missing `speed_phase: true` parameter to the `email-import-v2` invocation in `ProgressScreen.tsx` (line 456). Without this flag, the import defaults to fetching up to 30,000 emails instead of the 2,500 onboarding cap.

## Technical Change

**File:** `src/components/onboarding/ProgressScreen.tsx`, line 456

Change:
```typescript
body: { config_id: emailConfig.id, workspace_id: workspaceId },
```

To:
```typescript
body: { config_id: emailConfig.id, workspace_id: workspaceId, speed_phase: true },
```

One line, one parameter. No other files affected.

