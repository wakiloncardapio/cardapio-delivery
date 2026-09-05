import { createClient } from 'npm:@supabase/supabase-js@2';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' }
});

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function hmacHex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function validSignature(req: Request, dataId: string, secret: string) {
  const header = req.headers.get('x-signature') || '';
  const requestId = req.headers.get('x-request-id') || '';
  const parts = Object.fromEntries(header.split(',').map(part => part.trim().split('=')));
  if (!parts.ts || !parts.v1 || !requestId || !dataId) return false;
  const manifest = `id:${dataId};request-id:${requestId};ts:${parts.ts};`;
  return timingSafeEqual(await hmacHex(secret, manifest), String(parts.v1));
}

async function sendGa4Purchase(db: any, order: any) {
  const trackingConsent = order.customer?.trackingConsent || {};
  if (trackingConsent.analytics !== true) {
    return { sent: false, skipped: true, reason: 'analytics_consent_required' };
  }

  let measurementId = Deno.env.get('GA4_MEASUREMENT_ID') || '';
  const apiSecret = Deno.env.get('GA4_API_SECRET') || '';
  if (!measurementId) {
    const { data: settings } = await db.from('catalogs').select('data').eq('id', 'settings').maybeSingle();
    measurementId = String(settings?.data?.ga4Id || '');
  }
  if (!/^G-[A-Z0-9]+$/i.test(measurementId) || !apiSecret) {
    return { sent: false, configured: false };
  }

  const eventType = 'ga4.purchase';
  const { data: previous } = await db.from('order_webhook_events')
    .select('id,status')
    .eq('order_id', order.id)
    .eq('event_type', eventType)
    .eq('source_updated_at', order.created_at)
    .maybeSingle();
  if (previous?.status === 'enviado') return { sent: true, duplicate: true };

  let auditId = previous?.id || crypto.randomUUID();
  if (previous?.id) {
    await db.from('order_webhook_events').update({
      status: 'processando', error_message: '', updated_at: new Date().toISOString()
    }).eq('id', auditId);
  } else {
    const { error: auditError } = await db.from('order_webhook_events').insert({
      id: auditId,
      order_id: order.id,
      event_type: eventType,
      source_updated_at: order.created_at,
      status: 'processando'
    });
    if (auditError?.code === '23505') return { sent: false, duplicate: true, processing: true };
    if (auditError) auditId = '';
  }

  const items = (Array.isArray(order.items) ? order.items : []).map((item: any, index: number) => ({
    item_id: String(item.productId || item.id || index + 1),
    item_name: String(item.name || 'Produto'),
    price: Math.round((Number(item.unitTotal ?? item.basePrice) || 0) * 100) / 100,
    quantity: Math.max(1, Number(item.quantity) || 1)
  }));
  const attribution = order.customer?.attribution?.last_touch || {};
  const payload = {
    client_id: String(order.id),
    timestamp_micros: String(Date.now() * 1000),
    events: [{
      name: 'purchase',
      params: {
        transaction_id: order.order_number,
        event_id: order.order_number,
        currency: 'BRL',
        value: Math.round((Number(order.total) || 0) * 100) / 100,
        shipping: Math.round((Number(order.delivery_fee) || 0) * 100) / 100,
        items,
        order_source: String(attribution.source || ''),
        order_medium: String(attribution.medium || ''),
        order_campaign: String(attribution.campaign || ''),
        engagement_time_msec: 1
      }
    }]
  };

  try {
    const response = await fetch(`https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`GA4 respondeu HTTP ${response.status}.`);
    if (auditId) await db.from('order_webhook_events').update({
      status: 'enviado', response_status: response.status, error_message: '', updated_at: new Date().toISOString()
    }).eq('id', auditId);
    return { sent: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao enviar a compra ao GA4.';
    if (auditId) await db.from('order_webhook_events').update({
      status: 'erro', error_message: message, updated_at: new Date().toISOString()
    }).eq('id', auditId);
    return { sent: false, error: message };
  }
}

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const accessToken = Deno.env.get('MERCADO_PAGO_ACCESS_TOKEN') || '';
  const webhookSecret = Deno.env.get('MERCADO_PAGO_WEBHOOK_SECRET') || '';
  if (!supabaseUrl || !serviceKey || !accessToken || !webhookSecret) {
    return json({ error: 'Integração Mercado Pago incompleta.' }, 503);
  }

  const url = new URL(req.url);
  const body = await req.json().catch(() => ({}));
  const type = String(url.searchParams.get('type') || body.type || '').toLowerCase();
  const dataId = String(url.searchParams.get('data.id') || url.searchParams.get('data_id') || body?.data?.id || '');
  if (!dataId || !['order', 'payment'].includes(type)) return json({ received: true, ignored: true });
  if (!(await validSignature(req, dataId, webhookSecret))) return json({ error: 'Assinatura inválida.' }, 401);

  const resourceUrl = type === 'payment'
    ? `https://api.mercadopago.com/v1/payments/${encodeURIComponent(dataId)}`
    : `https://api.mercadopago.com/v1/orders/${encodeURIComponent(dataId)}`;
  const orderResponse = await fetch(resourceUrl, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const mercadoPagoResource = await orderResponse.json().catch(() => ({}));
  if (!orderResponse.ok) return json({ error: 'Não foi possível confirmar o pagamento no Mercado Pago.' }, 502);

  const orderId = String(mercadoPagoResource.external_reference || '');
  if (!orderId) return json({ received: true, ignored: true, reason: 'order_missing' });

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: order, error } = await db.from('orders').select('*').eq('id', orderId).maybeSingle();
  if (error || !order) return json({ received: true, ignored: true, reason: 'order_not_found' });

  const chargedAmount = Number(type === 'payment'
    ? mercadoPagoResource.transaction_amount
    : mercadoPagoResource.total_amount || 0);
  if (Math.abs(chargedAmount - Number(order.total || 0)) > 0.01) {
    return json({ error: 'O valor da order não confere com o pedido.' }, 409);
  }

  const orderStatus = String(mercadoPagoResource.status || '').toLowerCase();
  const paymentStatuses = type === 'payment'
    ? [orderStatus]
    : (mercadoPagoResource?.transactions?.payments || [])
      .map((payment: any) => String(payment.status || '').toLowerCase());
  const paid = ['processed', 'accredited', 'approved'].includes(orderStatus) ||
    paymentStatuses.some((status: string) => ['processed', 'accredited', 'approved'].includes(status));
  const refunded = ['refunded', 'charged_back'].includes(orderStatus) ||
    paymentStatuses.some((status: string) => ['refunded', 'charged_back'].includes(status));
  const rejected = ['rejected', 'cancelled', 'canceled'].includes(orderStatus) ||
    paymentStatuses.some((status: string) => ['rejected', 'cancelled', 'canceled'].includes(status));
  const nextPaymentStatus = paid ? 'pago' : refunded ? 'estornado' : rejected ? 'recusado' : 'pendente';
  const becamePaid = nextPaymentStatus === 'pago' && order.payment_status !== 'pago';

  const paidAt = new Date().toISOString();
  await db.from('orders').update({
    status: becamePaid && order.status === 'aguardando_pagamento' ? 'novo' : order.status,
    payment_status: nextPaymentStatus,
    payment_provider: 'mercadopago',
    payment_reference: String(mercadoPagoResource.id || dataId),
    updated_at: paidAt
  }).eq('id', order.id);

  let notifications: Record<string, unknown> = {};
  if (becamePaid) {
    const functionHeaders = {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'Content-Type': 'application/json'
    };
    const [emailResponse, whatsappResponse] = await Promise.all([
      fetch(`${supabaseUrl}/functions/v1/order-email`, {
        method: 'POST', headers: functionHeaders, body: JSON.stringify({ orderId: order.id, event: 'created' })
      }),
      fetch(`${supabaseUrl}/functions/v1/whatsapp-order`, {
        method: 'POST', headers: functionHeaders, body: JSON.stringify({ orderId: order.id })
      })
    ]);
    notifications = {
      email: await emailResponse.json().catch(() => ({ sent: false, status: emailResponse.status })),
      whatsapp: await whatsappResponse.json().catch(() => ({ sent: false, status: whatsappResponse.status }))
    };
  }

  return json({ received: true, orderId: order.id, paymentStatus: nextPaymentStatus, conversions: {}, notifications });
});
