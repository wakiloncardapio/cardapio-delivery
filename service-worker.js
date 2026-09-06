self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || '/sistema/admin/';
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    const existing = windows.find(client => client.url.includes('/sistema/admin/'));
    if (existing) return existing.focus();
    return clients.openWindow(target);
  }));
});
