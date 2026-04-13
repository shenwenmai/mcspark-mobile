import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * Agent 定时任务 Edge Function
 *
 * 通过 Supabase Dashboard 配置 Cron 调度触发
 * 支持：每日摘要、每周报告、清理建议
 */

const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY') || ''
const GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function getSupabase() {
  const url = Deno.env.get('SUPABASE_URL')!
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  return createClient(url, key)
}

async function callGemini(prompt: string, systemInstruction: string) {
  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      systemInstruction: { parts: [{ text: systemInstruction }] },
      generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
    }),
  })
  if (!res.ok) throw new Error(`Gemini ${res.status}`)
  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
}

// ── 预定义任务 ──

interface CronJob {
  type: string
  title: string
  instruction: string
  systemExtra: string
}

const CRON_JOBS: Record<string, CronJob> = {
  daily_digest: {
    type: 'digest',
    title: '📊 每日知识摘要',
    instruction: '生成今日知识库变化摘要',
    systemExtra: '生成一份简洁的每日摘要报告：新增了哪些内容、哪些领域有更新、有什么值得关注的趋势。控制在 300 字以内，用 Markdown 排版。',
  },
  weekly_report: {
    type: 'weekly',
    title: '📝 每周知识报告',
    instruction: '生成本周知识库报告',
    systemExtra: '生成一份周度知识报告：本周新增数量、按分类统计、重点内容摘要、知识库增长趋势、建议下周关注的方向。用 Markdown 排版，结构清晰。',
  },
  cleanup_check: {
    type: 'cleanup',
    title: '🧹 清理建议',
    instruction: '检查知识库中需要清理的条目',
    systemExtra: '检查知识库，找出：(1) 可能重复的条目 (2) 标题或内容为空/过短的条目 (3) 缺少标签的条目 (4) 分类可能不准确的条目。给出具体的清理建议列表，控制在 500 字以内。',
  },
}

async function runCronJob(jobName: string): Promise<{ success: boolean; message: string }> {
  const job = CRON_JOBS[jobName]
  if (!job) return { success: false, message: `未知任务: ${jobName}` }

  const sb = getSupabase()
  const startTime = Date.now()

  try {
    // 获取知识库概况
    const { data: items, error } = await sb
      .from('vault_items').select('id, data, deleted').eq('deleted', false)
      .order('updated_at', { ascending: false }).limit(500)

    if (error) throw new Error('读取知识库失败: ' + error.message)

    const allItems = (items || []).filter((r: { deleted?: boolean }) => !r.deleted)
      .map((r: { data: Record<string, unknown> }) => r.data as {
        id: string; title: string; summary: string; content: string; tags: string[]; category: string; createdAt: number; updatedAt: number
      })

    // 按时间分组统计
    const now = Date.now()
    const oneDayAgo = now - 86400000
    const oneWeekAgo = now - 7 * 86400000

    const todayItems = allItems.filter(i => (i.createdAt || 0) > oneDayAgo)
    const weekItems = allItems.filter(i => (i.createdAt || 0) > oneWeekAgo)

    // 分类统计
    const catCount: Record<string, number> = {}
    for (const item of allItems) {
      const cat = item.category || '未分类'
      catCount[cat] = (catCount[cat] || 0) + 1
    }

    const statsBlock = `知识库统计：
- 总条目数：${allItems.length}
- 今日新增：${todayItems.length}
- 本周新增：${weekItems.length}
- 分类分布：${Object.entries(catCount).map(([k, v]) => `${k}(${v})`).join('、')}

最近新增条目：
${todayItems.slice(0, 10).map((i, idx) => `${idx + 1}. ${i.title || '无标题'} [${i.category || '未分类'}]`).join('\n') || '（今日暂无新增）'}

本周条目样本：
${weekItems.slice(0, 20).map((i, idx) => `${idx + 1}. ${i.title || '无标题'} | 标签: ${(i.tags || []).join(',') || '无'} | 分类: ${i.category || '未分类'}`).join('\n') || '（本周暂无新增）'}`

    const systemPrompt = `你是 AIVault 知识库助手，正在执行定时任务。\n\n${job.systemExtra}\n\n${statsBlock}`

    const result = await callGemini(job.instruction, systemPrompt)
    const duration = Date.now() - startTime

    // 记录任务
    const { data: taskData } = await sb.from('agent_tasks').insert({
      task_type: job.type,
      instruction: `[定时] ${job.instruction}`,
      status: 'done',
      result,
      source: 'cron',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
    }).select('id').single()

    // 写入通知
    await sb.from('agent_notifications').insert({
      task_id: taskData?.id,
      type: job.type,
      title: job.title,
      content: result,
    })

    // 写日志
    if (taskData?.id) {
      await sb.from('agent_logs').insert({
        task_id: taskData.id,
        model: GEMINI_MODEL,
        prompt_preview: job.instruction,
        duration_ms: duration,
        success: true,
      })
    }

    console.log(`[Cron] ${jobName} completed in ${duration}ms`)
    return { success: true, message: `${job.title} 执行完成` }

  } catch (e) {
    const errMsg = (e as Error).message
    console.error(`[Cron] ${jobName} failed:`, errMsg)

    await sb.from('agent_tasks').insert({
      task_type: job.type,
      instruction: `[定时] ${job.instruction}`,
      status: 'failed',
      error: errMsg,
      source: 'cron',
    })

    return { success: false, message: errMsg }
  }
}

// ── 请求处理 ──
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    let jobName = 'daily_digest' // 默认执行每日摘要

    // 支持通过 body 或 query 指定任务
    if (req.method === 'POST') {
      try {
        const body = await req.json()
        jobName = body.job || body.type || 'daily_digest'
      } catch {
        // body 解析失败，用默认
      }
    } else {
      const url = new URL(req.url)
      jobName = url.searchParams.get('job') || 'daily_digest'
    }

    // 支持 "all" 执行所有任务
    if (jobName === 'all') {
      const results: Record<string, { success: boolean; message: string }> = {}
      for (const name of Object.keys(CRON_JOBS)) {
        results[name] = await runCronJob(name)
      }
      return new Response(JSON.stringify({ success: true, results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const result = await runCronJob(jobName)
    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (e) {
    return new Response(JSON.stringify({ success: false, message: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
