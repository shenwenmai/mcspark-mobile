# Agent 定时任务部署指南

## Step 1：建表

在 Supabase Dashboard → SQL Editor 中执行 `migrations/002_agent_notifications.sql`

## Step 2：部署 Edge Function

### 通过 Dashboard 手动创建

1. Supabase Dashboard → **Edge Functions**
2. **New Function** → 函数名: `agent-cron`
3. 粘贴 `functions/agent-cron/index.ts` 的代码
4. 部署

## Step 3：配置 Cron 调度

在 Supabase Dashboard → **Edge Functions** → `agent-cron` → **Schedule**

推荐配置：

| 任务 | Cron 表达式 | 说明 | Body |
|------|------------|------|------|
| 每日摘要 | `0 20 * * *` | 每天晚8点 | `{"job":"daily_digest"}` |
| 每周报告 | `0 10 * * 1` | 每周一早10点 | `{"job":"weekly_report"}` |
| 清理建议 | `0 10 1 * *` | 每月1号早10点 | `{"job":"cleanup_check"}` |

> 注意：Cron 时间为 UTC，中国时间需 -8 小时
> 例如：中国时间晚8点 = UTC 12:00 = `0 12 * * *`

## Step 4：手动测试

```bash
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/agent-cron \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"job":"daily_digest"}'
```

或执行所有任务：
```bash
curl -X POST ... -d '{"job":"all"}'
```

## 查看通知

打开手机端 Agent 页面，顶部会显示 🔔 通知铃铛，有未读通知时显示红色角标。
点击通知即可查看定时任务的结果。
