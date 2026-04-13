import { useState } from 'react'
import { isConfigured, getSupabase } from './lib/supabase'
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
  const url = localStorage.getItem('sb_url') || ''
  const hasKey = !!localStorage.getItem('sb_key')

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

      <div className="bg-white rounded-2xl p-4 border border-[var(--color-border)]">
        <div className="text-sm font-semibold text-[var(--color-k)] mb-3">缓存</div>
        <button onClick={() => {
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(regs => {
              regs.forEach(r => r.unregister())
            })
            caches.keys().then(names => {
              names.forEach(n => caches.delete(n))
            })
          }
          window.location.reload()
        }}
          className="w-full py-3 rounded-xl border border-[var(--color-border)] text-[var(--color-k)] font-semibold text-sm">
          🔄 清除缓存并刷新
        </button>
      </div>
    </div>
  )
}

export default function App() {
  const [ready, setReady] = useState(isConfigured())
  const [tab, setTab] = useState<Tab>('capture')
  const [refreshKey, setRefreshKey] = useState(0)

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
