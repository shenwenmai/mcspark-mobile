/**
 * push-check — 定时检查提醒，通过 Web Push 发送通知
 * 由 pg_cron 每分钟调用一次
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import webpush from 'npm:web-push@3.6.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const VAPID_PUBLIC_KEY = 'BMbCTxW3XU--j1x98lv3odVmfKttIGxs8jwJzteP6PKCGg15jlacpb9HgnAHLL069BZ9SS7GD-ULkGv29qu0fmQ'
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') || 'xDoY8xBpRDvVDREUqkXRM-X8gnAQ2Db5xPLKIhjBodw'

webpush.setVapidDetails(
  'mailto:admin@mcspark.app',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sb = createClient(supabaseUrl, serviceKey)

    // 当前时间（UTC+8 中国时区）
    const now = new Date(Date.now() + 8 * 3600 * 1000)
    const currentDay = now.getUTCDay()
    const today = now.toISOString().split('T')[0]
    const hh = String(now.getUTCHours()).padStart(2, '0')
    const mm = String(now.getUTCMinutes()).padStart(2, '0')
    const nowTime = `${hh}:${mm}`

    // 查询所有启用的提醒
    const { data: reminders, error: rErr } = await sb
      .from('task_reminders')
      .select('*')
      .eq('enabled', true)

    if (rErr) {
      return new Response(JSON.stringify({ error: rErr.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!reminders || reminders.length === 0) {
      return new Response(JSON.stringify({ checked: 0, sent: 0, time: nowTime }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 查询所有推送订阅
    const { data: subscriptions, error: sErr } = await sb
      .from('push_subscriptions')
      .select('*')

    if (sErr || !subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({ checked: reminders.length, sent: 0, reason: 'no subscriptions', time: nowTime }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let sentCount = 0
    const expiredEndpoints: string[] = []

    for (const r of reminders) {
      // 解析 repeat_days
      let days: number[] = []
      try {
        days = Array.isArray(r.repeat_days)
          ? r.repeat_days
          : (typeof r.repeat_days === 'string' ? JSON.parse(r.repeat_days) : [])
      } catch { days = [] }

      if (!days.includes(currentDay)) continue
      if (r.last_triggered_date === today) continue

      // 时间匹配（精确到分钟）
      const reminderTime = r.remind_time.substring(0, 5)
      if (reminderTime !== nowTime) continue

      // 匹配！发送推送
      const payload = JSON.stringify({
        title: '⏰ ' + r.title,
        body: `提醒时间：${r.remind_time}`,
        tag: 'reminder-' + r.id,
        url: '/',
      })

      for (const sub of subscriptions) {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            payload,
            { TTL: 86400 }
          )
          sentCount++
        } catch (e: any) {
          if (e.statusCode === 410 || e.statusCode === 404) {
            expiredEndpoints.push(sub.endpoint)
          } else {
            console.warn('[PushCheck] 发送失败:', e.statusCode || e.message)
          }
        }
      }

      // 标记已触发
      await sb.from('task_reminders').update({ last_triggered_date: today }).eq('id', r.id)

      // 存入通知记录
      await sb.from('agent_notifications').insert({
        type: 'reminder',
        title: '⏰ ' + r.title,
        content: `定时提醒：${r.title}\n时间：${r.remind_time}`,
      }).catch(e => console.warn('[PushCheck] 保存通知失败:', e))
    }

    // 清理过期订阅
    if (expiredEndpoints.length > 0) {
      await sb.from('push_subscriptions').delete().in('endpoint', expiredEndpoints)
    }

    return new Response(JSON.stringify({
      checked: reminders.length,
      sent: sentCount,
      time: nowTime,
      day: currentDay,
      cleaned: expiredEndpoints.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (e) {
    console.error('[PushCheck]', e)
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
