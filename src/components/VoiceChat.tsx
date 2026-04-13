import { useState, useEffect, useRef, useCallback } from 'react'
import { executeAgent, type AgentResponse } from '../lib/agent'

type VoiceState = 'listening' | 'processing' | 'speaking' | 'error' | 'closed'

interface TranscriptEntry {
  role: 'user' | 'agent'
  text: string
  stats?: AgentResponse['stats']
  relatedItems?: Array<{ id: string; title: string }>
}

interface Props {
  onClose: (transcript?: TranscriptEntry[]) => void
  chatHistory?: Array<{ role: 'user' | 'agent'; text: string }>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpeechRecognitionInstance = any

export default function VoiceChat({ onClose, chatHistory }: Props) {
  const [state, setState] = useState<VoiceState>('listening')
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState('')
  const [interimText, setInterimText] = useState('')
  const [currentReply, setCurrentReply] = useState('')
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [showTranscript, setShowTranscript] = useState(true)

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const timerRef = useRef<number>(0)
  const transcriptRef = useRef<TranscriptEntry[]>([])
  const transcriptScrollRef = useRef<HTMLDivElement>(null)
  const isProcessingRef = useRef(false)
  const shouldRestartRef = useRef(true)
  const silenceTimerRef = useRef<number>(0)
  const ttsUnlockedRef = useRef(false)

  // 自动滚动
  useEffect(() => {
    if (transcriptScrollRef.current) {
      transcriptScrollRef.current.scrollTop = transcriptScrollRef.current.scrollHeight
    }
  }, [transcript, currentReply, interimText])

  // ── 解锁 TTS（手机浏览器必须在用户手势中播放一次才能后续使用） ──
  const unlockTTS = useCallback(() => {
    if (ttsUnlockedRef.current) return
    if (!('speechSynthesis' in window)) return
    const utt = new SpeechSynthesisUtterance('')
    utt.volume = 0
    utt.rate = 10
    speechSynthesis.speak(utt)
    ttsUnlockedRef.current = true
    console.log('[VoiceChat] TTS 已解锁')
  }, [])

  // 停止语音播报
  const stopSpeaking = useCallback(() => {
    if ('speechSynthesis' in window) {
      speechSynthesis.cancel()
    }
  }, [])

  // 语音播报
  const speak = useCallback((text: string): Promise<void> => {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) {
        resolve()
        return
      }

      // 清理 Markdown 格式
      const clean = text
        .replace(/#{1,6}\s*/g, '')
        .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
        .replace(/`[^`]*`/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[>\-•·]/g, '')
        .replace(/\n{2,}/g, '。')
        .replace(/\n/g, '，')
        .trim()

      if (!clean) { resolve(); return }

      // 分段播报（每段不超过 150 字，手机 TTS 对长文本容易出问题）
      const segments: string[] = []
      let remaining = clean
      while (remaining.length > 0) {
        if (remaining.length <= 150) {
          segments.push(remaining)
          break
        }
        let cut = remaining.lastIndexOf('。', 150)
        if (cut < 30) cut = remaining.lastIndexOf('，', 150)
        if (cut < 30) cut = remaining.lastIndexOf('、', 150)
        if (cut < 30) cut = remaining.lastIndexOf('；', 150)
        if (cut < 30) cut = 150
        segments.push(remaining.substring(0, cut + 1))
        remaining = remaining.substring(cut + 1)
      }

      let idx = 0
      const speakNext = () => {
        if (idx >= segments.length) {
          resolve()
          return
        }
        const utt = new SpeechSynthesisUtterance(segments[idx])
        utt.lang = 'zh-CN'
        utt.rate = 1.05
        utt.pitch = 1.0
        utt.volume = 1.0

        // 选择中文语音
        const voices = speechSynthesis.getVoices()
        const zhVoice = voices.find(v => v.lang.startsWith('zh') && v.localService)
          || voices.find(v => v.lang.startsWith('zh'))
        if (zhVoice) utt.voice = zhVoice

        utt.onend = () => { idx++; speakNext() }
        utt.onerror = (e) => {
          console.warn('[VoiceChat] TTS 播报错误:', e)
          idx++
          speakNext()
        }
        speechSynthesis.speak(utt)
      }

      // Chrome 有 bug：如果 speechSynthesis 处于暂停状态，新的 speak 会挂起
      speechSynthesis.cancel()
      setTimeout(speakNext, 50)
    })
  }, [])

  // 发送到 Agent 后端
  const sendToAgent = useCallback(async (userText: string) => {
    if (isProcessingRef.current) return
    isProcessingRef.current = true
    setState('processing')
    setCurrentReply('')

    const userEntry: TranscriptEntry = { role: 'user', text: userText }
    transcriptRef.current = [...transcriptRef.current, userEntry]
    setTranscript([...transcriptRef.current])

    try {
      const historyForAgent = [
        ...(chatHistory || []).slice(-6).map(m => ({ role: m.role, text: m.text.substring(0, 500) })),
        ...transcriptRef.current.slice(-8).map(m => ({ role: m.role, text: m.text.substring(0, 500) })),
      ].slice(0, -1)

      const res = await executeAgent({
        instruction: userText,
        task_type: 'chat',
        source: 'voice',
        history: historyForAgent,
      })

      const replyText = res.result || res.error || '没有回答'

      const agentEntry: TranscriptEntry = {
        role: 'agent',
        text: replyText,
        stats: res.stats,
        relatedItems: res.related_items,
      }
      transcriptRef.current = [...transcriptRef.current, agentEntry]
      setTranscript([...transcriptRef.current])
      setCurrentReply(replyText)

      // 语音播报
      setState('speaking')
      await speak(replyText)

    } catch (e) {
      const errMsg = (e as Error).message
      const errEntry: TranscriptEntry = { role: 'agent', text: `调用失败：${errMsg}` }
      transcriptRef.current = [...transcriptRef.current, errEntry]
      setTranscript([...transcriptRef.current])
      setCurrentReply(`调用失败：${errMsg}`)
    }

    isProcessingRef.current = false
    setCurrentReply('')
    setInterimText('')

    if (shouldRestartRef.current) {
      setState('listening')
      startRecognition()
    }
  }, [chatHistory, speak])

  // 启动语音识别
  const startRecognition = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      setError('你的浏览器不支持语音识别，请使用 Chrome')
      setState('error')
      return
    }

    if (recognitionRef.current) {
      try { recognitionRef.current.abort() } catch { /* ignore */ }
    }

    const recognition = new SR()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'zh-CN'

    recognition.onresult = (ev: any) => {
      let interim = ''
      let final = ''

      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const result = ev.results[i]
        if (result.isFinal) {
          final += result[0].transcript
        } else {
          interim += result[0].transcript
        }
      }

      setInterimText(interim)

      if (final.trim()) {
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current)
          silenceTimerRef.current = 0
        }
        try { recognition.stop() } catch { /* ignore */ }
        stopSpeaking()
        sendToAgent(final.trim())
      }
    }

    recognition.onerror = (ev: any) => {
      console.warn('[VoiceChat] 识别错误:', ev.error)
      if (ev.error === 'not-allowed') {
        setError('麦克风权限被拒绝，请在浏览器设置中允许')
        setState('error')
      } else if (ev.error === 'no-speech') {
        if (shouldRestartRef.current && !isProcessingRef.current) {
          setTimeout(() => {
            if (shouldRestartRef.current && !isProcessingRef.current) startRecognition()
          }, 300)
        }
      }
    }

    recognition.onend = () => {
      if (shouldRestartRef.current && !isProcessingRef.current) {
        setTimeout(() => {
          if (shouldRestartRef.current && !isProcessingRef.current) startRecognition()
        }, 300)
      }
    }

    recognitionRef.current = recognition

    try {
      recognition.start()
    } catch (e) {
      console.warn('[VoiceChat] 启动识别失败:', e)
      setTimeout(() => {
        if (shouldRestartRef.current && !isProcessingRef.current) startRecognition()
      }, 500)
    }
  }, [sendToAgent, stopSpeaking])

  // 初始化
  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      setError('你的浏览器不支持语音识别，请使用 Chrome')
      setState('error')
      return
    }

    // 预加载语音列表
    if ('speechSynthesis' in window) {
      speechSynthesis.getVoices()
      speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices()
    }

    // 解锁 TTS（在 useEffect 里调用，因为组件挂载是用户点击触发的）
    unlockTTS()

    shouldRestartRef.current = true
    startRecognition()

    timerRef.current = window.setInterval(() => {
      setDuration(d => d + 1)
    }, 1000)

    return () => {
      shouldRestartRef.current = false
      if (recognitionRef.current) {
        try { recognitionRef.current.abort() } catch { /* ignore */ }
      }
      stopSpeaking()
      if (timerRef.current) clearInterval(timerRef.current)
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const endCall = useCallback(() => {
    shouldRestartRef.current = false
    if (recognitionRef.current) {
      try { recognitionRef.current.abort() } catch { /* ignore */ }
    }
    stopSpeaking()
    onClose(transcriptRef.current.length > 0 ? transcriptRef.current : undefined)
  }, [onClose, stopSpeaking])

  const fmtDur = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  }

  const labels: Record<VoiceState, string> = {
    listening: '正在听你说话…',
    processing: '正在思考…',
    speaking: 'AI 回复中…',
    error: error || '出错了',
    closed: '已结束',
  }

  const ringScale = state === 'listening' ? 1.05 : state === 'speaking' ? 1.15 : state === 'processing' ? 1.1 : 1
  const ringColor = state === 'listening' ? 'rgba(59,130,246,0.35)'
    : state === 'speaking' ? 'rgba(34,197,94,0.35)'
    : state === 'processing' ? 'rgba(168,85,247,0.35)'
    : state === 'error' ? 'rgba(239,68,68,0.35)'
    : 'rgba(255,255,255,0.1)'
  const ringGlow = state === 'listening' ? '0 0 60px rgba(59,130,246,0.3)'
    : state === 'speaking' ? '0 0 60px rgba(34,197,94,0.3)'
    : state === 'processing' ? '0 0 60px rgba(168,85,247,0.3)'
    : 'none'

  const hasText = transcript.length > 0 || interimText || currentReply

  return (
    <div className="fixed inset-0 z-50 flex flex-col"
      style={{ background: 'linear-gradient(180deg, #0f172a 0%, #000 100%)' }}>

      {/* 顶部栏 */}
      <div className="shrink-0 flex justify-between items-center px-5 pt-safe mt-3">
        <span className="text-white/30 text-xs">AI 语音助手 · Agent</span>
        <div className="flex items-center gap-3">
          {hasText && (
            <button
              onClick={() => setShowTranscript(!showTranscript)}
              className={`text-xs px-3 py-1 rounded-full transition-colors ${showTranscript ? 'bg-white/20 text-white' : 'bg-white/5 text-white/40'}`}
            >
              {showTranscript ? '隐藏记录' : '显示记录'}
            </button>
          )}
          <button onClick={endCall} className="text-white/40 text-lg px-2 py-1 active:text-white/80">✕</button>
        </div>
      </div>

      {/* 状态区 */}
      <div className="shrink-0 flex flex-col items-center gap-4 pt-6 pb-4">
        {/* 脉动圆圈 */}
        <div className="relative w-28 h-28 flex items-center justify-center">
          <div
            className={`absolute inset-0 rounded-full transition-transform duration-300 ${state === 'processing' ? 'animate-pulse' : ''}`}
            style={{ background: ringColor, transform: `scale(${ringScale})`, boxShadow: ringGlow }}
          />
          <div
            className="absolute rounded-full"
            style={{
              inset: '10px',
              background: ringColor.replace('0.35', '0.5'),
              transform: `scale(${state === 'processing' ? 0.95 : 1})`,
              transition: 'transform 200ms',
            }}
          />
          <span className="text-3xl relative z-10 select-none">
            {state === 'listening' ? '🎤' :
             state === 'processing' ? '🧠' :
             state === 'speaking' ? '🔊' :
             state === 'error' ? '⚠️' : '🎤'}
          </span>
        </div>

        {/* 状态文字 */}
        <div className={`text-sm font-medium ${
          state === 'error' ? 'text-red-400' :
          state === 'speaking' ? 'text-green-400' :
          state === 'processing' ? 'text-purple-400' :
          state === 'listening' ? 'text-blue-400' :
          'text-white/50'
        }`}>
          {labels[state]}
        </div>

        {/* 正在说的临时文字 */}
        {interimText && state === 'listening' && (
          <div className="mx-6 px-4 py-2 bg-blue-500/20 rounded-xl max-w-[320px]">
            <div className="text-blue-200 text-base leading-relaxed">{interimText}</div>
          </div>
        )}

        {/* 计时 */}
        {state !== 'error' && !interimText && (
          <div className="text-white/15 text-lg font-extralight tracking-[0.15em]">
            {fmtDur(duration)}
          </div>
        )}

        {/* 错误重试 */}
        {state === 'error' && (
          <button
            onClick={() => { setState('listening'); startRecognition() }}
            className="text-sm text-white/60 bg-white/10 px-5 py-2 rounded-full active:bg-white/20"
          >
            重试
          </button>
        )}
      </div>

      {/* 对话记录区（可滚动，占据剩余空间） */}
      <div className="flex-1 min-h-0 mx-3 mb-2">
        {showTranscript && hasText ? (
          <div
            ref={transcriptScrollRef}
            className="h-full bg-black/60 backdrop-blur-sm rounded-2xl px-4 py-3 overflow-y-auto"
          >
            {transcript.map((entry, i) => (
              <div key={i} className={`mb-4 ${entry.role === 'user' ? 'flex justify-end' : ''}`}>
                {entry.role === 'user' ? (
                  <div className="bg-blue-600/30 rounded-2xl rounded-br-md px-4 py-3 max-w-[85%]">
                    <div className="text-blue-100 text-[15px] leading-relaxed">{entry.text}</div>
                  </div>
                ) : (
                  <div className="bg-white/10 rounded-2xl rounded-bl-md px-4 py-3">
                    <div className="text-white/90 text-[15px] leading-relaxed whitespace-pre-wrap">{entry.text}</div>
                    {entry.stats && (
                      <div className="text-[11px] text-white/25 mt-2">
                        ⏱{(entry.stats.duration_ms / 1000).toFixed(1)}s · 📚检索{entry.stats.context_items}条 · 🔤{entry.stats.input_tokens + entry.stats.output_tokens} tokens
                      </div>
                    )}
                    {entry.relatedItems && entry.relatedItems.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {entry.relatedItems.slice(0, 4).map(item => (
                          <span key={item.id} className="text-[11px] bg-white/10 text-white/50 px-2 py-0.5 rounded-full truncate max-w-[140px]">
                            {item.title}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* AI 正在回复 */}
            {currentReply && (
              <div className="mb-4">
                <div className="bg-green-500/15 rounded-2xl rounded-bl-md px-4 py-3 border border-green-500/20">
                  <div className="text-white/80 text-[15px] leading-relaxed whitespace-pre-wrap">{currentReply}</div>
                  {state === 'speaking' && (
                    <div className="text-[11px] text-green-400/50 mt-1 flex items-center gap-1">
                      <span className="inline-block w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                      正在播报…
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 处理中 */}
            {state === 'processing' && !currentReply && (
              <div className="mb-4">
                <div className="bg-purple-500/15 rounded-2xl rounded-bl-md px-4 py-3 border border-purple-500/20">
                  <div className="flex items-center gap-2 text-purple-300/70 text-sm">
                    <span className="inline-block w-2 h-2 bg-purple-400 rounded-full animate-pulse" />
                    <span className="inline-block w-2 h-2 bg-purple-400 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }} />
                    <span className="inline-block w-2 h-2 bg-purple-400 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }} />
                    <span className="ml-1">正在检索知识库并思考…</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-white/15 text-sm text-center">
              {state === 'listening' ? '开始说话吧，我在听…' : ''}
            </div>
          </div>
        )}
      </div>

      {/* 底部控制 */}
      <div className="shrink-0 flex items-center justify-center gap-6 pb-safe mb-6">
        {/* 打断按钮 */}
        {state === 'speaking' && (
          <button
            onClick={() => {
              stopSpeaking()
              setState('listening')
              startRecognition()
            }}
            className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center active:bg-white/20"
          >
            <span className="text-white/60 text-lg">⏸</span>
          </button>
        )}

        {/* 结束按钮 */}
        <button
          onClick={endCall}
          className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center active:scale-90 transition-transform"
          style={{ boxShadow: '0 4px 24px rgba(239,68,68,0.4)' }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
            <path d="M3 3L21 21M21 3L3 21" />
          </svg>
        </button>

        {/* 占位（保持居中） */}
        {state === 'speaking' && <div className="w-12" />}
      </div>
    </div>
  )
}
