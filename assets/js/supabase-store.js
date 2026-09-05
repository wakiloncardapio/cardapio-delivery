(function () {
  const config = window.CARDAPIO_SUPABASE_CONFIG || {};
  const configured = /^https:\/\/.+\.supabase\.co$/i.test(config.url || '') &&
    typeof config.anonKey === 'string' && config.anonKey.length > 40 &&
    !config.anonKey.includes('COLE_AQUI');
  const DEMO_STORE_ID = '00000000-0000-0000-0000-000000000001';
  const DEMO_STORE = { id: DEMO_STORE_ID, name: 'Seu Delivery - Demonstração', slug: 'demonstracao', is_demo: true };
  let client = null;
  let currentStore = null;

  function getClient() {
    if (!configured) return null;
    if (!window.supabase?.createClient) throw new Error('Biblioteca do Supabase não carregada.');
    if (!client) {
      client = window.supabase.createClient(config.url, config.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
    }
    return client;
  }

  function throwIfError(error, fallback) {
    if (error) throw new Error(error.message || fallback);
  }

  function isLegacySchemaError(error) {
    return Boolean(error && (
      ['42P01', '42703', 'PGRST202', 'PGRST204'].includes(error.code) ||
      /store_id|stores|resolve_public_store|schema cache|does not exist/i.test(error.message || '')
    ));
  }

  function requestedStore() {
    const params = new URLSearchParams(window.location.search);
    const explicit = String(params.get('loja') || params.get('store') || '').trim().toLowerCase();
    if (explicit) return { slug: explicit, hostname: '' };
    const hostname = String(window.location.hostname || '').toLowerCase();
    const ownDomain = /(^|\.)seufood\.com(?:\.br)?$/.test(hostname);
    if (ownDomain) {
      const labels = hostname.split('.');
      const subdomain = labels.length > 2 ? labels[0] : '';
      if (subdomain && !['www', 'app', 'admin', 'painel'].includes(subdomain)) return { slug: subdomain, hostname };
      const pathSlug = window.location.pathname.split('/').filter(Boolean)[0] || 'demonstracao';
      return { slug: pathSlug.toLowerCase(), hostname };
    }
    const customHostname = hostname &&
      !hostname.endsWith('.github.io') &&
      !hostname.endsWith('.workers.dev') &&
      !['localhost', '127.0.0.1'].includes(hostname);
    return customHostname ? { slug: '', hostname } : { slug: 'demonstracao', hostname: '' };
  }

  function setCurrentStore(store) {
    currentStore = store ? { ...store } : null;
    window.CARDAPIO_STORE = currentStore;
    return currentStore;
  }

  async function resolveStore(force = false) {
    if (currentStore && !force) return currentStore;
    const db = getClient();
    if (!db) return setCurrentStore({ ...DEMO_STORE, legacy: true });
    const requested = requestedStore();
    const { data, error } = await db.rpc('resolve_public_store', {
      requested_slug: requested.slug || null,
      requested_hostname: requested.hostname || null
    }).maybeSingle();
    if (error && isLegacySchemaError(error)) return setCurrentStore({ ...DEMO_STORE, legacy: true });
    throwIfError(error, 'Não foi possível identificar esta empresa.');
    if (!data) throw new Error('Este cardápio não existe ou está temporariamente indisponível.');
    return setCurrentStore(data);
  }

  async function isPlatformAdmin() {
    const db = getClient();
    if (!db) return false;
    const { data, error } = await db.rpc('is_platform_admin');
    if (error && isLegacySchemaError(error)) return false;
    throwIfError(error, 'Não foi possível verificar o acesso central.');
    return data === true;
  }

  async function getAccessibleStores() {
    const db = getClient();
    if (!db) return [];
    const { data: sessionData } = await db.auth.getSession();
    const userId = sessionData?.session?.user?.id;
    if (!userId) return [];
    if (await isPlatformAdmin()) {
      const { data, error } = await db.from('stores')
        .select('id,name,slug,status,storefront_enabled,is_demo')
        .order('is_demo', { ascending: false })
        .order('created_at', { ascending: true });
      if (error && isLegacySchemaError(error)) return [{ ...DEMO_STORE, status: 'active', storefront_enabled: true, role: 'owner', legacy: true }];
      throwIfError(error, 'Não foi possível carregar as empresas.');
      return (data || []).map(store => ({ ...store, role: 'platform_admin' }));
    }
    const { data, error } = await db.from('store_members')
      .select('role,active,store:stores(id,name,slug,status,storefront_enabled,is_demo)')
      .eq('user_id', userId)
      .eq('active', true);
    if (error && isLegacySchemaError(error)) return [{ ...DEMO_STORE, status: 'active', storefront_enabled: true, role: 'owner', legacy: true }];
    throwIfError(error, 'Não foi possível carregar as empresas permitidas.');
    return (data || []).filter(item => item.store).map(item => ({ ...item.store, role: item.role }));
  }

  function chooseStore(store) {
    if (!store?.id) throw new Error('Empresa inválida.');
    return setCurrentStore(store);
  }

  function requireStore() {
    if (!currentStore?.id) throw new Error('Selecione uma empresa antes de continuar.');
    return currentStore;
  }

  async function loadCatalog() {
    const db = getClient();
    if (!db) return null;
    const store = await resolveStore();
    let query = db
      .from('catalogs')
      .select('id,data')
      .in('id', ['settings', 'categories', 'products']);
    if (!store.legacy) query = query.eq('store_id', store.id);
    const { data, error } = await query;
    throwIfError(error, 'Não foi possível carregar o cardápio.');
    const rows = Object.fromEntries((data || []).map(row => [row.id, row.data]));
    if (!rows.settings || !rows.categories || !rows.products) return null;
    return { settings: rows.settings, categories: rows.categories, products: rows.products };
  }

  async function saveCatalog(catalog) {
    const db = getClient();
    if (!db) throw new Error('Configure o Supabase antes de publicar.');
    const store = requireStore();
    const updatedAt = new Date().toISOString();
    let rows = [
      { id: 'settings', data: catalog.settings, updated_at: updatedAt },
      { id: 'categories', data: catalog.categories, updated_at: updatedAt },
      { id: 'products', data: catalog.products, updated_at: updatedAt }
    ];
    if (!store.legacy) rows = rows.map(row => ({ ...row, store_id: store.id }));
    const { error } = await db.from('catalogs').upsert(rows, { onConflict: store.legacy ? 'id' : 'store_id,id' });
    throwIfError(error, 'Não foi possível publicar as alterações.');
  }

  async function loadPrivateSettings() {
    const db = getClient();
    if (!db) return { makeWebhookEnabled: false, makeWebhookUrl: '', driverDeliveryEnabled: false, driverName: '', driverWhatsapp: '', available: false };
    const store = requireStore();
    let query = db
      .from('private_settings')
      .select('data')
      .eq('id', 'integrations');
    if (!store.legacy) query = query.eq('store_id', store.id);
    const { data, error } = await query.maybeSingle();
    if (error) {
      if (error.code === '42P01' || /private_settings|schema cache/i.test(error.message || '')) {
        return { makeWebhookEnabled: false, makeWebhookUrl: '', driverDeliveryEnabled: false, driverName: '', driverWhatsapp: '', available: false };
      }
      throwIfError(error, 'Não foi possível carregar as integrações privadas.');
    }
    return { makeWebhookEnabled: false, makeWebhookUrl: '', ...(data?.data || {}), available: true };
  }

  async function savePrivateSettings(settings) {
    const db = getClient();
    if (!db) throw new Error('Configure o Supabase antes de salvar integrações.');
    const store = requireStore();
    const makeWebhookEnabled = Boolean(settings.makeWebhookEnabled);
    const makeWebhookUrl = String(settings.makeWebhookUrl || '').trim();
    const driverDeliveryEnabled = Boolean(settings.driverDeliveryEnabled);
    const driverName = String(settings.driverName || '').trim();
    const driverWhatsapp = String(settings.driverWhatsapp || '').replace(/\D/g, '');
    if (driverDeliveryEnabled && driverWhatsapp.length < 10) {
      throw new Error('Informe um WhatsApp válido do motoboy antes de ativar o envio.');
    }
    if (makeWebhookEnabled && !makeWebhookUrl) {
      throw new Error('Cole a URL do webhook do Make antes de ativar a automação.');
    }
    if (makeWebhookUrl) {
      let parsed;
      try { parsed = new URL(makeWebhookUrl); } catch (error) { throw new Error('A URL do webhook do Make é inválida.'); }
      const allowedHost = parsed.hostname === 'hook.make.com' || parsed.hostname.endsWith('.make.com');
      if (parsed.protocol !== 'https:' || !allowedHost || parsed.username || parsed.password) {
        throw new Error('Use uma URL HTTPS oficial do Make (hook.make.com ou subdomínio .make.com).');
      }
    }
    const row = {
      id: 'integrations',
      data: {
        makeWebhookEnabled,
        makeWebhookUrl,
        driverDeliveryEnabled,
        driverName,
        driverWhatsapp
      },
      updated_at: new Date().toISOString()
    };
    if (!store.legacy) row.store_id = store.id;
    const { error } = await db.from('private_settings').upsert(row, { onConflict: store.legacy ? 'id' : 'store_id,id' });
    if (error && (error.code === '42P01' || /private_settings|schema cache/i.test(error.message || ''))) {
      throw new Error('Execute database/migrations/003_make_order_automation.sql no Supabase antes de salvar o webhook.');
    }
    throwIfError(error, 'Não foi possível salvar o webhook do Make.');
    return { ...row.data, available: true };
  }

  async function createOrder(payload, orderNumber) {
    const db = getClient();
    if (!db) return false;
    const store = await resolveStore();
    const row = {
      id: crypto.randomUUID(),
      order_number: orderNumber,
      customer: payload.customer,
      fulfillment: payload.fulfillment,
      address: payload.address,
      payment_method: payload.paymentMethod,
      change_for: payload.changeFor || '',
      notes: payload.notes || '',
      items: payload.items,
      subtotal: Number(payload.subtotal || 0),
      delivery_fee: Number(payload.deliveryFee || 0),
      total: Number(payload.total || 0),
      status: 'novo',
      payment_status: 'pendente'
    };
    if (!store.legacy) row.store_id = store.id;
    const { error } = await db.from('orders').insert(row);
    throwIfError(error, 'Não foi possível registrar o pedido.');
    return { id: row.id, order_number: row.order_number };
  }

  async function notifyOrder(orderId) {
    const db = getClient();
    if (!db) throw new Error('Supabase não configurado.');
    const { data, error } = await db.functions.invoke('whatsapp-order', { body: { orderId, storeId: currentStore?.id || '' } });
    throwIfError(error, 'O pedido foi salvo, mas o WhatsApp automático não foi enviado.');
    return data || {};
  }

  function readCookie(name) {
    const prefix = `${encodeURIComponent(name)}=`;
    const cookie = document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith(prefix));
    return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : '';
  }

  async function notifyMetaPurchase(orderId, eventId) {
    const db = getClient();
    if (!db) throw new Error('Supabase não configurado.');
    const { data, error } = await db.functions.invoke('meta-conversions', {
      body: {
        orderId,
        eventId,
        storeId: currentStore?.id || '',
        sourceUrl: window.location.href,
        fbp: readCookie('_fbp'),
        fbc: readCookie('_fbc')
      }
    });
    throwIfError(error, 'O pedido foi salvo, mas a compra não foi enviada à Meta.');
    return data || {};
  }

  async function confirmOrderConversion(orderId, eventId, forceRetry = false) {
    const db = getClient();
    if (!db) throw new Error('Supabase não configurado.');
    const { data, error } = await db.functions.invoke('confirmed-conversions', {
      body: { orderId, eventId, storeId: currentStore?.id || '', forceRetry, sourceUrl: window.location.href }
    });
    throwIfError(error, 'O pedido foi confirmado, mas a conversão não pôde ser enviada.');
    return data || {};
  }

  async function listConversionEvents() {
    const db = getClient();
    if (!db) return [];
    const store = requireStore();
    let query = db
      .from('order_webhook_events')
      .select('order_id,event_type,status,error_message,response_status,updated_at')
      .in('event_type', ['ga4.purchase', 'meta.purchase'])
      .order('updated_at', { ascending: false })
      .limit(2000);
    if (!store.legacy) query = query.eq('store_id', store.id);
    const { data, error } = await query;
    if (error && (error.code === '42P01' || /order_webhook_events|schema cache/i.test(error.message || ''))) return [];
    throwIfError(error, 'Não foi possível consultar o histórico das conversões.');
    return data || [];
  }

  async function notifyOrderEmail(orderId, event = 'created') {
    const db = getClient();
    if (!db) throw new Error('Supabase não configurado.');
    const { data, error } = await db.functions.invoke('order-email', { body: { orderId, event, storeId: currentStore?.id || '' } });
    throwIfError(error, 'O pedido foi salvo, mas o e-mail automático não pôde ser solicitado.');
    return data || {};
  }

  async function testMakeWebhook() {
    const db = getClient();
    if (!db) throw new Error('Supabase não configurado.');
    const { data, error } = await db.functions.invoke('order-email', { body: { event: 'test', storeId: currentStore?.id || '' } });
    throwIfError(error, 'Não foi possível testar o webhook do Make.');
    return data || {};
  }

  async function createCheckout(orderId, paymentMode = 'card') {
    const db = getClient();
    if (!db) throw new Error('Supabase não configurado.');
    const { data, error } = await db.functions.invoke('create-checkout', {
      body: { orderId, paymentMode, storeId: currentStore?.id || '', returnUrl: window.location.href }
    });
    if (error) {
      let message = error.message || 'O pedido foi salvo, mas o checkout não pôde ser criado.';
      try {
        const detail = await error.context?.clone?.().json();
        if (detail?.error) message = detail.error;
      } catch (contextError) {
        console.warn('Não foi possível ler os detalhes do erro do checkout.', contextError);
      }
      throw new Error(message);
    }
    return data || {};
  }

  async function getPaymentStatus(orderId, orderNumber) {
    const db = getClient();
    if (!db) throw new Error('Supabase não configurado.');
    const { data, error } = await db.functions.invoke('payment-status', { body: { orderId, orderNumber, storeId: currentStore?.id || '' } });
    throwIfError(error, 'Não foi possível consultar o pagamento.');
    return data || {};
  }

  async function listOrders() {
    const db = getClient();
    if (!db) return [];
    const store = requireStore();
    let query = db
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1000);
    if (!store.legacy) query = query.eq('store_id', store.id);
    const { data, error } = await query;
    throwIfError(error, 'Não foi possível carregar os pedidos.');
    return (data || []).filter(order => {
      const mercadoPago = ['mercadopago_pix', 'mercadopago_card'].includes(order.payment_method);
      return !mercadoPago || order.payment_status === 'pago';
    });
  }

  async function updateOrder(id, status, paymentStatus, emailEvents = []) {
    const db = getClient();
    const store = requireStore();
    let query = db
      .from('orders')
      .update({ status, payment_status: paymentStatus, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (!store.legacy) query = query.eq('store_id', store.id);
    const { error } = await query;
    throwIfError(error, 'Não foi possível atualizar o pedido.');
    const notifications = [];
    for (const event of [...new Set(emailEvents)]) {
      try {
        notifications.push({ event, ok: true, result: await notifyOrderEmail(id, event) });
      } catch (notificationError) {
        notifications.push({ event, ok: false, error: notificationError.message });
      }
    }
    return { notifications };
  }

  async function deleteOrders(ids) {
    const db = getClient();
    if (!db) throw new Error('Supabase não configurado.');
    const store = requireStore();
    const targets = [...new Set((ids || []).map(String).filter(Boolean))].slice(0, 1000);
    if (!targets.length) return;
    let query = db.from('orders').delete().in('id', targets);
    if (!store.legacy) query = query.eq('store_id', store.id);
    const { error } = await query;
    if (error && /permission|policy|denied/i.test(error.message || '')) {
      throw new Error('Execute a migração 003 no Supabase para liberar a exclusão segura de pedidos.');
    }
    throwIfError(error, 'Não foi possível excluir o pedido.');
  }

  async function deleteOrder(id) {
    return deleteOrders([id]);
  }

  async function optimizeImage(file) {
    let source;
    try {
      source = await createImageBitmap(file);
    } catch (error) {
      source = await new Promise((resolve, reject) => {
        const image = new Image();
        const objectUrl = URL.createObjectURL(file);
        image.onload = () => { URL.revokeObjectURL(objectUrl); resolve(image); };
        image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Não foi possível ler esta imagem.')); };
        image.src = objectUrl;
      });
    }
    const width = source.width || source.naturalWidth;
    const height = source.height || source.naturalHeight;
    const maxSide = 1600;
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d', { alpha: true });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    source.close?.();
    const optimized = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.84));
    if (!optimized) throw new Error('Não foi possível otimizar a imagem.');
    return optimized;
  }

  async function uploadImage(file, folder = 'geral') {
    const db = getClient();
    if (!db) throw new Error('Configure o Supabase antes de enviar imagens.');
    if (!file?.type?.startsWith('image/')) throw new Error('Selecione uma imagem válida.');
    if (file.size > 12 * 1024 * 1024) throw new Error('A imagem original deve ter no máximo 12 MB.');
    const { data: sessionData } = await db.auth.getSession();
    if (!sessionData?.session) throw new Error('Sua sessão expirou. Entre novamente no painel.');
    const store = requireStore();
    const optimized = await optimizeImage(file);
    if (optimized.size > 5 * 1024 * 1024) throw new Error('A imagem ficou maior que 5 MB mesmo após a otimização.');
    const safeFolder = String(folder || 'geral').replace(/[^a-z0-9_-]/gi, '').toLowerCase();
    const workerUrl = String(window.CARDAPIO_R2_CONFIG?.workerUrl || '').replace(/\/+$/, '');
    if (!/^https:\/\//i.test(workerUrl)) throw new Error('Configure o Worker do Cloudflare R2 antes de enviar imagens.');

    const headers = {
      Authorization: `Bearer ${sessionData.session.access_token}`,
      'Content-Type': 'image/webp',
      'X-Upload-Folder': safeFolder || 'geral'
    };
    // O Worker antigo continua funcionando enquanto a migração multiempresa não foi ativada.
    if (!store.legacy) headers['X-Store-Id'] = store.id;
    let response;
    try {
      response = await fetch(`${workerUrl}/upload`, {
        method: 'POST',
        headers,
        body: optimized
      });
    } catch (_) {
      throw new Error('Não foi possível acessar o Worker do Cloudflare R2.');
    }

    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Falha ao enviar a imagem ao R2 (${response.status}).`);
    if (!/^https:\/\//i.test(result.url || '')) throw new Error('O Worker não devolveu a URL pública da imagem.');
    return result.url;
  }

  async function signIn(email, password) {
    const db = getClient();
    if (!db) throw new Error('Supabase ainda não configurado.');
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    throwIfError(error, 'E-mail ou senha incorretos.');
    return data.session;
  }

  async function getSession() {
    const db = getClient();
    if (!db) return null;
    const { data, error } = await db.auth.getSession();
    throwIfError(error, 'Não foi possível verificar o acesso.');
    return data.session;
  }

  async function signOut() {
    const db = getClient();
    if (db) await db.auth.signOut();
  }

  window.SupabaseStore = {
    configured,
    getClient,
    requestedStore,
    resolveStore,
    chooseStore,
    getCurrentStore: () => currentStore,
    getAccessibleStores,
    isPlatformAdmin,
    loadCatalog,
    saveCatalog,
    loadPrivateSettings,
    savePrivateSettings,
    createOrder,
    notifyOrder,
    notifyMetaPurchase,
    confirmOrderConversion,
    listConversionEvents,
    getPaymentStatus,
    notifyOrderEmail,
    testMakeWebhook,
    createCheckout,
    listOrders,
    updateOrder,
    deleteOrder,
    deleteOrders,
    uploadImage,
    signIn,
    getSession,
    signOut
  };
})();
