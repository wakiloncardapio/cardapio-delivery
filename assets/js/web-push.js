(function () {
  let registration = null;
  let active = false;
  let busy = false;
  const status = message => { const el = document.querySelector('#notification-permission-status'); if (el) el.textContent = message; };
  const supported = () => window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  async function worker() {
    if (!registration) {
      await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
      registration = await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('O serviço de avisos não iniciou. Atualize o painel.')), 12000))]);
    }
    return registration;
  }
  async function call(action, values = {}) {
    const store = SupabaseStore.getCurrentStore();
    if (!store?.id) throw new Error('Selecione uma empresa antes de ativar os avisos.');
    const { data, error } = await SupabaseStore.getClient().functions.invoke('web-push', { body: { action, storeId: store.id, slug: store.slug, ...values } });
    if (error) {
      const detail = await error.context?.json?.().catch(() => null);
      throw new Error(detail?.error || 'Web Push ainda não está disponível. Confira Ativar Web Push no GitHub Actions.');
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }
  function buttons() {
    const enable = document.querySelector('#enable-browser-notifications');
    const disable = document.querySelector('#disable-web-push');
    const test = document.querySelector('#test-web-push');
    if (enable) { enable.disabled = busy || active; enable.textContent = active ? 'Web Push ativo neste aparelho' : 'Ativar Web Push neste aparelho'; }
    if (disable) { disable.disabled = busy || !active; disable.hidden = !active; }
    if (test) { test.disabled = busy || !active; test.hidden = !active; }
  }
  async function refresh() {
    if (!supported()) { status('Neste aparelho, abra um navegador compatível. No iPhone/iPad, adicione o painel à Tela de Início e abra pelo ícone.'); return; }
    try {
      const reg = await worker();
      const sub = await reg.pushManager.getSubscription();
      const cfg = await call('config', { endpoint: sub?.endpoint || '' });
      active = Notification.permission === 'granted' && cfg.subscribed;
      status(active ? 'Web Push ativo para esta empresa neste aparelho. Não é necessário manter o painel aberto.' : Notification.permission === 'denied' ? 'Avisos bloqueados. Libere as notificações nas permissões do site.' : 'Ative este aparelho para receber avisos mesmo com o painel fechado.');
    } catch (error) { active = false; status(error.message); }
    buttons();
  }
  async function activate() {
    if (busy || !supported()) return refresh();
    busy = true; buttons();
    try {
      // Must run directly in the click gesture, including Safari on iOS.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Autorize as notificações nas permissões do navegador.');
      const cfg = await call('config');
      const reg = await worker();
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const base64 = cfg.publicKey.replace(/-/g, '+').replace(/_/g, '/');
        const key = Uint8Array.from(atob(base64 + '='.repeat((4-base64.length%4)%4)), c => c.charCodeAt(0));
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      }
      await call('subscribe', { subscription: sub.toJSON(), origin: location.origin });
      active = true;
      status('Web Push ativado e salvo para esta empresa neste aparelho. Use Testar aviso para conferir.');
    } catch (error) { status(error.message); }
    finally { busy = false; buttons(); }
  }
  async function disable() {
    if (busy || !confirm('Desativar os avisos desta empresa neste aparelho? Os outros aparelhos continuam ativos.')) return;
    busy = true; buttons();
    try {
      const sub = await (await worker()).pushManager.getSubscription();
      if (sub) await call('unsubscribe', { endpoint: sub.endpoint });
      // Keep the browser subscription: this device may also manage other stores.
      active = false; status('Web Push desativado para esta empresa neste aparelho.');
    } catch (error) { status(error.message); }
    finally { busy = false; buttons(); }
  }
  async function test() {
    if (busy) return;
    busy = true; buttons();
    try {
      const sub = await (await worker()).pushManager.getSubscription();
      if (!sub) throw new Error('Ative os avisos primeiro.');
      await call('test', { endpoint: sub.endpoint });
      status('Teste aceito pelo serviço de push. Confira as notificações deste aparelho.');
    } catch (error) { status(error.message); }
    finally { busy = false; buttons(); }
  }
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelector('#disable-web-push')?.addEventListener('click', disable);
    document.querySelector('#test-web-push')?.addEventListener('click', test);
  });
  window.SeuFoodPush = { refresh, activate, isActive: () => active };
})();
