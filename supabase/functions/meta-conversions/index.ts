import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'Content-Type': 'application/json' }
});

const compact = (value: unknown) => String(value || '').trim().toLowerCase();
const normalizeText = (value: unknown) => compact(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]/g, '');

function normalizePhone(value: unknown) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function hashed(value: unknown, normalizer = normalizeText) {
  const normalized = normalizer(value);
  return normalized ? [await sha256(normalized)] : undefined;
}

function safeSourceUrl(value: unknown, configuredSiteUrl: string) {
  try {
    const configured = new URL(configuredSiteUrl);
    const url = new URL(String(value || ''), configured);
    const allowed = url.protocol === 'https:' && url.origin === configured.origin;
    return allowed ? url.href.slice(0, 1000) : configured.href.slice(0, 1000);
  } catch (_) {
    return '';
  }
}

function safeMetaCookie(value: unknown, _prefix: '_fbp' | '_fbc') {
  const cookie = String(value || '').trim();
  return cookie.startsWith('fb.') && cookie.length <= 255 ? cookie : '';
}

function requestIp(req: Request) {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || '';
}

function itemVariant(item: any) {
  return (Array.isArray(item.selections) ? item.selections : [])
    .flatMap((group: any) => (Array.isArray(group.options) ? group.options : [])
      .map((option: any) => `${String(group.groupName || 'Opção')}: ${String(option.name || option.title || '')}`))
    .filter(Boolean)
    .join(' | ')
    .slice(0, 100);
}

function productContents(items: any[]) {
  return items.map((item, index) => ({
    id: String(item.productId || item.id || index + 1),
    title: String(item.name || 'Produto').slice(0, 100),
    category: String(item.categoryName || item.categoryId || '').slice(0, 100),
    variant: itemVariant(item),
    quantity: Math.max(1, Number(item.quantity) || 1),
    item_price: Math.round((Number(item.unitTotal ?? item.basePrice) || 0) * 100) / 100
  }));
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const accessToken = Deno.env.get('META_CAPI_ACCESS_TOKEN');
  const pixelId = Deno.env.get('META_CAPI_PIXEL_ID') || '';
  const siteUrl = Deno.env.get('SITE_URL') || '';
  const apiVersion = Deno.env.get('META_API_VERSION') || 'v23.0';
  const testEventCode = Deno.env.get('META_CAPI_TEST_EVENT_CODE') || '';

  if (!supabaseUrl || !serviceKey || !accessToken || !pixelId || !safeSourceUrl(siteUrl, siteUrl)) {
    return json({ sent: false, configured: false, error: 'Conversions API ainda não configurada.' }, 503);
  }

  const body = await req.json().catch(() => ({}));
  const orderId = String(body.orderId || '');
  const eventId = String(body.eventId || '');
  const forceRetry = body.forceRetry === true;
  if (!orderId || !eventId) return json({ error: 'orderId e eventId são obrigatórios.' }, 400);

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  if (forceRetry) {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const internalService = token === serviceKey;
    if (!internalService) {
      const { data: authData, error: authError } = await db.auth.getUser(token);
      if (authError || !authData.user) return json({ error: 'Apenas o administrador pode reenviar conversões.' }, 401);
    }
  }
  const { data: order, error: orderError } = await db.from('orders').select('*').eq('id', orderId).single();
  if (orderError || !order) return json({ error: 'Pedido não encontrado.' }, 404);
  if (eventId !== order.order_number) return json({ error: 'Identificação do evento inválida.' }, 400);
  if (!['confirmado', 'preparando', 'saiu_entrega', 'concluido'].includes(order.status)) {
    return json({ sent: false, configured: true, skipped: true, reason: 'order_not_confirmed' }, 409);
  }

  const customer = order.customer || {};
  const checkoutMarketingConsent = customer.marketingConsent === true;
  const cookieMarketingConsent = customer.trackingConsent?.marketing === true;
  if (!checkoutMarketingConsent || !cookieMarketingConsent) {
    return json({ sent: false, configured: true, skipped: true, reason: 'marketing_consent_required' });
  }

  const paidAt = new Date(order.updated_at || order.created_at).getTime();
  const eventTime = Number.isFinite(paidAt) ? paidAt : Date.now();

  const eventType = 'meta.purchase';
  let auditId = '';
  const { data: previous } = await db
    .from('order_webhook_events')
    .select('id,status')
    .eq('order_id', order.id)
    .eq('event_type', eventType)
    .eq('source_updated_at', order.created_at)
    .maybeSingle();

  if (previous?.status === 'enviado' && !forceRetry) {
    return json({ sent: true, configured: true, duplicate: true, eventId });
  }

  if (previous?.id) {
    auditId = previous.id;
    await db.from('order_webhook_events').update({
      status: 'processando', error_message: '', updated_at: new Date().toISOString()
    }).eq('id', auditId);
  } else {
    auditId = crypto.randomUUID();
    const { error: auditError } = await db.from('order_webhook_events').insert({
      id: auditId,
      order_id: order.id,
      event_type: eventType,
      source_updated_at: order.created_at,
      status: 'processando'
    });
    if (auditError?.code === '23505') {
      return json({ sent: false, configured: true, duplicate: true, processing: true, eventId }, 202);
    }
    if (auditError) auditId = '';
  }

  const address = order.address || {};
  const nameParts = compact(customer.name).split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
  const email = compact(customer.email);
  const phone = normalizePhone(customer.phone);
  const fbp = safeMetaCookie(body.fbp || customer.fbp, '_fbp');
  const fbc = safeMetaCookie(body.fbc || customer.fbc, '_fbc');
  const serverConfirmed = ['mercadopago_webhook', 'crm_confirmation'].includes(body.confirmedBy);
  const clientIp = serverConfirmed ? '' : requestIp(req);
  const clientUserAgent = serverConfirmed ? '' : (req.headers.get('user-agent') || '');

  const userData: Record<string, unknown> = {};
  const hashedFields = {
    em: await hashed(email, compact),
    ph: await hashed(phone, normalizePhone),
    fn: await hashed(firstName),
    ln: await hashed(lastName),
    ct: await hashed(address.city),
    st: await hashed(address.state),
    zp: await hashed(address.zip, value => String(value || '').replace(/\D/g, '')),
    country: await hashed('br')
  };
  Object.entries(hashedFields).forEach(([key, value]) => { if (value) userData[key] = value; });
  if (clientIp) userData.client_ip_address = clientIp;
  if (clientUserAgent) userData.client_user_agent = clientUserAgent.slice(0, 500);
  if (fbp) userData.fbp = fbp;
  if (fbc) userData.fbc = fbc;

  const items = Array.isArray(order.items) ? order.items : [];
  const contents = productContents(items);
  const metaPayload: Record<string, unknown> = {
    data: [{
      event_name: 'Purchase',
      event_time: Math.floor(eventTime / 1000),
      event_id: eventId,
      event_source_url: safeSourceUrl(body.sourceUrl, siteUrl),
      action_source: 'website',
      user_data: userData,
      custom_data: {
        currency: 'BRL',
        value: Math.round((Number(order.total) || 0) * 100) / 100,
        order_id: order.order_number,
        content_type: 'product',
        content_ids: contents.map(item => item.id),
        content_name: contents.map(item => item.title).join(' | ').slice(0, 200),
        content_category: [...new Set(contents.map(item => item.category).filter(Boolean))].join(' | ').slice(0, 200),
        contents
      }
    }]
  };
  if (testEventCode) metaPayload.test_event_code = testEventCode;

  try {
    const response = await fetch(`https://graph.facebook.com/${apiVersion}/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metaPayload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result?.error?.message || `Meta respondeu HTTP ${response.status}.`);
    if (auditId) await db.from('order_webhook_events').update({
      status: 'enviado', response_status: response.status, error_message: '', updated_at: new Date().toISOString()
    }).eq('id', auditId);
    return json({ sent: true, configured: true, eventId, eventsReceived: result?.events_received || 0, test: Boolean(testEventCode) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao enviar a compra para a Meta.';
    if (auditId) await db.from('order_webhook_events').update({
      status: 'erro', error_message: message, updated_at: new Date().toISOString()
    }).eq('id', auditId);
    return json({ sent: false, configured: true, error: message, eventId }, 502);
  }
});
