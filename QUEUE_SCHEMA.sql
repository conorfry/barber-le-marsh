-- ─────────────────────────────────────────────────────────────────
-- Barber le Marsh — Virtual Queue Schema
-- Run in Supabase: Dashboard → SQL Editor → New Query → Run
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE daily_queue (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at     TIMESTAMPTZ DEFAULT now(),
  customer_name  TEXT        NOT NULL,
  phone_number   TEXT        NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'waiting'
                             CHECK (status IN ('waiting','active','completed','noshow')),
  queue_order    SERIAL
);

-- Allow all operations (tighten per-row with RLS policies in production)
ALTER TABLE daily_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON daily_queue FOR ALL USING (true) WITH CHECK (true);

-- Enable Realtime for live push to both portals
ALTER PUBLICATION supabase_realtime ADD TABLE daily_queue;
