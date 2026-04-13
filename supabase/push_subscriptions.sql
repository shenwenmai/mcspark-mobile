-- 创建 push_subscriptions 表（存储 Web Push 订阅信息）
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 启用 pg_cron 扩展（如果尚未启用）
-- CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 启用 pg_net 扩展（用于 HTTP 调用）
-- CREATE EXTENSION IF NOT EXISTS pg_net;

-- 创建每分钟调用 push-check 的 cron job
-- 注意：需要替换 <SUPABASE_URL> 和 <ANON_KEY>
-- SELECT cron.schedule(
--   'push-check-every-minute',
--   '* * * * *',
--   $$
--   SELECT net.http_post(
--     url := 'https://mbotythmvzzztshuynvc.supabase.co/functions/v1/push-check',
--     headers := '{"Authorization": "Bearer <ANON_KEY>"}'::jsonb,
--     body := '{}'::jsonb
--   ) AS request_id;
--   $$
-- );
