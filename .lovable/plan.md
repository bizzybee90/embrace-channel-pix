

# Drop Foreign Key Constraint on competitor_sites.job_id

## What This Does

Removes the requirement that every `job_id` in `competitor_sites` must reference an existing record in `competitor_research_jobs`. The `job_id` column stays for tracking purposes, but inserts will no longer fail when the job record doesn't exist.

## Technical Details

Run one SQL migration:

```sql
ALTER TABLE competitor_sites DROP CONSTRAINT IF EXISTS competitor_sites_job_id_fkey;
```

This is a safe, non-destructive change -- no data is lost, and the column remains available for grouping and filtering.

## After This

1. Fix the leading `=` typo in the n8n "Status: Complete" URL field
2. Re-run the discovery workflow to confirm all 18 competitors save successfully and the callback fires

