/**
 * Web Push 推送订阅管理
 */
import { getSupabase } from './supabase'

const VAPID_PUBLIC_KEY = 'BMbCTxW3XU--j1x98lv3odVmfKttIGxs8jwJzteP6PKCGg15jlacpb9HgnAHLL069BZ9SS7GD-ULkGv29qu0fmQ'

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray.buffer as ArrayBuffer
}

/** 注册 Service Worker + 订阅 Web Push，把 subscription 存到 Supabase */
export async function setupPushSubscription(): Promise<'subscribed' | 'denied' | 'unsupported' | 'error'> {
  // 检查浏览器支持
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('[Push] 浏览器不支持 Web Push')
    return 'unsupported'
  }

  // 请求通知权限
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    console.warn('[Push] 通知权限被拒绝:', permission)
    return 'denied'
  }

  try {
    // 注册 Service Worker
    const registration = await navigator.serviceWorker.register('/sw.js')
    await navigator.serviceWorker.ready

    // 检查是否已有订阅
    let subscription = await registration.pushManager.getSubscription()

    if (!subscription) {
      // 新建订阅
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      })
    }

    // 把 subscription 存到 Supabase
    const sb = getSupabase()
    if (!sb) {
      console.warn('[Push] Supabase 未配置')
      return 'error'
    }

    const subJson = subscription.toJSON()

    // upsert by endpoint
    const { error } = await sb.from('push_subscriptions').upsert({
      endpoint: subJson.endpoint,
      p256dh: subJson.keys?.p256dh || '',
      auth: subJson.keys?.auth || '',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' })

    if (error) {
      console.warn('[Push] 保存订阅失败:', error.message)
      return 'error'
    }

    console.log('[Push] 订阅成功')
    return 'subscribed'
  } catch (e) {
    console.warn('[Push] 订阅异常:', e)
    return 'error'
  }
}

/** 获取当前推送订阅状态 */
export async function getPushStatus(): Promise<'subscribed' | 'not-subscribed' | 'unsupported'> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported'
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    if (!reg) return 'not-subscribed'
    const sub = await reg.pushManager.getSubscription()
    return sub ? 'subscribed' : 'not-subscribed'
  } catch {
    return 'not-subscribed'
  }
}
