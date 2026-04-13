-- ============================================
-- 定时提醒表 — 存储用户自定义任务提醒
-- ============================================

CREATE TABLE IF NOT EXISTS task_reminders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- 提醒标题
  title TEXT NOT NULL,

  -- 提醒时间 "HH:MM" 24小时制（用户本地时间）
  remind_time TEXT NOT NULL,

  -- 重复日期：0=周日, 1=周一 ... 6=周六
  repeat_days INTEGER[] DEFAULT ARRAY[1,2,3,4,5],

  -- 是否启用
  enabled BOOLEAN DEFAULT true,

  -- 上次触发日期 "YYYY-MM-DD"，防止同一天重复
  last_triggered_date TEXT,

  created_at TIMESTAMPTZ DEFAULT now()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_reminders_enabled ON task_reminders(enabled, remind_time);

-- RLS
ALTER TABLE task_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reminders_all" ON task_reminders FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON task_reminders TO anon, service_role;
