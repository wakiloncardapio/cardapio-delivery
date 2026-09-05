import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'Content-Type': 'application/json' }
});

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const { orderId, orderNumber } = await req.json().catch(() => ({}));
  if (!supabaseUrl || !serviceKey) return json({ error: 'Supabase incompleto.' }, 503);
  if (!orderId || !orderNumber) return json({ error: 'Pedido inválido.' }, 400);

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: order, error } = await db.from('orders')
    .select('id,order_number,payment_status,payment_provider,updated_at')
    .eq('id', String(orderId))
    .eq('order_number', String(orderNumber))
    .maybeSingle();
  if (error || !order) return json({ error: 'Pedido não encontrado.' }, 404);

  return json({
    orderNumber: order.order_number,
    paymentStatus: order.payment_status,
    paymentProvider: order.payment_provider,
    updatedAt: order.updated_at
  });
});
