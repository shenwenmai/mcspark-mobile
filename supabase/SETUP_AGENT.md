# AIVault Agent 部署指南

## 前置条件
- Supabase 项目已创建并运行
- 已有 Gemini API Key

## Step 1：建表

1. 打开 Supabase Dashboard → **SQL Editor**
2. 复制 `migrations/001_agent_tables.sql` 的全部内容
3. 点击 **Run** 执行
4. 确认创建成功：左侧 Table Editor 中应出现 `agent_tasks` 和 `agent_logs` 两张表

## Step 2：配置 Gemini API Key

1. 打开 Supabase Dashboard → **Project Settings** → **Edge Functions**
2. 在 **Secrets** 区域，添加：
   - Name: `GEMINI_API_KEY`
   - Value: 你的 Gemini API Key

## Step 3：部署 Edge Function

### 方法 A：通过 Supabase CLI（推荐）

```bash
# 安装 CLI（如未安装）
npm install -g supabase

# 登录
supabase login

# 关联项目
supabase link --project-ref YOUR_PROJECT_REF

# 部署函数
supabase functions deploy agent-execute --no-verify-jwt
```

> `--no-verify-jwt` 允许用 anon key 直接调用，个人使用足够安全。

### 方法 B：通过 Dashboard 手动创建

1. 打开 Supabase Dashboard → **Edge Functions**
2. 点击 **New Function**
3. 函数名: `agent-execute`
4. 将 `functions/agent-execute/index.ts` 的代码粘贴进去
5. 部署

## Step 4：测试

在浏览器控制台或 Postman 中测试：

```javascript
const res = await fetch('https://YOUR_PROJECT.supabase.co/functions/v1/agent-execute', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_ANON_KEY',
    'apikey': 'YOUR_ANON_KEY',
  },
  body: JSON.stringify({
    instruction: '你好，帮我看看知识库里有什么内容',
    task_type: 'chat',
  }),
})
const data = await res.json()
console.log(data)
```

成功的返回格式：
```json
{
  "success": true,
  "task_id": "uuid",
  "result": "根据您的知识库...",
  "related_items": [{"id": "xxx", "title": "xxx"}],
  "stats": {
    "duration_ms": 2300,
    "input_tokens": 1500,
    "output_tokens": 400,
    "context_items": 15,
    "total_items": 200
  }
}
```

## 常见问题

### Q: Edge Function 返回 500 "GEMINI_API_KEY 未配置"
A: 检查 Supabase Dashboard → Edge Functions → Secrets 中是否正确设置了 `GEMINI_API_KEY`

### Q: 函数调用超时
A: Gemini API 有时响应较慢（3-8秒），Edge Function 默认超时 60 秒，正常不会超时。如果知识库太大，减少 `fetchVaultContext` 的 limit 参数。

### Q: agent_tasks 表没有数据
A: 确认 RLS Policy 已正确设置（SQL 脚本中已包含）。在 Table Editor 中检查 Policies 标签。
