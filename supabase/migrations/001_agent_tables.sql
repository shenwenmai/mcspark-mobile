-- ============================================
-- AIVault Agent 数据表
-- 在 Supabase SQL Editor 中执行此脚本
-- ============================================

-- 1. Agent 任务表：存储待执行和已完成的 Agent 指令
CREATE TABLE IF NOT EXISTS agent_tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- 任务类型：chat(对话问答), analyze(分析), summarize(摘要), organize(整理),
  --           digest(每日摘要), custom(自定义指令)
  task_type TEXT NOT NULL DEFAULT 'chat',

  -- 用户输入的原始指令
  instruction TEXT NOT NULL,

  -- 执行状态：pending(待执行) → running(执行中) → done(完成) / failed(失败)
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed')),

  -- AI 返回的结果（Markdown 格式）
  result TEXT,

  -- 错误信息（失败时）
  error TEXT,

  -- 关联的知识库条目 ID 列表（JSON 数组）
  related_item_ids JSONB DEFAULT '[]'::jsonb,

  -- 执行上下文（可存任意辅助信息）
  context JSONB DEFAULT '{}'::jsonb,

  -- 来源：mobile / desktop / cron
  source TEXT DEFAULT 'mobile',

  -- 定时任务用：cron 表达式（如 "0 8 * * *" = 每天8:00）
  schedule TEXT,

  -- 时间戳
  created_at TIMESTAMPTZ DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- 用于定时任务的下次执行时间
  next_run_at TIMESTAMPTZ
);

-- 2. Agent 执行日志表：记录每次 AI 调用的详情（调试用）
CREATE TABLE IF NOT EXISTS agent_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID REFERENCES agent_tasks(id) ON DELETE CASCADE,

  -- 调用的模型
  model TEXT,

  -- 发送的 prompt（截取前2000字）
  prompt_preview TEXT,

  -- 返回的 token 数
  input_tokens INT,
  output_tokens INT,

  -- 耗时（毫秒）
  duration_ms INT,

  -- 成功/失败
  success BOOLEAN DEFAULT true,
  error TEXT,

  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. 索引
CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_created ON agent_tasks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_schedule ON agent_tasks(schedule) WHERE schedule IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_logs_task ON agent_logs(task_id);

-- 4. RLS（Row Level Security）— 个人使用，允许 anon key 全权访问
ALTER TABLE agent_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_tasks_all" ON agent_tasks FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "agent_logs_all" ON agent_logs FOR ALL USING (true) WITH CHECK (true);

-- 5. 给 anon 和 service_role 授权
GRANT ALL ON agent_tasks TO anon, service_role;
GRANT ALL ON agent_logs TO anon, service_role;
