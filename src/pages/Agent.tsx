import { useState, useRef, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import { executeAgent, fetchAgentTasks, fetchNotifications, markNotificationRead, markAllNotificationsRead, QUICK_COMMANDS, type AgentTask, type AgentResponse, type AgentNotification } from '../lib/agent'
import { captureItem } from '../lib/db'

interface ChatMessage {
  role: 'user' | 'agent'
  text: string
  taskId?: string
  stats?: AgentResponse['stats']
  relatedItems?: Array<{ id: string; title: string }>
  timestamp: number
}

// ── TTS 工具函数 ──
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '') // 去掉代码块
    .replace(/`[^`]*`/g, '')        // 去掉行内代码
    .replace(/#{1,6}\s*/g, '')      // 去掉标题符号
    .replace(/\*\*([^*]+)\*\*/g, '$1') // 去掉加粗
    .replace(/\*([^*]+)\*/g, '$1')     // 去掉斜体
    .replace(/~~([^~]+)~~/g, '$1')     // 去掉删除线
    .replace(/>\s*/g, '')              // 去掉引用
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // 链接只留文字
    .replace(/[|\-]{3,}/g, '')         // 去掉表格分隔线
    .replace(/\n{3,}/g, '\n\n')        // 压缩多余空行
    .replace(/❌|✅|💾|📊|🔍|🏷️|💡|📝|🧹|⏱|📚|🔤/g, '') // 去掉 emoji
    .trim()
}

type TtsState = 'idle' | 'playing' | 'paused'

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
  const [notifications, setNotifications] = useState<AgentNotification[]>([])
  const [showNotifications, setShowNotifications] = useState(false)

  // ── TTS 状态 ──
  const [ttsState, setTtsState] = useState<TtsState>('idle')
  const [ttsIndex, setTtsIndex] = useState<number>(-1) // 正在朗读哪条消息
  const [ttsVoices, setTtsVoices] = useState<SpeechSynthesisVoice[]>([])
  const [ttsVoiceIdx, setTtsVoiceIdx] = useState<number>(() => {
    const saved = localStorage.getItem('tts_voice_idx')
    return saved ? parseInt(saved) : 0
  })
  const [ttsRate, setTtsRate] = useState<number>(() => {
    const saved = localStorage.getItem('tts_rate')
    return saved ? parseFloat(saved) : 1.0
  })
  const [showTtsSettings, setShowTtsSettings] = useState(false)
  const ttsUtterRef = useRef<SpeechSynthesisUtterance | null>(null)

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
    fetchNotifications(true).then(setNotifications).catch(() => {})
  }, [])

  const showToast = (msg: string, duration = 2000) => {
    setToast(msg)
    setTimeout(() => setToast(''), duration)
  }

  // ── 加载可用中文语音 ──
  useEffect(() => {
    const loadVoices = () => {
      const all = window.speechSynthesis.getVoices()
      const zh = all.filter(v =>
        v.lang.startsWith('zh') || v.lang.includes('CN') || v.lang.includes('TW') || v.lang.includes('HK')
      )
      if (zh.length > 0) {
        setTtsVoices(zh)
        // 恢复上次选择，如果索引越界则重置
        const savedIdx = parseInt(localStorage.getItem('tts_voice_idx') || '0')
        if (savedIdx >= zh.length) {
          setTtsVoiceIdx(0)
          localStorage.setItem('tts_voice_idx', '0')
        }
      }
    }
    loadVoices()
    // Chrome 需要监听 voiceschanged 事件
    window.speechSynthesis.onvoiceschanged = loadVoices
    return () => { window.speechSynthesis.onvoiceschanged = null }
  }, [])

  // ── TTS 语音朗读 ──
  const ttsPlay = useCallback((text: string, msgIndex: number) => {
    window.speechSynthesis.cancel()

    const clean = stripMarkdown(text)
    if (!clean) return

    const utter = new SpeechSynthesisUtterance(clean)
    utter.lang = 'zh-CN'
    utter.rate = ttsRate
    utter.pitch = 1.0

    // 使用用户选择的语音
    if (ttsVoices.length > 0 && ttsVoiceIdx < ttsVoices.length) {
      utter.voice = ttsVoices[ttsVoiceIdx]
    }

    utter.onend = () => { setTtsState('idle'); setTtsIndex(-1) }
    utter.onerror = () => { setTtsState('idle'); setTtsIndex(-1) }

    ttsUtterRef.current = utter
    setTtsState('playing')
    setTtsIndex(msgIndex)
    window.speechSynthesis.speak(utter)
  }, [ttsVoices, ttsVoiceIdx, ttsRate])

  const ttsPause = useCallback(() => {
    window.speechSynthesis.pause()
    setTtsState('paused')
  }, [])

  const ttsResume = useCallback(() => {
    window.speechSynthesis.resume()
    setTtsState('playing')
  }, [])

  const ttsStop = useCallback(() => {
    window.speechSynthesis.cancel()
    setTtsState('idle')
    setTtsIndex(-1)
  }, [])

  // 组件卸载时停止朗读
  useEffect(() => {
    return () => { window.speechSynthesis.cancel() }
  }, [])

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
          <button onClick={() => setShowTtsSettings(!showTtsSettings)} className={`text-xs px-3 py-1.5 rounded-lg border border-[var(--color-border)] ${showTtsSettings ? 'bg-[var(--color-pri)] text-white' : 'text-[var(--color-k3)] bg-white'}`}>
            🔊
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
        {showTtsSettings && (
          <div className="mt-2 bg-white rounded-xl border border-[var(--color-border)] p-3 fade-in">
            <div className="text-xs font-bold text-[var(--color-k)] mb-2">语音设置</div>

            {/* 语音选择 */}
            <div className="mb-3">
              <div className="text-[11px] text-[var(--color-k3)] mb-1">选择语音 {ttsVoices.length > 0 ? `(${ttsVoices.length}个可用)` : '(加载中…)'}</div>
              <div className="flex flex-col gap-1.5 max-h-[150px] overflow-y-auto">
                {ttsVoices.map((voice, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setTtsVoiceIdx(idx)
                      localStorage.setItem('tts_voice_idx', String(idx))
                      // 试听
                      window.speechSynthesis.cancel()
                      const u = new SpeechSynthesisUtterance('你好，这是语音试听效果')
                      u.voice = voice
                      u.lang = voice.lang
                      u.rate = ttsRate
                      window.speechSynthesis.speak(u)
                    }}
                    className={`text-left text-[12px] px-3 py-2 rounded-lg border transition-colors ${
                      idx === ttsVoiceIdx
                        ? 'border-[var(--color-pri)] bg-[var(--color-pri-light)] text-[var(--color-pri)] font-medium'
                        : 'border-[var(--color-border)] text-[var(--color-k2)]'
                    }`}
                  >
                    <div className="font-medium">{voice.name}</div>
                    <div className="text-[10px] text-[var(--color-k3)] mt-0.5">{voice.lang} {voice.localService ? '· 本地' : '· 在线'}</div>
                  </button>
                ))}
                {ttsVoices.length === 0 && (
                  <div className="text-[11px] text-[var(--color-k3)] py-2">未检测到中文语音，将使用系统默认</div>
                )}
              </div>
            </div>

            {/* 语速调节 */}
            <div>
              <div className="text-[11px] text-[var(--color-k3)] mb-1">语速：{ttsRate.toFixed(1)}x</div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-[var(--color-k3)]">慢</span>
                <input
                  type="range" min="0.5" max="2.0" step="0.1"
                  value={ttsRate}
                  onChange={e => {
                    const v = parseFloat(e.target.value)
                    setTtsRate(v)
                    localStorage.setItem('tts_rate', String(v))
                  }}
                  className="flex-1 h-1 accent-[var(--color-pri)]"
                />
                <span className="text-[10px] text-[var(--color-k3)]">快</span>
              </div>
            </div>
          </div>
        )}

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

        {!showTtsSettings && !showNotifications && <p className="text-[13px] text-[var(--color-k2)]">基于知识库的智能问答 · 分析 · 整理</p>}
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

                  {/* 操作按钮：朗读 + 存入知识库 */}
                  {msg.role === 'agent' && msg.text && !msg.text.startsWith('❌') && (
                    <div className="mt-2 pt-2 border-t border-[var(--color-border)] flex items-center gap-2 flex-wrap">
                      {/* TTS 朗读按钮 */}
                      {ttsState === 'idle' || ttsIndex !== i ? (
                        <button
                          onClick={() => { if (ttsIndex !== -1) ttsStop(); ttsPlay(msg.text, i) }}
                          className="text-[11px] text-[var(--color-k2)] bg-[var(--color-bg)] px-3 py-1.5 rounded-full active:scale-95 transition-transform font-medium"
                        >
                          🔊 朗读
                        </button>
                      ) : (
                        <>
                          {ttsState === 'playing' && (
                            <button
                              onClick={ttsPause}
                              className="text-[11px] text-amber-600 bg-amber-50 px-3 py-1.5 rounded-full active:scale-95 transition-transform font-medium"
                            >
                              ⏸ 暂停
                            </button>
                          )}
                          {ttsState === 'paused' && (
                            <button
                              onClick={ttsResume}
                              className="text-[11px] text-green-600 bg-green-50 px-3 py-1.5 rounded-full active:scale-95 transition-transform font-medium"
                            >
                              ▶ 继续
                            </button>
                          )}
                          <button
                            onClick={ttsStop}
                            className="text-[11px] text-red-500 bg-red-50 px-3 py-1.5 rounded-full active:scale-95 transition-transform font-medium"
                          >
                            ⏹ 停止
                          </button>
                        </>
                      )}

                      {/* 存入知识库 */}
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
    </div>
  )
}
