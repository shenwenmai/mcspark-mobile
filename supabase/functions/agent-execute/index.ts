// AIVault Agent — Supabase Edge Function
// 接收指令 → 读知识库上下文 → 调 Gemini → 返回结果
// Deno Deploy runtime

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ── Gemini API ──
const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY') || ''
const GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
  }>
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
}

async function callGemini(prompt: string, systemInstruction?: string): Promise<{
  text: string
  inputTokens: number
  outputTokens: number
}> {
  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 4096,
    },
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

  const data: GeminiResponse = await res.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
  const usage = data.usageMetadata || data.candidates?.[0]?.usageMetadata || {}
  return {
    text,
    inputTokens: usage.promptTokenCount || 0,
    outputTokens: usage.candidatesTokenCount || 0,
  }
}

// ── Supabase Client ──
function getSupabase(authHeader: string) {
  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  return createClient(url, serviceKey, {
    global: { headers: { Authorization: authHeader } },
  })
}

// ── 读取知识库上下文 ──
async function fetchVaultContext(
  sb: ReturnType<typeof createClient>,
  query: string,
  limit = 20
): Promise<{ items: Array<{ id: string; title: string; summary: string; content: string; tags: string[]; category: string }>; total: number }> {
  // 简单关键词匹配 — 从 query 中提取关键词
  const keywords = query
    .replace(/[？?！!。，,、\s]+/g, ' ')
    .split(' ')
    .filter(w => w.length >= 2)
    .slice(0, 5)

  // 先获取最近的条目作为上下文
  const { data: recentData, error: recentErr } = await sb
    .from('vault_items')
    .select('id, data, deleted')
    .eq('deleted', false)
    .order('updated_at', { ascending: false })
    .limit(200)

  if (recentErr) {
    console.error('[Agent] fetchVaultContext error:', recentErr.message)
    return { items: [], total: 0 }
  }

  const allItems = (recentData || [])
    .filter((r: { deleted?: boolean }) => !r.deleted)
    .map((r: { data: Record<string, unknown> }) => r.data as {
      id: string; title: string; summary: string; content: string; tags: string[]; category: string
    })

  // 如果有关键词，按相关性排序
  if (keywords.length > 0) {
    const scored = allItems.map(item => {
      const haystack = `${item.title || ''} ${item.summary || ''} ${item.content || ''} ${(item.tags || []).join(' ')}`.toLowerCase()
      let score = 0
      for (const kw of keywords) {
        if (haystack.includes(kw.toLowerCase())) score += 1
      }
      return { item, score }
    })
    scored.sort((a, b) => b.score - a.score)
    const relevant = scored.filter(s => s.score > 0).slice(0, limit)
    if (relevant.length > 0) {
      return { items: relevant.map(r => r.item), total: allItems.length }
    }
  }

  // 没有关键词匹配时，返回最近的条目
  return { items: allItems.slice(0, limit), total: allItems.length }
}

// ── 构建 System Prompt ──
function buildSystemPrompt(
  taskType: string,
  vaultItems: Array<{ id: string; title: string; summary: string; content: string; tags: string[]; category: string }>,
  totalItems: number
): string {
  const base = `你是 AIVault 个人知识管理助手。用户有一个包含 ${totalItems} 条知识资产的库。
你的角色是帮助用户：查询知识、分析内容、生成摘要、整理归类、回答基于知识库的问题。

回答规则：
- 用中文回答
- 简洁、有条理、用 Markdown 格式
- 引用知识库内容时标明来源标题
- 如果知识库中没有相关信息，诚实说明
- 不要编造不存在的内容`

  if (vaultItems.length === 0) {
    return base + '\n\n（当前没有找到相关的知识库内容）'
  }

  const contextBlock = vaultItems.map((item, i) => {
    const content = (item.content || '').substring(0, 500)
    return `--- 知识条目 ${i + 1} ---
标题: ${item.title || '无标题'}
分类: ${item.category || '未分类'}
标签: ${(item.tags || []).join(', ') || '无'}
摘要: ${item.summary || '无'}
内容: ${content}${(item.content || '').length > 500 ? '…（已截取）' : ''}`
  }).join('\n\n')

  const typeHint: Record<string, string> = {
    chat: '这是一个问答对话。请基于知识库内容回答用户的问题。',
    analyze: '请对以下知识库内容进行深度分析，找出规律和洞察。',
    summarize: '请对知识库内容生成一份结构化摘要。',
    organize: '请对知识库内容提出整理建议：合并重复、建议分类、补充标签。',
    digest: '请生成一份每日知识摘要，包含最新添加的内容和关键洞察。',
    custom: '请根据用户的具体指令处理。',
  }

  return `${base}

${typeHint[taskType] || typeHint.chat}

以下是从知识库中检索到的相关内容：

${contextBlock}`
}

// ── 主处理逻辑 ──
async function handleRequest(req: Request): Promise<Response> {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const startTime = Date.now()

  try {
    const authHeader = req.headers.get('Authorization') || ''
    const sb = getSupabase(authHeader)

    const body = await req.json()
    const {
      instruction,
      task_type = 'chat',
      context = {},
      source = 'mobile',
      task_id,
    } = body as {
      instruction: string
      task_type?: string
      context?: Record<string, unknown>
      source?: string
      task_id?: string
    }

    if (!instruction || instruction.trim().length === 0) {
      return new Response(JSON.stringify({ error: '指令不能为空' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!GEMINI_KEY) {
      return new Response(JSON.stringify({ error: 'GEMINI_API_KEY 未配置' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 1. 创建或更新任务记录
    let taskId = task_id
    if (!taskId) {
      const { data: taskData, error: taskErr } = await sb
        .from('agent_tasks')
        .insert({
          task_type,
          instruction: instruction.trim(),
          status: 'running',
          context,
          source,
          started_at: new Date().toISOString(),
        })
        .select('id')
        .single()

      if (taskErr) {
        console.error('[Agent] create task error:', taskErr.message)
        // 不阻塞执行，继续处理
      }
      taskId = taskData?.id
    } else {
      // 更新已有任务状态
      await sb
        .from('agent_tasks')
        .update({ status: 'running', started_at: new Date().toISOString() })
        .eq('id', taskId)
    }

    // 2. 检索知识库上下文
    const { items: vaultItems, total } = await fetchVaultContext(sb, instruction, 15)

    // 3. 构建 prompt 并调用 Gemini
    const systemPrompt = buildSystemPrompt(task_type, vaultItems, total)
    const geminiResult = await callGemini(instruction, systemPrompt)

    const duration = Date.now() - startTime

    // 4. 记录日志
    if (taskId) {
      await sb.from('agent_logs').insert({
        task_id: taskId,
        model: GEMINI_MODEL,
        prompt_preview: instruction.substring(0, 2000),
        input_tokens: geminiResult.inputTokens,
        output_tokens: geminiResult.outputTokens,
        duration_ms: duration,
        success: true,
      })

      // 5. 更新任务状态为完成
      await sb.from('agent_tasks').update({
        status: 'done',
        result: geminiResult.text,
        related_item_ids: vaultItems.map(i => i.id),
        completed_at: new Date().toISOString(),
      }).eq('id', taskId)
    }

    // 6. 返回结果
    return new Response(JSON.stringify({
      success: true,
      task_id: taskId,
      result: geminiResult.text,
      related_items: vaultItems.map(i => ({ id: i.id, title: i.title })),
      stats: {
        duration_ms: duration,
        input_tokens: geminiResult.inputTokens,
        output_tokens: geminiResult.outputTokens,
        context_items: vaultItems.length,
        total_items: total,
      },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (e) {
    const errMsg = (e as Error).message || 'Unknown error'
    console.error('[Agent] error:', errMsg)

    return new Response(JSON.stringify({
      success: false,
      error: errMsg,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
}

Deno.serve(handleRequest)
