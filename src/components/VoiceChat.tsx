import { useState, useEffect, useRef, useCallback } from 'react'
import { GeminiLiveSession, type LiveState } from '../lib/gemini-live'
import { fetchItems } from '../lib/db'

interface TranscriptEntry {
  role: 'ai'
  text: string
  time: number
}

interface Props {
  onClose: (transcript?: TranscriptEntry[]) => void
}

export default function VoiceChat({ onClose }: Props) {
  const [state, setState] = useState<LiveState>('connecting')
  const [duration, setDuration] = useState(0)
  const [audioLevel, setAudioLevel] = useState(0)
  const [error, setError] = useState('')
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [currentText, setCurrentText] = useState('') // AI 正在说的当前文字
  const [showTranscript, setShowTranscript] = useState(false)
  const sessionRef = useRef<GeminiLiveSession | null>(null)
  const timerRef = useRef<number>(0)
  const levelRef = useRef(0)
  const transcriptRef = useRef<TranscriptEntry[]>([])
  const currentTextRef = useRef('')
  const transcriptScrollRef = useRef<HTMLDivElement>(null)

  // 平滑音量（用于动画）
  useEffect(() => {
    let raf: number
    const update = () => {
      levelRef.current += (audioLevel - levelRef.current) * 0.3
      raf = requestAnimationFrame(update)
    }
    raf = requestAnimationFrame(update)
    return () => cancelAnimationFrame(raf)
  }, [audioLevel])

  // 自动滚动字幕到底部
  useEffect(() => {
    if (transcriptScrollRef.current) {
      transcriptScrollRef.current.scrollTop = transcriptScrollRef.current.scrollHeight
    }
  }, [transcript, currentText])

  useEffect(() => {
    const apiKey = localStorage.getItem('gemini_api_key')
    if (!apiKey) {
      setError('请先在 ⚙️ 设置中配置 Gemini API Key')
      setState('error')
      return
    }

    const session = new GeminiLiveSession({
      onStateChange: setState,
      onError: setError,
      onAudioLevel: setAudioLevel,
      onTranscript: (text: string, isFinal: boolean) => {
        if (isFinal) {
          // 本轮结束，把累积的文字存入记录
          if (currentTextRef.current.trim()) {
            const entry: TranscriptEntry = {
              role: 'ai',
              text: currentTextRef.current.trim(),
              time: Date.now(),
            }
            transcriptRef.current = [...transcriptRef.current, entry]
            setTranscript([...transcriptRef.current])
          }
          currentTextRef.current = ''
          setCurrentText('')
        } else {
          // 累积文字片段
          currentTextRef.current += text
          setCurrentText(currentTextRef.current)
        }
      },
    })
    sessionRef.current = session

    // 加载知识库内容注入到 system prompt
    const startWithKnowledge = async () => {
      let knowledgeContext = ''
      try {
        const items = await fetchItems()
        if (items.length > 0) {
          const catCount: Record<string, number> = {}
          items.forEach(it => { catCount[it.category] = (catCount[it.category] || 0) + 1 })
          const catSummary = Object.entries(catCount).map(([c, n]) => `${c}(${n}条)`).join('、')

          const MAX_CHARS = 12000
          let used = 0
          const snippets: string[] = []
          for (const it of items) {
            const summary = it.summary || it.content?.substring(0, 150) || ''
            const tags = it.tags?.length ? ` [标签:${it.tags.join(',')}]` : ''
            const line = `• ${it.title}${tags}: ${summary}`
            if (used + line.length > MAX_CHARS) break
            snippets.push(line)
            used += line.length
          }

          knowledgeContext = `\n\n=== 用户知识库概况 ===
总计 ${items.length} 条知识，分类：${catSummary}

=== 知识库内容（按时间从新到旧） ===
${snippets.join('\n')}`
        }
      } catch (e) {
        console.warn('[VoiceChat] 加载知识库失败:', e)
      }

      const systemPrompt = `你是 AIVault 知识库语音助手。你可以访问用户的个人知识库数据，请基于这些真实数据来回答问题。

规则：
- 始终用中文回答
- 语气自然亲切，像朋友聊天
- 回答简洁，适合语音交流（每次回复控制在 3-5 句话）
- 不要输出列表、代码块、Markdown 格式
- 回答必须基于下方提供的知识库真实内容，不要编造不存在的条目
- 如果知识库中没有相关内容，坦诚告诉用户"你的知识库里目前没有这方面的内容"
- 可以随时被打断，被打断后根据新问题重新回答${knowledgeContext}`

      session.start(apiKey, systemPrompt)
    }

    startWithKnowledge()

    // 计时器
    timerRef.current = window.setInterval(() => {
      setDuration(d => d + 1)
    }, 1000)

    return () => {
      session.stop()
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const endCall = useCallback(() => {
    sessionRef.current?.stop()
    // 把最后正在说的文字也加上
    if (currentTextRef.current.trim()) {
      transcriptRef.current = [...transcriptRef.current, {
        role: 'ai' as const,
        text: currentTextRef.current.trim(),
        time: Date.now(),
      }]
    }
    onClose(transcriptRef.current.length > 0 ? transcriptRef.current : undefined)
  }, [onClose])

  const fmtDur = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  }

  const labels: Record<LiveState, string> = {
    idle: '准备中…',
    connecting: '正在连接…',
    listening: '正在听你说话…',
    speaking: 'AI 回复中…',
    error: error || '连接失败',
    closed: '已结束',
  }

  const ringScale = state === 'listening'
    ? 1 + audioLevel * 0.4
    : state === 'speaking'
    ? 1.15
    : 1

  const ringColor = state === 'listening'
    ? 'rgba(59,130,246,0.35)'
    : state === 'speaking'
    ? 'rgba(34,197,94,0.35)'
    : state === 'error'
    ? 'rgba(239,68,68,0.35)'
    : 'rgba(255,255,255,0.1)'

  const ringGlow = state === 'listening'
    ? '0 0 60px rgba(59,130,246,0.3)'
    : state === 'speaking'
    ? '0 0 60px rgba(34,197,94,0.3)'
    : 'none'

  // 是否有文字内容可显示
  const hasText = transcript.length > 0 || currentText

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-between"
      style={{ background: 'linear-gradient(180deg, #0f172a 0%, #000 100%)' }}>

      {/* 顶部 */}
      <div className="w-full flex justify-between items-center px-5 pt-safe mt-3">
        <span className="text-white/30 text-xs">Gemini Live</span>
        <div className="flex items-center gap-3">
          {/* 字幕开关 */}
          {hasText && (
            <button
              onClick={() => setShowTranscript(!showTranscript)}
              className={`text-xs px-3 py-1 rounded-full transition-colors ${showTranscript ? 'bg-white/20 text-white' : 'bg-white/5 text-white/40'}`}
            >
              {showTranscript ? '隐藏字幕' : '显示字幕'}
            </button>
          )}
          <button onClick={endCall} className="text-white/40 text-lg px-2 py-1 active:text-white/80">✕</button>
        </div>
      </div>

      {/* 中心 */}
      <div className="flex flex-col items-center gap-6 -mt-8">
        {/* 脉动圆圈 */}
        <div className="relative w-40 h-40 flex items-center justify-center">
          <div
            className="absolute inset-0 rounded-full transition-transform duration-150"
            style={{
              background: ringColor,
              transform: `scale(${ringScale})`,
              boxShadow: ringGlow,
            }}
          />
          <div
            className="absolute rounded-full"
            style={{
              inset: '12px',
              background: ringColor.replace('0.35', '0.5'),
              transform: `scale(${state === 'listening' ? 1 + audioLevel * 0.2 : 1})`,
              transition: 'transform 100ms',
            }}
          />
          <span className="text-5xl relative z-10 select-none">
            {state === 'connecting' ? '⏳' :
             state === 'listening' ? '🎤' :
             state === 'speaking' ? '✦' :
             state === 'error' ? '⚠️' : '🎤'}
          </span>
        </div>

        {/* 标题 */}
        <div className="text-white text-xl font-medium tracking-wide">AI 语音助手</div>

        {/* 状态 */}
        <div className={`text-sm font-medium ${
          state === 'error' ? 'text-red-400' :
          state === 'speaking' ? 'text-green-400' :
          state === 'listening' ? 'text-blue-400' :
          'text-white/50'
        }`}>
          {labels[state]}
        </div>

        {/* 实时字幕（AI 正在说的文字） */}
        {currentText && (
          <div className="mx-6 px-4 py-2 bg-white/10 rounded-xl max-w-[320px]">
            <div className="text-white/80 text-sm leading-relaxed">{currentText}</div>
          </div>
        )}

        {/* 计时 */}
        {state !== 'error' && state !== 'idle' && !currentText && (
          <div className="text-white/25 text-3xl font-extralight tracking-[0.2em] mt-2">
            {fmtDur(duration)}
          </div>
        )}

        {/* 错误重试 */}
        {state === 'error' && (
          <button
            onClick={() => window.location.reload()}
            className="mt-2 text-sm text-white/60 bg-white/10 px-5 py-2 rounded-full active:bg-white/20"
          >
            重试
          </button>
        )}
      </div>

      {/* 完整字幕面板 */}
      {showTranscript && hasText && (
        <div
          ref={transcriptScrollRef}
          className="absolute bottom-32 left-3 right-3 bg-black/80 backdrop-blur-sm rounded-xl p-3 max-h-[200px] overflow-y-auto"
        >
          <div className="text-[10px] text-white/30 mb-2 font-medium">对话记录</div>
          {transcript.map((entry, i) => (
            <div key={i} className="mb-2">
              <div className="text-[10px] text-green-400/60 mb-0.5">
                AI · {new Date(entry.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </div>
              <div className="text-[13px] text-white/80 leading-relaxed">{entry.text}</div>
            </div>
          ))}
          {currentText && (
            <div className="mb-2">
              <div className="text-[10px] text-blue-400/60 mb-0.5">AI · 正在说…</div>
              <div className="text-[13px] text-white/60 leading-relaxed">{currentText}</div>
            </div>
          )}
        </div>
      )}

      {/* 底部 */}
      <div className="flex flex-col items-center gap-3 pb-safe mb-8">
        {/* 字幕条数提示 */}
        {transcript.length > 0 && !showTranscript && (
          <button
            onClick={() => setShowTranscript(true)}
            className="text-[11px] text-white/30 mb-1"
          >
            已记录 {transcript.length} 条回复 · 点击查看
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
