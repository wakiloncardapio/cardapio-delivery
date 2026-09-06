import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const url = Deno.env.get('SUPABASE_URL')!;
const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const platform = Deno.env.get('PLATFORM_URL') || 'https://seu-food-cardapios.wakilonferreira.workers.dev';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
function checked<T extends { error?: any; data?: any }>(result: T): any {
  if (result.error) throw new Error('Não foi possível acessar a configuração do Web Push.');
  return result.data;
}
export function validEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return endpoint.length <= 2048 && u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && (
      u.hostname === 'fcm.googleapis.com' || u.hostname === 'web.push.apple.com' ||
      u.hostname.endsWith('.push.services.mozilla.com') || u.hostname.endsWith('.notify.windows.com')
    );
  } catch { return false; }
}
async function config() {
  let cfg = checked(await db.from('web_push_config').select('*').eq('id', true).single());
  if (!cfg.public_key) {
    const pair = webpush.generateVAPIDKeys();
    checked(await db.from('web_push_config').update({ public_key: pair.publicKey, private_key: pair.privateKey }).eq('id', true).is('public_key', null));
    cfg = checked(await db.from('web_push_config').select('*').eq('id', true).single());
  }
  return cfg;
}
async function originAllowed(origin: string, storeId: string) {
  try {
    const u = new URL(origin);
    if (u.origin !== origin || u.protocol !== 'https:') return false;
    if (origin === new URL(platform).origin) return true;
    const rows = checked(await db.from('store_domains').select('id').eq('store_id', storeId).eq('hostname', u.hostname).eq('status', 'active').limit(1));
    return rows.length > 0;
  } catch { return false; }
}
async function stillAuthorized(userId: string, storeId: string) {
  const admin = checked(await db.from('platform_admins').select('user_id').eq('user_id', userId).limit(1));
  if (admin.length) return true;
  const member = checked(await db.from('store_members').select('role').eq('store_id', storeId).eq('user_id', userId).eq('active', true).in('role', ['owner','manager']).limit(1));
  return member.length > 0;
}
async function send(subscription: any, cfg: any, payload: unknown) {
  if (!validEndpoint(subscription.endpoint)) return 410;
  // Generate/encrypt with web-push; fetch avoids Node HTTPS compatibility issues in Edge.
  const request = webpush.generateRequestDetails({ endpoint: subscription.endpoint, keys: subscription.keys }, JSON.stringify(payload), {
    TTL: 1800, urgency: 'high', contentEncoding: 'aes128gcm',
    vapidDetails: { subject: platform, publicKey: cfg.public_key, privateKey: cfg.private_key }
  });
  const response = await fetch(request.endpoint, { method: request.method, headers: request.headers, body: request.body, redirect: 'error', signal: AbortSignal.timeout(8000) });
  await response.body?.cancel();
  return response.status;
}
async function dispatch(jobId: string, cfg: any) {
  const job = checked(await db.from('web_push_queue').update({ claimed_until: new Date(Date.now()+90000).toISOString() }).eq('id', jobId).is('completed_at', null).lt('claimed_until', new Date().toISOString()).select('*').maybeSingle());
  if (!job || job.completed_at) return { ok: true };
  const store = checked(await db.from('stores').select('id,name,slug,status,access_expires_at').eq('id', job.store_id).maybeSingle());
  const order = checked(await db.from('orders').select('id,status,payment_status,payment_method').eq('id', job.order_id).eq('store_id', job.store_id).maybeSingle());
  if (!store || store.status !== 'active' || (store.access_expires_at && Date.parse(store.access_expires_at) <= Date.now()) || !order || order.status === 'cancelado' || ['estornado','recusado'].includes(order.payment_status) || !(order.payment_status === 'pago' || ['cash','card_delivery'].includes(order.payment_method))) {
    checked(await db.from('web_push_queue').update({ completed_at: new Date().toISOString() }).eq('id', job.id));
    return { ok: true };
  }
  const subscriptions = checked(await db.from('web_push_subscriptions').select('*').eq('store_id', store.id).lte('created_at', job.created_at));
  const delivered = new Set<string>(job.delivered || []);
  let retry = false;
  const deadline = Date.now() + 40000;
  for (const sub of subscriptions) {
    if (delivered.has(sub.id)) continue;
    if (Date.now() > deadline) { retry = true; break; }
    if (!(await stillAuthorized(sub.user_id, store.id)) || !(await originAllowed(sub.origin, store.id))) {
      checked(await db.from('web_push_subscriptions').delete().eq('id', sub.id));
      continue;
    }
    try {
      const status = await send(sub, cfg, { title: `${store.name}: novo pedido`, body: 'Abra o painel para conferir e preparar o pedido.', tag: `order-${order.id}`, url: `/sistema/admin/?loja=${encodeURIComponent(store.slug)}&tab=orders` });
      if (status === 404 || status === 410) checked(await db.from('web_push_subscriptions').delete().eq('id', sub.id));
      else if (status >= 200 && status < 300) {
        delivered.add(sub.id);
        checked(await db.from('web_push_queue').update({ delivered: [...delivered] }).eq('id', job.id));
      } else retry = true;
    } catch { retry = true; }
  }
  if (!retry) checked(await db.from('web_push_queue').update({ completed_at: new Date().toISOString() }).eq('id', job.id));
  checked(await db.from('web_push_queue').update({ claimed_until: new Date(0).toISOString() }).eq('id', job.id));
  return { ok: !retry, accepted: delivered.size };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método inválido.' }, 405);
  try {
    const text = await req.text();
    if (text.length > 8000) return json({ error: 'Dados excedem o limite.' }, 413);
    const body = JSON.parse(text);
    const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (body.action === 'dispatch') {
      const cfg = checked(await db.from('web_push_config').select('*').eq('id', true).single());
      if (!bearer || bearer !== cfg.dispatch_secret) return json({ error: 'Acesso negado.' }, 401);
      return json(await dispatch(String(body.jobId || ''), cfg));
    }
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${bearer}` } }, auth: { persistSession: false } });
    const { data: auth, error: authError } = await userClient.auth.getUser(bearer);
    if (authError || !auth.user) return json({ error: 'Entre novamente no painel.' }, 401);
    const storeId = String(body.storeId || '');
    const endpoint = String(body.subscription?.endpoint || body.endpoint || '');
    // Unsubscribe is allowed even after access revocation, but only for this account.
    if (body.action === 'unsubscribe') {
      checked(await db.from('web_push_subscriptions').delete().eq('user_id', auth.user.id).eq('store_id', storeId).eq('endpoint', endpoint));
      return json({ ok: true });
    }
    const allowed = checked(await userClient.rpc('can_manage_store', { target_store_id: storeId }));
    if (!allowed) return json({ error: 'Somente proprietário ou gestor desta empresa pode ativar o Web Push.' }, 403);
    const cfg = await config();
    if (body.action === 'config') {
      const rows = checked(await db.from('web_push_subscriptions').select('id').eq('user_id', auth.user.id).eq('store_id', storeId).eq('endpoint', endpoint));
      return json({ publicKey: cfg.public_key, subscribed: rows.length > 0 });
    }
    if (body.action === 'subscribe') {
      const keys = body.subscription?.keys;
      const origin = String(body.origin || '');
      if (!validEndpoint(endpoint) || !/^[A-Za-z0-9_-]{86,88}$/.test(keys?.p256dh || '') || !/^[A-Za-z0-9_-]{22,24}$/.test(keys?.auth || '') || !(await originAllowed(origin, storeId))) return json({ error: 'Inscrição ou domínio inválido.' }, 400);
      checked(await db.from('web_push_subscriptions').upsert({ store_id: storeId, user_id: auth.user.id, endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth }, origin }, { onConflict: 'store_id,user_id,endpoint' }));
      return json({ ok: true });
    }
    if (body.action === 'test') {
      // A single device test, at most once per minute, never broadcasts to other owners.
      const sub = checked(await db.from('web_push_subscriptions').update({ last_test_at: new Date().toISOString() }).eq('store_id', storeId).eq('user_id', auth.user.id).eq('endpoint', endpoint).lt('last_test_at', new Date(Date.now()-60000).toISOString()).select('*').maybeSingle());
      if (!sub) return json({ error: 'Ative este aparelho ou aguarde um minuto antes de testar novamente.' }, 429);
      const status = await send(sub, cfg, { title: 'Seu Food: teste de aviso', body: 'Este aparelho está pronto para receber novos pedidos.', tag: 'seufood-push-test', url: `/sistema/admin/?loja=${encodeURIComponent(String(body.slug || ''))}` });
      if (status === 404 || status === 410) checked(await db.from('web_push_subscriptions').delete().eq('id', sub.id));
      if (status < 200 || status >= 300) return json({ error: 'O serviço de push não aceitou o teste. Reative os avisos neste aparelho.' }, 502);
      return json({ ok: true });
    }
    return json({ error: 'Ação inválida.' }, 400);
  } catch { return json({ error: 'Web Push indisponível. Confira a execução de Ativar Web Push no GitHub.' }, 503); }
});
