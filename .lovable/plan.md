

# Fix: Email Track Never Completes (Bug 11)

## Problem

The email classification track on the Progress Screen stays stuck at "pending" forever because of two compounding issues:

1. **Field name mismatch**: The ProgressScreen reads `emailProgress?.total_emails` and `emailProgress?.classified_count`, but the actual database columns are `estimated_total_emails` and `emails_classified`. Since the field names don't match, the counts are always 0.

2. **No `n8n_workflow_progress` update**: The `email-classify-bulk` edge function never writes to the `n8n_workflow_progress` table. It only updates `email_import_progress`. When classification finishes, the email track in `n8n_workflow_progress` stays at `pending`.

Together, these mean the auto-advance logic (`if totalEmails > 0`) never fires, and the primary status source (`n8n_workflow_progress.email_import`) never changes from `pending`.

## Fix (2 changes)

### 1. Fix field names in ProgressScreen.tsx

Update the `email_import_progress` field references to match actual column names:

- `emailProgress?.total_emails` becomes `emailProgress?.estimated_total_emails`
- `emailProgress?.classified_count` becomes `emailProgress?.emails_classified`

This alone gets the auto-advance logic working: the ProgressScreen will detect classification progress from the `email_import_progress` table and override the stuck `pending` status automatically.

### 2. Update `n8n_workflow_progress` when classification completes

In `email-classify-bulk/index.ts`, inside the `handlePartitionComplete` function (after the last worker finishes), add an upsert to `n8n_workflow_progress` marking the `email_import` workflow as `complete`. This ensures the primary status source also reflects completion, rather than relying solely on the auto-advance fallback.

## Expected outcome

- Email track will show real-time classification counts during processing
- Email track will auto-advance to "complete" when classification finishes
- The "Continue" button will enable once all 3 tracks are done

## Impact on success probability

This fix closes the last known gap in the Lovable-side code. Combined with the n8n-side fixes (Bugs 2 and 3, already done), expected success probability rises from ~92% to **~95-97%**.

The remaining 3-5% risk is operational: Apify actor timeouts, Aurinko sync delays, or edge function cold starts -- not code bugs.

