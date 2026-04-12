import { createClient, SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient | null {
  if (client) return client
  const url = localStorage.getItem('sb_url')
  const key = localStorage.getItem('sb_key')
  if (!url || !key) return null
  client = createClient(url, key)
  return client
}

export function setSupabaseConfig(url: string, key: string) {
  localStorage.setItem('sb_url', url.trim())
  localStorage.setItem('sb_key', key.trim())
  client = null // 重置，下次 getSupabase 时用新配置创建
  client = createClient(url.trim(), key.trim())
}

export function isConfigured(): boolean {
  return !!(localStorage.getItem('sb_url') && localStorage.getItem('sb_key'))
}
