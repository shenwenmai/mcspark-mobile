/**
 * Gemini Live API — 实时双向语音对话
 * WebSocket 连接，PCM 音频流
 */

export type LiveState = 'idle' | 'connecting' | 'listening' | 'speaking' | 'error' | 'closed'

export interface LiveCallbacks {
  onStateChange: (state: LiveState) => void
  onError: (msg: string) => void
  onAudioLevel: (level: number) => void
}

const WS_BASE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent'
const INPUT_RATE = 16000
const OUTPUT_RATE = 24000
const MODEL = 'models/gemini-2.0-flash-live-001'

export class GeminiLiveSession {
  private ws: WebSocket | null = null
  private audioCtx: AudioContext | null = null
  private mediaStream: MediaStream | null = null
  private processor: ScriptProcessorNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private silentGain: GainNode | null = null
  private playQueue: Float32Array[] = []
  private isPlaying = false
  private cb: LiveCallbacks
  private _state: LiveState = 'idle'

  constructor(cb: LiveCallbacks) {
    this.cb = cb
  }

  get state() { return this._state }

  async start(apiKey: string, systemPrompt: string, voiceName = 'Kore') {
    this.setState('connecting')

    try {
      // 1. 获取麦克风
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      })

      // 2. AudioContext
      this.audioCtx = new AudioContext()
      if (this.audioCtx.state === 'suspended') await this.audioCtx.resume()

      // 3. WebSocket
      this.ws = new WebSocket(`${WS_BASE}?key=${apiKey}`)

      this.ws.onopen = () => {
        this.ws!.send(JSON.stringify({
          setup: {
            model: MODEL,
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName }
                }
              }
            },
            systemInstruction: {
              parts: [{ text: systemPrompt }]
            }
          }
        }))
      }

      this.ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data)
          this.handleMsg(data)
        } catch { /* ignore parse errors */ }
      }

      this.ws.onerror = () => {
        this.cb.onError('WebSocket 连接失败，请检查 API Key')
        this.setState('error')
      }

      this.ws.onclose = (e) => {
        if (this._state !== 'closed' && this._state !== 'error') {
          if (e.code !== 1000) {
            this.cb.onError(`连接断开 (${e.code})`)
            this.setState('error')
          } else {
            this.setState('closed')
          }
        }
      }

    } catch (e) {
      this.cb.onError('麦克风访问失败: ' + (e as Error).message)
      this.setState('error')
    }
  }

  stop() {
    if (this.processor) { this.processor.disconnect(); this.processor = null }
    if (this.source) { this.source.disconnect(); this.source = null }
    if (this.silentGain) { this.silentGain.disconnect(); this.silentGain = null }
    if (this.mediaStream) { this.mediaStream.getTracks().forEach(t => t.stop()); this.mediaStream = null }
    if (this.ws && this.ws.readyState <= 1) { this.ws.close(1000); this.ws = null }
    if (this.audioCtx) { this.audioCtx.close().catch(() => {}); this.audioCtx = null }
    this.playQueue = []
    this.isPlaying = false
    this.setState('closed')
  }

  private setState(s: LiveState) {
    this._state = s
    this.cb.onStateChange(s)
  }

  // ── 消息处理 ──
  private handleMsg(data: Record<string, unknown>) {
    // Setup 完成 → 开始收音
    if (data.setupComplete) {
      this.startMic()
      this.setState('listening')
      return
    }

    // AI 回复
    const sc = data.serverContent as { modelTurn?: { parts?: Array<{ inlineData?: { data: string } }> }; turnComplete?: boolean } | undefined
    if (sc) {
      if (sc.modelTurn?.parts) {
        for (const part of sc.modelTurn.parts) {
          if (part.inlineData?.data) {
            this.setState('speaking')
            const pcm = this.b64ToI16(part.inlineData.data)
            const f32 = this.i16ToF32(pcm)
            this.playQueue.push(f32)
            this.playNext()
          }
        }
      }

      if (sc.turnComplete) {
        const waitDone = () => {
          if (this.playQueue.length === 0 && !this.isPlaying) {
            if (this._state === 'speaking') this.setState('listening')
          } else {
            setTimeout(waitDone, 150)
          }
        }
        setTimeout(waitDone, 150)
      }
    }
  }

  // ── 麦克风采集 ──
  private startMic() {
    if (!this.audioCtx || !this.mediaStream) return

    this.source = this.audioCtx.createMediaStreamSource(this.mediaStream)
    this.processor = this.audioCtx.createScriptProcessor(4096, 1, 1)

    // 静音增益：ScriptProcessor 需连接到 destination 才工作，但不想播放麦克风声音
    this.silentGain = this.audioCtx.createGain()
    this.silentGain.gain.value = 0

    const nativeRate = this.audioCtx.sampleRate

    this.processor.onaudioprocess = (ev) => {
      if (this._state === 'closed' || !this.ws || this.ws.readyState !== WebSocket.OPEN) return

      const raw = ev.inputBuffer.getChannelData(0)

      // 音量可视化
      let sum = 0
      for (let i = 0; i < raw.length; i++) sum += raw[i] * raw[i]
      this.cb.onAudioLevel(Math.min(1, Math.sqrt(sum / raw.length) * 6))

      // 降采样 → Int16 → base64 → 发送
      const down = this.downsample(raw, nativeRate, INPUT_RATE)
      const i16 = this.f32ToI16(down)
      const b64 = this.bufToB64(i16.buffer)

      this.ws!.send(JSON.stringify({
        realtimeInput: {
          mediaChunks: [{ mimeType: `audio/pcm;rate=${INPUT_RATE}`, data: b64 }]
        }
      }))
    }

    this.source.connect(this.processor)
    this.processor.connect(this.silentGain)
    this.silentGain.connect(this.audioCtx.destination)
  }

  // ── 音频播放 ──
  private playNext() {
    if (this.isPlaying || this.playQueue.length === 0 || !this.audioCtx) return
    this.isPlaying = true

    const samples = this.playQueue.shift()!
    const buf = this.audioCtx.createBuffer(1, samples.length, OUTPUT_RATE)
    buf.getChannelData(0).set(samples)

    const src = this.audioCtx.createBufferSource()
    src.buffer = buf
    src.connect(this.audioCtx.destination)
    src.onended = () => { this.isPlaying = false; this.playNext() }
    src.start()
  }

  // ── 音频工具函数 ──
  private downsample(input: Float32Array, from: number, to: number): Float32Array {
    if (from === to) return input
    const ratio = from / to
    const len = Math.round(input.length / ratio)
    const out = new Float32Array(len)
    for (let i = 0; i < len; i++) {
      out[i] = input[Math.min(Math.floor(i * ratio), input.length - 1)]
    }
    return out
  }

  private f32ToI16(f: Float32Array): Int16Array {
    const o = new Int16Array(f.length)
    for (let i = 0; i < f.length; i++) {
      const s = Math.max(-1, Math.min(1, f[i]))
      o[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
    }
    return o
  }

  private i16ToF32(i: Int16Array): Float32Array {
    const o = new Float32Array(i.length)
    for (let j = 0; j < i.length; j++) {
      o[j] = i[j] / (i[j] < 0 ? 0x8000 : 0x7FFF)
    }
    return o
  }

  private b64ToI16(b64: string): Int16Array {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new Int16Array(bytes.buffer)
  }

  private bufToB64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf)
    let s = ''
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
    return btoa(s)
  }
}
