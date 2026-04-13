import { getSupabase } from './supabase'

// ── 类型定义 ──
export interface ChatHistoryItem {
  role: 'user' | 'agent'
  text: string
}

export interface AgentRequest {
  instruction: string
  task_type?: 'chat' | 'analyze' | 'summarize' | 'organize' | 'digest' | 'custom'
  context?: Record<string, unknown>
  source?: string
  history?: ChatHistoryItem[]
}

export interface AgentRelatedItem {
  id: string
  title: string
}

export interface AgentResponse {
  success: boolean
  task_id?: string
  result?: string
  error?: string
  related_items?: AgentRelatedItem[]
  saved_item_id?: string
  executed_actions?: string[]
  stats?: {
    duration_ms: number
    input_tokens: number
    output_tokens: number
    context_items: number
    total_items: number
  }
}

export interface AgentTask {
  id: string
  task_type: string
  instruction: string
  status: 'pending' | 'running' | 'done' | 'failed'
  result: string | null
  error: string | null
  related_item_ids: string[]
  source: string
  created_at: string
  completed_at: string | null
}

// ── 调用 Agent Edge Function ──
export async function executeAgent(req: AgentRequest): Promise<AgentResponse> {
  const sb = getSupabase()
  if (!sb) throw new Error('Supabase 未连接')

  // 获取 Supabase URL 和 Key
  const sbUrl = localStorage.getItem('sb_url')
  const sbKey = localStorage.getItem('sb_key')
  if (!sbUrl || !sbKey) throw new Error('Supabase 配置缺失')

  const functionUrl = `${sbUrl}/functions/v1/agent-execute`

  const res = await fetch(functionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sbKey}`,
      'apikey': sbKey,
    },
    body: JSON.stringify({
      instruction: req.instruction,
      task_type: req.task_type || 'chat',
      context: req.context || {},
      source: req.source || 'mobile',
      history: req.history || [],
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Agent 调用失败 (${res.status}): ${errText.substring(0, 200)}`)
  }

  return await res.json()
}

// ── 获取历史任务 ──
export async function fetchAgentTasks(limit = 50): Promise<AgentTask[]> {
  const sb = getSupabase()
  if (!sb) return []

  try {
    const { data, error } = await sb
      .from('agent_tasks')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.warn('[Agent] fetchTasks error:', error.message)
      return []
    }
    return data || []
  } catch (e) {
    console.warn('[Agent] fetchTasks exception:', (e as Error).message)
    return []
  }
}

// ── 删除任务 ──
export async function deleteAgentTask(taskId: string): Promise<void> {
  const sb = getSupabase()
  if (!sb) return

  const { error } = await sb.from('agent_tasks').delete().eq('id', taskId)
  if (error) console.warn('[Agent] deleteTask error:', error.message)
}

// ── 预设快捷指令 ──
export const QUICK_COMMANDS = [
  { label: '📊 今日摘要', instruction: '生成今日知识库摘要，列出最新添加的内容和关键洞察', task_type: 'digest' as const },
  { label: '🔍 知识盘点', instruction: '盘点我的知识库，按分类统计数量，找出内容最多和最少的领域', task_type: 'analyze' as const },
  { label: '🏷️ 标签建议', instruction: '检查知识库中缺少标签或标签不一致的条目，给出整理建议', task_type: 'organize' as const },
  { label: '💡 发现关联', instruction: '分析知识库中不同条目之间的隐藏关联，找出跨领域的联系', task_type: 'analyze' as const },
  { label: '📝 周报草稿', instruction: '根据最近一周添加的知识内容，生成一份周报草稿', task_type: 'summarize' as const },
  { label: '🧹 清理建议', instruction: '找出知识库中可能重复、过时或质量较低的条目，给出清理建议', task_type: 'organize' as const },
]
