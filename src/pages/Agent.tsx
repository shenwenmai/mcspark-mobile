import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import { executeAgent, fetchAgentTasks, fetchNotifications, markNotificationRead, markAllNotificationsRead, fetchReminders, createReminder, updateReminder as updateReminderApi, deleteReminder as deleteReminderApi, QUICK_COMMANDS, type AgentTask, type AgentResponse, type AgentNotification, type TaskReminder } from '../lib/agent'
import { captureItem } from '../lib/db'
import VoiceChat from '../components/VoiceChat'

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
    } catch (e) { console.warn('[Agent] 聊天记录解析失败:', e); return [] }
  })
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory] = useState<AgentTask[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [toast, setToast] = useState('')
  const [notifications, setNotifications] = useState<AgentNotification[]>([])
  const [showNotifications, setShowNotifications] = useState(false)

  // ── 定时提醒状态 ──
  const [reminders, setReminders] = useState<TaskReminder[]>([])
  const [showReminders, setShowReminders] = useState(false)
  const [reminderTitle, setReminderTitle] = useState('')
  const [reminderTime, setReminderTime] = useState('09:00')
  const [reminderDays, setReminderDays] = useState<number[]>([1, 2, 3, 4, 5])
  const [showVoiceChat, setShowVoiceChat] = useState(false)
  const [addingReminder, setAddingReminder] = useState(false)

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

  // 加载未读通知
  useEffect(() => {
    fetchNotifications(true).then(setNotifications).catch(e => console.warn('[Agent] 加载失败:', e))
  }, [])

  // ── 加载提醒列表（检查逻辑已移到 App.tsx 全局运行） ──
  useEffect(() => {
    fetchReminders().then(r => {
      setReminders(r)
    }).catch(e => console.warn('[Agent] 加载失败:', e))
  }, [])

  // ── 提醒管理函数 ──
  const addReminder = async () => {
    if (!reminderTitle.trim() || !reminderTime || addingReminder) return
    setAddingReminder(true)
    try {
      const r = await createReminder({
        title: reminderTitle.trim(),
        remind_time: reminderTime,
        repeat_days: reminderDays,
      })
      if (r) {
        setReminders(prev => [...prev, r].sort((a, b) => a.remind_time.localeCompare(b.remind_time)))
        setReminderTitle('')
        setReminderTime('09:00')
        showToast('✅ 提醒已添加')
      } else {
        showToast('❌ 添加失败', 3000)
      }
    } catch (e) {
      console.warn('[Agent] 添加提醒异常:', e)
      showToast('❌ 添加失败', 3000)
    }
    setAddingReminder(false)
  }

  const toggleReminder = async (r: TaskReminder) => {
    await updateReminderApi(r.id, { enabled: !r.enabled })
    setReminders(prev => prev.map(x => x.id === r.id ? { ...x, enabled: !x.enabled } : x))
  }

  const removeReminder = async (id: string) => {
    await deleteReminderApi(id)
    setReminders(prev => prev.filter(x => x.id !== id))
    showToast('已删除')
  }

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
      // 取最近5轮对话作为上下文
      const recentMessages = [...messages, userMsg]
        .slice(-10) // 最多10条（5轮）
        .map(m => ({ role: m.role, text: m.text.substring(0, 500) }))

      const res = await executeAgent({
        instruction: msg,
        task_type: (taskType as 'chat') || 'chat',
        source: 'mobile',
        history: recentMessages.slice(0, -1), // 不包含当前这条（已在 instruction 中）
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
    try {
      const tasks = await fetchAgentTasks(30)
      setHistory(tasks)
    } catch (e) {
      console.warn('[Agent] 加载历史失败:', e)
      setHistory([])
    }
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

  // ── 定时提醒管理面板 ──
  if (showReminders) {
    const DAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']
    return (
      <div className="h-full flex flex-col overflow-hidden fade-in">
        <div className="p-4 border-b border-[var(--color-border)] bg-white shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => setShowReminders(false)} className="text-sm text-[var(--color-k3)] font-medium">← 返回</button>
            <h2 className="text-base font-bold text-[var(--color-k)]">⏰ 定时提醒</h2>
            <span className="flex-1" />
            <span className="text-[11px] text-[var(--color-k3)]">{reminders.filter(r => r.enabled).length} 个启用</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {/* 提醒列表 */}
          {reminders.length === 0 ? (
            <div className="text-center py-12 text-[var(--color-k3)]">
              <div className="text-4xl mb-3 opacity-30">⏰</div>
              <div className="text-sm">暂无定时提醒</div>
              <div className="text-[11px] mt-1">在下方添加你的第一个任务提醒</div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {reminders.map(r => (
                <div key={r.id} className={`bg-white rounded-2xl p-4 border border-[var(--color-border)] transition-opacity ${r.enabled ? '' : 'opacity-50'}`}>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-[var(--color-k)] truncate">{r.title}</div>
                      <div className="text-2xl font-light text-[var(--color-k)] mt-1 tracking-wider">{r.remind_time}</div>
                      <div className="flex gap-1 mt-2">
                        {DAY_LABELS.map((d, i) => (
                          <span
                            key={i}
                            className={`w-6 h-6 rounded-full text-[10px] flex items-center justify-center font-medium ${
                              r.repeat_days.includes(i)
                                ? 'bg-[var(--color-pri)] text-white'
                                : 'bg-[var(--color-bg)] text-[var(--color-k3)]'
                            }`}
                          >
                            {d}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-col items-center gap-2 shrink-0">
                      {/* 开关 */}
                      <button
                        onClick={() => toggleReminder(r)}
                        className={`w-11 h-6 rounded-full relative transition-colors ${r.enabled ? 'bg-[var(--color-pri)]' : 'bg-gray-300'}`}
                      >
                        <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${r.enabled ? 'left-[22px]' : 'left-0.5'}`} />
                      </button>
                      <button
                        onClick={() => removeReminder(r.id)}
                        className="text-[10px] text-red-400 active:text-red-600"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 添加新提醒 */}
          <div className="mt-4 bg-white rounded-2xl p-4 border-2 border-dashed border-[var(--color-border)]">
            <div className="text-sm font-bold text-[var(--color-k)] mb-3">+ 添加新提醒</div>

            {/* 标题 */}
            <input
              type="text"
              value={reminderTitle}
              onChange={e => setReminderTitle(e.target.value)}
              placeholder="提醒内容，如：站会、午休、写周报…"
              className="w-full text-sm px-3 py-2.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] outline-none focus:border-[var(--color-pri)] mb-3 placeholder:text-[var(--color-k3)]"
            />

            {/* 时间 */}
            <div className="flex items-center gap-3 mb-3">
              <span className="text-sm text-[var(--color-k2)] shrink-0">时间</span>
              <input
                type="time"
                value={reminderTime}
                onChange={e => setReminderTime(e.target.value)}
                className="flex-1 text-lg px-3 py-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] outline-none focus:border-[var(--color-pri)]"
              />
            </div>

            {/* 重复日 */}
            <div className="mb-4">
              <span className="text-sm text-[var(--color-k2)] mb-2 block">重复</span>
              <div className="flex gap-2">
                {DAY_LABELS.map((d, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setReminderDays(prev =>
                        prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i].sort()
                      )
                    }}
                    className={`w-9 h-9 rounded-full text-xs flex items-center justify-center font-medium transition-colors ${
                      reminderDays.includes(i)
                        ? 'bg-[var(--color-pri)] text-white'
                        : 'bg-[var(--color-bg)] text-[var(--color-k3)] border border-[var(--color-border)]'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => setReminderDays([1, 2, 3, 4, 5])}
                  className="text-[10px] text-[var(--color-pri)] bg-[var(--color-pri-light)] px-2 py-1 rounded-full"
                >
                  工作日
                </button>
                <button
                  onClick={() => setReminderDays([0, 1, 2, 3, 4, 5, 6])}
                  className="text-[10px] text-[var(--color-pri)] bg-[var(--color-pri-light)] px-2 py-1 rounded-full"
                >
                  每天
                </button>
                <button
                  onClick={() => setReminderDays([0, 6])}
                  className="text-[10px] text-[var(--color-pri)] bg-[var(--color-pri-light)] px-2 py-1 rounded-full"
                >
                  周末
                </button>
              </div>
            </div>

            {/* 添加按钮 */}
            <button
              onClick={addReminder}
              disabled={!reminderTitle.trim() || addingReminder}
              className="w-full py-3 rounded-xl bg-[var(--color-pri)] text-white text-sm font-bold disabled:opacity-40 active:scale-[0.98] transition-transform"
            >
              添加提醒
            </button>
          </div>

          {/* 通知权限提示 */}
          {'Notification' in window && Notification.permission === 'default' && (
            <div className="mt-3 bg-amber-50 rounded-xl p-3 border border-amber-200">
              <div className="text-[12px] text-amber-700 font-medium">⚠ 需要通知权限</div>
              <div className="text-[11px] text-amber-600 mt-1">请允许浏览器通知，否则提醒时无法弹出横幅。</div>
              <button
                onClick={() => Notification.requestPermission()}
                className="mt-2 text-[11px] text-white bg-amber-500 px-3 py-1.5 rounded-lg font-medium"
              >
                授权通知
              </button>
            </div>
          )}
          {'Notification' in window && Notification.permission === 'denied' && (
            <div className="mt-3 bg-red-50 rounded-xl p-3 border border-red-200">
              <div className="text-[12px] text-red-700 font-medium">❌ 通知已被阻止</div>
              <div className="text-[11px] text-red-600 mt-1">请在浏览器设置中允许本网站发送通知，才能收到提醒横幅。</div>
            </div>
          )}
        </div>
      </div>
    )
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
          {/* 通知铃铛 */}
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className={`relative text-xs px-3 py-1.5 rounded-lg border border-[var(--color-border)] ${showNotifications ? 'bg-[var(--color-pri)] text-white' : 'text-[var(--color-k3)] bg-white'}`}
          >
            🔔
            {notifications.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white text-[9px] rounded-full flex items-center justify-center font-bold">
                {notifications.length > 9 ? '9+' : notifications.length}
              </span>
            )}
          </button>
          {/* 语音对话 */}
          <button
            onClick={() => setShowVoiceChat(true)}
            className="text-xs px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-[var(--color-k3)] bg-white"
          >
            🎤
          </button>
          {/* 定时提醒 */}
          <button
            onClick={() => { setShowReminders(true); fetchReminders().then(r => { setReminders(r) }).catch(e => console.warn('[Agent] 加载失败:', e)) }}
            className={`relative text-xs px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-[var(--color-k3)] bg-white`}
          >
            ⏰
            {reminders.filter(r => r.enabled).length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-[var(--color-pri)] text-white text-[9px] rounded-full flex items-center justify-center font-bold">
                {reminders.filter(r => r.enabled).length}
              </span>
            )}
          </button>
          <button onClick={loadHistory} className="text-xs text-[var(--color-k3)] px-3 py-1.5 rounded-lg border border-[var(--color-border)] bg-white">
            历史
          </button>
          {messages.length > 0 && (
            <button onClick={clearChat} className="text-xs text-[var(--color-k3)] px-3 py-1.5 rounded-lg border border-[var(--color-border)] bg-white">
              清空
            </button>
          )}
        </div>

        {/* TTS 语音设置面板 */}
        {/* 通知面板 */}
        {showNotifications && (
          <div className="mt-2 bg-white rounded-xl border border-[var(--color-border)] p-3 fade-in">
            <div className="flex items-center mb-2">
              <div className="text-xs font-bold text-[var(--color-k)] flex-1">通知 ({notifications.length})</div>
              {notifications.length > 0 && (
                <button
                  onClick={async () => {
                    await markAllNotificationsRead()
                    setNotifications([])
                    showToast('已全部标为已读')
                  }}
                  className="text-[10px] text-[var(--color-pri)]"
                >
                  全部已读
                </button>
              )}
            </div>
            {notifications.length === 0 ? (
              <div className="text-[11px] text-[var(--color-k3)] py-3 text-center">暂无未读通知</div>
            ) : (
              <div className="flex flex-col gap-2 max-h-[250px] overflow-y-auto">
                {notifications.map(n => (
                  <div
                    key={n.id}
                    onClick={async () => {
                      // 点击通知 → 插入到对话中显示
                      const agentMsg: ChatMessage = {
                        role: 'agent',
                        text: `${n.title}\n\n${n.content}`,
                        timestamp: new Date(n.created_at).getTime(),
                      }
                      setMessages(prev => [...prev, agentMsg])
                      await markNotificationRead(n.id)
                      setNotifications(prev => prev.filter(x => x.id !== n.id))
                      setShowNotifications(false)
                    }}
                    className="text-left bg-[var(--color-bg)] rounded-lg p-2.5 cursor-pointer active:scale-[0.98] transition-transform"
                  >
                    <div className="text-[12px] font-medium text-[var(--color-k)]">{n.title}</div>
                    <div className="text-[10px] text-[var(--color-k3)] mt-0.5 line-clamp-2">{n.content.substring(0, 80)}…</div>
                    <div className="text-[9px] text-[var(--color-k3)] mt-1">{fmtTime(n.created_at)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!showNotifications && <p className="text-[13px] text-[var(--color-k2)]">基于知识库的智能问答 · 分析 · 整理</p>}
      </div>

      {/* Chat Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-2">
        {messages.length === 0 ? (
          /* 空状态 — 快捷指令 */
          <div className="py-6">
            <div className="text-center text-[var(--color-k3)] text-sm mb-6">
              <div className="text-3xl mb-2 opacity-50">✦</div>
              <div>向 AI Agent 提问，或使用快捷指令</div>
              <div className="text-[11px] mt-1 text-[var(--color-k3)]">粘贴链接可自动抓取网页内容</div>
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
                <div className={`rounded-2xl px-4 py-3 ${msg.role === 'user'
                  ? 'max-w-[85%] bg-[var(--color-pri)] text-white rounded-br-md'
                  : 'w-full bg-white border border-[var(--color-border)] text-[var(--color-k)] rounded-bl-md'
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

                  {/* 存入知识库 */}
                  {msg.role === 'agent' && msg.text && !msg.text.startsWith('❌') && (
                    <div className="mt-2 pt-2 border-t border-[var(--color-border)] flex items-center gap-2">
                      <button
                        onClick={async () => {
                          try {
                            const titleMatch = msg.text.replace(/^#+\s*/, '').split('\n')[0]
                            const title = (titleMatch || 'Agent 回复').substring(0, 50)
                            await captureItem({
                              title,
                              content: msg.text,
                              source: 'agent',
                              category: 'note',
                            })
                            showToast('✅ 已存入知识库')
                          } catch (e) {
                            showToast('❌ 存入失败: ' + (e as Error).message, 3000)
                          }
                        }}
                        className="text-[11px] text-[var(--color-pri)] bg-[var(--color-pri-light)] px-3 py-1.5 rounded-full active:scale-95 transition-transform font-medium"
                      >
                        💾 存入知识库
                      </button>
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
                    <span className="ml-1">{/https?:\/\//.test(messages[messages.length - 1]?.text || '') ? '正在抓取网页…' : '思考中…'}</span>
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

      {/* 语音对话全屏覆盖 */}
      {showVoiceChat && (
        <VoiceChat onClose={() => setShowVoiceChat(false)} />
      )}
    </div>
  )
}
