import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'Content-Type': 'application/json' }
});
const money = (value: unknown) => new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL'
}).format(Number(value) || 0);
const entities: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
};
const html = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => entities[character] || character);
const firstName = (value: unknown) => {
  const name = String(value ?? '').trim().split(/\s+/)[0] || 'cliente';
  return name.charAt(0).toLocaleUpperCase('pt-BR') + name.slice(1).toLocaleLowerCase('pt-BR');
};
const safeImageUrl = (value: unknown) => {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : '';
  } catch (_) {
    return '';
  }
};
const messageVariables = (value: unknown, order: any, customerFirstName: string) => String(value ?? '')
  .replace(/\{primeiro_nome\}/gi, customerFirstName)
  .replace(/\{pedido\}/gi, String(order.order_number || ''))
  .replace(/\{total\}/gi, money(order.total));

const eventNames: Record<string, string> = {
  created: 'order.created',
  confirmed: 'order.confirmed',
  preparing: 'order.preparing',
  out_for_delivery: 'order.out_for_delivery',
  completed: 'order.completed',
  cancelled: 'order.cancelled',
  payment_paid: 'order.payment_paid',
  payment_refunded: 'order.payment_refunded'
};

function validateMakeUrl(value: unknown) {
  try {
    const url = new URL(String(value || ''));
    const allowedHost = url.hostname === 'hook.make.com' || url.hostname.endsWith('.make.com');
    return url.protocol === 'https:' && allowedHost && !url.username && !url.password ? url.toString() : '';
  } catch (_) {
    return '';
  }
}

function paymentLabel(method: unknown) {
  return ({
    pix: 'PIX',
    card_delivery: 'Cartão na entrega',
    cash: 'Dinheiro',
    payment_link: 'Pagamento on-line'
  } as Record<string, string>)[String(method || '')] || String(method || 'Não informado');
}

function paymentStatusLabel(status: unknown) {
  return ({ pendente: 'Pendente', pago: 'Pago', estornado: 'Estornado' } as Record<string, string>)[String(status || '')] || String(status || 'Pendente');
}

function paymentDetail(order: any) {
  const method = paymentLabel(order.payment_method);
  return order.payment_method === 'cash' && order.change_for ? `${method} · troco para ${order.change_for}` : method;
}

function orderNote(order: any, store: any) {
  const customer = order.customer || {};
  const address = order.address || {};
  const lines = [
    String(store.establishmentName || store.storeName || 'Seu Delivery').toUpperCase(),
    `PEDIDO ${order.order_number}`,
    `Data: ${new Date(order.created_at).toLocaleString('pt-BR', { timeZone: store.timezone || 'America/Sao_Paulo' })}`,
    '',
    `CLIENTE: ${customer.name || '-'}`,
    `WhatsApp: ${customer.phone || '-'}`,
    `E-mail: ${customer.email || '-'}`,
    '',
    'ITENS DO PEDIDO'
  ];
  (order.items || []).forEach((item: any, index: number) => {
    const quantity = Number(item.quantity || 1);
    lines.push(`${index + 1}. ${quantity}x ${item.name || 'Item'} — ${money(Number(item.unitTotal || 0) * quantity)}`);
    (item.selections || []).forEach((selection: any) => {
      const options = (selection.options || []).map((option: any) => {
        const price = Number(option.price || 0);
        const priceText = price ? (selection.priceMode === 'final' ? ` (${money(price)})` : ` (+${money(price)})`) : '';
        return `${option.name}${priceText}`;
      }).join(', ');
      lines.push(`   ${selection.groupName || 'Adicionais'}: ${options}`);
    });
    if (item.notes) lines.push(`   Observação: ${item.notes}`);
  });
  lines.push(
    '',
    `Subtotal: ${money(order.subtotal)}`,
    `Entrega: ${money(order.delivery_fee)}`,
    `TOTAL: ${money(order.total)}`,
    '',
    `Pagamento: ${paymentDetail(order)}`,
    `Status do pagamento: ${paymentStatusLabel(order.payment_status)}`
  );
  if (order.fulfillment === 'delivery') {
    lines.push(
      '',
      'ENDEREÇO DE ENTREGA',
      `${address.street || ''}, ${address.number || ''}${address.complement ? ` — ${address.complement}` : ''}`,
      `${address.neighborhood || ''} — ${address.city || ''}${address.zip ? ` — CEP ${address.zip}` : ''}`
    );
    if (address.reference) lines.push(`Referência: ${address.reference}`);
    if (address.mapUrl) lines.push(`Mapa: ${address.mapUrl}`);
  } else {
    lines.push('', 'RETIRADA NO LOCAL');
  }
  if (order.notes) lines.push('', `OBSERVAÇÕES: ${order.notes}`);
  return lines.join('\n');
}

function itemRows(order: any) {
  return (order.items || []).map((item: any) => {
    const quantity = Number(item.quantity || 1);
    const additions = (item.selections || []).map((selection: any) => {
      const options = (selection.options || []).map((option: any) => html(option.name)).join(', ');
      return `<div style="color:#666;font-size:13px;margin-top:4px"><b>${html(selection.groupName || 'Adicionais')}:</b> ${options}</div>`;
    }).join('');
    const observation = item.notes
      ? `<div style="color:#666;font-size:13px;margin-top:4px"><b>Observação:</b> ${html(item.notes)}</div>`
      : '';
    return `<tr><td style="padding:12px 0;border-bottom:1px solid #eee;vertical-align:top"><b>${quantity}x ${html(item.name || 'Item')}</b>${additions}${observation}</td><td style="padding:12px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;vertical-align:top"><b>${html(money(Number(item.unitTotal || 0) * quantity))}</b></td></tr>`;
  }).join('');
}

function emailFrame(title: string, intro: string, content: string, store: any, imageUrl = '') {
  const name = html(store.establishmentName || store.storeName || 'Seu Delivery');
  const contact = html(store.publicEmail || store.orderEmail || '');
  const help = contact ? `Mensagem automática. Precisa de ajuda? <a href="mailto:${contact}" style="color:#620853;font-weight:700">${contact}</a>` : 'Mensagem automática.';
  const safeImage = safeImageUrl(imageUrl);
  const imageBlock = safeImage ? `<tr><td style="padding:0;background:#ffffff"><img src="${html(safeImage)}" width="620" alt="${html(title)}" style="display:block;width:100%;max-width:620px;height:auto;max-height:330px;object-fit:cover;border:0"></td></tr>` : '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>@media only screen and (max-width:620px){.email-wrap{padding:12px 8px!important}.email-content{padding:24px 20px!important}.email-title{font-size:27px!important}}</style></head><body style="margin:0;background:#f5f1f6;font-family:Arial,Helvetica,sans-serif;color:#281225"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${html(intro)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f1f6"><tr><td class="email-wrap" style="padding:28px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 8px 28px rgba(77,9,65,.10)"><tr><td align="center" style="background-color:#620853;background-image:linear-gradient(135deg,#510544 0%,#810b6d 100%);padding:25px 24px 28px;border-bottom:7px solid #fcd307"><div style="color:#ffffff;font-size:18px;font-weight:800;letter-spacing:2px;text-transform:uppercase;margin-bottom:16px">${name}</div><div style="display:inline-block;background:#fcd307;color:#4a073f;border-radius:999px;padding:7px 13px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase">Atualização do pedido</div><h1 class="email-title" style="color:#ffffff;font-size:31px;line-height:1.15;margin:14px 0 0">${html(title)}</h1></td></tr>${imageBlock}<tr><td class="email-content" style="padding:30px 34px"><p style="font-size:17px;line-height:1.65;margin:0;color:#32142d">${html(intro)}</p>${content}</td></tr><tr><td style="background:#fff7c7;padding:20px 28px;text-align:center;font-size:12px;line-height:1.6;color:#684761"><b>${name}</b><br>${help}</td></tr></table></td></tr></table></body></html>`;
}

function storeEmail(order: any, store: any, note: string) {
  const customer = order.customer || {};
  const address = order.address || {};
  const delivery = order.fulfillment === 'delivery'
    ? `${html(address.street)}, ${html(address.number)}${address.complement ? ` — ${html(address.complement)}` : ''}<br>${html(address.neighborhood)} — ${html(address.city)}${address.zip ? ` — CEP ${html(address.zip)}` : ''}${address.deliveryRegion ? `<br><b>Região de entrega:</b> ${html(address.deliveryRegion)}` : ''}${address.reference ? `<br><b>Referência:</b> ${html(address.reference)}` : ''}${address.mapUrl ? `<br><a href="${html(address.mapUrl)}">Abrir mapa</a>` : ''}`
    : 'Retirada no estabelecimento';
  const content = `<div style="background:#faf7fa;border:1px solid #eadfea;border-radius:12px;padding:16px;margin:18px 0"><b>Cliente:</b> ${html(customer.name)}<br><b>WhatsApp:</b> ${html(customer.phone)}<br><b>E-mail:</b> ${html(customer.email)}<br><b>Recebimento:</b> ${delivery}<br><b>Pagamento escolhido:</b> ${html(paymentDetail(order))}<br><b>Status do pagamento:</b> ${html(paymentStatusLabel(order.payment_status))}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${itemRows(order)}<tr><td style="padding-top:16px"><b>TOTAL</b></td><td style="padding-top:16px;text-align:right;font-size:22px;color:#620853"><b>${html(money(order.total))}</b></td></tr></table>${order.notes ? `<p><b>Observações gerais:</b> ${html(order.notes)}</p>` : ''}`;
  return {
    to: store.orderEmail || store.publicEmail || '',
    replyTo: customer.email || '',
    subject: `Novo pedido ${order.order_number} — ${customer.name || 'cliente'} — ${money(order.total)}`,
    preheader: `${order.fulfillment === 'delivery' ? 'Entrega' : 'Retirada'} · ${paymentLabel(order.payment_method)} · ${money(order.total)}`,
    text: note,
    html: emailFrame(`Novo pedido ${order.order_number}`, 'Um novo pedido foi registrado automaticamente no cardápio.', content, store)
  };
}

function customerEmail(order: any, store: any, event: string) {
  const customer = order.customer || {};
  const customerFirstName = firstName(customer.name);
  const storeName = String(store.establishmentName || store.storeName || 'Seu Delivery');
  const messages: Record<string, { title: string; intro: string; subject: string; emoji: string; status: string; detail: string }> = {
    confirmed: {
      title: 'Pedido confirmado! 🎉',
      intro: `Olá, ${customerFirstName}! Seu pedido foi confirmado e já está sendo preparado com todo carinho. Assim que sair para entrega, avisaremos você por e-mail.`,
      subject: `🎉 Pedido ${order.order_number} confirmado e em preparo`,
      emoji: '🥣',
      status: 'Confirmado e em preparo',
      detail: 'Agora é com a gente: estamos preparando tudo para você.'
    },
    preparing: {
      title: 'Preparando seu pedido 💜',
      intro: `${customerFirstName}, seu pedido já está sendo preparado com muito carinho.`,
      subject: `🥣 Pedido ${order.order_number} em preparo`,
      emoji: '🥣',
      status: 'Em preparo',
      detail: 'Assim que sair para entrega, enviaremos um novo aviso.'
    },
    out_for_delivery: {
      title: 'Seu pedido está a caminho! 🛵',
      intro: `${customerFirstName}, seu pedido saiu para entrega. Fique de olho!`,
      subject: `🛵 Pedido ${order.order_number} saiu para entrega`,
      emoji: '🛵',
      status: 'Saiu para entrega',
      detail: `Seu pedido da ${storeName} está indo até você.`
    },
    completed: {
      title: 'Pedido concluído! 💛',
      intro: `${customerFirstName}, seu pedido foi concluído. Obrigado por escolher a ${storeName}!`,
      subject: `Pedido ${order.order_number} concluído`,
      emoji: '💛',
      status: 'Concluído',
      detail: 'Esperamos que você aproveite seu pedido!'
    },
    cancelled: {
      title: 'Pedido cancelado',
      intro: `${customerFirstName}, o pedido ${order.order_number} foi cancelado. Fale conosco se precisar de ajuda.`,
      subject: `Pedido ${order.order_number} cancelado`,
      emoji: '⚠️',
      status: 'Cancelado',
      detail: 'Se precisar de ajuda, responda esta mensagem.'
    },
    payment_paid: {
      title: 'Pagamento confirmado! ✅',
      intro: `${customerFirstName}, o pagamento do pedido ${order.order_number} foi confirmado.`,
      subject: `Pagamento do pedido ${order.order_number} confirmado`,
      emoji: '✅',
      status: 'Pagamento aprovado',
      detail: 'Tudo certo com o pagamento do seu pedido.'
    },
    payment_refunded: {
      title: 'Pagamento estornado',
      intro: `${customerFirstName}, o pagamento do pedido ${order.order_number} foi marcado como estornado.`,
      subject: `Pagamento do pedido ${order.order_number} estornado`,
      emoji: '↩️',
      status: 'Pagamento estornado',
      detail: 'Fale conosco caso precise de mais informações.'
    }
  };
  const defaultMessage = messages[event] || messages.confirmed;
  const customMessage = store.crmNotifications?.[event] || {};
  const customTitle = messageVariables(customMessage.title || defaultMessage.title, order, customerFirstName);
  const customIntro = messageVariables(customMessage.message || defaultMessage.intro, order, customerFirstName);
  const message = {
    ...defaultMessage,
    title: customTitle,
    intro: customIntro,
    subject: customMessage.title ? `${customTitle} — ${order.order_number}` : defaultMessage.subject,
    imageUrl: safeImageUrl(customMessage.imageUrl)
  };
  const content = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:24px 0 18px;background:#fff9d9;border:1px solid #f8e77c;border-radius:18px"><tr><td width="64" style="padding:20px 0 20px 20px;vertical-align:top"><div style="width:48px;height:48px;line-height:48px;text-align:center;background:#620853;border-radius:50%;font-size:24px">${message.emoji}</div></td><td style="padding:20px;vertical-align:middle"><div style="font-size:11px;color:#7a536f;font-weight:700;letter-spacing:.8px;text-transform:uppercase">Status atual</div><div style="font-size:18px;color:#620853;font-weight:700;margin-top:4px">${html(message.status)}</div><div style="font-size:13px;line-height:1.5;color:#684761;margin-top:5px">${html(message.detail)}</div></td></tr></table><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#faf7fb;border:1px solid #eadfea;border-radius:16px"><tr><td style="padding:18px 20px"><div style="font-size:11px;color:#7a536f;font-weight:700;letter-spacing:.8px;text-transform:uppercase">Número do pedido</div><div style="font-size:21px;color:#620853;font-weight:700;margin-top:4px">${html(order.order_number)}</div></td><td style="padding:18px 20px;text-align:right"><div style="font-size:11px;color:#7a536f;font-weight:700;letter-spacing:.8px;text-transform:uppercase">Total</div><div style="font-size:21px;color:#620853;font-weight:700;margin-top:4px;white-space:nowrap">${html(money(order.total))}</div></td></tr></table><p style="font-size:13px;line-height:1.6;color:#74596f;text-align:center;margin:20px 0 0">Você receberá novos avisos conforme o pedido avançar.</p>`;
  return {
    to: customer.email || '',
    replyTo: store.publicEmail || store.orderEmail || '',
    subject: message.subject,
    preheader: message.intro,
    text: `${message.title}\n\n${message.intro}\n\nStatus: ${message.status}\n${message.detail}\n\nPedido: ${order.order_number}\nTotal: ${money(order.total)}\n\n${store.establishmentName || store.storeName || 'Seu Delivery'}`,
    html: emailFrame(message.title, message.intro, content, store, message.imageUrl)
  };
}

async function canManageStore(db: any, req: Request, storeId: string) {
  const authorization = req.headers.get('Authorization') || '';
  const token = authorization.replace(/^Bearer\s+/i, '');
  if (!token) return false;
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) return false;
  const [{ data: platformAdmin }, { data: member }] = await Promise.all([
    db.from('platform_admins').select('user_id').eq('user_id', data.user.id).maybeSingle(),
    db.from('store_members').select('role').eq('store_id', storeId).eq('user_id', data.user.id)
      .eq('active', true).in('role', ['owner', 'manager']).maybeSingle()
  ]);
  return Boolean(platformAdmin || member);
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return json({ error: 'Ambiente do Supabase incompleto.' }, 503);
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const body = await req.json().catch(() => ({}));
  const event = String(body.event || 'created');
  const storeId = String(body.storeId || '');
  if (!storeId) return json({ error: 'storeId obrigatório.' }, 400);
  const hasAdminAccess = await canManageStore(db, req, storeId);

  if (event === 'test') {
    if (!hasAdminAccess) return json({ error: 'Acesso administrativo obrigatório.' }, 401);
    const [{ data: privateRow }, { data: settingsRow }] = await Promise.all([
      db.from('private_settings').select('data').eq('store_id', storeId).eq('id', 'integrations').maybeSingle(),
      db.from('catalogs').select('data').eq('store_id', storeId).eq('id', 'settings').maybeSingle()
    ]);
    const integration = privateRow?.data || {};
    const store = settingsRow?.data || {};
    const webhookUrl = validateMakeUrl(integration.makeWebhookUrl);
    if (!integration.makeWebhookEnabled || !webhookUrl) return json({ sent: false, configured: false, error: 'Ative e salve uma URL válida do Make.' });
    const email = {
      to: store.orderEmail || store.publicEmail || '',
      replyTo: store.publicEmail || store.orderEmail || '',
      subject: `Teste da integração Make + Mailgun — ${store.establishmentName || store.storeName || 'Seu Delivery'}`,
      preheader: 'O webhook protegido está funcionando.',
      text: 'Teste concluído. O webhook do cardápio enviou estes dados ao Make.',
      html: emailFrame('Integração funcionando', 'O webhook protegido do cardápio enviou este teste ao Make.', '<p>Agora confirme se o módulo Mailgun também enviou esta mensagem.</p>', store)
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ schema_version: '1.0', event: 'integration.test', event_id: crypto.randomUUID(), sent_at: new Date().toISOString(), store, email })
      });
      if (!response.ok) return json({ sent: false, configured: true, error: `Make respondeu HTTP ${response.status}.` }, 502);
      return json({ sent: true, configured: true });
    } catch (error) {
      return json({ sent: false, configured: true, error: error instanceof Error ? error.message : 'Falha ao chamar o Make.' }, 502);
    } finally {
      clearTimeout(timeout);
    }
  }

  if (!eventNames[event]) return json({ error: 'Evento de e-mail inválido.' }, 400);
  const orderId = String(body.orderId || '');
  if (!orderId) return json({ error: 'orderId obrigatório.' }, 400);
  if (event !== 'created' && !hasAdminAccess) return json({ error: 'Acesso administrativo obrigatório.' }, 401);

  const [{ data: order, error: orderError }, { data: privateRow }, { data: settingsRow }] = await Promise.all([
    db.from('orders').select('*').eq('id', orderId).eq('store_id', storeId).maybeSingle(),
    db.from('private_settings').select('data').eq('store_id', storeId).eq('id', 'integrations').maybeSingle(),
    db.from('catalogs').select('data').eq('store_id', storeId).eq('id', 'settings').maybeSingle()
  ]);
  if (orderError || !order) return json({ error: 'Pedido não encontrado.' }, 404);
  if (event === 'created' && !hasAdminAccess && Date.now() - new Date(order.created_at).valueOf() > 30 * 60 * 1000) {
    return json({ error: 'A notificação inicial deste pedido expirou.' }, 403);
  }

  const integration = privateRow?.data || {};
  const store = settingsRow?.data || {};
  if (event !== 'created' && store.crmNotifications?.[event]?.enabled === false) {
    return json({ sent: false, configured: true, disabled: true, reason: 'notification_disabled', event: eventNames[event] });
  }
  const webhookUrl = validateMakeUrl(integration.makeWebhookUrl);
  if (!integration.makeWebhookEnabled || !webhookUrl) {
    return json({ sent: false, configured: false, reason: 'make_disabled' });
  }
  const note = orderNote(order, store);
  const email = event === 'created' ? storeEmail(order, store, note) : customerEmail(order, store, event);
  if (!email.to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.to)) {
    return json({ sent: false, configured: true, reason: 'recipient_missing' });
  }

  const sourceUpdatedAt = order.updated_at || order.created_at;
  let eventId = crypto.randomUUID();
  const { data: inserted, error: insertError } = await db.from('order_webhook_events').insert({
    id: eventId, store_id: storeId, order_id: order.id, event_type: eventNames[event], source_updated_at: sourceUpdatedAt
  }).select('id').single();
  if (insertError?.code === '23505') {
    const { data: previous } = await db.from('order_webhook_events')
      .select('id,status,updated_at')
      .eq('order_id', order.id)
      .eq('event_type', eventNames[event])
      .eq('source_updated_at', sourceUpdatedAt)
      .maybeSingle();
    if (previous?.status === 'enviado' || (previous?.status === 'processando' && Date.now() - new Date(previous.updated_at).valueOf() < 120000)) {
      return json({ sent: previous.status === 'enviado', configured: true, duplicate: true });
    }
    eventId = previous?.id || eventId;
    await db.from('order_webhook_events').update({ status: 'processando', error_message: '', updated_at: new Date().toISOString() }).eq('id', eventId);
  } else if (insertError || !inserted) {
    return json({ error: insertError?.message || 'Não foi possível registrar o evento.' }, 500);
  }

  const payload = {
    schema_version: '1.0',
    event: eventNames[event],
    event_id: eventId,
    sent_at: new Date().toISOString(),
    store: {
      name: store.establishmentName || store.storeName || 'Seu Delivery',
      location: store.locationName || store.city || '',
      address: store.address || '',
      phone: store.contactPhone || store.whatsapp || '',
      public_email: store.publicEmail || '',
      cnpj: store.cnpj || ''
    },
    order: {
      id: order.id, number: order.order_number, created_at: order.created_at, updated_at: order.updated_at,
      status: order.status, payment_status: order.payment_status, payment_method: order.payment_method,
      notes: order.notes || ''
    },
    customer: order.customer || {},
    fulfillment: order.fulfillment,
    address: order.address || {},
    items: order.items || [],
    totals: { subtotal: Number(order.subtotal), delivery_fee: Number(order.delivery_fee), total: Number(order.total), currency: 'BRL' },
    note,
    email: { ...email, from: `${store.establishmentName || store.storeName || 'Seu Delivery'} <${store.orderEmail || store.publicEmail || ''}>` }
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`Make respondeu HTTP ${response.status}.`);
    const now = new Date().toISOString();
    await db.from('order_webhook_events').update({ status: 'enviado', response_status: response.status, error_message: '', updated_at: now }).eq('id', eventId);
    const statusField = event === 'created' ? 'store_email_status' : 'customer_email_status';
    await db.from('orders').update({ [statusField]: 'enviado', email_error: '', last_email_at: now }).eq('id', order.id).eq('store_id', storeId);
    return json({ sent: true, configured: true, event: eventNames[event], eventId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao chamar o Make.';
    const now = new Date().toISOString();
    await db.from('order_webhook_events').update({ status: 'erro', error_message: message, updated_at: now }).eq('id', eventId);
    const statusField = event === 'created' ? 'store_email_status' : 'customer_email_status';
    await db.from('orders').update({ [statusField]: 'erro', email_error: message, last_email_at: now }).eq('id', order.id).eq('store_id', storeId);
    return json({ sent: false, configured: true, error: message }, 502);
  } finally {
    clearTimeout(timeout);
  }
});
