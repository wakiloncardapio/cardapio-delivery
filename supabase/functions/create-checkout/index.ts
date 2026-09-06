import { createClient } from 'npm:@supabase/supabase-js@2';
import { paymentCredentials, paymentFailure, recordAnalyticsEvent, recordPaymentAttempt } from '../_shared/commerce.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'Content-Type': 'application/json' }
});
const money = (value: unknown) => Number(value || 0).toFixed(2);

function checkoutItems(order: any) {
  const items = (Array.isArray(order.items) ? order.items : []).map((item: any, index: number) => {
    const quantity = Math.max(1, Number(item.quantity) || 1);
    const unitPrice = Number(item.unitTotal || 0);
    return {
      title: String(item.name || `Produto ${index + 1}`).slice(0, 120),
      quantity,
      unit_price: money(unitPrice),
      unit_measure: 'unit',
      total_amount: money(unitPrice * quantity)
    };
  });
  if (Number(order.delivery_fee || 0) > 0) {
    items.push({
      title: 'Taxa de entrega',
      quantity: 1,
      unit_price: money(order.delivery_fee),
      unit_measure: 'unit',
      total_amount: money(order.delivery_fee)
    });
  }
  return items;
}

function paymentDetails(result: any) {
  const payment = result?.transactions?.payments?.[0] || {};
  const method = payment.payment_method || {};
  const transactionData = result?.point_of_interaction?.transaction_data || {};
  return {
    reference: String(result?.id || payment.id || ''),
    checkoutUrl: String(result?.init_point || result?.sandbox_init_point || result?.checkout_url || transactionData.ticket_url || ''),
    ticketUrl: String(transactionData.ticket_url || method.ticket_url || payment.ticket_url || ''),
    qrCode: String(transactionData.qr_code || method.qr_code || payment.qr_code || ''),
    qrCodeBase64: String(transactionData.qr_code_base64 || method.qr_code_base64 || payment.qr_code_base64 || '')
  };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const siteUrlValue = Deno.env.get('SITE_URL') || req.headers.get('origin') || '';
  const body = await req.json().catch(() => ({}));
  const { orderId, storeId, paymentMode = 'card', returnUrl: requestedReturnUrl = '' } = body;
  if (!supabaseUrl || !serviceKey) return json({ error: 'Supabase incompleto.' }, 503);
  let siteUrl = '';
  try {
    const parsed = new URL(siteUrlValue);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid protocol');
    siteUrl = parsed.href.endsWith('/') ? parsed.href : `${parsed.href}/`;
  } catch (_) {
    return json({ error: 'Configure SITE_URL com o endereço público do cardápio.' }, 503);
  }
  if (!orderId || !storeId) return json({ error: 'orderId e storeId são obrigatórios.' }, 400);
  if (!['card', 'pix'].includes(paymentMode)) return json({ error: 'Forma de pagamento inválida.' }, 400);

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: order, error } = await db.from('orders').select('*').eq('id', orderId).eq('store_id', storeId).single();
  if (error || !order) return json({ error: 'Pedido não encontrado.' }, 404);
  if (order.payment_status === 'pago') return json({ error: 'Este pedido já foi pago.' }, 409);
  const credentials = await paymentCredentials(db, String(storeId));
  if (!credentials.enabled || !credentials.accessToken) {
    await recordPaymentAttempt(db, {
      storeId, orderId: order.id, orderNumber: order.order_number,
      paymentMethod: paymentMode, status: 'error', amount: order.total,
      reasonCode: 'credentials_missing', reasonMessage: 'Mercado Pago não configurado para esta empresa.'
    });
    return json({ error: 'Mercado Pago ainda não configurado para esta empresa.' }, 503);
  }
  const accessToken = credentials.accessToken;

  let checkoutReturnUrl = new URL(siteUrl);
  if (requestedReturnUrl) {
    try {
      const candidate = new URL(String(requestedReturnUrl));
      const configuredOrigin = new URL(siteUrl).origin;
      let allowed = candidate.protocol === 'https:' && candidate.origin === configuredOrigin;
      if (!allowed) {
        const { data: domain } = await db.from('store_domains').select('id')
          .eq('store_id', storeId).eq('hostname', candidate.hostname.toLowerCase()).eq('status', 'active').maybeSingle();
        allowed = Boolean(domain);
      }
      if (allowed) checkoutReturnUrl = candidate;
    } catch (_) {}
  }
  checkoutReturnUrl.hash = '';
  checkoutReturnUrl.searchParams.set('pagamento', '');

  const customer = order.customer || {};
  const email = String(customer.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'Informe um e-mail válido para pagar on-line.' }, 400);
  }

  const items = checkoutItems(order);
  const calculatedTotal = items.reduce((sum: number, item: any) => sum + Number(item.total_amount), 0);
  if (!items.length || Math.abs(calculatedTotal - Number(order.total || 0)) > 0.01 || calculatedTotal <= 0) {
    return json({ error: 'Os valores do pedido não conferem. Volte ao cardápio e tente novamente.' }, 409);
  }

  const notificationUrl = `${supabaseUrl}/functions/v1/mercadopago-webhook?source_news=webhooks&store_id=${encodeURIComponent(String(storeId))}`;
  const returnUrl = checkoutReturnUrl.href;
  const idempotencyKey = paymentMode === 'card'
    ? order.id
    : `${String(order.id).slice(0, -1)}${String(order.id).endsWith('0') ? '1' : '0'}`;
  const commonHeaders = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'X-Idempotency-Key': idempotencyKey
  };

  if (paymentMode === 'pix') {
    // Confirme o ambiente diretamente no Mercado Pago. Isso também corrige
    // credenciais de teste que foram salvas antes de a plataforma passar a usar
    // o prefixo APP_USR no sandbox.
    const accountResponse = await fetch('https://api.mercadopago.com/users/me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const account = await accountResponse.json().catch(() => ({}));
    const pixTestMode = credentials.liveMode === false || account.test_user === true ||
      accessToken.startsWith('TEST-') || credentials.publicKey.startsWith('TEST-');
    const pixEndpoint = pixTestMode
      ? 'https://api.mercadopago.com/v1/orders'
      : 'https://api.mercadopago.com/v1/payments';
    const pixTestPayload = {
          type: 'online',
          external_reference: order.id,
          total_amount: money(order.total),
          notification_url: notificationUrl,
          payer: {
            email: 'test_user_br@testuser.com',
            first_name: 'APRO'
          },
          transactions: {
            payments: [{
              amount: money(order.total),
              payment_method: { id: 'pix', type: 'bank_transfer' }
            }]
          }
        };
    const pixLivePayload = {
          transaction_amount: Number(order.total),
          description: `Pedido ${order.order_number}`,
          payment_method_id: 'pix',
          external_reference: order.id,
          notification_url: notificationUrl,
          payer: {
            email,
            first_name: String(customer.name || '').trim().split(/\s+/)[0] || 'Cliente'
          }
        };
    const pixPayload = pixTestMode ? pixTestPayload : pixLivePayload;
    let response = await fetch(pixEndpoint, {
      method: 'POST',
      headers: commonHeaders,
      body: JSON.stringify(pixPayload)
    });
    let result = await response.json().catch(() => ({}));
    // Algumas credenciais de sandbox são reportadas como contas reais pelo
    // endpoint /users/me. Se a API antiga recusar exatamente por esse conflito,
    // repita uma única vez pelo fluxo oficial de teste da Orders API.
    if (!response.ok && !pixTestMode &&
      /unauthorized use of live credentials/i.test(JSON.stringify(result))) {
      response = await fetch('https://api.mercadopago.com/v1/orders', {
        method: 'POST',
        headers: commonHeaders,
        body: JSON.stringify(pixTestPayload)
      });
      result = await response.json().catch(() => ({}));
    }
    if (!response.ok) {
      const failure = paymentFailure(result, 'O Mercado Pago não conseguiu gerar o PIX.');
      await recordPaymentAttempt(db, {
        storeId, orderId: order.id, orderNumber: order.order_number,
        paymentMethod: 'pix', status: response.status >= 500 ? 'error' : 'rejected',
        amount: order.total, reasonCode: failure.code, reasonMessage: failure.message
      });
      await recordAnalyticsEvent(db, { storeId, orderId: order.id, eventName: 'payment_failed', value: order.total, items: order.items });
      return json({ error: failure.message }, response.status);
    }
    const details = paymentDetails(result);
    // A Orders API de teste retorna o Pix copia e cola e pode deixar a imagem
    // base64 vazia. O cardápio continua oferecendo o código e o ticket seguro.
    if (!details.qrCode) {
      await recordPaymentAttempt(db, {
        storeId, orderId: order.id, orderNumber: order.order_number,
        paymentMethod: 'pix', status: 'error', amount: order.total,
        externalReference: details.reference, reasonCode: 'pix_qr_missing',
        reasonMessage: 'O Mercado Pago não retornou o QR Code do PIX.'
      });
      return json({ error: 'O Mercado Pago não retornou o QR Code do PIX.' }, 502);
    }
    await db.from('orders').update({
      payment_method: 'mercadopago_pix',
      payment_provider: 'mercadopago',
      payment_reference: details.reference,
      checkout_url: details.ticketUrl,
      updated_at: new Date().toISOString()
    }).eq('id', order.id).eq('store_id', storeId);
    await recordPaymentAttempt(db, {
      storeId, orderId: order.id, orderNumber: order.order_number,
      paymentMethod: 'pix', status: 'pending', amount: order.total,
      externalReference: details.reference
    });
    await recordAnalyticsEvent(db, { storeId, orderId: order.id, eventName: 'payment_created', value: order.total, items: order.items });
    return json({
      paymentMode: 'pix',
      reference: details.reference,
      checkoutUrl: details.ticketUrl,
      ticketUrl: details.ticketUrl,
      qrCode: details.qrCode,
      qrCodeBase64: details.qrCodeBase64
    });
  }

  const preferenceItems = items.map((item: any, index: number) => ({
    id: String(index + 1),
    title: item.title,
    quantity: item.quantity,
    unit_price: Number(item.unit_price),
    currency_id: 'BRL'
  }));
  const payload = {
        external_reference: order.id,
        notification_url: notificationUrl,
        statement_descriptor: String(Deno.env.get('PAYMENT_DESCRIPTOR') || 'PEDIDO ONLINE').replace(/[^A-Z0-9 ]/gi, '').slice(0, 13),
        payer: { email, name: String(customer.name || '').trim() },
        items: preferenceItems,
        back_urls: {
          success: `${returnUrl}aprovado`,
          pending: `${returnUrl}pendente`,
          failure: `${returnUrl}falhou`
        },
        auto_return: 'approved',
        binary_mode: true,
        payment_methods: {
          excluded_payment_types: [{ id: 'ticket' }, { id: 'bank_transfer' }],
          installments: 10
        }
      };

  const endpoint = 'https://api.mercadopago.com/checkout/preferences';
  let response = await fetch(endpoint, {
    method: 'POST',
    headers: commonHeaders,
    body: JSON.stringify(payload)
  });
  let result = await response.json().catch(() => ({}));
  if (!response.ok) {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: commonHeaders,
      body: JSON.stringify({
        items: preferenceItems,
        payer: { email },
        external_reference: order.id,
        notification_url: notificationUrl,
        back_urls: {
          success: `${returnUrl}aprovado`,
          pending: `${returnUrl}pendente`,
          failure: `${returnUrl}falhou`
        },
        auto_return: 'approved',
        binary_mode: true,
        payment_methods: {
          excluded_payment_types: [{ id: 'ticket' }, { id: 'bank_transfer' }],
          installments: 10
        }
      })
    });
    result = await response.json().catch(() => ({}));
  }
  if (!response.ok) {
    const failure = paymentFailure(result, 'O Mercado Pago recusou a criação do pagamento.');
    await recordPaymentAttempt(db, {
      storeId, orderId: order.id, orderNumber: order.order_number,
      paymentMethod: 'card', status: response.status >= 500 ? 'error' : 'rejected',
      amount: order.total, reasonCode: failure.code, reasonMessage: failure.message
    });
    await recordAnalyticsEvent(db, { storeId, orderId: order.id, eventName: 'payment_failed', value: order.total, items: order.items });
    return json({ error: failure.message }, response.status);
  }

  const details = paymentDetails(result);
  if (!/^https:\/\//.test(details.checkoutUrl)) {
    await recordPaymentAttempt(db, {
      storeId, orderId: order.id, orderNumber: order.order_number,
      paymentMethod: 'card', status: 'error', amount: order.total,
      externalReference: details.reference, reasonCode: 'checkout_url_missing',
      reasonMessage: 'O Mercado Pago não retornou a página segura de pagamento.'
    });
    return json({ error: 'O Mercado Pago não retornou a página segura de pagamento.' }, 502);
  }

  const checkoutUrl = details.checkoutUrl;
  await db.from('orders').update({
    payment_method: 'mercadopago_card',
    payment_provider: 'mercadopago',
    payment_reference: details.reference,
    checkout_url: checkoutUrl,
    updated_at: new Date().toISOString()
  }).eq('id', order.id).eq('store_id', storeId);
  await recordPaymentAttempt(db, {
    storeId, orderId: order.id, orderNumber: order.order_number,
    paymentMethod: 'card', status: 'created', amount: order.total,
    externalReference: details.reference
  });
  await recordAnalyticsEvent(db, { storeId, orderId: order.id, eventName: 'payment_created', value: order.total, items: order.items });

  return json({
    paymentMode,
    reference: details.reference,
    checkoutUrl: details.checkoutUrl,
    ticketUrl: details.ticketUrl,
    qrCode: details.qrCode,
    qrCodeBase64: details.qrCodeBase64
  });
});
