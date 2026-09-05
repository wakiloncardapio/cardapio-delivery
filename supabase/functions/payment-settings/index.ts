import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'Content-Type': 'application/json' }
});

async function actorForStore(db: any, req: Request, storeId: string) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new Error('Sessão administrativa inválida.');
  const [{ data: platformAdmin }, { data: member }] = await Promise.all([
    db.from('platform_admins').select('user_id').eq('user_id', data.user.id).maybeSingle(),
    db.from('store_members').select('role,active').eq('store_id', storeId).eq('user_id', data.user.id).maybeSingle()
  ]);
  if (!platformAdmin && !(member?.active && ['owner', 'manager'].includes(member.role))) {
    throw new Error('Somente o proprietário ou gestor pode alterar pagamentos.');
  }
  return data.user;
}

async function safeConfig(db: any, storeId: string) {
  const { data, error } = await db.from('payment_provider_configs')
    .select('provider,enabled,public_key,account_id,account_email,live_mode,apple_pay_status,updated_at,access_token_secret_id,webhook_secret_id')
    .eq('store_id', storeId).maybeSingle();
  if (error && /payment_provider_configs|schema cache|does not exist/i.test(error.message || '')) {
    return { available: false, connected: false, enabled: false };
  }
  if (error) throw error;
  if (!data) return { available: true, connected: false, enabled: false, applePayStatus: 'provider_required' };
  return {
    available: true,
    connected: Boolean(data.access_token_secret_id),
    webhookConfigured: Boolean(data.webhook_secret_id),
    provider: data.provider,
    enabled: data.enabled === true,
    publicKey: data.public_key || '',
    accountId: data.account_id || '',
    accountEmail: data.account_email || '',
    liveMode: data.live_mode === true,
    applePayStatus: data.apple_pay_status || 'provider_required',
    updatedAt: data.updated_at
  };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'Supabase incompleto.' }, 503);
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const body = await req.json().catch(() => ({}));
    const storeId = String(body.storeId || '');
    if (!/^[0-9a-f-]{36}$/i.test(storeId)) return json({ error: 'Empresa inválida.' }, 400);
    const actor = await actorForStore(db, req, storeId);
    const action = String(body.action || 'get');

    if (action === 'get') return json(await safeConfig(db, storeId));

    if (action === 'disconnect') {
      const { error } = await db.rpc('delete_payment_provider_credentials', { target_store_id: storeId });
      if (error) throw error;
      await db.from('audit_logs').insert({ actor_id: actor.id, store_id: storeId, action: 'payment_credentials_removed' });
      return json(await safeConfig(db, storeId));
    }

    if (action !== 'save') return json({ error: 'Ação desconhecida.' }, 400);
    const accessToken = String(body.accessToken || '').trim();
    const publicKey = String(body.publicKey || '').trim();
    const webhookSecret = String(body.webhookSecret || '').trim();
    if (!/^(APP_USR|TEST)-/i.test(accessToken)) return json({ error: 'Access Token do Mercado Pago inválido.' }, 400);
    if (publicKey && !/^(APP_USR|TEST)-/i.test(publicKey)) return json({ error: 'Public Key do Mercado Pago inválida.' }, 400);

    const accountResponse = await fetch('https://api.mercadopago.com/users/me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const account = await accountResponse.json().catch(() => ({}));
    if (!accountResponse.ok || !account?.id) {
      return json({ error: 'O Mercado Pago recusou o token. Copie novamente o Access Token da conta correta.' }, 400);
    }

    const liveMode = accessToken.startsWith('APP_USR-');
    const { error } = await db.rpc('save_mercadopago_credentials', {
      target_store_id: storeId,
      p_access_token: accessToken,
      p_public_key: publicKey,
      p_webhook_secret: webhookSecret || null,
      p_account_id: String(account.id),
      p_account_email: String(account.email || ''),
      p_live_mode: liveMode,
      p_enabled: body.enabled !== false
    });
    if (error) throw error;
    await db.from('audit_logs').insert({
      actor_id: actor.id,
      store_id: storeId,
      action: 'payment_credentials_updated',
      details: { provider: 'mercadopago', accountId: String(account.id), liveMode }
    });
    return json(await safeConfig(db, storeId));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao salvar o pagamento.';
    return json({ error: message }, /Sessão|Somente/i.test(message) ? 403 : 400);
  }
});
