import { getSupabase } from './supabase'

// ── Vault Items ──
export interface VaultItem {
  id: string
  title: string
  summary: string
  content: string
  category: string
  layer: string
  tags: string[]
  source: string
  status: string
  createdAt: number
  updatedAt: number
  [key: string]: unknown
}

export async function fetchItems(): Promise<VaultItem[]> {
  const sb = getSupabase()
  if (!sb) return []
  try {
    const { data, error } = await sb
      .from('vault_items')
      .select('id, data, deleted')
      .order('updated_at', { ascending: false })
      .limit(200)
    if (error) { console.warn('[DB] fetchItems error:', error.message); return [] }
    return (data || []).filter((r: { deleted?: boolean }) => !r.deleted).map((r: { data: VaultItem }) => r.data)
  } catch (e) {
    console.warn('[DB] fetchItems exception:', (e as Error).message)
    return []
  }
}

export async function pushItem(item: VaultItem) {
  const sb = getSupabase()
  if (!sb) throw new Error('Supabase 未连接')
  const { error } = await sb.from('vault_items').upsert({
    id: item.id,
    data: item,
    updated_at: new Date(item.updatedAt || Date.now()).toISOString(),
    deleted: false,
  })
  if (error) throw new Error('保存失败: ' + error.message)
}

// ── Projects ──
export interface ProjectTask {
  id: string
  title: string
  status: 'todo' | 'doing' | 'done'
  note: string
  createdAt: number
  startedAt?: number
  completedAt?: number
  updatedAt?: number
}

export interface ProjectPhase {
  id: string
  name: string
  tasks: ProjectTask[]
  collapsed?: boolean
  createdAt?: number
}

export interface Project {
  id: string
  name: string
  description: string
  phases: ProjectPhase[]
  createdAt: number
  updatedAt: number
}

export async function fetchProjects(): Promise<Project[]> {
  const sb = getSupabase()
  if (!sb) return []
  try {
    const { data, error } = await sb
      .from('vault_projects')
      .select('id, data, deleted')
      .order('updated_at', { ascending: false })
    if (error) { console.warn('[DB] fetchProjects error:', error.message); return [] }
    return (data || []).filter((r: { deleted?: boolean }) => !r.deleted).map((r: { data: Project }) => r.data)
  } catch (e) {
    console.warn('[DB] fetchProjects exception:', (e as Error).message)
    return []
  }
}

export async function pushProject(project: Project) {
  const sb = getSupabase()
  if (!sb) throw new Error('Supabase 未连接')
  const { error } = await sb.from('vault_projects').upsert({
    id: project.id,
    data: project,
    updated_at: new Date(project.updatedAt || Date.now()).toISOString(),
    deleted: false,
  })
  if (error) throw new Error('保存失败: ' + error.message)
}

// ── File Upload (Supabase Storage) ──
export async function uploadFile(file: Blob, fileName: string): Promise<string | null> {
  const sb = getSupabase()
  if (!sb) return null

  const safeName = fileName.replace(/[^a-zA-Z0-9._\-]/g, '_')
  const path = `mobile/${Date.now()}_${safeName}`

  const { error } = await sb.storage.from('vault-files').upload(path, file, { upsert: true })
  if (error) {
    throw new Error('[Storage] ' + error.message)
  }
  const { data: urlData } = sb.storage.from('vault-files').getPublicUrl(path)
  return urlData.publicUrl
}

// ── Quick Capture ──
export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8)
}

export async function captureItem(input: { title: string; content: string; source?: string; category?: string }) {
  const item: VaultItem = {
    id: uid(),
    title: input.title || '快速记录',
    summary: '',
    content: input.content,
    category: input.category || 'note',
    layer: 'raw',
    tags: [],
    source: input.source || 'mobile',
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  await pushItem(item)
  return item
}
