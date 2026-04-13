import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import { executeAgent, fetchAgentTasks, QUICK_COMMANDS, type AgentTask, type AgentResponse } from '../lib/agent'

interface ChatMessage {
  role: 'user' | 'agent'
  text: string
  taskId?: string
  stats?: AgentResponse['stats']
  relatedItems?: Array<{ id: string; title: string }>
  timestamp: number
}

export default function Agent() {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const saved = localStorage.getItem('agent_chat')
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory] = useState<AgentTask[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [toast, setToast] = useState('')

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 保存聊天记录到 localStorage
  useEffect(() => {
    localStorage.setItem('agent_chat', JSON.stringify(messages.slice(-100)))
  }, [messages])

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, loading])

  const showToast = (msg: string, duration = 2000) => {
    setToast(msg)
    setTimeout(() => setToast(''), duration)
  }

  // ── 发送消息 ──
  const send = async (text?: string, taskType?: string) => {
    const msg = (text || input).trim()
    if (!msg || loading) return

    // 添加用户消息
    const userMsg: ChatMessage = { role: 'user', text: msg, timestamp: Date.now() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    // 自动收起输入框高度
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
    }

    try {
      const res = await executeAgent({
        instruction: msg,
        task_type: (taskType as 'chat') || 'chat',
        source: 'mobile',
      })

      const agentMsg: ChatMessage = {
        role: 'agent',
        text: res.result || res.error || '无返回内容',
        taskId: res.task_id,
        stats: res.stats,
        relatedItems: res.related_items,
        timestamp: Date.now(),
      }
      setMessages(prev => [...prev, agentMsg])

      if (!res.success) {
        showToast('Agent 执行出错', 3000)
      }
    } catch (e) {
      const errMsg = (e as Error).message
      const agentMsg: ChatMessage = {
        role: 'agent',
        text: `❌ 调用失败：${errMsg}`,
        timestamp: Date.now(),
      }
      setMessages(prev => [...prev, agentMsg])
      showToast('调用失败', 3000)
    }

    setLoading(false)
  }

  // ── 加载历史 ──
  const loadHistory = async () => {
    setShowHistory(true)
    setHistoryLoading(true)
    const tasks = await fetchAgentTasks(30)
    setHistory(tasks)
    setHistoryLoading(false)
  }

  // ── 清空对话 ──
  const clearChat = () => {
    setMessages([])
    localStorage.removeItem('agent_chat')
    showToast('对话已清空')
  }

  // ── 时间格式化 ──
  const fmtTime = (ts: number | string) => {
    const d = new Date(ts)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    return isToday ? time : `${d.getMonth() + 1}/${d.getDate()} ${time}`
  }

  // ── 历史记录面板 ──
  if (showHistory) {
    return (
      <div className="h-full flex flex-col overflow-hidden fade-in">
        <div className="p-4 border-b border-[var(--color-border)] bg-white shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => setShowHistory(false)} className="text-sm text-[var(--color-k3)] font-medium">← 返回</button>
            <h2 className="text-base font-bold text-[var(--color-k)]">执行历史</h2>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {historyLoading ? (
            <div className="text-center py-16 text-[var(--color-k3)] text-sm">加载中…</div>
          ) : history.length === 0 ? (
            <div className="text-center py-16 text-[var(--color-k3)]">
              <div className="text-4xl mb-3 opacity-30">📭</div>
              <div className="text-sm">暂无执行记录</div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {history.map(task => (
                <div key={task.id} className="bg-white rounded-2xl p-4 border border-[var(--color-border)]">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`w-2 h-2 rounded-full ${task.status === 'done' ? 'bg-green-500' : task.status === 'failed' ? 'bg-red-500' : task.status === 'running' ? 'bg-blue-500 animate-pulse' : 'bg-gray-300'}`} />
                    <span className="text-xs text-[var(--color-k3)]">{task.task_type}</span>
                    <span className="flex-1" />
                    <span className="text-xs text-[var(--color-k3)]">{fmtTime(task.created_at)}</span>
                  </div>
                  <div className="text-sm text-[var(--color-k)] font-medium mb-1 line-clamp-2">{task.instruction}</div>
                  {task.result && (
                    <div className="text-xs text-[var(--color-k2)] line-clamp-3 mt-1">{task.result.substring(0, 150)}</div>
                  )}
                  {task.error && (
                    <div className="text-xs text-red-500 mt-1">{task.error}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── 主界面 ──
  return (
    <div className="h-full flex flex-col overflow-hidden fade-in">
      {/* Header */}
      <div className="p-4 pb-2 shrink-0">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-xl font-bold text-[var(--color-k)] flex-1">🤖 AI Agent</h1>
          <button onClick={loadHistory} className="text-xs text-[var(--color-k3)] px-3 py-1.5 rounded-lg border border-[var(--color-border)] bg-white">
            历史
          </button>
          {messages.length > 0 && (
            <button onClick={clearChat} className="text-xs text-[var(--color-k3)] px-3 py-1.5 rounded-lg border border-[var(--color-border)] bg-white">
              清空
            </button>
          )}
        </div>
        <p className="text-[13px] text-[var(--color-k2)]">基于知识库的智能问答 · 分析 · 整理</p>
      </div>

      {/* Chat Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-2">
        {messages.length === 0 ? (
          /* 空状态 — 快捷指令 */
          <div className="py-6">
            <div className="text-center text-[var(--color-k3)] text-sm mb-6">
              <div className="text-3xl mb-2 opacity-50">✦</div>
              <div>向 AI Agent 提问，或使用快捷指令</div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {QUICK_COMMANDS.map((cmd, i) => (
                <button
                  key={i}
                  onClick={() => send(cmd.instruction, cmd.task_type)}
                  className="text-left bg-white rounded-xl p-3 border border-[var(--color-border)] active:scale-[0.97] transition-transform"
                >
                  <div className="text-sm font-semibold text-[var(--color-k)] mb-1">{cmd.label}</div>
                  <div className="text-[11px] text-[var(--color-k3)] line-clamp-2">{cmd.instruction}</div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* 消息列表 */
          <div className="flex flex-col gap-3">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${msg.role === 'user'
                  ? 'bg-[var(--color-pri)] text-white rounded-br-md'
                  : 'bg-white border border-[var(--color-border)] text-[var(--color-k)] rounded-bl-md'
                  }`}>
                  {/* 消息内容 */}
                  {msg.role === 'agent' ? (
                    <div className="prose-agent text-[14px] leading-relaxed break-words">
                      <ReactMarkdown>{msg.text}</ReactMarkdown>
                    </div>
                  ) : (
                    <div className="text-[14px] leading-relaxed whitespace-pre-wrap break-words">
                      {msg.text}
                    </div>
                  )}

                  {/* Agent 统计信息 */}
                  {msg.role === 'agent' && msg.stats && (
                    <div className="mt-2 pt-2 border-t border-[var(--color-border)] flex flex-wrap gap-2 text-[10px] text-[var(--color-k3)]">
                      <span>⏱ {(msg.stats.duration_ms / 1000).toFixed(1)}s</span>
                      <span>📚 {msg.stats.context_items}/{msg.stats.total_items}条</span>
                      <span>🔤 {msg.stats.input_tokens + msg.stats.output_tokens} tokens</span>
                    </div>
                  )}

                  {/* 关联条目 */}
                  {msg.role === 'agent' && msg.relatedItems && msg.relatedItems.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-[var(--color-border)]">
                      <div className="text-[10px] text-[var(--color-k3)] mb-1">引用知识：</div>
                      <div className="flex flex-wrap gap-1">
                        {msg.relatedItems.slice(0, 5).map(item => (
                          <span key={item.id} className="text-[10px] bg-[var(--color-bg)] text-[var(--color-k2)] px-2 py-0.5 rounded-full truncate max-w-[120px]">
                            {item.title}
                          </span>
                        ))}
                        {msg.relatedItems.length > 5 && (
                          <span className="text-[10px] text-[var(--color-k3)]">+{msg.relatedItems.length - 5}</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 时间 */}
                  <div className={`text-[10px] mt-1 ${msg.role === 'user' ? 'text-white/60' : 'text-[var(--color-k3)]'}`}>
                    {fmtTime(msg.timestamp)}
                  </div>
                </div>
              </div>
            ))}

            {/* Loading indicator */}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-white border border-[var(--color-border)] rounded-2xl rounded-bl-md px-4 py-3">
                  <div className="flex items-center gap-2 text-[var(--color-k3)] text-sm">
                    <span className="inline-block w-2 h-2 bg-[var(--color-pri)] rounded-full animate-pulse" />
                    <span className="inline-block w-2 h-2 bg-[var(--color-pri)] rounded-full animate-pulse" style={{ animationDelay: '0.2s' }} />
                    <span className="inline-block w-2 h-2 bg-[var(--color-pri)] rounded-full animate-pulse" style={{ animationDelay: '0.4s' }} />
                    <span className="ml-1">思考中…</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="shrink-0 border-t border-[var(--color-border)] bg-white p-3 pb-safe">
        {/* 快捷指令按钮（对话中也可用） */}
        {messages.length > 0 && !loading && (
          <div className="flex gap-2 overflow-x-auto pb-2 mb-2 -mx-1 px-1 scrollbar-hide">
            {QUICK_COMMANDS.slice(0, 4).map((cmd, i) => (
              <button
                key={i}
                onClick={() => send(cmd.instruction, cmd.task_type)}
                className="shrink-0 text-[11px] text-[var(--color-k2)] bg-[var(--color-bg)] px-3 py-1.5 rounded-full whitespace-nowrap active:scale-95"
              >
                {cmd.label}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => {
              setInput(e.target.value)
              const el = e.target
              el.style.height = 'auto'
              el.style.height = Math.min(el.scrollHeight, 120) + 'px'
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder="向 AI Agent 提问…"
            rows={1}
            disabled={loading}
            className="flex-1 text-[15px] leading-relaxed px-4 py-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg)] resize-none outline-none focus:border-[var(--color-pri)] placeholder:text-[var(--color-k3)] transition-colors disabled:opacity-50"
            style={{ maxHeight: '120px' }}
          />
          <button
            onClick={() => send()}
            disabled={loading || !input.trim()}
            className="shrink-0 w-12 h-12 rounded-2xl bg-[var(--color-pri)] text-white flex items-center justify-center text-lg font-bold disabled:opacity-40 active:scale-95 transition-transform"
          >
            {loading ? '⏳' : '↑'}
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 px-4 py-2 bg-[var(--color-k)] text-white text-sm rounded-full shadow-lg toast-enter">
          {toast}
        </div>
      )}
    </div>
  )
}
