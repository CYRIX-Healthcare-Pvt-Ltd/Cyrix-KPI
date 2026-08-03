/**
 * Imported into the Workbox-generated service worker (see vite.config.ts).
 *
 * Android will not let a page call `new Notification()` — it insists the
 * service worker shows it — and a notification shown by the worker is
 * clicked in the worker too. Without this handler, tapping the popup on
 * a phone dismisses it and does nothing else.
 *
 * No push handler here: notifications are raised by the open app, not
 * sent from a server. If web push is added later, this is where the
 * 'push' listener joins it.
 */
self.addEventListener('notificationclick', event => {
  event.notification.close()

  const url = (event.notification.data && event.notification.data.url) || '/'

  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })

      // Reuse a window that is already on this origin rather than opening
      // a second copy of the app beside the first.
      for (const client of open) {
        if ('focus' in client) {
          await client.focus()
          if ('navigate' in client) {
            try {
              await client.navigate(url)
            } catch {
              // Cross-origin or a client that refuses; focusing is enough.
            }
          }
          return
        }
      }

      if (self.clients.openWindow) await self.clients.openWindow(url)
    })(),
  )
})
