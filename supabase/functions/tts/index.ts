/**
 * TTS 代理 — 调用 Google Translate TTS（免费）
 * 分段合成并拼接，返回 MP3 音频
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const TTS_BASE = 'https://translate.google.com/translate_tts'

async function synthesizeChunk(text: string): Promise<Uint8Array> {
  const params = new URLSearchParams({
    ie: 'UTF-8',
    tl: 'zh-CN',
    client: 'tw-ob',
    q: text,
  })

  const res = await fetch(`${TTS_BASE}?${params}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://translate.google.com/',
    },
  })

  if (!res.ok) {
    throw new Error(`TTS 请求失败: ${res.status}`)
  }

  return new Uint8Array(await res.arrayBuffer())
}

// Google TTS 每次最多约 200 字，需要分段
function splitText(text: string, maxLen = 180): string[] {
  const segments: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      segments.push(remaining)
      break
    }

    let cut = -1
    for (const sep of ['。', '！', '？', '；', '，', '、', '…', ' ']) {
      const idx = remaining.lastIndexOf(sep, maxLen)
      if (idx > 20) { cut = idx + 1; break }
    }
    if (cut <= 0) cut = maxLen

    segments.push(remaining.substring(0, cut))
    remaining = remaining.substring(cut)
  }

  return segments.filter(s => s.trim().length > 0)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  try {
    const { text } = await req.json()

    if (!text || typeof text !== 'string') {
      return new Response(JSON.stringify({ error: '缺少 text 参数' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const trimmed = text.substring(0, 3000)
    const segments = splitText(trimmed)
    const audioChunks: Uint8Array[] = []

    for (const seg of segments) {
      const chunk = await synthesizeChunk(seg)
      audioChunks.push(chunk)
    }

    // 合并音频
    const totalLen = audioChunks.reduce((sum, c) => sum + c.length, 0)
    const result = new Uint8Array(totalLen)
    let offset = 0
    for (const chunk of audioChunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }

    return new Response(result, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(result.length),
        'Cache-Control': 'public, max-age=3600',
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
