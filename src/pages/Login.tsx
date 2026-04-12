import { useState, useEffect } from 'react'
import { setSupabaseConfig, isConfigured } from '../lib/supabase'

export default function Login({ onDone }: { onDone: () => void }) {
  const [url, setUrl] = useState(localStorage.getItem('sb_url') || '')
  const [key, setKey] = useState(localStorage.getItem('sb_key') || '')
  const [err, setErr] = useState('')

  // 如果已配置，在 effect 中跳转（不在 render 中直接调 setState）
  useEffect(() => {
    if (isConfigured()) onDone()
  }, [onDone])

  const saveAndEnter = () => {
    if (!url.trim() || !key.trim()) { setErr('请填写完整'); return }
    setSupabaseConfig(url, key)
    onDone()
  }

  // 已配置时不渲染任何内容
  if (isConfigured()) return null

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[var(--color-bg)]">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-3xl font-bold text-[var(--color-k)] mb-1">McSpark</div>
          <div className="text-xs text-[var(--color-k3)]">轻量知识捕获 & 任务管理</div>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-[var(--color-border)]">
          <h2 className="text-base font-bold mb-1 text-[var(--color-k)]">连接 Supabase</h2>
          <p className="text-xs text-[var(--color-k3)] mb-4">填入与桌面端相同的 Supabase 配置，即可同步数据</p>
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="Supabase URL（https://xxx.supabase.co）"
            className="w-full text-sm p-3 rounded-xl border border-[var(--color-border)] mb-3 outline-none focus:border-[var(--color-pri)]" />
          <input value={key} onChange={e => setKey(e.target.value)} placeholder="Supabase Anon Key"
            className="w-full text-sm p-3 rounded-xl border border-[var(--color-border)] mb-4 outline-none focus:border-[var(--color-pri)]" />
          {err && <div className="text-xs text-[var(--color-rd)] mb-3">{err}</div>}
          <button onClick={saveAndEnter}
            className="w-full py-3 rounded-xl bg-[var(--color-pri)] text-white font-semibold text-sm">
            连接并进入
          </button>
        </div>
      </div>
    </div>
  )
}
