(function () {
  const json = response => {
    if (!response.ok) throw new Error('Falha na comunicação');
    return response.json();
  };

  async function loadStaticCatalog() {
    const [settings, categories, products] = await Promise.all([
      fetch('data/config/store.json', { cache: 'no-store' }).then(json),
      fetch('data/categories/catalog.json', { cache: 'no-store' }).then(json),
      fetch('data/products/catalog.json', { cache: 'no-store' }).then(json)
    ]);
    return { settings, categories, products };
  }

  async function loadCatalog() {
    const requested = window.SupabaseStore?.requestedStore?.() || { slug: 'demonstracao', hostname: '' };
    const demonstration = requested.slug === 'demonstracao' && !requested.hostname;
    if (window.SupabaseStore?.configured) {
      try {
        const remote = await window.SupabaseStore.loadCatalog();
        if (remote) return remote;
      } catch (error) {
        if (!demonstration) throw error;
        console.warn('Supabase indisponível; usando catálogo publicado no GitHub.', error);
      }
    }
    if (!demonstration) throw new Error('O catálogo desta empresa ainda não foi publicado.');
    return loadStaticCatalog();
  }

  function orderResult(orderNumber, payload, stored, extra = {}) {
    const note = buildNote(orderNumber, payload);
    const settings = window.CARDAPIO_CATALOG?.settings || {};
    const phone = String(settings.whatsapp || '').replace(/\D/g, '');
    return {
      orderNumber,
      orderId: extra.orderId || '',
      note,
      stored,
      whatsappUrl: settings.autoOpenWhatsApp === true && phone ? `https://wa.me/${phone}?text=${encodeURIComponent(note)}` : '',
      customerEmail: payload.customer.email || '',
      pixKey: payload.paymentMethod === 'pix' ? (settings.pixKey || '') : '',
      paymentUrl: extra.paymentUrl || (payload.paymentMethod === 'payment_link' ? (settings.paymentLink || '') : ''),
      paymentMode: extra.paymentMode || '',
      paymentReference: extra.paymentReference || '',
      pixQrCode: extra.pixQrCode || '',
      pixQrCodeBase64: extra.pixQrCodeBase64 || '',
      pixTicketUrl: extra.pixTicketUrl || '',
      paymentError: extra.paymentError || '',
      notificationSent: Boolean(extra.notificationSent),
      notificationError: extra.notificationError || '',
      storeEmailSent: Boolean(extra.storeEmailSent),
      emailAutomationConfigured: Boolean(extra.emailAutomationConfigured),
      emailNotificationError: extra.emailNotificationError || ''
    };
  }

  async function createOrder(payload) {
    const orderNumber = `PED-${Date.now().toString().slice(-7)}${Math.floor(10 + Math.random() * 90)}`;
    const mercadoPagoMode = payload.paymentMethod === 'mercadopago_pix'
      ? 'pix'
      : payload.paymentMethod === 'mercadopago_card'
        ? 'card'
        : '';
    if (window.SupabaseStore?.configured) {
      try {
        const saved = await window.SupabaseStore.createOrder(payload, orderNumber);
        const settings = window.CARDAPIO_CATALOG?.settings || {};
        let notificationSent = false;
        let notificationError = '';
        let storeEmailSent = false;
        let emailAutomationConfigured = false;
        let emailNotificationError = '';
        let paymentUrl = '';
        let paymentMode = '';
        let paymentReference = '';
        let pixQrCode = '';
        let pixQrCodeBase64 = '';
        let pixTicketUrl = '';
        let paymentError = '';
        if (!mercadoPagoMode && saved?.id) {
          try {
            const emailNotification = await window.SupabaseStore.notifyOrderEmail(saved.id, 'created');
            storeEmailSent = emailNotification.sent === true;
            emailAutomationConfigured = emailNotification.configured !== false;
          } catch (error) {
            emailNotificationError = error.message;
            console.error('Pedido salvo; falha na automação de e-mail.', error);
          }
        }
        if (!mercadoPagoMode && settings.whatsappCloudEnabled && saved?.id) {
          try {
            const notification = await window.SupabaseStore.notifyOrder(saved.id);
            notificationSent = notification.sent === true;
          } catch (error) {
            notificationError = error.message;
            console.error('Pedido salvo; falha no WhatsApp Cloud API.', error);
          }
        }
        if (mercadoPagoMode && saved?.id) {
          try {
            const checkout = await window.SupabaseStore.createCheckout(saved.id, mercadoPagoMode);
            paymentMode = checkout.paymentMode || mercadoPagoMode;
            paymentReference = checkout.reference || '';
            paymentUrl = checkout.checkoutUrl || '';
            pixQrCode = checkout.qrCode || '';
            pixQrCodeBase64 = checkout.qrCodeBase64 || '';
            pixTicketUrl = checkout.ticketUrl || '';
          } catch (error) {
            console.error('Pedido salvo; falha ao criar checkout.', error);
            throw new Error(error.message || 'O Mercado Pago não criou o pagamento.');
          }
        } else if (payload.paymentMethod === 'payment_link' && settings.gatewayEnabled && settings.gatewayProvider !== 'none' && saved?.id) {
          try {
            const checkout = await window.SupabaseStore.createCheckout(saved.id, 'card');
            paymentMode = checkout.paymentMode || 'card';
            paymentReference = checkout.reference || '';
            paymentUrl = checkout.checkoutUrl || '';
          } catch (error) {
            console.error('Pedido salvo; falha ao criar checkout.', error);
          }
        }
        if (!mercadoPagoMode) trackOrderCreated(payload, orderNumber);
        return orderResult(orderNumber, payload, true, {
          orderId: saved?.id || '',
          notificationSent,
          notificationError,
          storeEmailSent,
          emailAutomationConfigured,
          emailNotificationError,
          paymentUrl,
          paymentMode,
          paymentReference,
          pixQrCode,
          pixQrCodeBase64,
          pixTicketUrl,
          paymentError
        });
      } catch (error) {
        console.error('Pedido não salvo no Supabase.', error);
        if (mercadoPagoMode) throw error;
      }
    }

    const orders = JSON.parse(localStorage.getItem('cardapio_orders') || '[]');
    orders.unshift({
      id: crypto.randomUUID(),
      number: orderNumber,
      status: 'novo',
      createdAt: new Date().toISOString(),
      ...payload
    });
    localStorage.setItem('cardapio_orders', JSON.stringify(orders.slice(0, 30)));
    return orderResult(orderNumber, payload, false);
  }

  function roundTrackingValue(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function trackingAttribution() {
    const record = window.MenuAttribution?.forOrder?.() || null;
    return record?.last_touch || {};
  }

  function trackingItem(item, index) {
    const productId = String(item.productId || item.id || index + 1);
    const product = (window.CARDAPIO_CATALOG?.products || []).find(current => String(current.id) === productId) || {};
    const category = (window.CARDAPIO_CATALOG?.categories || []).find(current => current.id === product.categoryId) || {};
    return {
      item_id: productId,
      item_name: String(item.name || product.name || 'Produto'),
      item_category: String(category.name || ''),
      price: roundTrackingValue(item.unitTotal ?? item.price ?? item.basePrice ?? product.price),
      quantity: Math.max(1, Number(item.quantity) || 1)
    };
  }

  function trackEcommerce(eventName, sourceItems, extra = {}) {
    if (!['view_item', 'add_to_cart', 'begin_checkout'].includes(eventName)) return;
    const items = (Array.isArray(sourceItems) ? sourceItems : [sourceItems])
      .filter(Boolean)
      .map(trackingItem);
    if (!items.length) return;

    const attribution = trackingAttribution();
    const value = roundTrackingValue(
      extra.value ?? items.reduce((sum, item) => sum + (item.price * item.quantity), 0)
    );
    const campaign = {
      utm_source: attribution.source || '',
      utm_medium: attribution.medium || '',
      utm_campaign: attribution.campaign || '',
      utm_content: attribution.content || '',
      utm_term: attribution.term || '',
      traffic_referrer: attribution.referrer || '',
      landing_page: attribution.landingPage || ''
    };

    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      event: eventName,
      ...campaign,
      checkout_mode: extra.checkout_mode || 'order',
      value,
      currency: 'BRL',
      items,
      ecommerce: { value, currency: 'BRL', items }
    });

    const consentState = window.MenuConsent?.get() || {};
    if (window.__CARDAPIO_DIRECT_GA4__ === true && consentState.analytics === true && typeof window.gtag === 'function') {
      window.gtag('event', eventName, {
        value,
        currency: 'BRL',
        items,
        order_source: campaign.utm_source,
        order_medium: campaign.utm_medium,
        order_campaign: campaign.utm_campaign,
        order_content: campaign.utm_content,
        order_term: campaign.utm_term
      });
    }
  }

  function trackOrderCreated(payload, orderNumber) {
    const eventId = orderNumber;
    const consentState = window.MenuConsent?.get() || {};
    const checkoutMarketingConsent = payload.customer?.marketingConsent === true;
    const cookieMarketingConsent = consentState.marketing === true;
    const marketingConsent = checkoutMarketingConsent && cookieMarketingConsent;
    const attributionRecord = payload.customer?.attribution || window.MenuAttribution?.forOrder?.() || null;
    const attribution = attributionRecord?.last_touch || {};
    const value = Math.round((Number(payload.total) || 0) * 100) / 100;
    const items = (Array.isArray(payload.items) ? payload.items : []).map((item, index) => ({
      item_id: String(item.productId || index + 1),
      item_name: String(item.name || 'Produto'),
      price: Math.round((Number(item.unitTotal ?? item.basePrice) || 0) * 100) / 100,
      quantity: Math.max(1, Number(item.quantity) || 1)
    }));
    window.dataLayer = window.dataLayer || [];
    const eventName = payload.isReservation ? 'reservation_request' : 'order_request';
    window.dataLayer.push({
      event: eventName,
      transaction_id: orderNumber,
      reservation_at: payload.reservationAt || '',
      event_id: eventId,
      marketing_consent: marketingConsent,
      checkout_marketing_consent: checkoutMarketingConsent,
      cookie_marketing_consent: cookieMarketingConsent,
      utm_source: attribution.source || '',
      utm_medium: attribution.medium || '',
      utm_campaign: attribution.campaign || '',
      utm_content: attribution.content || '',
      utm_term: attribution.term || '',
      traffic_referrer: attribution.referrer || '',
      landing_page: attribution.landingPage || '',
      value,
      currency: 'BRL',
      items,
      ecommerce: { transaction_id: orderNumber, event_id: eventId, value, currency: 'BRL', items }
    });
    if (window.__CARDAPIO_DIRECT_GA4__ === true && consentState.analytics === true && typeof window.gtag === 'function') {
      window.gtag('event', eventName, {
        transaction_id: orderNumber,
        event_id: eventId,
        value,
        currency: 'BRL',
        items,
        utm_source: attribution.source || '',
        utm_medium: attribution.medium || '',
        utm_campaign: attribution.campaign || '',
        utm_content: attribution.content || '',
        utm_term: attribution.term || '',
        order_source: attribution.source || '',
        order_medium: attribution.medium || '',
        order_campaign: attribution.campaign || '',
        order_content: attribution.content || '',
        order_term: attribution.term || ''
      });
    }
    return eventId;
  }

  function trackConfirmedPurchase(payload, orderNumber) {
    const settings = window.CARDAPIO_CATALOG?.settings || {};
    const consentState = window.MenuConsent?.get() || {};
    const checkoutMarketingConsent = payload.customer?.marketingConsent === true;
    const marketingConsent = checkoutMarketingConsent && consentState.marketing === true;
    const attribution = payload.customer?.attribution?.last_touch || {};
    const value = roundTrackingValue(payload.total);
    const items = (Array.isArray(payload.items) ? payload.items : []).map(trackingItem);
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      event: 'purchase',
      transaction_id: orderNumber,
      event_id: orderNumber,
      payment_confirmed: true,
      marketing_consent: marketingConsent,
      utm_source: attribution.source || '',
      utm_medium: attribution.medium || '',
      utm_campaign: attribution.campaign || '',
      utm_content: attribution.content || '',
      utm_term: attribution.term || '',
      value,
      currency: 'BRL',
      items,
      ecommerce: { transaction_id: orderNumber, event_id: orderNumber, value, currency: 'BRL', items }
    });
    if (marketingConsent && !settings.gtmId && typeof window.fbq === 'function') {
      window.fbq('track', 'Purchase', { value, currency: 'BRL' }, { eventID: orderNumber });
    }
    if (window.__CARDAPIO_DIRECT_GA4__ === true && consentState.analytics === true && typeof window.gtag === 'function') {
      window.gtag('event', 'purchase', { transaction_id: orderNumber, event_id: orderNumber, value, currency: 'BRL', items });
    }
  }

  function money(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
      .format(Number(value) || 0);
  }

  function buildNote(number, payload) {
    const paymentNames = {
      pix: 'PIX',
      mercadopago_pix: 'PIX pelo Mercado Pago',
      mercadopago_card: 'Cartão pelo Mercado Pago',
      card_delivery: 'Cartão na entrega',
      cash: 'Dinheiro',
      payment_link: 'Pagamento on-line'
    };
    const lines = [
      '━━━━━━━━━━━━━━━━━━━━',
      `🟣 *SEU DELIVERY*`,
      `*PEDIDO ${number}*`,
      '━━━━━━━━━━━━━━━━━━━━',
      '',
      '👤 *CLIENTE*',
      `Nome: ${payload.customer.name}`,
      `WhatsApp: ${payload.customer.phone}`
    ];
    if (payload.customer.email) lines.push(`E-mail: ${payload.customer.email}`);
    lines.push('', '🧾 *ITENS DO PEDIDO*');
    payload.items.forEach((item, index) => {
      lines.push('', `${index + 1}. *${item.quantity}x ${item.name}*`, `   Valor: ${money(item.unitTotal * item.quantity)}`);
      (item.selections || []).forEach(selection => {
        lines.push(`   ${selection.groupName}: ${selection.options.map(option => option.name).join(', ')}`);
      });
      if (item.notes) lines.push(`   Observação: ${item.notes}`);
    });
    lines.push(
      '',
      '💰 *VALORES*',
      `Subtotal: ${money(payload.subtotal)}`,
      `Entrega: ${money(payload.deliveryFee)}`,
      `*TOTAL: ${money(payload.total)}*`,
      '',
      `💳 Pagamento: ${paymentNames[payload.paymentMethod] || payload.paymentMethod}`
    );
    if (payload.changeFor) lines.push(`Troco para: ${payload.changeFor}`);
    if (payload.fulfillment === 'delivery') {
      const address = payload.address;
      lines.push(
        '',
        '📍 *ENDEREÇO DE ENTREGA*',
        `${address.street}, ${address.number}${address.complement ? ` — ${address.complement}` : ''}`,
        `${address.neighborhood} — ${address.city}${address.zip ? ` — CEP ${address.zip}` : ''}`
      );
      if (address.deliveryRegion) lines.push(`Região de entrega: ${address.deliveryRegion}`);
      if (address.reference) lines.push(`Referência: ${address.reference}`);
      if (address.mapUrl) lines.push(`Mapa: ${address.mapUrl}`);
    } else {
      lines.push('', '🏪 Retirada no local');
    }
    if (payload.notes) lines.push('', `📝 *OBSERVAÇÕES GERAIS*`, payload.notes);
    lines.push('', '━━━━━━━━━━━━━━━━━━━━');
    return lines.join('\n');
  }

  let trackingSettings = null;
  let consentListenerBound = false;
  const trackingLoaded = { gtm: false, ga4: false, meta: false };

  function currentConsent() {
    return window.MenuConsent?.get() || {
      decided: false,
      analytics: false,
      marketing: false
    };
  }

  function loadGTM(idValue) {
    if (trackingLoaded.gtm) return;
    const id = String(idValue || '').replace(/[^A-Z0-9-]/gi, '');
    if (!id) return;
    trackingLoaded.gtm = true;
    const script = document.createElement('script');
    script.text = "(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s);j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i;f.parentNode.insertBefore(j,f)})(window,document,'script','dataLayer','" + id + "');";
    document.head.appendChild(script);
  }

  function loadGA4(idValue) {
    if (trackingLoaded.ga4) return;
    const id = String(idValue || '').replace(/[^A-Z0-9-]/gi, '');
    if (!id) return;
    trackingLoaded.ga4 = true;
    window.__CARDAPIO_DIRECT_GA4__ = true;
    const loader = document.createElement('script');
    loader.async = true;
    loader.src = 'https://www.googletagmanager.com/gtag/js?id=' + id;
    document.head.appendChild(loader);
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', id, { send_page_view: true });
  }

  function loadMeta(idValue) {
    if (trackingLoaded.meta) return;
    const id = String(idValue || '').replace(/\D/g, '');
    if (!id) return;
    trackingLoaded.meta = true;
    const script = document.createElement('script');
    script.text = "!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','" + id + "');fbq('track','PageView');";
    document.head.appendChild(script);
  }

  function activateTracking() {
    if (!trackingSettings) return;
    const consent = currentConsent();
    if (!consent.decided) return;

    if (trackingSettings.gtmId && (consent.analytics || consent.marketing)) {
      loadGTM(trackingSettings.gtmId);
      return;
    }

    if (trackingSettings.ga4Id && consent.analytics) {
      loadGA4(trackingSettings.ga4Id);
    }
    if (!trackingSettings.gtmId && trackingSettings.metaPixelId && consent.marketing) {
      loadMeta(trackingSettings.metaPixelId);
    }
  }

  function injectTracking(settings) {
    trackingSettings = settings || {};
    if (!consentListenerBound) {
      consentListenerBound = true;
      window.addEventListener('cardapio:consent-changed', activateTracking);
    }
    activateTracking();
  }

  window.MenuAPI = { loadCatalog, createOrder, money, buildNote, injectTracking, trackEcommerce, trackConfirmedPurchase };
})();
