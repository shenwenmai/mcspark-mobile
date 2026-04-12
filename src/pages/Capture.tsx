import { useState, useRef } from 'react'
import { captureItem, uploadFile } from '../lib/db'

export default function Capture({ onSaved }: { onSaved: () => void }) {
  const [text, setText] = useState(() => localStorage.getItem('capture_draft') || '')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [attachments, setAttachments] = useState<{ name: string; url: string; type: string }[]>([])
  const [uploading, setUploading] = useState(false)

  // 录音状态
  const [recording, setRecording] = useState(false)
  const [recordTime, setRecordTime] = useState(0)
  const mediaRecorder = useRef<MediaRecorder | null>(null)
  const audioChunks = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const imageRef = useRef<HTMLInputElement>(null)

  const isUrl = (s: string) => /^https?:\/\/.+/.test(s.trim())

  const showToast = (msg: string, duration = 2000) => {
    setToast(msg)
    setTimeout(() => setToast(''), duration)
  }

  // ── 录音 ──
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      audioChunks.current = []
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.current.push(e.data) }
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        if (audioChunks.current.length === 0) { showToast('录音为空，已取消'); return }
        const blob = new Blob(audioChunks.current, { type: 'audio/webm' })
        await doUpload(blob, `录音_${new Date().toLocaleTimeString()}.webm`, 'audio')
      }
      recorder.start()
      mediaRecorder.current = recorder
      setRecording(true)
      setRecordTime(0)
      timerRef.current = setInterval(() => setRecordTime(t => t + 1), 1000)
    } catch {
      showToast('无法访问麦克风，请允许权限', 3000)
    }
  }

  const stopRecording = () => {
    if (!mediaRecorder.current) return // 防止重复点击
    mediaRecorder.current.stop()
    mediaRecorder.current = null
    setRecording(false)
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }

  // ── 上传文件 ──
  const doUpload = async (file: Blob, name: string, type: string) => {
    setUploading(true)
    try {
      const url = await uploadFile(file, name)
      if (url) {
        setAttachments(prev => [...prev, { name, url, type }])
        showToast(`✓ ${name} 已上传`)
      }
    } catch (e) {
      showToast('上传失败: ' + (e as Error).message, 5000)
    }
    setUploading(false)
  }

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    for (const f of Array.from(files)) {
      const type = f.type.startsWith('image/') ? 'image' : 'file'
      await doUpload(f, f.name, type)
    }
    e.target.value = ''
  }

  const removeAttachment = (idx: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== idx))
  }

  // ── 保存 ──
  const save = async () => {
    const v = text.trim()
    if (!v && attachments.length === 0) return
    setSaving(true)
    try {
      const isLink = isUrl(v)
      // 把附件信息拼入 content
      let content = v
      if (attachments.length > 0) {
        const attachInfo = attachments.map(a => `[${a.type === 'image' ? '图片' : a.type === 'audio' ? '录音' : '文件'}] ${a.name}\n${a.url}`).join('\n\n')
        content = content ? content + '\n\n---\n' + attachInfo : attachInfo
      }
      const title = v ? (isLink ? v.substring(0, 80) : v.substring(0, 40))
        : attachments.length > 0 ? `${attachments[0].name}` : '快速记录'
      const category = isLink ? 'link' : attachments.some(a => a.type === 'image') ? 'image'
        : attachments.some(a => a.type === 'audio') ? 'audio' : 'note'

      await captureItem({ title, content, source: 'mobile', category })
      setText('')
      localStorage.removeItem('capture_draft')
      setAttachments([])
      showToast('✓ 已保存')
      onSaved()
      inputRef.current?.focus()
    } catch (e) {
      showToast('保存失败：' + (e as Error).message, 3000)
    }
    setSaving(false)
  }

  const fmtTime = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`

  return (
    <div className="flex flex-col h-full p-4 fade-in">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--color-k)] mb-2">📥 快速录入</h1>
        <p className="text-[13px] text-[var(--color-k2)] leading-relaxed">文字、录音、图片、文件 → 一键保存</p>
      </div>

      {/* Input */}
      <textarea
        ref={inputRef}
        value={text}
        onChange={e => {
          const v = e.target.value
          setText(v)
          localStorage.setItem('capture_draft', v)
          // 自动展开高度
          const el = e.target
          el.style.height = 'auto'
          el.style.height = Math.max(el.scrollHeight, 80) + 'px'
        }}
        placeholder="输入文字、粘贴链接、记录想法…"
        autoFocus
        rows={5}
        className="w-full text-[15px] leading-relaxed p-4 rounded-2xl border border-[var(--color-border)] bg-white resize-none outline-none focus:border-[var(--color-pri)] placeholder:text-[var(--color-k3)] transition-colors"
        style={{ minHeight: '130px', maxHeight: '60vh' }}
      />

      {/* Attachments Preview */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {attachments.map((a, i) => (
            <div key={i} className="flex items-center gap-2 bg-white rounded-xl px-3 py-2 border border-[var(--color-border)] text-xs">
              <span>{a.type === 'image' ? '🖼️' : a.type === 'audio' ? '🎙️' : '📎'}</span>
              <span className="text-[var(--color-k)] max-w-[120px] truncate">{a.name}</span>
              <button onClick={() => removeAttachment(i)} className="text-[var(--color-k3)] ml-1">✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Recording indicator */}
      {recording && (
        <div className="mt-3 flex items-center justify-center gap-3 py-3 bg-red-50 rounded-xl border border-red-200">
          <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
          <span className="text-sm font-semibold text-red-600">录音中 {fmtTime(recordTime)}</span>
          <button onClick={stopRecording}
            className="px-4 py-1.5 bg-red-500 text-white text-xs font-semibold rounded-lg">
            停止
          </button>
        </div>
      )}

      {/* Upload buttons + Save */}
      <div className="flex items-center gap-2 mt-4">
        {/* 录音 */}
        <button onClick={recording ? stopRecording : startRecording}
          disabled={uploading}
          className={`w-11 h-11 rounded-xl flex items-center justify-center text-lg border transition-colors ${recording ? 'bg-red-500 text-white border-red-500' : 'bg-white text-[var(--color-k3)] border-[var(--color-border)] active:bg-[var(--color-bg)]'}`}>
          🎙️
        </button>

        {/* 拍照/图片 */}
        <button onClick={() => imageRef.current?.click()}
          disabled={uploading}
          className="w-11 h-11 rounded-xl flex items-center justify-center text-lg bg-white text-[var(--color-k3)] border border-[var(--color-border)] active:bg-[var(--color-bg)]">
          📷
        </button>

        {/* 文件 */}
        <button onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="w-11 h-11 rounded-xl flex items-center justify-center text-lg bg-white text-[var(--color-k3)] border border-[var(--color-border)] active:bg-[var(--color-bg)]">
          📎
        </button>

        {uploading && <span className="text-xs text-[var(--color-k3)]">上传中…</span>}

        <div className="flex-1" />

        {/* 字数 */}
        {text.length > 0 && (
          <span className="text-xs text-[var(--color-k3)]">{text.length}字{isUrl(text) ? ' · 🔗' : ''}</span>
        )}

        {/* 保存 */}
        <button onClick={save}
          disabled={saving || uploading || (!text.trim() && attachments.length === 0)}
          className="px-6 py-3 rounded-xl bg-[var(--color-pri)] text-white font-semibold text-sm disabled:opacity-40 active:scale-95 transition-transform">
          {saving ? '保存中…' : '保存'}
        </button>
      </div>

      {/* Hidden file inputs */}
      <input ref={imageRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={onFileChange} />
      <input ref={fileRef} type="file" accept="*/*" multiple className="hidden" onChange={onFileChange} />

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 px-4 py-2 bg-[var(--color-k)] text-white text-sm rounded-full shadow-lg toast-enter">
          {toast}
        </div>
      )}
    </div>
  )
}
