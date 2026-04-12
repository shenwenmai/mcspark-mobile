import { useState, useEffect, useCallback } from 'react'
import { fetchItems, type VaultItem } from '../lib/db'

const catLabel: Record<string, string> = {
  concept: '概念', tool: '工具', case: '案例', opinion: '观点',
  method: '方法', data: '数据', note: '笔记', link: '链接',
}

export default function Browse() {
  const [items, setItems] = useState<VaultItem[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<VaultItem | null>(null)

  const load = useCallback(async () => {
    const all = await fetchItems()
    setItems(all)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = query.trim()
    ? items.filter(i => ((i.title || '') + (i.summary || '') + (i.content || '') + (i.tags || []).join('')).toLowerCase().includes(query.toLowerCase()))
    : items

  if (loading) return <div className="flex items-center justify-center h-full text-[var(--color-k3)] text-sm">加载中…</div>

  // ── Detail ──
  if (detail) {
    return (
      <div className="h-full flex flex-col overflow-hidden fade-in">
        <div className="p-4 border-b border-[var(--color-border)] bg-white shrink-0 flex items-center gap-3">
          <button onClick={() => setDetail(null)} className="text-sm text-[var(--color-k3)] font-medium">← 返回</button>
          <h2 className="flex-1 text-base font-bold text-[var(--color-k)] truncate">{detail.title}</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex gap-2 mb-3 flex-wrap">
            <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-pri-light)] text-[var(--color-pri)] font-medium">
              {catLabel[detail.category] || detail.category}
            </span>
            {(detail.tags || []).map(t => (
              <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-bg)] text-[var(--color-k3)]">#{t}</span>
            ))}
          </div>
          {detail.summary && <p className="text-sm text-[var(--color-k2)] mb-3 leading-relaxed">{detail.summary}</p>}
          <div className="text-[13px] text-[var(--color-k)] leading-relaxed whitespace-pre-wrap break-words">{detail.content}</div>
        </div>
      </div>
    )
  }

  // ── List ──
  return (
    <div className="h-full flex flex-col overflow-hidden fade-in">
      <div className="p-4 pb-2 shrink-0">
        <h1 className="text-xl font-bold text-[var(--color-k)] mb-2">🔍 知识库</h1>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="搜索标题、内容、标签…"
          className="w-full text-sm p-3 rounded-xl border border-[var(--color-border)] bg-white outline-none focus:border-[var(--color-pri)] transition-colors"
        />
        <div className="text-xs text-[var(--color-k3)] mt-2">{filtered.length} 条记录</div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-[var(--color-k3)]">
            <div className="text-4xl mb-3 opacity-30">🔍</div>
            <div className="text-sm">{query ? '没有找到匹配的内容' : '知识库为空'}</div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map(item => (
              <button key={item.id} onClick={() => setDetail(item)}
                className="w-full text-left bg-white rounded-xl p-3 border border-[var(--color-border)] active:scale-[0.98] transition-transform">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-[var(--color-k)] line-clamp-1">{item.title}</div>
                    {item.summary && <div className="text-xs text-[var(--color-k3)] mt-0.5 line-clamp-2">{item.summary}</div>}
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-[var(--color-bg)] text-[var(--color-k3)] shrink-0">
                    {catLabel[item.category] || item.category}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
