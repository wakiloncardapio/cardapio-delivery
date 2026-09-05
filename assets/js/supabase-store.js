(function () {
  const config = window.CARDAPIO_SUPABASE_CONFIG || {};
  const configured = /^https:\/\/.+\.supabase\.co$/i.test(config.url || '') &&
    typeof config.anonKey === 'string' && config.anonKey.length > 40 &&
    !config.anonKey.includes('COLE_AQUI');
  let client = null;

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

  async function loadCatalog() {
    const db = getClient();
    if (!db) return null;
    const { data, error } = await db
      .from('catalogs')
      .select('id,data')
      .in('id', ['settings', 'categories', 'products']);
    throwIfError(error, 'Não foi possível carregar o cardápio.');
    const rows = Object.fromEntries((data || []).map(row => [row.id, row.data]));
    if (!rows.settings || !rows.categories || !rows.products) return null;
    return { settings: rows.settings, categories: rows.categories, products: rows.products };
  }

  async function saveCatalog(catalog) {
    const db = getClient();
    if (!db) throw new Error('Configure o Supabase antes de publicar.');
    const updatedAt = new Date().toISOString();
    const rows = [
      { id: 'settings', data: catalog.settings, updated_at: updatedAt },
      { id: 'categories', data: catalog.categories, updated_at: updatedAt },
      { id: 'products', data: catalog.products, updated_at: updatedAt }
    ];
    const { error } = await db.from('catalogs').upsert(rows, { onConflict: 'id' });
    throwIfError(error, 'Não foi possível publicar as alterações.');
  }

  async function loadPrivateSettings() {
    const db = getClient();
    if (!db) return { makeWebhookEnabled: false, makeWebhookUrl: '', driverDeliveryEnabled: false, driverName: '', driverWhatsapp: '', available: false };
    const { data, error } = await db
      .from('private_settings')
      .select('data')
      .eq('id', 'integrations')
      .maybeSingle();
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
    const { error } = await db.from('private_settings').upsert(row, { onConflict: 'id' });
    if (error && (error.code === '42P01' || /private_settings|schema cache/i.test(error.message || ''))) {
      throw new Error('Execute database/migrations/003_make_order_automation.sql no Supabase antes de salvar o webhook.');
    }
    throwIfError(error, 'Não foi possível salvar o webhook do Make.');
    return { ...row.data, available: true };
  }

  async function createOrder(payload, orderNumber) {
    const db = getClient();
    if (!db) return false;
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
    const { error } = await db.from('orders').insert(row);
    throwIfError(error, 'Não foi possível registrar o pedido.');
    return { id: row.id, order_number: row.order_number };
  }

  async function notifyOrder(orderId) {
    const db = getClient();
    if (!db) throw new Error('Supabase não configurado.');
    const { data, error } = await db.functions.invoke('whatsapp-order', { body: { orderId } });
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
      body: { orderId, eventId, forceRetry, sourceUrl: window.location.href }
    });
    throwIfError(error, 'O pedido foi confirmado, mas a conversão não pôde ser enviada.');
    return data || {};
  }

  async function listConversionEvents() {
    const db = getClient();
    if (!db) return [];
    const { data, error } = await db
      .from('order_webhook_events')
      .select('order_id,event_type,status,error_message,response_status,updated_at')
      .in('event_type', ['ga4.purchase', 'meta.purchase'])
      .order('updated_at', { ascending: false })
      .limit(2000);
    if (error && (error.code === '42P01' || /order_webhook_events|schema cache/i.test(error.message || ''))) return [];
    throwIfError(error, 'Não foi possível consultar o histórico das conversões.');
    return data || [];
  }

  async function notifyOrderEmail(orderId, event = 'created') {
    const db = getClient();
    if (!db) throw new Error('Supabase não configurado.');
    const { data, error } = await db.functions.invoke('order-email', { body: { orderId, event } });
    throwIfError(error, 'O pedido foi salvo, mas o e-mail automático não pôde ser solicitado.');
    return data || {};
  }

  async function testMakeWebhook() {
    const db = getClient();
    if (!db) throw new Error('Supabase não configurado.');
    const { data, error } = await db.functions.invoke('order-email', { body: { event: 'test' } });
    throwIfError(error, 'Não foi possível testar o webhook do Make.');
    return data || {};
  }

  async function createCheckout(orderId, paymentMode = 'card') {
    const db = getClient();
    if (!db) throw new Error('Supabase não configurado.');
    const { data, error } = await db.functions.invoke('create-checkout', { body: { orderId, paymentMode } });
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
    const { data, error } = await db.functions.invoke('payment-status', { body: { orderId, orderNumber } });
    throwIfError(error, 'Não foi possível consultar o pagamento.');
    return data || {};
  }

  async function listOrders() {
    const db = getClient();
    if (!db) return [];
    const { data, error } = await db
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1000);
    throwIfError(error, 'Não foi possível carregar os pedidos.');
    return (data || []).filter(order => {
      const mercadoPago = ['mercadopago_pix', 'mercadopago_card'].includes(order.payment_method);
      return !mercadoPago || order.payment_status === 'pago';
    });
  }

  async function updateOrder(id, status, paymentStatus, emailEvents = []) {
    const db = getClient();
    const { error } = await db
      .from('orders')
      .update({ status, payment_status: paymentStatus, updated_at: new Date().toISOString() })
      .eq('id', id);
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
    const targets = [...new Set((ids || []).map(String).filter(Boolean))].slice(0, 1000);
    if (!targets.length) return;
    const { error } = await db.from('orders').delete().in('id', targets);
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
    const optimized = await optimizeImage(file);
    if (optimized.size > 5 * 1024 * 1024) throw new Error('A imagem ficou maior que 5 MB mesmo após a otimização.');
    const safeFolder = String(folder || 'geral').replace(/[^a-z0-9_-]/gi, '').toLowerCase();
    const workerUrl = String(window.CARDAPIO_R2_CONFIG?.workerUrl || '').replace(/\/+$/, '');
    if (!/^https:\/\//i.test(workerUrl)) throw new Error('Configure o Worker do Cloudflare R2 antes de enviar imagens.');

    let response;
    try {
      response = await fetch(`${workerUrl}/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionData.session.access_token}`,
          'Content-Type': 'image/webp',
          'X-Upload-Folder': safeFolder || 'geral'
        },
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
