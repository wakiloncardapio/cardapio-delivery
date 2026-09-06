self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch (_) {}
  event.waitUntil(self.registration.showNotification(data.title || 'Seu Food: novo pedido', {
    body: data.body || 'Abra o painel para conferir os pedidos.',
    icon: '/assets/images/push/icon-192.png', badge: '/assets/images/push/icon-192.png',
    tag: data.tag || 'seufood-order', renotify: true,
    data: { url: data.url || '/sistema/admin/' }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  let target = new URL('/sistema/admin/', self.location.origin);
  try {
    const requested = new URL(event.notification.data?.url || target.href, self.location.origin);
    if (requested.origin === self.location.origin && requested.pathname === '/sistema/admin/') target = requested;
  } catch (_) {}
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async windows => {
    // Match the company, not simply any admin tab.
    const existing = windows.find(client => {
      const u = new URL(client.url);
      return u.pathname === target.pathname && u.searchParams.get('loja') === target.searchParams.get('loja');
    });
    if (existing) { await existing.navigate(target.href); return existing.focus(); }
    return self.clients.openWindow(target.href);
  }));
});
