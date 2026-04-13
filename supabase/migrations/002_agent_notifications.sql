-- ============================================
-- Agent 通知表 — 存储定时任务结果
-- ============================================

CREATE TABLE IF NOT EXISTS agent_notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID REFERENCES agent_tasks(id) ON DELETE CASCADE,

  -- 通知类型：digest(每日摘要), weekly(周报), cleanup(清理建议), custom
  type TEXT NOT NULL DEFAULT 'digest',

  -- 标题和内容
  title TEXT NOT NULL,
  content TEXT NOT NULL,

  -- 是否已读
  read BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ DEFAULT now()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_agent_notif_read ON agent_notifications(read, created_at DESC);

-- RLS
ALTER TABLE agent_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent_notif_all" ON agent_notifications FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON agent_notifications TO anon, service_role;
