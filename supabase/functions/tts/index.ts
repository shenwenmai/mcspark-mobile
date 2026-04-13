/**
 * Edge TTS 代理 — 调用微软 Edge 免费 TTS 接口
 * 返回 MP3 音频流
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Edge TTS WebSocket 地址
const WS_URL = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1'
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'

// 可选语音
const VOICES: Record<string, string> = {
  xiaoxiao: 'zh-CN-XiaoxiaoNeural',    // 女声（默认，活泼自然）
  xiaoyi: 'zh-CN-XiaoyiNeural',        // 女声（温柔）
  yunjian: 'zh-CN-YunjianNeural',      // 男声（沉稳）
  yunxi: 'zh-CN-YunxiNeural',          // 男声（年轻）
  yunyang: 'zh-CN-YunyangNeural',      // 男声（新闻播报）
}

function generateRequestId(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

function buildSSML(text: string, voice: string, rate: string, pitch: string): string {
  // 清理文本中的 XML 特殊字符
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN">
<voice name="${voice}">
<prosody rate="${rate}" pitch="${pitch}">
${escaped}
</prosody>
</voice>
</speak>`
}

async function synthesize(text: string, voiceKey: string, rate = '+0%', pitch = '+0Hz'): Promise<Uint8Array> {
  const voice = VOICES[voiceKey] || VOICES.xiaoxiao
  const requestId = generateRequestId()

  const wsUrl = `${WS_URL}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&ConnectionId=${requestId}`

  return new Promise((resolve, reject) => {
    const audioChunks: Uint8Array[] = []
    let resolved = false

    const ws = new WebSocket(wsUrl)

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        ws.close()
        reject(new Error('TTS 超时'))
      }
    }, 30000)

    ws.onopen = () => {
      // 发送配置
      const configMsg = `Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{
        "context": {
          "synthesis": {
            "audio": {
              "metadataoptions": { "sentenceBoundaryEnabled": false, "wordBoundaryEnabled": false },
              "outputFormat": "audio-24khz-48kbitrate-mono-mp3"
            }
          }
        }
      }`
      ws.send(configMsg)

      // 发送 SSML
      const ssml = buildSSML(text, voice, rate, pitch)
      const ssmlMsg = `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n${ssml}`
      ws.send(ssmlMsg)
    }

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        // 二进制音频数据 — 需要跳过头部
        const view = new DataView(event.data)
        // 头部格式：2 bytes (header length) + header text + audio data
        const headerLen = view.getUint16(0)
        const audioData = new Uint8Array(event.data, 2 + headerLen)
        if (audioData.length > 0) {
          audioChunks.push(audioData)
        }
      } else if (typeof event.data === 'string') {
        // 文本消息
        if (event.data.includes('Path:turn.end')) {
          // 合成完成
          clearTimeout(timeout)
          resolved = true
          ws.close()

          // 合并所有音频块
          const totalLen = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0)
          const result = new Uint8Array(totalLen)
          let offset = 0
          for (const chunk of audioChunks) {
            result.set(chunk, offset)
            offset += chunk.length
          }
          resolve(result)
        }
      }
    }

    ws.onerror = (e) => {
      clearTimeout(timeout)
      if (!resolved) {
        resolved = true
        reject(new Error('WebSocket 连接失败: ' + String(e)))
      }
    }

    ws.onclose = () => {
      clearTimeout(timeout)
      if (!resolved) {
        resolved = true
        if (audioChunks.length > 0) {
          const totalLen = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0)
          const result = new Uint8Array(totalLen)
          let offset = 0
          for (const chunk of audioChunks) {
            result.set(chunk, offset)
            offset += chunk.length
          }
          resolve(result)
        } else {
          reject(new Error('未收到音频数据'))
        }
      }
    }
  })
}

Deno.serve(async (req) => {
  // CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  try {
    const { text, voice, rate, pitch } = await req.json()

    if (!text || typeof text !== 'string') {
      return new Response(JSON.stringify({ error: '缺少 text 参数' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 限制文本长度（安全限制）
    const trimmed = text.substring(0, 5000)

    const audio = await synthesize(trimmed, voice || 'xiaoxiao', rate, pitch)

    return new Response(audio, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audio.length),
      },
    })
  } catch (e) {
    console.error('[TTS]', e)
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
