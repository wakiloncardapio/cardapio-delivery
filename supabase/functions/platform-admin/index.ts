import { createClient } from 'npm:@supabase/supabase-js@2';

const DEMO_STORE_ID = '00000000-0000-0000-0000-000000000001';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'Content-Type': 'application/json' }
});

const cleanEmail = (value: unknown) => String(value || '').trim().toLowerCase();
const cleanSlug = (value: unknown) => String(value || '').trim().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const cleanHostname = (value: unknown) => String(value || '').trim().toLowerCase()
  .replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');

function starterCatalogData(row: any, storeName: string) {
  const data = JSON.parse(JSON.stringify(row?.data || (row?.id === 'settings' ? {} : [])));
  if (row?.id !== 'settings') return data;
  return {
    ...data,
    storeName,
    establishmentName: storeName,
    seoTitle: `${storeName} | Cardápio on-line`,
    logoUrl: '',
    faviconUrl: '',
    platformLogoUrl: '',
    locationName: 'Sua cidade - UF',
    city: '',
    address: '',
    whatsapp: '',
    contactPhone: '',
    orderEmail: '',
    publicEmail: '',
    cnpj: '',
    pixKey: '',
    paymentLink: '',
    metaPixelId: '',
    gtmId: '',
    ga4Id: '',
    whatsappCloudEnabled: false,
    gatewayEnabled: false,
    gatewayProvider: 'none',
    orderRedirectEnabled: false,
    orderRedirectUrl: ''
  };
}

async function authenticate(db: any, req: Request) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new Error('Sessão administrativa inválida.');
  const { data: platformAdmin } = await db.from('platform_admins')
    .select('user_id').eq('user_id', data.user.id).maybeSingle();
  if (!platformAdmin) throw new Error('Acesso permitido somente ao administrador central do Seu Food.');
  return data.user;
}

async function listAllUsers(db: any) {
  const users: any[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const batch = data?.users || [];
    users.push(...batch);
    if (batch.length < 1000) break;
  }
  return users;
}

async function ensureUser(db: any, email: string, redirectTo: string) {
  const users = await listAllUsers(db);
  const existing = users.find(user => cleanEmail(user.email) === email);
  if (existing) return { user: existing, invitationLink: '' };
  const { data, error } = await db.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { redirectTo }
  });
  if (error || !data?.user) throw error || new Error('Não foi possível criar o convite.');
  return { user: data.user, invitationLink: data.properties?.action_link || '' };
}

async function audit(db: any, actorId: string, storeId: string | null, action: string, details: Record<string, unknown> = {}) {
  await db.from('audit_logs').insert({ actor_id: actorId, store_id: storeId, action, details });
}

async function listPlatform(db: any) {
  const [{ data: stores, error: storesError }, { data: members, error: membersError }, { data: domains, error: domainsError }, { data: settings, error: settingsError }, users] = await Promise.all([
    db.from('stores').select('*').order('is_demo', { ascending: false }).order('created_at', { ascending: true }),
    db.from('store_members').select('store_id,user_id,role,active,created_at,updated_at'),
    db.from('store_domains').select('id,store_id,hostname,kind,status,is_primary,created_at,updated_at').order('created_at'),
    db.from('catalogs').select('store_id,data').eq('id', 'settings'),
    listAllUsers(db)
  ]);
  if (storesError) throw storesError;
  if (membersError) throw membersError;
  if (domainsError) throw domainsError;
  if (settingsError) throw settingsError;
  const emails = Object.fromEntries(users.map(user => [user.id, user.email || '']));
  const logos = Object.fromEntries((settings || []).map((row: any) => [row.store_id, String(row.data?.logoUrl || '')]));
  const demoSettings = (settings || []).find((row: any) => row.store_id === DEMO_STORE_ID)?.data || {};
  const [summaryResult, attemptsResult, paymentsResult] = await Promise.all([
    db.rpc('platform_commerce_summary'),
    db.from('payment_attempts').select('store_id,order_id,order_number,payment_method,status,amount,reason_code,reason_message,occurred_at').order('occurred_at', { ascending: false }).limit(500),
    db.from('payment_provider_configs').select('store_id,provider,enabled,account_email,live_mode,apple_pay_status,updated_at')
  ]);
  const missingTable = (error: any, name: string) => error && new RegExp(`${name}|schema cache|does not exist`, 'i').test(error.message || '');
  if (summaryResult.error && !missingTable(summaryResult.error, 'platform_commerce_summary')) throw summaryResult.error;
  if (attemptsResult.error && !missingTable(attemptsResult.error, 'payment_attempts')) throw attemptsResult.error;
  if (paymentsResult.error && !missingTable(paymentsResult.error, 'payment_provider_configs')) throw paymentsResult.error;
  const summary = summaryResult.error ? [] : (summaryResult.data || []);
  const attempts = attemptsResult.error ? [] : (attemptsResult.data || []);
  const paymentConfigs = paymentsResult.error ? [] : (paymentsResult.data || []);
  const byStore = (stores || []).map((store: any) => {
    const storeSummary = summary.find((item: any) => item.store_id === store.id) || {};
    const payment = paymentConfigs.find((config: any) => config.store_id === store.id) || null;
    return {
      store_id: store.id,
      orders: Number(storeSummary.orders || 0),
      paid_orders: Number(storeSummary.paid_orders || 0),
      revenue: Number(storeSummary.revenue || 0),
      customers: Number(storeSummary.customers || 0),
      begin_checkout: Number(storeSummary.begin_checkout || 0),
      payment_failures: Number(storeSummary.payment_failures || 0),
      payment: payment ? {
        connected: true,
        enabled: payment.enabled === true,
        account_email: payment.account_email || '',
        live_mode: payment.live_mode === true,
        apple_pay_status: payment.apple_pay_status || 'provider_required',
        updated_at: payment.updated_at
      } : { connected: false, enabled: false, apple_pay_status: 'provider_required' }
    };
  });
  const failures = attempts.filter((attempt: any) => ['rejected','error'].includes(attempt.status)).slice(0, 100);
  return {
    stores: (stores || []).map((store: any) => ({ ...store, logo_url: logos[store.id] || '' })),
    members: (members || []).map((member: any) => ({ ...member, email: emails[member.user_id] || '' })),
    domains: domains || [],
    branding: { logo_url: String(demoSettings.platformLogoUrl || '') },
    commerce: {
      by_store: byStore,
      failures,
      totals: {
        revenue: byStore.reduce((sum: number, item: any) => sum + Number(item.revenue || 0), 0),
        orders: byStore.reduce((sum: number, item: any) => sum + Number(item.orders || 0), 0),
        customers: byStore.reduce((sum: number, item: any) => sum + Number(item.customers || 0), 0),
        failures: byStore.reduce((sum: number, item: any) => sum + Number(item.payment_failures || 0), 0)
      }
    }
  };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const platformUrl = String(Deno.env.get('PLATFORM_URL') || req.headers.get('origin') || '').replace(/\/+$/, '');
  if (!supabaseUrl || !serviceKey) return json({ error: 'Supabase incompleto.' }, 503);
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const actor = await authenticate(db, req);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'list');
    const inviteRedirect = `${platformUrl}/sistema/convite/`;

    if (action === 'list') return json(await listPlatform(db));

    if (action === 'update_platform_branding') {
      const logoUrl = String(body.logoUrl || '').trim();
      if (logoUrl && !/^https:\/\//i.test(logoUrl)) return json({ error: 'A URL da logo precisa começar com https://.' }, 400);
      const { data: settingsRow, error: settingsReadError } = await db.from('catalogs')
        .select('data').eq('store_id', DEMO_STORE_ID).eq('id', 'settings').single();
      if (settingsReadError) throw settingsReadError;
      const { error: updateError } = await db.from('catalogs').update({
        data: { ...(settingsRow?.data || {}), platformLogoUrl: logoUrl },
        updated_at: new Date().toISOString()
      }).eq('store_id', DEMO_STORE_ID).eq('id', 'settings');
      if (updateError) throw updateError;
      await audit(db, actor.id, null, logoUrl ? 'platform_logo_updated' : 'platform_logo_removed');
      return json({ platform: await listPlatform(db) });
    }

    if (action === 'create_store') {
      const name = String(body.name || '').trim();
      const slug = cleanSlug(body.slug || name);
      const ownerEmail = cleanEmail(body.ownerEmail);
      if (name.length < 2) return json({ error: 'Informe o nome da empresa.' }, 400);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return json({ error: 'O endereço da empresa é inválido.' }, 400);
      if (ownerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) return json({ error: 'O e-mail do responsável é inválido.' }, 400);

      let owner: any = null;
      let invitationLink = '';
      if (ownerEmail) {
        const ensured = await ensureUser(db, ownerEmail, inviteRedirect);
        owner = ensured.user;
        invitationLink = ensured.invitationLink;
      }
      const { data: store, error: storeError } = await db.from('stores').insert({
        name,
        slug,
        status: 'active',
        storefront_enabled: true,
        is_demo: false,
        plan_name: null,
        access_expires_at: null,
        max_products: null,
        max_orders_month: null,
        max_storage_mb: null
      }).select('*').single();
      if (storeError) throw storeError;

      const { data: demoCatalog, error: catalogError } = await db.from('catalogs')
        .select('id,data').eq('store_id', DEMO_STORE_ID);
      if (catalogError) throw catalogError;
      const now = new Date().toISOString();
      if ((demoCatalog || []).length) {
        const { error } = await db.from('catalogs').insert((demoCatalog || []).map((row: any) => ({
          store_id: store.id,
          id: row.id,
          data: starterCatalogData(row, name),
          updated_at: now
        })));
        if (error) throw error;
      }
      const { error: privateSettingsError } = await db.from('private_settings').insert({
        store_id: store.id,
        id: 'integrations',
        data: { makeWebhookEnabled: false, makeWebhookUrl: '', driverDeliveryEnabled: false, driverName: '', driverWhatsapp: '' },
        updated_at: now
      });
      if (privateSettingsError) throw privateSettingsError;
      if (owner) {
        const { error } = await db.from('store_members').upsert({
          store_id: store.id,
          user_id: owner.id,
          role: 'owner',
          active: true
        }, { onConflict: 'store_id,user_id' });
        if (error) throw error;
      }
      await audit(db, actor.id, store.id, 'store_created', { name, slug, ownerEmail });
      return json({ store, invitationLink, platform: await listPlatform(db) }, 201);
    }

    if (action === 'update_store') {
      const storeId = String(body.storeId || '');
      const patch: Record<string, unknown> = {};
      const logoUrl = body.logoUrl === undefined ? undefined : String(body.logoUrl || '').trim();
      if (logoUrl && !/^https:\/\//i.test(logoUrl)) return json({ error: 'A URL da logo precisa começar com https://.' }, 400);
      if (body.name !== undefined) patch.name = String(body.name || '').trim();
      if (body.slug !== undefined) patch.slug = cleanSlug(body.slug);
      if (body.status !== undefined) patch.status = String(body.status);
      if (body.storefrontEnabled !== undefined) patch.storefront_enabled = Boolean(body.storefrontEnabled);
      ['planName', 'accessExpiresAt', 'maxProducts', 'maxOrdersMonth', 'maxStorageMb'].forEach(key => {
        if (body[key] === undefined) return;
        const column = ({ planName: 'plan_name', accessExpiresAt: 'access_expires_at', maxProducts: 'max_products', maxOrdersMonth: 'max_orders_month', maxStorageMb: 'max_storage_mb' } as Record<string, string>)[key];
        const value = body[key];
        patch[column] = value === '' || value === null ? null : (key.startsWith('max') ? Math.max(0, Number(value) || 0) : value);
      });
      let store: any = null;
      if (Object.keys(patch).length) {
        const result = await db.from('stores').update(patch).eq('id', storeId).select('*').single();
        if (result.error) throw result.error;
        store = result.data;
      } else {
        const result = await db.from('stores').select('*').eq('id', storeId).single();
        if (result.error) throw result.error;
        store = result.data;
      }
      if (logoUrl !== undefined) {
        const { data: settingsRow, error: settingsReadError } = await db.from('catalogs')
          .select('data').eq('store_id', storeId).eq('id', 'settings').single();
        if (settingsReadError) throw settingsReadError;
        const { error: logoError } = await db.from('catalogs').update({
          data: { ...(settingsRow?.data || {}), logoUrl },
          updated_at: new Date().toISOString()
        }).eq('store_id', storeId).eq('id', 'settings');
        if (logoError) throw logoError;
      }
      await audit(db, actor.id, storeId, 'store_updated', { fields: [...Object.keys(patch), ...(logoUrl !== undefined ? ['logoUrl'] : [])] });
      return json({ store, platform: await listPlatform(db) });
    }

    if (action === 'set_member') {
      const storeId = String(body.storeId || '');
      const email = cleanEmail(body.email);
      const role = ['owner', 'manager', 'staff'].includes(body.role) ? body.role : 'owner';
      if (!email) return json({ error: 'Informe o e-mail da pessoa.' }, 400);
      const ensured = await ensureUser(db, email, inviteRedirect);
      const { error } = await db.from('store_members').upsert({
        store_id: storeId,
        user_id: ensured.user.id,
        role,
        active: body.active !== false
      }, { onConflict: 'store_id,user_id' });
      if (error) throw error;
      await audit(db, actor.id, storeId, 'member_access_changed', { email, role, active: body.active !== false });
      return json({ invitationLink: ensured.invitationLink, platform: await listPlatform(db) });
    }

    if (action === 'set_member_active') {
      const storeId = String(body.storeId || '');
      const userId = String(body.userId || '');
      const active = Boolean(body.active);
      const { error } = await db.from('store_members').update({ active }).eq('store_id', storeId).eq('user_id', userId);
      if (error) throw error;
      await audit(db, actor.id, storeId, active ? 'member_access_enabled' : 'member_access_disabled', { userId });
      return json({ platform: await listPlatform(db) });
    }

    if (action === 'save_domain') {
      const storeId = String(body.storeId || '');
      const hostname = cleanHostname(body.hostname);
      if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname)) {
        return json({ error: 'Informe um domínio válido, sem https:// ou caminhos.' }, 400);
      }
      const row = {
        store_id: storeId,
        hostname,
        kind: body.kind === 'subdomain' ? 'subdomain' : 'custom',
        status: 'pending',
        is_primary: Boolean(body.isPrimary)
      };
      if (row.is_primary) await db.from('store_domains').update({ is_primary: false }).eq('store_id', storeId);
      const { error } = await db.from('store_domains').upsert(row, { onConflict: 'hostname' });
      if (error) throw error;
      await audit(db, actor.id, storeId, 'domain_saved', { hostname, kind: row.kind });
      return json({ platform: await listPlatform(db) });
    }

    if (action === 'delete_domain') {
      const domainId = String(body.domainId || '');
      const { data: domain } = await db.from('store_domains').select('store_id,hostname').eq('id', domainId).maybeSingle();
      const { error } = await db.from('store_domains').delete().eq('id', domainId);
      if (error) throw error;
      await audit(db, actor.id, domain?.store_id || null, 'domain_deleted', { hostname: domain?.hostname || '' });
      return json({ platform: await listPlatform(db) });
    }

    return json({ error: 'Ação desconhecida.' }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha no painel central.';
    const status = /Sessão|administrador central/i.test(message) ? 403 : 400;
    return json({ error: message }, status);
  }
});
