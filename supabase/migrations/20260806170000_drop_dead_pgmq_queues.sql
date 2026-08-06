-- Migration: drop the dead pgmq queues 'ingest' and 'index' (audit 2026-08-06)
--
-- DEPLOY NOTE: committed but NOT pushed automatically, same as the other
-- 20260806* migrations.
--
-- 20260406100000:15/18 created four queues. Only two of them ever got wired
-- up:
--   normalize — enqueued by the connectors (_shared/worker.ts) and by
--               retrySource (app/quellen/actions.ts), drained by
--               worker-normalize.
--   embed     — enqueued by worker-normalize, drained by worker-embed.
--   extract   — added later (20260416085324), enqueued by worker-embed,
--               drained by worker-extract-entities.
-- 'ingest' and 'index' have neither a producer nor a consumer. Verified by
-- grep over apps/web/src, supabase/functions, scripts and e2e: the only hit
-- for either name was the QueueName union in
-- supabase/functions/_shared/queue.ts, which advertised them as valid targets
-- to the type checker. That union is narrowed in the same commit.
--
-- pgmq.drop_queue also removes the queue's archive table (pgmq.a_<name>), so
-- any archived message in them is deleted. Both are empty by construction —
-- nothing ever sent to them.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pgmq.list_queues() WHERE queue_name = 'ingest') THEN
    PERFORM pgmq.drop_queue('ingest');
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- Older pgmq builds expose no list_queues(); fall back to a plain drop and
  -- keep the migration idempotent if the queue is already gone.
  BEGIN
    PERFORM pgmq.drop_queue('ingest');
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pgmq queue "ingest" already absent — skipping';
  END;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pgmq.list_queues() WHERE queue_name = 'index') THEN
    PERFORM pgmq.drop_queue('index');
  END IF;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    PERFORM pgmq.drop_queue('index');
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pgmq queue "index" already absent — skipping';
  END;
END $$;
