-- Disable redundant pg_cron polling workers now handled by n8n
-- These fire every 60-120s (24/7) even when idle, costing ~5,760 invocations/day

SELECT cron.unschedule('classify-emails-worker');
SELECT cron.unschedule('hydrate-emails-worker');
SELECT cron.unschedule('process-emails-worker');
SELECT cron.unschedule('pipeline-watchdog');