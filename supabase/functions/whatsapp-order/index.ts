import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const money = (value: unknown) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);

function note(order: any, storeName: string) {
  const customer = order.customer || {};
  const address = order.address || {};
  const lines = [`🟣 ${storeName.toUpperCase()}`, `PEDIDO ${order.order_number}`, '', `Cliente: ${customer.name || '-'}`, `WhatsApp: ${customer.phone || '-'}`, '', 'ITENS'];
  (order.items || []).forEach((item: any, index: number) => {
    lines.push(`${index + 1}. ${item.quantity || 1}x ${item.name} — ${money(Number(item.unitTotal || 0) * Number(item.quantity || 1))}`);
    (item.selections || []).forEach((selection: any) => lines.push(`   ${selection.groupName}: ${(selection.options || []).map((option: any) => option.name).join(', ')}`));
    if (item.notes) lines.push(`   Observação: ${item.notes}`);
  });
  lines.push('', `Subtotal: ${money(order.subtotal)}`, `Entrega: ${money(order.delivery_fee)}`, `TOTAL: ${money(order.total)}`, `Pagamento: ${order.payment_method}`);
  if (order.fulfillment === 'delivery') {
    lines.push('', 'ENDEREÇO', `${address.street || ''}, ${address.number || ''}`, `${address.neighborhood || ''} — ${address.city || ''}`);
    if (address.reference) lines.push(`Referência: ${address.reference}`);
    if (address.mapUrl) lines.push(`Mapa: ${address.mapUrl}`);
  } else lines.push('', 'Retirada no local');
  if (order.notes) lines.push('', `Observações: ${order.notes}`);
  return lines.join('\n');
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const token = Deno.env.get('META_WHATSAPP_TOKEN');
  const phoneId = Deno.env.get('META_PHONE_NUMBER_ID');
  const recipient = Deno.env.get('META_ORDER_RECIPIENT');
  const version = Deno.env.get('META_API_VERSION') || 'v23.0';
  if (!supabaseUrl || !serviceKey || !token || !phoneId || !recipient) return json({ error: 'Secrets da integração incompletos.' }, 503);
  const { orderId, storeId } = await req.json().catch(() => ({}));
  if (!orderId || !storeId) return json({ error: 'orderId e storeId são obrigatórios.' }, 400);
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const [{ data: order, error }, { data: settingsRow }] = await Promise.all([
    db.from('orders').select('*').eq('id', orderId).eq('store_id', storeId).single(),
    db.from('catalogs').select('data').eq('store_id', storeId).eq('id', 'settings').maybeSingle()
  ]);
  if (error || !order) return json({ error: 'Pedido não encontrado.' }, 404);
  const storeName = String(settingsRow?.data?.establishmentName || settingsRow?.data?.storeName || 'Seu Delivery');
  const response = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: recipient.replace(/\D/g, ''), type: 'text', text: { preview_url: true, body: note(order, storeName) } })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = result?.error?.message || 'Falha ao enviar pela Meta.';
    await db.from('orders').update({ notification_status: 'erro', notification_error: message }).eq('id', orderId).eq('store_id', storeId);
    return json({ error: message }, response.status);
  }
  await db.from('orders').update({ notification_status: 'enviado', notification_error: '', notified_at: new Date().toISOString() }).eq('id', orderId).eq('store_id', storeId);
  return json({ sent: true, messageId: result?.messages?.[0]?.id || '' });
});
