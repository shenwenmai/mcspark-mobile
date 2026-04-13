import { useState, useEffect, useRef } from 'react'
import { isConfigured, getSupabase } from './lib/supabase'
import { fetchReminders, updateReminder as updateReminderApi, createNotification, type TaskReminder } from './lib/agent'
import { setupPushSubscription } from './lib/push'
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

// ── 应用内提醒弹窗组件 ──
function ReminderAlert({ title, time, onDismiss }: { title: string; time: string; onDismiss: () => void }) {
  useEffect(() => {
    // 用 AudioContext 生成提示音（兼容所有浏览器）
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
      const playBeep = (freq: number, startTime: number, duration: number) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.frequency.value = freq
        osc.type = 'sine'
        gain.gain.setValueAtTime(0.3, startTime)
        gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration)
        osc.start(startTime)
        osc.stop(startTime + duration)
      }
      // 三连响
      const now = ctx.currentTime
      playBeep(880, now, 0.15)
      playBeep(1100, now + 0.2, 0.15)
      playBeep(880, now + 0.4, 0.3)
      // 第二轮（1.5秒后重复）
      playBeep(880, now + 1.5, 0.15)
      playBeep(1100, now + 1.7, 0.15)
      playBeep(880, now + 1.9, 0.3)
    } catch (e) {
      console.warn('[Reminder] 音频播放失败:', e)
    }

    // 30秒后自动关闭
    const t = setTimeout(onDismiss, 30000)
    return () => clearTimeout(t)
  }, [onDismiss])

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onDismiss}>
      <div className="bg-white rounded-3xl p-6 mx-6 max-w-sm w-full shadow-2xl animate-bounce-in text-center" onClick={e => e.stopPropagation()}>
        <div className="text-5xl mb-4">⏰</div>
        <div className="text-xl font-bold text-gray-900 mb-2">{title}</div>
        <div className="text-lg text-gray-500 mb-6">提醒时间：{time}</div>
        <button
          onClick={onDismiss}
          className="w-full py-3.5 rounded-2xl bg-[var(--color-pri)] text-white text-base font-bold active:scale-95 transition-transform"
        >
          知道了
        </button>
      </div>
    </div>
  )
}

export default function App() {
  const [ready, setReady] = useState(isConfigured())
  const [tab, setTab] = useState<Tab>('capture')
  const [refreshKey, setRefreshKey] = useState(0)
  const remindersRef = useRef<TaskReminder[]>([])
  const [reminderDebug, setReminderDebug] = useState('')
  const [activeAlert, setActiveAlert] = useState<{ title: string; time: string } | null>(null)

  // ── 全局提醒检查器（不依赖任何 tab） ──
  useEffect(() => {
    if (!isConfigured()) return

    // 注册 Web Push 推送（后台也能收到通知）
    setupPushSubscription().then(status => {
      console.log('[Push] 状态:', status)
    })

    // 加载提醒
    fetchReminders().then(r => {
      remindersRef.current = r
      setReminderDebug(`已加载${r.length}个提醒`)
    }).catch(e => {
      console.warn('[Reminder] 加载失败:', e)
      setReminderDebug('加载失败: ' + (e as Error).message)
    })

    // 定期刷新提醒列表（同步 Agent 页新增的）
    let lastRefresh = 0
    const refreshList = async () => {
      try {
        remindersRef.current = await fetchReminders()
        lastRefresh = Date.now()
      } catch (e) { console.warn('[Reminder] 刷新失败:', e) }
    }

    const checkReminders = async () => {
      // 每 2 分钟刷新一次列表
      if (Date.now() - lastRefresh > 120000) {
        await refreshList()
      }

      const list = remindersRef.current
      const now = new Date()
      const nowMinutes = now.getHours() * 60 + now.getMinutes()
      const currentDay = now.getDay() // 0=周日 1=周一 ... 6=周六
      const today = now.toISOString().split('T')[0]
      const nowStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`

      if (list.length === 0) {
        setReminderDebug(`${nowStr} | 0个提醒`)
        return
      }

      const debugParts: string[] = [`${nowStr} 周${currentDay} | ${list.length}个`]
      for (const r of list) {
        if (!r.enabled) { debugParts.push(`[${r.title}]禁用`); continue }

        // repeat_days 可能是字符串或数组，做兼容处理
        let days: number[] = []
        try {
          days = Array.isArray(r.repeat_days)
            ? r.repeat_days
            : (typeof r.repeat_days === 'string' ? JSON.parse(r.repeat_days) : [])
        } catch { days = [] }

        if (!days.includes(currentDay)) {
          debugParts.push(`[${r.title}]${r.remind_time} 周${days.join(',')}不含今天`)
          continue
        }
        if (r.last_triggered_date === today) {
          debugParts.push(`[${r.title}]${r.remind_time} 今天已触发`)
          continue
        }

        // 解析时间（兼容 HH:MM 和 HH:MM:SS 格式）
        const timeParts = r.remind_time.split(':').map(Number)
        const hh = timeParts[0] || 0
        const mm = timeParts[1] || 0
        const reminderMinutes = hh * 60 + mm
        const diff = nowMinutes - reminderMinutes

        if (diff < 0 || diff > 5) {
          debugParts.push(`[${r.title}]${r.remind_time} 差${diff}分`)
          continue
        }

        // 匹配！触发应用内弹窗提醒
        debugParts.push(`[${r.title}]${r.remind_time} ✅触发!`)

        // 显示全屏弹窗 + 声音
        setActiveAlert({ title: r.title, time: r.remind_time })

        // 同时尝试浏览器通知（如果支持的话作为额外通知）
        if ('Notification' in window && Notification.permission === 'granted') {
          try {
            new Notification('⏰ ' + r.title, {
              body: `提醒时间：${r.remind_time}`,
              icon: '/favicon.svg',
              tag: r.id,
            })
          } catch (_) { /* 不支持就忽略 */ }
        }

        // 存入通知记录
        try {
          await createNotification({
            type: 'reminder',
            title: '⏰ ' + r.title,
            content: `定时提醒：${r.title}\n时间：${r.remind_time}`,
          })
        } catch (e) {
          console.warn('[Reminder] 保存通知失败:', e)
        }

        // 标记已触发
        try {
          await updateReminderApi(r.id, { last_triggered_date: today })
          r.last_triggered_date = today
        } catch (e) {
          console.warn('[Reminder] 更新触发状态失败:', e)
        }
      }
      setReminderDebug(debugParts.join(' | '))
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

      {/* 提醒状态条 */}
      {reminderDebug && (
        <div className="shrink-0 bg-gray-900 px-3 py-1 flex items-center gap-2">
          <div className="flex-1 text-[9px] text-green-400 font-mono truncate">⏰ {reminderDebug}</div>
          <button
            onClick={() => setActiveAlert({ title: '测试提醒', time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) })}
            className="text-[9px] text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded shrink-0"
          >
            测试
          </button>
        </div>
      )}

      {/* 提醒弹窗（应用内，不依赖浏览器 Notification API） */}
      {activeAlert && (
        <ReminderAlert
          title={activeAlert.title}
          time={activeAlert.time}
          onDismiss={() => setActiveAlert(null)}
        />
      )}

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
