-- Cron job draining the `automation` pgmq queue every 30 seconds.
-- The worker exits immediately on an empty queue (pgmq.metrics pre-check),
-- so idle ticks are a single cheap COUNT.

SELECT cron.schedule(
  'worker-automation-30s',
  '30 seconds',
  $$SELECT public.invoke_edge_function('worker-automation', '{}'::jsonb);$$
);
