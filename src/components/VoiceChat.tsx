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
  const [interimText, setInterimText] = useState('') // 正在说的（临时）
  const [currentReply, setCurrentReply] = useState('') // AI 当前回复
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [showTranscript, setShowTranscript] = useState(true)

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const timerRef = useRef<number>(0)
  const transcriptRef = useRef<TranscriptEntry[]>([])
  const transcriptScrollRef = useRef<HTMLDivElement>(null)
  const isProcessingRef = useRef(false)
  const shouldRestartRef = useRef(true)
  const silenceTimerRef = useRef<number>(0)

  // 自动滚动
  useEffect(() => {
    if (transcriptScrollRef.current) {
      transcriptScrollRef.current.scrollTop = transcriptScrollRef.current.scrollHeight
    }
  }, [transcript, currentReply, interimText])

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

      // 分段播报（每段不超过 200 字，避免 TTS 截断）
      const segments: string[] = []
      let remaining = clean
      while (remaining.length > 0) {
        if (remaining.length <= 200) {
          segments.push(remaining)
          break
        }
        // 找合适的断句点
        let cut = remaining.lastIndexOf('。', 200)
        if (cut < 50) cut = remaining.lastIndexOf('，', 200)
        if (cut < 50) cut = remaining.lastIndexOf('、', 200)
        if (cut < 50) cut = 200
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
        utt.rate = 1.1
        utt.pitch = 1.0

        // 尝试选择中文语音
        const voices = speechSynthesis.getVoices()
        const zhVoice = voices.find(v => v.lang.startsWith('zh') && v.localService)
          || voices.find(v => v.lang.startsWith('zh'))
        if (zhVoice) utt.voice = zhVoice

        utt.onend = () => { idx++; speakNext() }
        utt.onerror = () => { idx++; speakNext() }
        speechSynthesis.speak(utt)
      }
      speakNext()
    })
  }, [])

  // 发送到 Agent 后端
  const sendToAgent = useCallback(async (userText: string) => {
    if (isProcessingRef.current) return
    isProcessingRef.current = true
    setState('processing')
    setCurrentReply('')

    // 记录用户消息
    const userEntry: TranscriptEntry = { role: 'user', text: userText }
    transcriptRef.current = [...transcriptRef.current, userEntry]
    setTranscript([...transcriptRef.current])

    try {
      // 构建历史上下文（包含之前的文字聊天 + 本次语音对话）
      const historyForAgent = [
        ...(chatHistory || []).slice(-6).map(m => ({ role: m.role, text: m.text.substring(0, 500) })),
        ...transcriptRef.current.slice(-8).map(m => ({ role: m.role, text: m.text.substring(0, 500) })),
      ].slice(0, -1) // 不包含当前这条

      const res = await executeAgent({
        instruction: userText,
        task_type: 'chat',
        source: 'voice',
        history: historyForAgent,
      })

      const replyText = res.result || res.error || '没有回答'

      // 记录 AI 回复
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

    // 回到监听
    if (shouldRestartRef.current) {
      setState('listening')
      startRecognition()
    }
  }, [chatHistory, speak])

  // 启动语音识别
  const startRecognition = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      setError('你的浏览器不支持语音识别，请使用 Chrome')
      setState('error')
      return
    }

    // 清理旧实例
    if (recognitionRef.current) {
      try { recognitionRef.current.abort() } catch { /* ignore */ }
    }

    const recognition = new SpeechRecognition()
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

      // 有最终结果 → 发送给 Agent
      if (final.trim()) {
        // 清除静默计时器
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current)
          silenceTimerRef.current = 0
        }

        // 停止识别，发送
        try { recognition.stop() } catch { /* ignore */ }
        stopSpeaking() // 如果 AI 在说话，打断
        sendToAgent(final.trim())
      }
    }

    recognition.onerror = (ev: any) => {
      console.warn('[VoiceChat] 识别错误:', ev.error)
      if (ev.error === 'not-allowed') {
        setError('麦克风权限被拒绝，请在浏览器设置中允许')
        setState('error')
      } else if (ev.error === 'no-speech') {
        // 没说话，重新开始
        if (shouldRestartRef.current && !isProcessingRef.current) {
          setTimeout(() => {
            if (shouldRestartRef.current && !isProcessingRef.current) {
              startRecognition()
            }
          }, 300)
        }
      }
      // aborted 和 network 不需要特别处理
    }

    recognition.onend = () => {
      // 如果没在处理中且应该继续，重启识别
      if (shouldRestartRef.current && !isProcessingRef.current) {
        setTimeout(() => {
          if (shouldRestartRef.current && !isProcessingRef.current) {
            startRecognition()
          }
        }, 300)
      }
    }

    recognitionRef.current = recognition

    try {
      recognition.start()
    } catch (e) {
      console.warn('[VoiceChat] 启动识别失败:', e)
      // 可能是上一个实例还没完全停止，稍后重试
      setTimeout(() => {
        if (shouldRestartRef.current && !isProcessingRef.current) {
          startRecognition()
        }
      }, 500)
    }
  }, [sendToAgent, stopSpeaking])

  // 初始化
  useEffect(() => {
    // 检查浏览器支持
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      setError('你的浏览器不支持语音识别，请使用 Chrome')
      setState('error')
      return
    }

    // 预加载语音列表
    if ('speechSynthesis' in window) {
      speechSynthesis.getVoices()
      speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices()
    }

    shouldRestartRef.current = true
    startRecognition()

    // 计时器
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
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-between"
      style={{ background: 'linear-gradient(180deg, #0f172a 0%, #000 100%)' }}>

      {/* 顶部 */}
      <div className="w-full flex justify-between items-center px-5 pt-safe mt-3">
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

      {/* 中心 */}
      <div className="flex flex-col items-center gap-5 -mt-4">
        {/* 脉动圆圈 */}
        <div className="relative w-36 h-36 flex items-center justify-center">
          <div
            className={`absolute inset-0 rounded-full transition-transform duration-300 ${state === 'processing' ? 'animate-pulse' : ''}`}
            style={{ background: ringColor, transform: `scale(${ringScale})`, boxShadow: ringGlow }}
          />
          <div
            className="absolute rounded-full"
            style={{
              inset: '12px',
              background: ringColor.replace('0.35', '0.5'),
              transform: `scale(${state === 'processing' ? 0.95 : 1})`,
              transition: 'transform 200ms',
            }}
          />
          <span className="text-4xl relative z-10 select-none">
            {state === 'listening' ? '🎤' :
             state === 'processing' ? '🧠' :
             state === 'speaking' ? '🔊' :
             state === 'error' ? '⚠️' : '🎤'}
          </span>
        </div>

        {/* 标题 */}
        <div className="text-white text-lg font-medium tracking-wide">AI 语音助手</div>

        {/* 状态 */}
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
            <div className="text-blue-300 text-sm leading-relaxed">{interimText}</div>
          </div>
        )}

        {/* AI 当前回复摘要 */}
        {currentReply && (state === 'speaking' || state === 'processing') && (
          <div className="mx-6 px-4 py-2 bg-white/10 rounded-xl max-w-[320px] max-h-[100px] overflow-hidden">
            <div className="text-white/70 text-sm leading-relaxed line-clamp-4">{currentReply}</div>
          </div>
        )}

        {/* 计时 */}
        {state !== 'error' && !interimText && !currentReply && (
          <div className="text-white/20 text-2xl font-extralight tracking-[0.2em] mt-1">
            {fmtDur(duration)}
          </div>
        )}

        {/* 错误重试 */}
        {state === 'error' && (
          <button
            onClick={() => { setState('listening'); startRecognition() }}
            className="mt-2 text-sm text-white/60 bg-white/10 px-5 py-2 rounded-full active:bg-white/20"
          >
            重试
          </button>
        )}
      </div>

      {/* 对话记录面板 */}
      {showTranscript && hasText && (
        <div
          ref={transcriptScrollRef}
          className="absolute bottom-32 left-3 right-3 bg-black/80 backdrop-blur-sm rounded-xl p-3 max-h-[220px] overflow-y-auto"
        >
          <div className="text-[10px] text-white/30 mb-2 font-medium">对话记录（结束后自动保存）</div>
          {transcript.map((entry, i) => (
            <div key={i} className="mb-2">
              <div className={`text-[10px] mb-0.5 ${entry.role === 'user' ? 'text-blue-400/70' : 'text-green-400/70'}`}>
                {entry.role === 'user' ? '你' : 'AI'}
              </div>
              <div className={`text-[13px] leading-relaxed ${entry.role === 'user' ? 'text-blue-200/80' : 'text-white/80'}`}>
                {entry.text}
              </div>
              {entry.stats && (
                <div className="text-[9px] text-white/20 mt-0.5">
                  ⏱{(entry.stats.duration_ms / 1000).toFixed(1)}s · 📚{entry.stats.context_items}条
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 底部 */}
      <div className="flex flex-col items-center gap-3 pb-safe mb-8">
        {transcript.length > 0 && !showTranscript && (
          <button onClick={() => setShowTranscript(true)} className="text-[11px] text-white/30 mb-1">
            {transcript.length} 条对话 · 点击查看
          </button>
        )}

        {/* 打断按钮（AI 说话时） */}
        {state === 'speaking' && (
          <button
            onClick={() => {
              stopSpeaking()
              setState('listening')
              startRecognition()
            }}
            className="text-xs text-white/50 bg-white/10 px-4 py-1.5 rounded-full mb-2 active:bg-white/20"
          >
            打断 AI
          </button>
        )}

        <button
          onClick={endCall}
          className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center active:scale-90 transition-transform"
          style={{ boxShadow: '0 4px 24px rgba(239,68,68,0.4)' }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
            <path d="M3 3L21 21M21 3L3 21" />
          </svg>
        </button>
        <span className="text-white/30 text-xs">结束通话</span>
      </div>
    </div>
  )
}
