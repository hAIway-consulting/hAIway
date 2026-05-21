-- Migration: pipedrive_cron
-- Schedule the Pipedrive connector to fan out across all active orgs every
-- 15 minutes. Reuses public.invoke_edge_function() from the ingest pipeline
-- foundation migration.

SELECT cron.schedule(
  'connector-pipedrive-15min',
  '*/15 * * * *',
  $$
  SELECT public.invoke_edge_function(
    'connector-pipedrive',
    jsonb_build_object('action', 'cron', 'trigger', 'cron')
  );
  $$
);
