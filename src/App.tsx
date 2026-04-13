import { useState, useEffect, useRef } from 'react'
import { isConfigured, getSupabase } from './lib/supabase'
import { fetchReminders, updateReminder as updateReminderApi, createNotification, type TaskReminder } from './lib/agent'
import Login from './pages/Login'
import Capture from './pages/Capture'
import Tasks from './pages/Tasks'
import Browse from './pages/Browse'
import AgentPage from './pages/Agent'

type Tab = 'capture' | 'agent' | 'tasks' | 'browse' | 'settings'

const tabs: { id: Tab; label: string; icon: string }[] = [
  { id: 'capture', label: '录入', icon: '📥' },
  { id: 'agent', label: 'Agent', icon: '🤖' },
  { id: 'tasks', label: '任务', icon: '📋' },
  { id: 'browse', label: '知识库', icon: '🔍' },
  { id: 'settings', label: '设置', icon: '⚙️' },
]

function Settings({ onReconfigure }: { onReconfigure: () => void }) {
  const [testResult, setTestResult] = useState<string[]>([])
  const [testing, setTesting] = useState(false)
  const [cacheCleared, setCacheCleared] = useState(false)
  const url = localStorage.getItem('sb_url') || ''
  const hasKey = !!localStorage.getItem('sb_key')
  const [geminiKey, setGeminiKey] = useState(localStorage.getItem('gemini_api_key') || '')
  const [showGeminiKey, setShowGeminiKey] = useState(false)

  const runTest = async () => {
    setTesting(true)
    const results: string[] = []
    try {
      const sb = getSupabase()
      if (!sb) { results.push('❌ Supabase 客户端未创建'); setTestResult(results); setTesting(false); return }
      results.push('✅ Supabase 客户端已创建')

      // 测试数据表读取
      const { data: items, error: itemsErr } = await sb.from('vault_items').select('id').limit(1)
      if (itemsErr) results.push('❌ vault_items 读取: ' + itemsErr.message)
      else results.push('✅ vault_items 读取成功 (' + (items?.length || 0) + ' 条)')

      const { data: projects, error: projErr } = await sb.from('vault_projects').select('id').limit(1)
      if (projErr) results.push('❌ vault_projects 读取: ' + projErr.message)
      else results.push('✅ vault_projects 读取成功 (' + (projects?.length || 0) + ' 条)')

      // 测试 Storage 上传
      const testBlob = new Blob(['test'], { type: 'text/plain' })
      const testPath = `mobile/test_${Date.now()}.txt`
      const { error: upErr } = await sb.storage.from('vault-files').upload(testPath, testBlob)
      if (upErr) results.push('❌ Storage 上传: ' + upErr.message)
      else {
        results.push('✅ Storage 上传成功')
        await sb.storage.from('vault-files').remove([testPath])
      }
    } catch (e) {
      results.push('❌ 异常: ' + (e as Error).message)
    }
    setTestResult(results)
    setTesting(false)
  }

  return (
    <div className="h-full overflow-y-auto p-4 fade-in">
      <h1 className="text-xl font-bold text-[var(--color-k)] mb-2">⚙️ 设置</h1>
      <p className="text-[13px] text-[var(--color-k2)] mb-4">连接配置 · 缓存管理</p>

      <div className="bg-white rounded-2xl p-4 border border-[var(--color-border)] mb-4">
        <div className="text-sm font-semibold text-[var(--color-k)] mb-3">Supabase 连接</div>
        <div className="text-xs text-[var(--color-k3)] mb-1">URL:</div>
        <div className="text-xs text-[var(--color-k)] break-all mb-2">{url || '未配置'}</div>
        <div className="text-xs text-[var(--color-k3)] mb-1">Anon Key:</div>
        <div className="text-xs text-[var(--color-k)] mb-3">{hasKey ? '••••••已配置' : '未配置'}</div>

        <button onClick={runTest} disabled={testing}
          className="w-full py-3 rounded-xl bg-green-600 text-white font-semibold text-sm mb-3 disabled:opacity-50">
          {testing ? '检测中…' : '🔍 测试连接'}
        </button>

        {testResult.length > 0 && (
          <div className="bg-[var(--color-bg)] rounded-xl p-3 mb-3">
            {testResult.map((r, i) => (
              <div key={i} className="text-xs py-1 break-all">{r}</div>
            ))}
          </div>
        )}

        <button onClick={onReconfigure}
          className="w-full py-3 rounded-xl bg-[var(--color-pri)] text-white font-semibold text-sm">
          重新配置 Supabase
        </button>
      </div>

      <div className="bg-white rounded-2xl p-4 border border-[var(--color-border)] mb-4">
        <div className="text-sm font-semibold text-[var(--color-k)] mb-1">🎤 Gemini 语音对话</div>
        <div className="text-[11px] text-[var(--color-k3)] mb-3">Agent 页面的实时语音对话需要 Gemini API Key（仅存在本地）</div>
        <div className="relative">
          <input
            type={showGeminiKey ? 'text' : 'password'}
            value={geminiKey}
            onChange={e => {
              setGeminiKey(e.target.value)
              localStorage.setItem('gemini_api_key', e.target.value)
            }}
            placeholder="粘贴 Gemini API Key…"
            className="w-full text-sm px-3 py-2.5 pr-12 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] outline-none focus:border-[var(--color-pri)] placeholder:text-[var(--color-k3)]"
          />
          <button
            onClick={() => setShowGeminiKey(!showGeminiKey)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[var(--color-k3)] px-2 py-1"
          >
            {showGeminiKey ? '隐藏' : '显示'}
          </button>
        </div>
        {geminiKey && (
          <div className="flex items-center gap-2 mt-2">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-[11px] text-green-600">已配置</span>
          </div>
        )}
        <div className="text-[10px] text-[var(--color-k3)] mt-2">
          获取方式：<a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" className="text-[var(--color-pri)] underline">Google AI Studio</a> → Create API Key
        </div>
      </div>

      <div className="bg-white rounded-2xl p-4 border border-[var(--color-border)]">
        <div className="text-sm font-semibold text-[var(--color-k)] mb-3">缓存</div>
        <button onClick={async () => {
          setCacheCleared(false)
          if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations()
            await Promise.all(regs.map(r => r.unregister()))
            const names = await caches.keys()
            await Promise.all(names.map(n => caches.delete(n)))
          }
          setCacheCleared(true)
        }}
          className="w-full py-3 rounded-xl border border-[var(--color-border)] text-[var(--color-k)] font-semibold text-sm">
          🔄 清除缓存
        </button>
        {cacheCleared && (
          <div className="mt-2 text-center text-xs text-green-600 font-medium">✅ 缓存已清除，下次加载将获取最新版本</div>
        )}
      </div>
    </div>
  )
}

export default function App() {
  const [ready, setReady] = useState(isConfigured())
  const [tab, setTab] = useState<Tab>('capture')
  const [refreshKey, setRefreshKey] = useState(0)
  const remindersRef = useRef<TaskReminder[]>([])

  // ── 全局提醒检查器（不依赖任何 tab） ──
  useEffect(() => {
    if (!isConfigured()) return

    // 请求通知权限
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }

    // 加载提醒
    fetchReminders().then(r => { remindersRef.current = r }).catch(() => {})

    const checkReminders = async () => {
      const list = remindersRef.current
      if (list.length === 0) {
        // 每次检查也尝试重新加载（可能用户在 Agent 页新增了）
        try { remindersRef.current = await fetchReminders() } catch {}
        return
      }

      const now = new Date()
      const nowMinutes = now.getHours() * 60 + now.getMinutes()
      const currentDay = now.getDay()
      const today = now.toISOString().split('T')[0]

      for (const r of list) {
        if (!r.enabled) continue
        if (!r.repeat_days.includes(currentDay)) continue
        if (r.last_triggered_date === today) continue

        const [hh, mm] = r.remind_time.split(':').map(Number)
        const reminderMinutes = hh * 60 + mm
        const diff = nowMinutes - reminderMinutes
        if (diff < 0 || diff > 3) continue

        // 浏览器系统通知
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('⏰ ' + r.title, {
            body: `提醒时间：${r.remind_time}`,
            icon: '/favicon.svg',
            tag: r.id,
            requireInteraction: true,
          })
        }

        // 写入通知表
        await createNotification({
          type: 'reminder',
          title: '⏰ ' + r.title,
          content: `定时提醒：${r.title}\n时间：${r.remind_time}`,
        })

        await updateReminderApi(r.id, { last_triggered_date: today })
        r.last_triggered_date = today
      }
    }

    const timer = setInterval(checkReminders, 15000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') checkReminders()
    }
    document.addEventListener('visibilitychange', onVisible)
    checkReminders()

    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [ready])

  if (!ready) {
    return <Login onDone={() => setReady(true)} />
  }

  return (
    <div className="flex flex-col bg-[var(--color-bg)]" style={{ height: '100dvh' }}>
      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'capture' && <Capture onSaved={() => setRefreshKey(k => k + 1)} />}
        {tab === 'agent' && <AgentPage />}
        {tab === 'tasks' && <Tasks key={refreshKey} />}
        {tab === 'browse' && <Browse key={refreshKey} />}
        {tab === 'settings' && <Settings onReconfigure={() => {
          localStorage.removeItem('sb_url')
          localStorage.removeItem('sb_key')
          setReady(false)
          setTab('capture')
        }} />}
      </div>

      {/* Bottom Nav */}
      <nav className="shrink-0 bg-white border-t border-[var(--color-border)] pb-safe">
        <div className="flex">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 flex flex-col items-center gap-1 py-3 transition-colors ${tab === t.id ? 'text-[var(--color-pri)]' : 'text-[var(--color-k3)]'}`}
            >
              <span className="text-2xl">{t.icon}</span>
              <span className="text-[11px] font-semibold">{t.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}
