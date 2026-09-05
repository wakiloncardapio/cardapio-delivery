import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json' }
});

function itemVariant(item: any) {
  return (Array.isArray(item.selections) ? item.selections : [])
    .flatMap((group: any) => (Array.isArray(group.options) ? group.options : [])
      .map((option: any) => `${String(group.groupName || 'Opção')}: ${String(option.name || option.title || '')}`))
    .filter(Boolean)
    .join(' | ')
    .slice(0, 100);
}

function validGaClientId(value: unknown) {
  const clientId = String(value || '').trim();
  return /^\d+\.\d+$/.test(clientId) ? clientId : '';
}

function validGaSessionId(value: unknown) {
  const sessionId = String(value || '').replace(/\D/g, '');
  return /^\d{8,}$/.test(sessionId) ? sessionId : '';
}

async function sendGa4(db: any, order: any, forceRetry = false) {
  if (order.customer?.trackingConsent?.analytics !== true) {
    return { sent: false, skipped: true, reason: 'analytics_consent_required' };
  }
  let measurementId = Deno.env.get('GA4_MEASUREMENT_ID') || '';
  const apiSecret = Deno.env.get('GA4_API_SECRET') || '';
  if (!measurementId) {
    const { data: settings } = await db.from('catalogs').select('data')
      .eq('store_id', order.store_id).eq('id', 'settings').maybeSingle();
    measurementId = String(settings?.data?.ga4Id || '');
  }
  if (!/^G-[A-Z0-9]+$/i.test(measurementId) || !apiSecret) return { sent: false, configured: false };

  const eventType = 'ga4.purchase';
  const { data: previous } = await db.from('order_webhook_events')
    .select('id,status').eq('order_id', order.id).eq('event_type', eventType)
    .eq('source_updated_at', order.created_at).maybeSingle();
  if (previous?.status === 'enviado' && !forceRetry) return { sent: true, duplicate: true };

  let auditId = previous?.id || crypto.randomUUID();
  if (previous?.id) {
    await db.from('order_webhook_events').update({ status: 'processando', error_message: '', updated_at: new Date().toISOString() }).eq('id', auditId);
  } else {
    const { error } = await db.from('order_webhook_events').insert({
      id: auditId, store_id: order.store_id, order_id: order.id, event_type: eventType,
      source_updated_at: order.created_at, status: 'processando'
    });
    if (error?.code === '23505') return { sent: false, duplicate: true, processing: true };
    if (error) auditId = '';
  }

  const items = (Array.isArray(order.items) ? order.items : []).map((item: any, index: number) => ({
    item_id: String(item.productId || item.id || index + 1),
    item_name: String(item.name || 'Produto'),
    item_category: String(item.categoryName || item.categoryId || ''),
    item_variant: itemVariant(item),
    price: Math.round((Number(item.unitTotal ?? item.basePrice) || 0) * 100) / 100,
    quantity: Math.max(1, Number(item.quantity) || 1)
  }));
  const customer = order.customer || {};
  const attribution = customer.attribution?.last_touch || {};
  const gaClientId = validGaClientId(customer.gaClientId);
  const gaSessionId = validGaSessionId(customer.gaSessionId);
  const payload = {
    client_id: gaClientId || String(order.id),
    timestamp_micros: String(Date.now() * 1000),
    events: [{
      name: 'purchase',
      params: {
        transaction_id: order.order_number, event_id: order.order_number,
        currency: 'BRL', value: Math.round((Number(order.total) || 0) * 100) / 100,
        shipping: Math.round((Number(order.delivery_fee) || 0) * 100) / 100,
        items, order_source: String(attribution.source || ''),
        order_medium: String(attribution.medium || ''), order_campaign: String(attribution.campaign || ''),
        ...(gaSessionId ? { session_id: Number(gaSessionId), session_engaged: 1 } : {}),
        engagement_time_msec: 1
      }
    }]
  };
  try {
    const response = await fetch(`https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`GA4 respondeu HTTP ${response.status}.`);
    if (auditId) await db.from('order_webhook_events').update({ status: 'enviado', response_status: response.status, error_message: '', updated_at: new Date().toISOString() }).eq('id', auditId);
    return { sent: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao enviar a compra ao GA4.';
    if (auditId) await db.from('order_webhook_events').update({ status: 'erro', error_message: message, updated_at: new Date().toISOString() }).eq('id', auditId);
    return { sent: false, error: message };
  }
}

async function canManageStore(db: any, req: Request, storeId: string) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: authData, error: authError } = await db.auth.getUser(token);
  if (authError || !authData.user) return false;
  const [{ data: platformAdmin }, { data: member }] = await Promise.all([
    db.from('platform_admins').select('user_id').eq('user_id', authData.user.id).maybeSingle(),
    db.from('store_members').select('role').eq('store_id', storeId).eq('user_id', authData.user.id)
      .eq('active', true).in('role', ['owner', 'manager']).maybeSingle()
  ]);
  return Boolean(platformAdmin || member);
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const { orderId, eventId, storeId, sourceUrl, forceRetry = false } = await req.json().catch(() => ({}));
  if (!supabaseUrl || !serviceKey) return json({ error: 'Supabase incompleto.' }, 503);
  if (!orderId || !eventId || !storeId) return json({ error: 'Pedido inválido.' }, 400);

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  if (forceRetry && !(await canManageStore(db, req, String(storeId)))) {
    return json({ error: 'Apenas o gestor desta empresa pode reenviar conversões.' }, 401);
  }
  const { data: order, error } = await db.from('orders').select('*')
    .eq('id', String(orderId)).eq('store_id', String(storeId)).eq('order_number', String(eventId)).maybeSingle();
  if (error || !order) return json({ error: 'Pedido não encontrado.' }, 404);
  if (!['confirmado', 'preparando', 'saiu_entrega', 'concluido'].includes(order.status)) {
    return json({ sent: false, skipped: true, reason: order.status === 'cancelado' ? 'order_cancelled' : 'order_not_confirmed' }, 409);
  }

  const headers = { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'Content-Type': 'application/json' };
  const metaResponse = await fetch(`${supabaseUrl}/functions/v1/meta-conversions`, {
    method: 'POST', headers,
    body: JSON.stringify({
      orderId: order.id, eventId: order.order_number, storeId: order.store_id, confirmedBy: 'crm_confirmation',
      forceRetry: Boolean(forceRetry), sourceUrl: sourceUrl || '',
      fbp: order.customer?.fbp || '', fbc: order.customer?.fbc || ''
    })
  });
  const [meta, ga4] = await Promise.all([
    metaResponse.json().catch(() => ({ sent: false, status: metaResponse.status })),
    sendGa4(db, order, Boolean(forceRetry))
  ]);
  return json({ sent: Boolean((meta as any)?.sent || (ga4 as any)?.sent), confirmed: true, meta, ga4 });
});
