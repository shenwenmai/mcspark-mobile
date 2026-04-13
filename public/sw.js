// Service Worker — 处理 Web Push 通知

self.addEventListener('push', (event) => {
  let data = { title: '⏰ 提醒', body: '你有一条提醒' }
  try {
    data = event.data.json()
  } catch (e) {
    console.warn('[SW] push data parse failed:', e)
  }

  const options = {
    body: data.body || '',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: data.tag || 'reminder-' + Date.now(),
    requireInteraction: true,
    vibrate: [200, 100, 200, 100, 200],
    data: { url: data.url || '/' },
  }

  event.waitUntil(
    self.registration.showNotification(data.title || '⏰ 提醒', options)
  )
})

// 点击通知 → 打开/聚焦页面
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus()
        }
      }
      return clients.openWindow(url)
    })
  )
})
