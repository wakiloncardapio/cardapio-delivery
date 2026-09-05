const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Upload-Folder, X-Store-Id',
  'Access-Control-Max-Age': '86400'
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function supabaseRequest(env, token, path, init = {}) {
  const url = `${String(env.SUPABASE_URL || '').replace(/\/+$/, '')}${path}`;
  const publicKey = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY;
  return fetch(url, {
    ...init,
    headers: {
      apikey: publicKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
}

async function authorizeStore(env, token, storeId) {
  const userResponse = await supabaseRequest(env, token, '/auth/v1/user');
  if (!userResponse.ok) return { ok: false, status: 401, error: 'Sua sessão expirou. Entre novamente no painel.' };
  const user = await userResponse.json();

  const adminResponse = await supabaseRequest(env, token, '/rest/v1/rpc/is_platform_admin', {
    method: 'POST',
    body: '{}'
  });
  const isPlatformAdmin = adminResponse.ok && await adminResponse.json() === true;

  let authorized = isPlatformAdmin;
  if (!authorized) {
    const params = new URLSearchParams({
      select: 'role',
      store_id: `eq.${storeId}`,
      user_id: `eq.${user.id}`,
      active: 'eq.true',
      limit: '1'
    });
    const memberResponse = await supabaseRequest(env, token, `/rest/v1/store_members?${params}`);
    if (memberResponse.ok) authorized = (await memberResponse.json()).length === 1;
  }
  if (!authorized) return { ok: false, status: 403, error: 'Você não possui acesso a esta empresa.' };

  const storeParams = new URLSearchParams({ select: 'id,status', id: `eq.${storeId}`, limit: '1' });
  const storeResponse = await supabaseRequest(env, token, `/rest/v1/stores?${storeParams}`);
  const stores = storeResponse.ok ? await storeResponse.json() : [];
  if (!stores.length || stores[0].status !== 'active') {
    return { ok: false, status: 403, error: 'Esta empresa não está ativa.' };
  }
  return { ok: true, userId: user.id };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/') {
      return json({ ok: true, service: 'Seu Food R2 Upload', multiTenant: true });
    }
    if (request.method !== 'POST' || url.pathname !== '/upload') {
      return json({ error: 'Rota não encontrada.' }, 404);
    }
    const publicKey = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY;
    if (!env.IMAGES || !env.SUPABASE_URL || !publicKey || !env.R2_PUBLIC_URL) {
      return json({ error: 'Worker incompleto. Confira o binding e as variáveis.' }, 503);
    }

    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const storeId = String(request.headers.get('X-Store-Id') || '').trim();
    if (!token) return json({ error: 'Sessão administrativa obrigatória.' }, 401);
    if (!uuidPattern.test(storeId)) return json({ error: 'Empresa não informada no upload.' }, 400);

    const access = await authorizeStore(env, token, storeId);
    if (!access.ok) return json({ error: access.error }, access.status);

    const contentType = String(request.headers.get('Content-Type') || '').toLowerCase();
    if (contentType !== 'image/webp') return json({ error: 'Envie uma imagem WebP.' }, 415);
    const declaredSize = Number(request.headers.get('Content-Length') || 0);
    if (declaredSize > 5 * 1024 * 1024) return json({ error: 'A imagem deve ter no máximo 5 MB.' }, 413);

    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > 5 * 1024 * 1024) {
      return json({ error: 'A imagem deve ter entre 1 byte e 5 MB.' }, 413);
    }
    const folder = String(request.headers.get('X-Upload-Folder') || 'geral')
      .toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40) || 'geral';
    const key = `${storeId}/${folder}/${crypto.randomUUID()}.webp`;
    await env.IMAGES.put(key, bytes, {
      httpMetadata: { contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' },
      customMetadata: { storeId, uploadedBy: access.userId }
    });

    const publicBase = String(env.R2_PUBLIC_URL).replace(/\/+$/, '');
    return json({ url: `${publicBase}/${key}`, key, storeId }, 201);
  }
};
