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

// ── URL 检测与抓取 ──
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi

function extractUrls(text: string): string[] {
  return [...new Set((text.match(URL_REGEX) || []).map(u => u.replace(/[.,;:!?）)》\]]+$/, '')))]
}

async function fetchUrlContent(url: string): Promise<string> {
  const errors: string[] = []

  // Strategy 1: Jina Reader（最快、返回干净 Markdown）
  try {
    console.log('[Agent] fetching URL via Jina:', url)
    const r = await fetch(`https://r.jina.ai/${url}`, {
      headers: { 'Accept': 'text/plain', 'X-Return-Format': 'text', 'X-No-Cache': 'true', 'X-Timeout': '15' },
      signal: AbortSignal.timeout(18000),
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const t = await r.text()
    if (!t.trim() || t.length < 50) throw new Error('内容过短')
    console.log('[Agent] Jina success, length:', t.length)
    return t.substring(0, 12000)
  } catch (e) {
    errors.push('Jina:' + (e as Error).message)
  }

  // Strategy 2: CORS proxy
  try {
    console.log('[Agent] fetching URL via proxy')
    const r = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(15000),
    })
    if (r.ok) {
      const json = await r.json()
      const html = json.contents || ''
      // 粗暴提取文本：去掉 script/style 标签，取 textContent
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&[a-z]+;/gi, ' ')
        .replace(/\s{3,}/g, '\n')
        .trim()
      if (text.length >= 100) {
        console.log('[Agent] proxy success, length:', text.length)
        return text.substring(0, 12000)
      }
    }
    throw new Error('代理返回内容不足')
  } catch (e) {
    errors.push('Proxy:' + (e as Error).message)
  }

  // Strategy 3: 用 Gemini url_context 工具
  if (GEMINI_KEY) {
    try {
      console.log('[Agent] fetching URL via Gemini url_context')
      const r = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(45000),
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: `读取并输出以下网页的完整正文内容，用 Markdown 格式，不要总结，不要评论：\n${url}` }] }],
          tools: [{ url_context: {} }],
          generationConfig: { temperature: 0, maxOutputTokens: 8192 },
        }),
      })
      if (r.ok) {
        const d = await r.json()
        const text = d.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('\n').trim() || ''
        if (text.length >= 80) {
          console.log('[Agent] Gemini url_context success, length:', text.length)
          return text.substring(0, 12000)
        }
      }
      throw new Error('Gemini返回不足')
    } catch (e) {
      errors.push('Gemini:' + (e as Error).message)
    }
  }

  throw new Error('URL 抓取失败: ' + errors.join('; '))
}

// ── 意图检测 ──
interface DetectedIntent {
  taskType: string
  actions: string[] // 'save_to_vault' | 'batch_tag' | 'batch_category'
  saveToVault: boolean
  batchTag?: string      // 要批量添加的标签
  batchCategory?: string // 要批量修改的分类
}

function detectIntent(instruction: string): DetectedIntent {
  const text = instruction.toLowerCase()
  const actions: string[] = []

  // 检测任务类型
  let taskType = 'chat'
  if (/摘要|总结|概括|归纳|整合|汇总|要点|综述/.test(text)) taskType = 'summarize'
  else if (/分析|对比|比较|评估|洞察|趋势|规律|统计|盘点|领域/.test(text)) taskType = 'analyze'
  else if (/整理|分类|归类|标签|重复|合并|清理/.test(text)) taskType = 'organize'
  else if (/今日|每日|日报|周报|最近|最新/.test(text)) taskType = 'digest'

  // 检测存入意图
  const saveToVault = /存入|保存|收藏|存到|加入知识库|存进|写入|记录下来|收录/.test(text)
  if (saveToVault) actions.push('save_to_vault')

  // 检测批量标签意图：如 "给所有AI相关的条目加上'人工智能'标签"
  const tagMatch = text.match(/(?:加上|添加|打上|设为|标记为)[""'']?([^""''，。,.\s]{1,10})[""'']?(?:标签|tag)/i)
  const batchTag = tagMatch ? tagMatch[1] : undefined
  if (batchTag) actions.push('batch_tag')

  // 检测批量分类意图
  const catMatch = text.match(/(?:分类为|归类为|移到|移至)[""'']?([^""''，。,.\s]{1,10})[""'']?/i)
  const batchCategory = catMatch ? catMatch[1] : undefined
  if (batchCategory) actions.push('batch_category')

  return { taskType, actions, saveToVault, batchTag, batchCategory }
}

// 保持向后兼容
function detectTaskType(instruction: string): string {
  return detectIntent(instruction).taskType
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

你的能力：
- 阅读链接：用户粘贴 URL，你能读取网页内容并分析
- 存入知识库：用户说"存入/保存/收藏"时，系统会自动将你的回答存入知识库
- 批量标签：用户说"给XX加上YY标签"时，系统会自动批量操作
- 批量分类：用户说"把XX分类为YY"时，系统会自动执行
- 多轮对话：你能记住之前几轮对话的上下文

回答规则：
- 用中文回答
- **必须使用 Markdown 格式**排版，包括标题(##)、加粗(**text**)、列表(- item)、分隔线(---)、引用(>)等
- 内容要有清晰的层级结构，每个主题用 ## 标题分段
- 引用知识库内容时用 **加粗** 标明来源标题
- 数据统计用表格或列表呈现
- 如果知识库中没有相关信息，诚实说明
- 不要编造不存在的内容
- 分析类任务必须覆盖所有提供的知识条目，不要遗漏
- 如果用户要求存入/保存，你的回答内容将作为知识条目被存入，请确保内容完整、结构清晰`

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

    // 意图检测（含任务类型 + 动作）
    const intent = detectIntent(instruction)
    if (task_type === 'chat' && intent.taskType !== 'chat') {
      console.log('[Agent] auto-detected task_type:', intent.taskType)
      task_type = intent.taskType
    }
    if (intent.actions.length > 0) {
      console.log('[Agent] detected actions:', intent.actions)
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

    // ── URL 抓取 ──
    const urls = extractUrls(instruction)
    let urlContents = ''
    if (urls.length > 0) {
      console.log('[Agent] detected URLs:', urls)
      const fetched: string[] = []
      for (const url of urls.slice(0, 3)) { // 最多抓取3个URL
        try {
          const content = await fetchUrlContent(url)
          fetched.push(`\n\n--- 以下是从 ${url} 抓取的网页内容 ---\n${content}\n--- 网页内容结束 ---`)
        } catch (e) {
          fetched.push(`\n\n[⚠️ 无法读取 ${url}: ${(e as Error).message}]`)
        }
      }
      urlContents = fetched.join('\n')
    }

    const isFullScan = ['analyze', 'organize', 'digest', 'summarize'].includes(task_type)
    const contextLimit = isFullScan ? 50 : 30

    const { items: vaultItems, total } = await fetchVaultContext(sb, instruction, task_type, contextLimit)
    let systemPrompt = buildSystemPrompt(task_type, vaultItems, total)

    // 如果有 URL 内容，追加到 system prompt
    if (urlContents) {
      systemPrompt += `\n\n用户消息中包含链接，以下是抓取到的网页内容。请基于这些内容回答用户的问题（总结、分析、提炼等）。如果用户要求存入知识库，请整理成结构化内容。${urlContents}`
    }

    const geminiResult = await callGemini(instruction, systemPrompt, history)

    // ── 后续动作执行 ──
    const executedActions: string[] = []
    let savedItemId: string | null = null

    // 动作1：自动存入知识库
    if (intent.saveToVault && geminiResult.text) {
      try {
        // 用 AI 提取标题（取第一行非空文本，去掉 Markdown 符号）
        const firstLine = geminiResult.text.split('\n').find(l => l.trim().length > 0) || ''
        const autoTitle = firstLine.replace(/^#+\s*/, '').replace(/\*\*/g, '').substring(0, 60) || '来自 Agent'

        // 如果有 URL，用 URL 作为来源
        const itemSource = urls.length > 0 ? urls[0] : 'agent'

        // 智能分类：让 AI 给个分类
        let autoCategory = 'note'
        const catKeywords: Record<string, string[]> = {
          'tech': ['代码', '编程', '技术', '开发', 'API', '框架', '算法'],
          'product': ['产品', '设计', '用户', '需求', '功能', 'PRD'],
          'business': ['商业', '营销', '增长', '运营', '市场', '投资'],
          'reading': ['文章', '书', '阅读', '读书', '笔记', '摘录'],
          'idea': ['想法', '灵感', '创意', '思考', '观点'],
        }
        const resultLower = geminiResult.text.toLowerCase()
        for (const [cat, words] of Object.entries(catKeywords)) {
          if (words.some(w => resultLower.includes(w))) { autoCategory = cat; break }
        }

        const newId = Date.now().toString(36) + Math.random().toString(36).substring(2, 8)
        const now = Date.now()
        const newItem = {
          id: newId,
          title: autoTitle,
          summary: geminiResult.text.substring(0, 200),
          content: geminiResult.text,
          category: autoCategory,
          layer: 'wiki',
          tags: urls.length > 0 ? ['agent-capture', 'url'] : ['agent-capture'],
          source: itemSource,
          status: 'active',
          createdAt: now,
          updatedAt: now,
        }

        const { error: saveErr } = await sb.from('vault_items').upsert({
          id: newId,
          data: newItem,
          updated_at: new Date(now).toISOString(),
          deleted: false,
        })

        if (saveErr) {
          console.error('[Agent] auto-save error:', saveErr.message)
        } else {
          savedItemId = newId
          executedActions.push('save_to_vault')
          console.log('[Agent] auto-saved to vault:', newId, autoTitle)
        }
      } catch (e) {
        console.error('[Agent] auto-save exception:', (e as Error).message)
      }
    }

    // 动作2：批量添加标签
    if (intent.batchTag && vaultItems.length > 0) {
      try {
        let taggedCount = 0
        for (const item of vaultItems) {
          const tags = item.tags || []
          if (!tags.includes(intent.batchTag)) {
            tags.push(intent.batchTag)
            const updatedItem = { ...item, tags, updatedAt: Date.now() }
            await sb.from('vault_items').upsert({
              id: item.id,
              data: updatedItem,
              updated_at: new Date().toISOString(),
              deleted: false,
            })
            taggedCount++
          }
        }
        if (taggedCount > 0) {
          executedActions.push(`batch_tag:${taggedCount}`)
          console.log('[Agent] batch tagged', taggedCount, 'items with:', intent.batchTag)
        }
      } catch (e) {
        console.error('[Agent] batch tag error:', (e as Error).message)
      }
    }

    // 动作3：批量修改分类
    if (intent.batchCategory && vaultItems.length > 0) {
      try {
        let catCount = 0
        for (const item of vaultItems) {
          if (item.category !== intent.batchCategory) {
            const updatedItem = { ...item, category: intent.batchCategory, updatedAt: Date.now() }
            await sb.from('vault_items').upsert({
              id: item.id,
              data: updatedItem,
              updated_at: new Date().toISOString(),
              deleted: false,
            })
            catCount++
          }
        }
        if (catCount > 0) {
          executedActions.push(`batch_category:${catCount}`)
          console.log('[Agent] batch categorized', catCount, 'items to:', intent.batchCategory)
        }
      } catch (e) {
        console.error('[Agent] batch category error:', (e as Error).message)
      }
    }

    // 在结果末尾追加动作执行报告
    let finalResult = geminiResult.text
    if (executedActions.length > 0) {
      const report: string[] = ['\n\n---\n**✅ 已自动执行：**']
      for (const act of executedActions) {
        if (act === 'save_to_vault') report.push('- 已存入知识库')
        else if (act.startsWith('batch_tag:')) report.push(`- 已为 ${act.split(':')[1]} 条知识添加标签「${intent.batchTag}」`)
        else if (act.startsWith('batch_category:')) report.push(`- 已将 ${act.split(':')[1]} 条知识分类修改为「${intent.batchCategory}」`)
      }
      finalResult += report.join('\n')
    }

    const duration = Date.now() - startTime
    if (taskId) {
      await sb.from('agent_logs').insert({
        task_id: taskId, model: GEMINI_MODEL, prompt_preview: instruction.substring(0, 2000),
        input_tokens: geminiResult.inputTokens, output_tokens: geminiResult.outputTokens, duration_ms: duration, success: true,
      })
      await sb.from('agent_tasks').update({
        status: 'done', result: finalResult, related_item_ids: vaultItems.map(i => i.id), completed_at: new Date().toISOString(),
      }).eq('id', taskId)
    }
    return new Response(JSON.stringify({
      success: true, task_id: taskId, result: finalResult,
      related_items: vaultItems.map(i => ({ id: i.id, title: i.title })),
      saved_item_id: savedItemId,
      executed_actions: executedActions,
      stats: { duration_ms: duration, input_tokens: geminiResult.inputTokens, output_tokens: geminiResult.outputTokens, context_items: vaultItems.length, total_items: total },
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    const errMsg = (e as Error).message || 'Unknown error'
    console.error('[Agent] error:', errMsg)
    return new Response(JSON.stringify({ success: false, error: errMsg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
}

Deno.serve(handleRequest)
