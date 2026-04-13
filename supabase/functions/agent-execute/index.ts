import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY') || ''
const GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`

async function callGemini(prompt: string, systemInstruction?: string, history?: Array<{ role: string; text: string }>) {
  // 构建多轮对话 contents
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = []

  // 加入对话历史（最近几轮）
  if (history && history.length > 0) {
    for (const h of history) {
      contents.push({
        role: h.role === 'user' ? 'user' : 'model',
        parts: [{ text: h.text }],
      })
    }
  }

  // 加入当前用户消息
  contents.push({ role: 'user', parts: [{ text: prompt }] })

  const body: Record<string, unknown> = {
    contents,
    generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
  }
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] }
  }
  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Gemini API ${res.status}: ${errText.substring(0, 200)}`)
  }
  const data = await res.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
  const usage = data.usageMetadata || data.candidates?.[0]?.usageMetadata || {}
  return { text, inputTokens: usage.promptTokenCount || 0, outputTokens: usage.candidatesTokenCount || 0 }
}

function getSupabase(authHeader: string) {
  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  return createClient(url, serviceKey, { global: { headers: { Authorization: authHeader } } })
}

// 智能提取中文关键词：将长句切成2-4字的短词
function extractKeywords(text: string): string[] {
  const stopWords = ['帮我', '请问', '分析', '摘要', '整理', '总结', '列出', '告诉', '查看', '看看', '了解', '整合', '一下', '一篇', '文档', '内容', '所有', '全部', '关于', '相关', '哪些', '什么', '怎么', '如何', '目前', '不要', '冗长', '最后', '要点', '大概', '知识库', '知识', '多少', '给我', '一个', '可以', '能否', '这个', '那个']

  const segments = text.replace(/[？?！!。，,、\s：:；;（）()""''《》【】\[\]]+/g, '|').split('|').filter(s => s.length >= 2)

  const keywords: string[] = []
  for (const seg of segments) {
    if (stopWords.includes(seg)) continue

    if (seg.length >= 2 && seg.length <= 4) {
      keywords.push(seg)
      continue
    }

    if (seg.length > 4) {
      keywords.push(seg)
      for (let i = 0; i < seg.length - 1; i++) {
        const bi = seg.substring(i, i + 2)
        if (!stopWords.includes(bi)) keywords.push(bi)
      }
      for (let i = 0; i < seg.length - 2; i++) {
        const tri = seg.substring(i, i + 3)
        if (!stopWords.includes(tri)) keywords.push(tri)
      }
    }
  }

  return [...new Set(keywords)].slice(0, 15)
}

// 自动检测任务类型
function detectTaskType(instruction: string): string {
  const text = instruction.toLowerCase()
  if (/摘要|总结|概括|归纳|整合|汇总|要点|综述/.test(text)) return 'summarize'
  if (/分析|对比|比较|评估|洞察|趋势|规律|统计|盘点|领域/.test(text)) return 'analyze'
  if (/整理|分类|归类|标签|重复|合并|清理/.test(text)) return 'organize'
  if (/今日|每日|日报|周报|最近|最新/.test(text)) return 'digest'
  return 'chat'
}

async function fetchVaultContext(
  sb: ReturnType<typeof createClient>,
  query: string,
  taskType: string,
  limit = 20
) {
  const keywords = extractKeywords(query)
  console.log('[Agent] keywords:', keywords)

  const { data: recentData, error: recentErr } = await sb
    .from('vault_items').select('id, data, deleted').eq('deleted', false)
    .order('updated_at', { ascending: false }).limit(500)
  if (recentErr) { console.error('[Agent] fetchVaultContext error:', recentErr.message); return { items: [], total: 0 } }
  const allItems = (recentData || []).filter((r: { deleted?: boolean }) => !r.deleted).map((r: { data: Record<string, unknown> }) => r.data as {
    id: string; title: string; summary: string; content: string; tags: string[]; category: string
  })

  if (keywords.length > 0) {
    const scored = allItems.map(item => {
      const haystack = `${item.title || ''} ${item.summary || ''} ${item.content || ''} ${(item.tags || []).join(' ')} ${item.category || ''}`.toLowerCase()
      let score = 0
      for (const kw of keywords) {
        const kwLower = kw.toLowerCase()
        if (haystack.includes(kwLower)) score += 2
        if ((item.title || '').toLowerCase().includes(kwLower)) score += 5
        if ((item.tags || []).some(t => t.toLowerCase().includes(kwLower))) score += 3
      }
      return { item, score }
    })
    scored.sort((a, b) => b.score - a.score)
    const relevant = scored.filter(s => s.score > 0).slice(0, limit)
    if (relevant.length > 0) {
      console.log('[Agent] found', relevant.length, 'relevant items, top:', relevant[0].item.title, 'score:', relevant[0].score)
      return { items: relevant.map(r => r.item), total: allItems.length }
    }
  }

  return { items: allItems.slice(0, limit), total: allItems.length }
}

function buildSystemPrompt(taskType: string, vaultItems: Array<{ id: string; title: string; summary: string; content: string; tags: string[]; category: string }>, totalItems: number) {
  const base = `你是 AIVault 个人知识管理助手。用户有一个包含 ${totalItems} 条知识资产的库。
你的角色是帮助用户：查询知识、分析内容、生成摘要、整理归类、回答基于知识库的问题。

回答规则：
- 用中文回答
- **必须使用 Markdown 格式**排版，包括标题(##)、加粗(**text**)、列表(- item)、分隔线(---)、引用(>)等
- 内容要有清晰的层级结构，每个主题用 ## 标题分段
- 引用知识库内容时用 **加粗** 标明来源标题
- 数据统计用表格或列表呈现
- 如果知识库中没有相关信息，诚实说明
- 不要编造不存在的内容
- 分析类任务必须覆盖所有提供的知识条目，不要遗漏`

  if (vaultItems.length === 0) return base + '\n\n（当前没有找到相关的知识库内容）'

  const contextBlock = vaultItems.map((item, i) => {
    const content = (item.content || '').substring(0, 500)
    return `[#${i + 1}] 标题: ${item.title || '无标题'} | 分类: ${item.category || '未分类'} | 标签: ${(item.tags || []).join(',') || '无'} | 摘要: ${(item.summary || '').substring(0, 200)} | 内容: ${content}`
  }).join('\n')

  const typeHint: Record<string, string> = {
    chat: '这是一个问答对话。请基于知识库内容回答用户的问题。',
    analyze: `这是一个分析任务。请对以下全部 ${vaultItems.length} 条知识进行全面分析，确保每一条都被覆盖，不要遗漏。用结构化 Markdown 呈现结果。`,
    summarize: `这是一个摘要/总结任务。请对以下全部 ${vaultItems.length} 条知识内容生成一份完整的结构化摘要，用 Markdown 格式排版。确保覆盖所有提供的条目。`,
    organize: `请对以下全部 ${vaultItems.length} 条知识内容提出整理建议：合并重复、建议分类、补充标签。用 Markdown 格式清晰呈现。`,
    digest: `请生成一份全面的知识摘要报告。覆盖以下全部 ${vaultItems.length} 条内容，按主题分组，用 Markdown 格式排版。`,
    custom: '请根据用户的具体指令处理，用 Markdown 格式输出。',
  }

  return `${base}

${typeHint[taskType] || typeHint.chat}

以下是从知识库中检索到的 ${vaultItems.length} 条相关内容（共 ${totalItems} 条）：

${contextBlock}`
}

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const startTime = Date.now()
  try {
    const authHeader = req.headers.get('Authorization') || ''
    const sb = getSupabase(authHeader)
    const body = await req.json()
    let { instruction, task_type = 'chat', context = {}, source = 'mobile', task_id, history = [] } = body as {
      instruction: string; task_type?: string; context?: Record<string, unknown>; source?: string; task_id?: string
      history?: Array<{ role: string; text: string }>
    }
    if (!instruction || instruction.trim().length === 0) {
      return new Response(JSON.stringify({ error: '指令不能为空' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    if (!GEMINI_KEY) {
      return new Response(JSON.stringify({ error: 'GEMINI_API_KEY 未配置' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // 如果前端传了 chat，自动检测是否应该升级
    if (task_type === 'chat') {
      const detected = detectTaskType(instruction)
      if (detected !== 'chat') {
        console.log('[Agent] auto-detected task_type:', detected)
        task_type = detected
      }
    }

    let taskId = task_id
    if (!taskId) {
      const { data: taskData, error: taskErr } = await sb.from('agent_tasks').insert({
        task_type, instruction: instruction.trim(), status: 'running', context, source, started_at: new Date().toISOString(),
      }).select('id').single()
      if (taskErr) console.error('[Agent] create task error:', taskErr.message)
      taskId = taskData?.id
    } else {
      await sb.from('agent_tasks').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', taskId)
    }

    const isFullScan = ['analyze', 'organize', 'digest', 'summarize'].includes(task_type)
    const contextLimit = isFullScan ? 50 : 30

    const { items: vaultItems, total } = await fetchVaultContext(sb, instruction, task_type, contextLimit)
    const systemPrompt = buildSystemPrompt(task_type, vaultItems, total)
    const geminiResult = await callGemini(instruction, systemPrompt, history)
    const duration = Date.now() - startTime
    if (taskId) {
      await sb.from('agent_logs').insert({
        task_id: taskId, model: GEMINI_MODEL, prompt_preview: instruction.substring(0, 2000),
        input_tokens: geminiResult.inputTokens, output_tokens: geminiResult.outputTokens, duration_ms: duration, success: true,
      })
      await sb.from('agent_tasks').update({
        status: 'done', result: geminiResult.text, related_item_ids: vaultItems.map(i => i.id), completed_at: new Date().toISOString(),
      }).eq('id', taskId)
    }
    return new Response(JSON.stringify({
      success: true, task_id: taskId, result: geminiResult.text,
      related_items: vaultItems.map(i => ({ id: i.id, title: i.title })),
      stats: { duration_ms: duration, input_tokens: geminiResult.inputTokens, output_tokens: geminiResult.outputTokens, context_items: vaultItems.length, total_items: total },
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    const errMsg = (e as Error).message || 'Unknown error'
    console.error('[Agent] error:', errMsg)
    return new Response(JSON.stringify({ success: false, error: errMsg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
}

Deno.serve(handleRequest)
