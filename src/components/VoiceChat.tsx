import { useState, useEffect, useRef, useCallback } from 'react'
import { GeminiLiveSession, type LiveState } from '../lib/gemini-live'

interface Props {
  onClose: () => void
}

export default function VoiceChat({ onClose }: Props) {
  const [state, setState] = useState<LiveState>('connecting')
  const [duration, setDuration] = useState(0)
  const [audioLevel, setAudioLevel] = useState(0)
  const [error, setError] = useState('')
  const [debugLogs, setDebugLogs] = useState<string[]>([])
  const sessionRef = useRef<GeminiLiveSession | null>(null)
  const timerRef = useRef<number>(0)
  const levelRef = useRef(0)

  // 拦截 console.log/warn/error 中的 GeminiLive 日志显示在界面上
  useEffect(() => {
    const origLog = console.log
    const origWarn = console.warn
    const origErr = console.error
    const addLog = (prefix: string, args: unknown[]) => {
      const msg = args.map(a => {
        if (typeof a === 'string') return a
        if (a instanceof Error) return a.message
        try { return JSON.stringify(a)?.substring(0, 200) } catch { return String(a) }
      }).join(' ')
      if (msg.includes('GeminiLive') || msg.includes('gemini') || msg.includes('Gemini')) {
        setDebugLogs(prev => [...prev.slice(-12), `${prefix} ${msg.substring(0, 200)}`])
      }
    }
    console.log = (...args: unknown[]) => { origLog(...args); addLog('📝', args) }
    console.warn = (...args: unknown[]) => { origWarn(...args); addLog('⚠️', args) }
    console.error = (...args: unknown[]) => { origErr(...args); addLog('❌', args) }
    return () => { console.log = origLog; console.warn = origWarn; console.error = origErr }
  }, [])

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
    })
    sessionRef.current = session

    const systemPrompt = `你是 AIVault 知识库语音助手。规则：
- 始终用中文回答
- 语气自然亲切，像朋友聊天
- 回答简洁，适合语音交流（每次回复控制在 3-5 句话）
- 不要输出列表、代码块、Markdown 格式
- 如果用户问知识库相关问题，尽量提供有用的建议
- 可以随时被打断，被打断后根据新问题重新回答`

    session.start(apiKey, systemPrompt)

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
    onClose()
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

  // 圆圈大小根据状态动态变化
  const ringScale = state === 'listening'
    ? 1 + audioLevel * 0.4
    : state === 'speaking'
    ? 1.15
    : 1

  const ringColor = state === 'listening'
    ? 'rgba(59,130,246,0.35)'  // blue
    : state === 'speaking'
    ? 'rgba(34,197,94,0.35)'   // green
    : state === 'error'
    ? 'rgba(239,68,68,0.35)'   // red
    : 'rgba(255,255,255,0.1)'

  const ringGlow = state === 'listening'
    ? '0 0 60px rgba(59,130,246,0.3)'
    : state === 'speaking'
    ? '0 0 60px rgba(34,197,94,0.3)'
    : 'none'

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-between"
      style={{ background: 'linear-gradient(180deg, #0f172a 0%, #000 100%)' }}>

      {/* 顶部 */}
      <div className="w-full flex justify-between items-center px-5 pt-safe mt-3">
        <span className="text-white/30 text-xs">Gemini Live</span>
        <button onClick={endCall} className="text-white/40 text-lg px-2 py-1 active:text-white/80">✕</button>
      </div>

      {/* 中心 */}
      <div className="flex flex-col items-center gap-6 -mt-8">
        {/* 脉动圆圈 */}
        <div className="relative w-40 h-40 flex items-center justify-center">
          {/* 外圈脉动 */}
          <div
            className="absolute inset-0 rounded-full transition-transform duration-150"
            style={{
              background: ringColor,
              transform: `scale(${ringScale})`,
              boxShadow: ringGlow,
            }}
          />
          {/* 内圈 */}
          <div
            className="absolute rounded-full"
            style={{
              inset: '12px',
              background: ringColor.replace('0.35', '0.5'),
              transform: `scale(${state === 'listening' ? 1 + audioLevel * 0.2 : 1})`,
              transition: 'transform 100ms',
            }}
          />
          {/* 图标 */}
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

        {/* 计时 */}
        {state !== 'error' && state !== 'idle' && (
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

      {/* 调试日志（手机可见） */}
      {debugLogs.length > 0 && (
        <div className="absolute bottom-32 left-3 right-3 bg-black/70 rounded-xl p-2 max-h-[150px] overflow-y-auto">
          {debugLogs.map((log, i) => (
            <div key={i} className="text-[10px] text-green-400 font-mono leading-tight py-0.5 break-all">{log}</div>
          ))}
        </div>
      )}

      {/* 底部 */}
      <div className="flex flex-col items-center gap-3 pb-safe mb-8">
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
