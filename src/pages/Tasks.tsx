import { useState, useEffect, useCallback } from 'react'
import { fetchProjects, pushProject, type Project, type ProjectTask } from '../lib/db'

export default function Tasks() {
  const [projects, setProjects] = useState<Project[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState(false)
  const [toast, setToast] = useState('')

  const load = useCallback(async () => {
    const all = await fetchProjects()
    setProjects(all)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const toggleTask = async (project: Project, phaseId: string, taskId: string) => {
    if (toggling) return
    setToggling(true)
    try {
      const now = Date.now()
      const phases = project.phases.map(ph => {
        if (ph.id !== phaseId) return ph
        return {
          ...ph,
          tasks: ph.tasks.map(t => {
            if (t.id !== taskId) return t
            const next = t.status === 'todo' ? 'doing' : t.status === 'doing' ? 'done' : 'todo' as ProjectTask['status']
            const u = { ...t, status: next, updatedAt: now }
            if (next === 'done') u.completedAt = now
            if (next === 'doing') u.startedAt = u.startedAt || now
            if (next === 'todo') { delete u.completedAt; delete u.startedAt }
            return u
          }),
        }
      })
      const updated = { ...project, phases, updatedAt: now }
      await pushProject(updated)
      await load()
    } catch (e) {
      console.warn('[Tasks] toggleTask error:', (e as Error).message)
      setToast('操作失败: ' + (e as Error).message)
      setTimeout(() => setToast(''), 3000)
    }
    setToggling(false)
  }

  const getStats = (p: Project) => {
    let total = 0, done = 0
    p.phases.forEach(ph => ph.tasks.forEach(t => { total++; if (t.status === 'done') done++ }))
    return { total, done, pct: total ? Math.round(done / total * 100) : 0 }
  }

  const active = activeId ? projects.find(p => p.id === activeId) : null

  if (loading) return <div className="flex items-center justify-center h-full text-[var(--color-k3)] text-sm">加载中…</div>

  // ── Project List ──
  if (!active) {
    return (
      <div className="h-full overflow-y-auto p-4 fade-in">
        <h1 className="text-xl font-bold text-[var(--color-k)] mb-2">📋 项目任务</h1>
        <p className="text-[13px] text-[var(--color-k2)] mb-3">查看进度 · 勾选任务</p>
        {projects.length === 0 ? (
          <div className="text-center py-16 text-[var(--color-k3)]">
            <div className="text-4xl mb-3 opacity-30">📋</div>
            <div className="text-sm">暂无项目，请在桌面端创建</div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {projects.map(p => {
              const s = getStats(p)
              return (
                <button key={p.id} onClick={() => setActiveId(p.id)}
                  className="w-full text-left bg-white rounded-2xl p-4 border border-[var(--color-border)] active:scale-[0.98] transition-transform">
                  <div className="font-bold text-[15px] text-[var(--color-k)] mb-1 truncate">{p.name}</div>
                  {p.description && <div className="text-xs text-[var(--color-k3)] mb-2 line-clamp-1">{p.description}</div>}
                  <div className="h-1.5 bg-[var(--color-bg)] rounded-full overflow-hidden mb-2">
                    <div className="h-full rounded-full transition-all duration-300"
                      style={{ width: s.pct + '%', background: s.pct === 100 ? 'var(--color-gn)' : 'var(--color-pri)' }} />
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="font-semibold" style={{ color: s.pct === 100 ? 'var(--color-gn)' : 'var(--color-pri)' }}>{s.pct}%</span>
                    <span className="text-[var(--color-k3)]">{s.done}/{s.total} 项</span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // ── Project Detail ──
  const stats = getStats(active)
  return (
    <div className="h-full flex flex-col overflow-hidden fade-in">
      {/* Header */}
      <div className="p-4 border-b border-[var(--color-border)] bg-white shrink-0">
        <div className="flex items-center gap-3 mb-2">
          <button onClick={() => setActiveId(null)} className="text-sm text-[var(--color-k3)] font-medium">← 返回</button>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-[var(--color-k)] truncate">{active.name}</h2>
          </div>
          <span className="text-sm font-bold shrink-0" style={{ color: stats.pct === 100 ? 'var(--color-gn)' : 'var(--color-pri)' }}>
            {stats.pct}%
          </span>
        </div>
        <div className="h-2 bg-[var(--color-bg)] rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-300"
            style={{ width: stats.pct + '%', background: stats.pct === 100 ? 'var(--color-gn)' : 'var(--color-pri)' }} />
        </div>
      </div>

      {/* Phases */}
      <div className="flex-1 overflow-y-auto p-4">
        {active.phases.map((phase, phIdx) => {
          const pDone = phase.tasks.filter(t => t.status === 'done').length
          const pTotal = phase.tasks.length
          const allDone = pTotal > 0 && pDone === pTotal

          return (
            <div key={phase.id} className="mb-4 rounded-2xl border overflow-hidden"
              style={{ borderColor: allDone ? '#BBF7D0' : 'var(--color-border)', background: allDone ? '#F0FDF4' : 'white' }}>
              {/* Phase header */}
              <div className="px-4 py-3 flex items-center gap-2">
                <span className="text-xs font-bold text-[var(--color-k3)]">阶段 {phIdx + 1}</span>
                <span className="flex-1 text-sm font-bold text-[var(--color-k)]">{phase.name}</span>
                <span className="text-xs font-semibold" style={{ color: allDone ? 'var(--color-gn)' : 'var(--color-pri)' }}>
                  {pDone}/{pTotal}
                </span>
              </div>

              {/* Tasks */}
              <div className="px-3 pb-3">
                {phase.tasks.map(task => {
                  const icon = task.status === 'done' ? '✅' : task.status === 'doing' ? '🔵' : '○'
                  return (
                    <button
                      key={task.id}
                      onClick={() => toggleTask(active, phase.id, task.id)}
                      className="w-full flex items-start gap-3 py-2.5 px-2 rounded-xl text-left active:bg-[var(--color-bg)] transition-colors"
                    >
                      <span className="text-lg shrink-0 mt-0.5">{icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className={`text-[13px] leading-relaxed ${task.status === 'done' ? 'line-through text-[var(--color-k3)]' : task.status === 'doing' ? 'text-[var(--color-pri)] font-semibold' : 'text-[var(--color-k)]'}`}>
                          {task.title}
                        </div>
                        {task.note && <div className="text-[11px] text-[var(--color-k3)] mt-0.5">💬 {task.note}</div>}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 px-4 py-2 bg-red-500 text-white text-sm rounded-full shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}
