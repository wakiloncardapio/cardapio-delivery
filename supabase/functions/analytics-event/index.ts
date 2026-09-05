import { createClient } from 'npm:@supabase/supabase-js@2';
import { recordAnalyticsEvent } from '../_shared/commerce.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'Content-Type': 'application/json' }
});
const allowed = new Set(['view_item','add_to_cart','begin_checkout','order_created']);

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  if (Number(req.headers.get('content-length') || 0) > 50000) return json({ error: 'Evento muito grande.' }, 413);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'Supabase incompleto.' }, 503);
  const body = await req.json().catch(() => ({}));
  const storeId = String(body.storeId || '');
  const eventName = String(body.eventName || '');
  if (!/^[0-9a-f-]{36}$/i.test(storeId) || !allowed.has(eventName)) return json({ error: 'Evento inválido.' }, 400);

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: store } = await db.from('stores').select('id').eq('id', storeId)
    .eq('status', 'active').eq('storefront_enabled', true).maybeSingle();
  if (!store) return json({ error: 'Empresa indisponível.' }, 404);
  await recordAnalyticsEvent(db, {
    storeId,
    sessionId: body.sessionId,
    eventName,
    orderId: body.orderId,
    value: body.value,
    items: body.items,
    attribution: body.attribution,
    consent: body.consent
  });
  return json({ received: true }, 202);
});
