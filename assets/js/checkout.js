(function () {
  let catalog = null;
  let step = 1;
  let bound = false;
  let lastRestoredPhone = '';
  let phoneTimer = null;
  let redirectTimer = null;
  let paymentTimer = null;
  let zipTimer = null;
  let lastZipLookup = '';
  let reservationMode = false;
  const profileStorageKey = 'cardapio_customer_profiles_v1';
  const $ = selector => document.querySelector(selector);
  const escapeHtml = value => String(value || '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);

  function readCookie(name) {
    const prefix = `${encodeURIComponent(name)}=`;
    const cookie = document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith(prefix));
    return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : '';
  }

  function gaTrackingIds() {
    if (window.MenuConsent?.get?.().analytics !== true) return { clientId: '', sessionId: '' };
    const clientParts = readCookie('_ga').split('.');
    const clientId = clientParts.length >= 2
      ? clientParts.slice(-2).join('.').replace(/[^0-9.]/g, '')
      : '';
    const measurementId = String(window.CARDAPIO_CATALOG?.settings?.ga4Id || '')
      .replace(/^G-/i, '')
      .replace(/[^A-Z0-9]/gi, '');
    const namedCookie = measurementId ? readCookie(`_ga_${measurementId}`) : '';
    const fallbackCookie = document.cookie.split(';')
      .map(value => value.trim())
      .find(value => /^_ga_[^=]+=/.test(value));
    const sessionCookie = namedCookie || (fallbackCookie ? decodeURIComponent(fallbackCookie.split('=').slice(1).join('=')) : '');
    const modernSession = sessionCookie.match(/(?:^|\.)s(\d{8,})(?:\$|\.|$)/);
    const legacySession = sessionCookie.match(/^GS\d+\.\d+\.(\d{8,})/);
    return {
      clientId: /^\d+\.\d+$/.test(clientId) ? clientId : '',
      sessionId: String(modernSession?.[1] || legacySession?.[1] || '')
    };
  }

  function normalizePhone(value) {
    return String(value || '').replace(/\D/g, '').slice(-11);
  }

  function normalizeText(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function normalizePostalCode(value) {
    return String(value || '').replace(/\D/g, '').slice(0, 8);
  }

  function postalMatches(zip, pattern) {
    const rule = normalizePostalCode(pattern);
    return Boolean(zip && rule && (rule.length === 8 ? zip === rule : zip.startsWith(rule)));
  }

  function deliveryQuote(data = formData()) {
    if (data.fulfillment === 'pickup') return { fee: 0, blocked: false, zone: null, message: 'Retirada no local: sem taxa de entrega.' };
    const settings = catalog?.settings || {};
    const zip = normalizePostalCode(data.zip);
    const neighborhood = normalizeText(data.neighborhood);
    const blockedPostal = (settings.blockedPostalCodes || []).find(pattern => postalMatches(zip, pattern));
    if (blockedPostal) return { fee: 0, blocked: true, zone: null, message: 'Este CEP está fora da área de entrega. Escolha retirada ou fale com a loja.' };
    const zone = (settings.deliveryZones || []).find(rule => {
      const postal = (rule.postalPrefixes || []).some(pattern => postalMatches(zip, pattern));
      const area = (rule.neighborhoods || []).some(name => normalizeText(name) === neighborhood);
      return postal || (neighborhood && area);
    }) || null;
    if (zone?.deliver === false) return { fee: 0, blocked: true, zone, message: `${zone.name || 'Esta região'} está fora da área de entrega. Escolha retirada ou fale com a loja.` };
    if (CartStore.hasFreeShipping?.()) return { fee: 0, blocked: false, zone, freeShipping: true, message: 'Entrega grátis aplicada pelo produto selecionado.' };
    const fee = zone ? Math.max(0, Number(zone.fee) || 0) : Math.max(0, Number(settings.deliveryFee) || 0);
    return { fee, blocked: false, zone, message: zone ? `Entrega para ${zone.name}: ${MenuAPI.money(fee)}.` : `Taxa padrão de entrega: ${MenuAPI.money(fee)}.` };
  }

  function renderDeliveryQuote() {
    const element = $('#delivery-quote');
    if (!element || !catalog) return deliveryQuote();
    const data = formData();
    const quote = deliveryQuote(data);
    const incomplete = data.fulfillment === 'delivery' && (!normalizePostalCode(data.zip) || !normalizeText(data.neighborhood));
    element.textContent = incomplete ? 'Informe o CEP e o bairro para confirmar a taxa e a área de entrega.' : quote.message;
    element.classList.toggle('blocked', !incomplete && quote.blocked);
    element.classList.toggle('matched', !incomplete && !quote.blocked);
    return quote;
  }

  function readProfiles() {
    try { return JSON.parse(localStorage.getItem(profileStorageKey) || '{}'); }
    catch (error) { return {}; }
  }

  function clearRestoredFields() {
    if (!lastRestoredPhone) return;
    ['name', 'email', 'zip', 'street', 'number', 'complement', 'neighborhood', 'reference', 'latitude', 'longitude'].forEach(name => {
      const field = $('#checkout-form').elements.namedItem(name);
      if (field) field.value = '';
    });
    lastRestoredPhone = '';
    resetLocationStatus();
  }

  function restoreProfile() {
    const form = $('#checkout-form');
    const phone = normalizePhone(form.elements.namedItem('phone').value);
    const found = $('#returning-customer');
    if (phone.length < 10) { found.hidden = true; return; }
    if (lastRestoredPhone && lastRestoredPhone !== phone) clearRestoredFields();
    const profile = readProfiles()[phone];
    if (!profile) { found.hidden = true; return; }
    const values = { ...profile.customer, ...profile.address };
    ['name', 'email', 'zip', 'street', 'number', 'complement', 'neighborhood', 'reference', 'latitude', 'longitude'].forEach(name => {
      const value = values[name];
      const field = form.elements.namedItem(name);
      if (field && name !== 'phone') field.value = value || '';
    });
    const fulfillment = form.querySelector(`input[name="fulfillment"][value="${profile.fulfillment || 'delivery'}"]`);
    if (fulfillment) fulfillment.checked = true;
    $('#address-fields').hidden = profile.fulfillment === 'pickup';
    form.elements.namedItem('rememberProfile').checked = true;
    lastRestoredPhone = phone;
    found.hidden = false;
    if (profile.address?.latitude && profile.address?.longitude) {
      showLocationStatus('Localização salva recuperada para esta entrega.', true);
    }
    renderDeliveryQuote();
  }

  function saveProfile(payload) {
    const phone = normalizePhone(payload.customer.phone);
    if (phone.length < 10) return;
    const profiles = readProfiles();
    profiles[phone] = {
      customer: {
        name: payload.customer.name,
        phone: payload.customer.phone,
        email: payload.customer.email
      },
      address: payload.address,
      fulfillment: payload.fulfillment,
      updatedAt: new Date().toISOString()
    };
    try { localStorage.setItem(profileStorageKey, JSON.stringify(profiles)); }
    catch (error) { console.warn('Não foi possível lembrar os dados neste aparelho.', error); }
  }

  function removeProfile(phoneValue) {
    const phone = normalizePhone(phoneValue);
    if (phone.length < 10) return;
    const profiles = readProfiles();
    if (!profiles[phone]) return;
    delete profiles[phone];
    try { localStorage.setItem(profileStorageKey, JSON.stringify(profiles)); }
    catch (error) { console.warn('Não foi possível remover os dados lembrados neste aparelho.', error); }
  }

  function open(nextCatalog, options = {}) {
    catalog = nextCatalog;
    reservationMode = options.reservation === true;
    const reservationFields = $('#reservation-fields');
    if (reservationFields) reservationFields.hidden = !reservationMode;
    const reservationInput = $('#reservation-at');
    if (reservationMode && reservationInput) {
      const now = new Date();
      now.setMinutes(now.getMinutes() + 60 - (now.getMinutes() % 30), 0, 0);
      const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      reservationInput.min = local;
      if (!reservationInput.value) reservationInput.value = local;
    }
    clearTimeout(redirectTimer);
    step = 1;
    lastRestoredPhone = '';
    $('#returning-customer').hidden = true;
    $('#checkout-form').elements.namedItem('rememberProfile').checked = true;
    resetLocationStatus();
    render();
    $('#checkout-overlay').hidden = false;
    window.syncMenuScroll?.();
    requestAnimationFrame(() => $('#checkout-form').elements.namedItem('phone')?.focus());
    return true;
  }

  function close() {
    clearTimeout(redirectTimer);
    $('#checkout-overlay').hidden = true;
    window.syncMenuScroll?.();
    $('#order-success').hidden = true;
    $('#checkout-form').hidden = false;
    $('#checkout-form').reset();
    step = 1;
    reservationMode = false;
    resetLocationStatus();
    render();
  }

  function safeRedirectUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
    } catch (error) {
      return '';
    }
  }

  function showLocationStatus(message, success = false) {
    const box = document.querySelector('.location-assist');
    const status = $('#location-status');
    if (status) status.textContent = message;
    box?.classList.toggle('success', success);
  }

  function resetLocationStatus() {
    showLocationStatus('Opcional: facilita encontrar o endereço na entrega.', false);
    const button = $('#use-location');
    if (button) {
      button.disabled = false;
      button.textContent = '⌖ Marcar minha localização atual';
    }
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      showLocationStatus('Este navegador não permite marcar localização.');
      return;
    }
    const button = $('#use-location');
    button.disabled = true;
    button.textContent = 'Localizando...';
    navigator.geolocation.getCurrentPosition(position => {
      const form = $('#checkout-form');
      form.elements.namedItem('latitude').value = position.coords.latitude.toFixed(6);
      form.elements.namedItem('longitude').value = position.coords.longitude.toFixed(6);
      showLocationStatus('Localização marcada. Complete rua, número e bairro.', true);
      button.disabled = false;
      button.textContent = '✓ Localização marcada';
    }, () => {
      showLocationStatus('Não foi possível acessar a localização. Você pode preencher o endereço normalmente.');
      button.disabled = false;
      button.textContent = '⌖ Marcar minha localização atual';
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 });
  }

  function render() {
    document.querySelectorAll('.checkout-step').forEach(element => {
      element.hidden = Number(element.dataset.step) !== step;
    });
    $('#checkout-step-label').textContent = `Etapa ${step} de 4`;
    $('#checkout-progress').style.width = `${(step / 4) * 100}%`;
    $('#checkout-back').disabled = step === 1;
    $('#checkout-next').hidden = step === 4;
    $('#checkout-next').textContent = step === 3 ? 'Revisar pedido →' : 'Continuar →';
    $('#checkout-submit').hidden = step !== 4;
    $('#checkout-error').hidden = true;
    renderDeliveryQuote();
    if (step === 3) {
      renderPayments();
      renderSummary();
    }
    if (step === 4) renderReview();
  }

  function formData() {
    return Object.fromEntries(new FormData($('#checkout-form')).entries());
  }

  function validate() {
    const data = formData();
    const error = $('#checkout-error');
    let message = '';
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.email || '').trim());
    if (step === 1 && (!String(data.name || '').trim() || String(data.phone || '').replace(/\D/g, '').length < 10 || !emailValid)) {
      message = 'Informe seu nome, um WhatsApp válido e o e-mail que receberá a confirmação.';
    }
    if (step === 2 && data.fulfillment === 'delivery' && (!data.street || !data.number || !data.neighborhood || !data.city || normalizePostalCode(data.zip).length !== 8)) {
      message = 'Preencha CEP, rua, número, bairro e cidade.';
    }
    if (step === 2 && data.fulfillment === 'delivery' && !message) {
      const quote = deliveryQuote(data);
      if (quote.blocked) message = quote.message;
    }
    if (step === 3 && data.paymentMethod === 'cash' && data.changeNeeded === 'yes') {
      const changeValue = Number(String(data.changeFor || '').replace(/[^\d,.-]/g, '').replace(',', '.'));
      const total = CartStore.subtotal() + deliveryQuote(data).fee;
      if (!Number.isFinite(changeValue) || changeValue <= total) message = `Informe um valor para troco maior que ${MenuAPI.money(total)}.`;
    }
    if (message) {
      error.textContent = message;
      error.hidden = false;
      return false;
    }
    return true;
  }

  function renderPayments() {
    const mercadoPagoEnabled = window.SupabaseStore?.configured === true;
    const methods = mercadoPagoEnabled
      ? [
          ['mercadopago_pix', 'Pix Mercado Pago', 'Abra o Mercado Pago e gere o QR Code'],
          ['mercadopago_card', 'Cartão Mercado Pago', 'Abrir direto no pagamento com crédito ou débito'],
          ['card_delivery', 'Cartão na entrega', 'Pague na maquininha'],
          ['cash', 'Dinheiro', 'Informe se precisa de troco']
        ]
      : [
          ['pix', 'PIX', catalog.settings.pixKey ? 'Chave após confirmar' : 'Confirme com a loja'],
          ['card_delivery', 'Cartão na entrega', 'Crédito ou débito'],
          ['cash', 'Dinheiro', 'Informe se precisa de troco']
        ];
    if (!mercadoPagoEnabled && (catalog.settings.paymentLink || (catalog.settings.gatewayEnabled && catalog.settings.gatewayProvider !== 'none'))) {
      methods.push(['payment_link', 'Pagamento on-line', 'Link seguro']);
    }
    const fallback = mercadoPagoEnabled ? 'mercadopago_pix' : 'pix';
    const selected = document.querySelector('input[name=paymentMethod]:checked')?.value;
    const current = methods.some(([value]) => value === selected) ? selected : fallback;
    const media = {
      mercadopago_pix: '<span class="payment-brand pix-brand"><img src="assets/images/payments/pix.png" alt="Pix"></span>',
      mercadopago_card: '<span class="payment-brand mp-brand"><img src="assets/images/payments/mercado-pago.png" alt="Mercado Pago"></span>',
      card_delivery: '<span class="payment-brand payment-emoji" aria-hidden="true">💳</span>',
      cash: '<span class="payment-brand payment-emoji" aria-hidden="true">💵</span>',
      pix: '<span class="payment-brand pix-brand"><img src="assets/images/payments/pix.png" alt="Pix"></span>',
      payment_link: '<span class="payment-brand payment-emoji" aria-hidden="true">🔒</span>'
    };
    $('#payment-options').innerHTML = methods.map(([value, label, description]) =>
      `<label class="payment-option"><input type="radio" name="paymentMethod" value="${value}" ${value === current ? 'checked' : ''}>${media[value] || ''}<span class="payment-copy"><b>${label}</b><small>${description}</small></span><i aria-hidden="true"></i></label>`
    ).join('');
    $('#payment-options').querySelectorAll('input').forEach(input => {
      input.addEventListener('change', () => {
        const cash = input.value === 'cash';
        $('#change-field').hidden = !cash;
        if (!cash) {
          $('#change-amount').hidden = true;
          const noChange = $('#checkout-form').querySelector('input[name="changeNeeded"][value="no"]');
          if (noChange) noChange.checked = true;
        }
      });
    });
    $('#change-field').hidden = current !== 'cash';
  }

  function renderSummary() {
    const quote = deliveryQuote();
    const delivery = quote.fee;
    const total = CartStore.subtotal() + delivery;
    $('#order-summary').innerHTML = '<h3>Resumo</h3>' +
      CartStore.get().map(item => `<div><span>${item.quantity}x ${item.name}</span><b>${MenuAPI.money(item.unitTotal * item.quantity)}</b></div>`).join('') +
      `<hr><div><span>Subtotal</span><b>${MenuAPI.money(CartStore.subtotal())}</b></div>` +
      `<div><span>${quote.zone?.name ? `Entrega · ${quote.zone.name}` : 'Entrega'}</span><b>${MenuAPI.money(delivery)}</b></div>` +
      `<div class="total"><span>Total</span><b>${MenuAPI.money(total)}</b></div>`;
    $('#checkout-submit').textContent = reservationMode ? `Reservar · ${MenuAPI.money(total)}` : `Confirmar · ${MenuAPI.money(total)}`;
  }

  function paymentName(value) {
    return ({
      mercadopago_pix: 'PIX pelo Mercado Pago', mercadopago_card: 'Cartão pelo Mercado Pago',
      card_delivery: 'Cartão na entrega', cash: 'Dinheiro', pix: 'PIX', payment_link: 'Pagamento on-line'
    })[value] || 'Não informado';
  }

  function renderReview() {
    const data = formData();
    const quote = deliveryQuote(data);
    const onlinePayment = ['mercadopago_pix', 'mercadopago_card'].includes(data.paymentMethod);
    const address = data.fulfillment === 'pickup'
      ? `Retirada no ${window.CARDAPIO_CATALOG?.settings?.establishmentName || window.CARDAPIO_CATALOG?.settings?.storeName || 'estabelecimento'}`
      : `${escapeHtml(data.street)}, ${escapeHtml(data.number)}${data.complement ? ` — ${escapeHtml(data.complement)}` : ''}<br>${escapeHtml(data.neighborhood)} — ${escapeHtml(data.city)} · CEP ${escapeHtml(data.zip)}${data.reference ? `<br>Referência: ${escapeHtml(data.reference)}` : ''}`;
    const items = CartStore.get().map(item => {
      const options = (item.selections || []).flatMap(selection => (selection.options || []).map(option => option.name)).join(', ');
      return `<div class="review-item"><span><b>${item.quantity}x ${escapeHtml(item.name)}</b>${options ? `<small>${escapeHtml(options)}</small>` : ''}</span><strong>${MenuAPI.money(item.unitTotal * item.quantity)}</strong></div>`;
    }).join('');
    $('#checkout-review').innerHTML =
      `<section><header><b>Seus dados</b><button type="button" data-review-step="1">Corrigir</button></header><p>${escapeHtml(data.name)} · ${escapeHtml(data.phone)}<br><strong>${escapeHtml(data.email)}</strong></p></section>` +
      `<section><header><b>${data.fulfillment === 'pickup' ? 'Retirada' : 'Endereço de entrega'}</b><button type="button" data-review-step="2">Corrigir</button></header><p>${address}</p></section>` +
      `<section><header><b>Pedido</b><button type="button" data-review-step="3">Corrigir</button></header>${items}<div class="review-total"><span>Subtotal</span><b>${MenuAPI.money(CartStore.subtotal())}</b></div><div class="review-total"><span>Entrega</span><b>${MenuAPI.money(quote.fee)}</b></div><div class="review-total grand"><span>Total</span><b>${MenuAPI.money(CartStore.subtotal() + quote.fee)}</b></div></section>` +
      `<section class="review-payment"><header><b>Pagamento escolhido</b><button type="button" data-review-step="3">Corrigir</button></header><p>${escapeHtml(paymentName(data.paymentMethod))}${data.paymentMethod === 'cash' ? `<br>${data.changeNeeded === 'yes' ? `Troco para ${escapeHtml(data.changeFor)}` : 'Não precisa de troco'}` : ''}</p>${['mercadopago_pix', 'mercadopago_card'].includes(data.paymentMethod) ? '<small>O pedido só será enviado à loja após o Mercado Pago aprovar o pagamento.</small>' : ''}</section>`;
    $('#checkout-submit').textContent = onlinePayment
      ? `Confirmar e pagar · ${MenuAPI.money(CartStore.subtotal() + quote.fee)}`
      : `Confirmar pedido · ${MenuAPI.money(CartStore.subtotal() + quote.fee)}`;
    $('#checkout-review').querySelectorAll('[data-review-step]').forEach(button => {
      button.addEventListener('click', () => { step = Number(button.dataset.reviewStep); render(); });
    });
  }

  async function submit(event) {
    event.preventDefault();
    const storeState = window.MenuStoreStatus?.get?.() || { open: true };
    const isReservation = reservationMode && !storeState.open;
    const data = formData();
    if (!storeState.open && !isReservation) {
      const error = $('#checkout-error');
      error.textContent = 'A loja está fechada. Use a opção de reservar o pedido.';
      error.hidden = false;
      return;
    }
    if (isReservation && (!data.reservationAt || new Date(data.reservationAt).getTime() <= Date.now())) {
      const error = $('#checkout-error');
      error.textContent = 'Escolha uma data e um horário futuros para a reserva.';
      error.hidden = false;
      return;
    }
    const quote = deliveryQuote(data);
    const delivery = quote.fee;
    if (data.fulfillment === 'delivery' && (normalizePostalCode(data.zip).length !== 8 || !String(data.neighborhood || '').trim())) {
      const error = $('#checkout-error');
      error.textContent = 'Informe um CEP válido e o bairro para confirmar a entrega.';
      error.hidden = false;
      return;
    }
    if (quote.blocked) {
      const error = $('#checkout-error');
      error.textContent = quote.message;
      error.hidden = false;
      return;
    }
    if (CartStore.subtotal() < Number(catalog.settings.minOrder) && data.fulfillment === 'delivery') {
      const error = $('#checkout-error');
      error.textContent = `O pedido mínimo é ${MenuAPI.money(catalog.settings.minOrder)}.`;
      error.hidden = false;
      return;
    }
    const button = $('#checkout-submit');
    button.disabled = true;
    button.textContent = 'Registrando pedido...';
    const payload = {
      customer: {
        name: data.name,
        phone: data.phone,
        email: data.email || '',
        marketingConsent: data.marketingConsent === '1',
        marketingConsentAt: data.marketingConsent === '1' ? new Date().toISOString() : '',
        trackingConsent: window.MenuConsent?.get?.() || {
          necessary: true,
          analytics: false,
          marketing: false,
          decided: false
        },
        attribution: window.MenuAttribution?.forOrder?.() || null,
        fbp: readCookie('_fbp'),
        fbc: readCookie('_fbc'),
        gaClientId: gaTrackingIds().clientId,
        gaSessionId: gaTrackingIds().sessionId
      },
      fulfillment: data.fulfillment,
      address: {
        zip: data.zip || '', street: data.street || '', number: data.number || '',
        complement: data.complement || '', neighborhood: data.neighborhood || '',
        reference: data.reference || '', city: data.city || '', deliveryRegion: quote.zone?.name || '',
        latitude: data.latitude || '', longitude: data.longitude || '',
        mapUrl: data.latitude && data.longitude ? `https://www.google.com/maps?q=${encodeURIComponent(data.latitude)},${encodeURIComponent(data.longitude)}` : ''
      },
      paymentMethod: data.paymentMethod || 'pix',
      changeFor: data.paymentMethod === 'cash' && data.changeNeeded === 'yes' ? (data.changeFor || '') : '',
      isReservation,
      reservationAt: isReservation ? data.reservationAt : '',
      notes: isReservation
        ? `[RESERVA PARA ${new Date(data.reservationAt).toLocaleString('pt-BR')}] ${data.notes || ''}`.trim()
        : (data.notes || ''),
      items: CartStore.get(),
      subtotal: CartStore.subtotal(),
      deliveryFee: delivery,
      total: CartStore.subtotal() + delivery
    };
    let whatsappWindow = null;
    let paymentWindow = null;
    const mercadoPagoPayment = ['mercadopago_card', 'mercadopago_pix'].includes(payload.paymentMethod);
    if (!mercadoPagoPayment && catalog.settings.autoOpenWhatsApp !== false && !catalog.settings.whatsappCloudEnabled) {
      whatsappWindow = window.open('', 'cardapio-pedido-whatsapp');
      if (whatsappWindow) whatsappWindow.document.title = 'Preparando pedido no WhatsApp';
    }
    if (payload.paymentMethod === 'mercadopago_card') {
      paymentWindow = window.open('', 'cardapio-pagamento-mercadopago');
      if (paymentWindow) paymentWindow.document.title = 'Abrindo pagamento seguro';
    }
    try {
      const result = await MenuAPI.createOrder(payload);
      if (data.rememberProfile === '1') saveProfile(payload);
      else removeProfile(payload.customer.phone);
      if (paymentWindow) {
        if (result.paymentUrl) paymentWindow.location.replace(result.paymentUrl);
        else paymentWindow.close();
      }
      if (mercadoPagoPayment) {
        showPaymentWaiting(result);
        monitorPayment(result, payload, data.name);
      } else {
        CartStore.clear();
        showSuccess(result, data.name, isReservation);
      }
      if (whatsappWindow) {
        if (result.whatsappUrl) whatsappWindow.location.replace(result.whatsappUrl);
        else whatsappWindow.close();
      }
    } catch (error) {
      whatsappWindow?.close();
      paymentWindow?.close();
      const box = $('#checkout-error');
      box.textContent = error.message || 'Não foi possível concluir o pedido.';
      box.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = 'Confirmar e pagar';
    }
  }

  function showPaymentWaiting(result) {
    $('#checkout-form').hidden = true;
    const box = $('#order-success');
    box.hidden = false;
    const safeQrImage = /^[A-Za-z0-9+/=\r\n]+$/.test(String(result.pixQrCodeBase64 || ''))
      ? String(result.pixQrCodeBase64).replace(/\s/g, '')
      : '';
    const pixBox = result.paymentMode === 'pix' && result.pixQrCode
      ? `<section class="mercadopago-pix payment-pix-live"><span class="mp-badge">PIX MERCADO PAGO</span><h3>Escaneie para pagar</h3>` +
        (safeQrImage ? `<img src="data:image/png;base64,${safeQrImage}" alt="QR Code Pix do pedido">` : '') +
        `<label>Pix copia e cola</label><div class="pix-copy"><input value="${escapeHtml(result.pixQrCode)}" readonly><button type="button" data-copy-waiting-pix>Copiar Pix</button></div></section>`
      : '';
    box.innerHTML = '<span class="payment-waiting-icon"></span><small>PAGAMENTO SEGURO</small><h2>Conclua no Mercado Pago</h2><p>Seu pedido ainda não foi enviado à loja. Ele será gerado somente depois da aprovação do pagamento.</p>' + pixBox +
      (result.paymentUrl ? `<div class="success-links single"><a href="${escapeHtml(result.paymentUrl)}" target="_blank" rel="noopener">${result.paymentMode === 'pix' ? 'Abrir PIX no Mercado Pago' : 'Abrir Mercado Pago novamente'}</a></div>` : '') +
      '<div class="payment-waiting-note">Aguardando confirmação automática…</div><button type="button" class="link-button" data-cancel-payment>Voltar e corrigir</button>';
    box.querySelector('[data-copy-waiting-pix]')?.addEventListener('click', async event => {
      await navigator.clipboard.writeText(result.pixQrCode);
      event.currentTarget.textContent = 'Copiado!';
    });
    box.querySelector('[data-cancel-payment]')?.addEventListener('click', () => {
      clearTimeout(paymentTimer);
      box.hidden = true;
      $('#checkout-form').hidden = false;
      step = 4;
      render();
    });
  }

  function monitorPayment(result, payload, customerName) {
    clearTimeout(paymentTimer);
    const startedAt = Date.now();
    const check = async () => {
      try {
        const status = await window.SupabaseStore.getPaymentStatus(result.orderId, result.orderNumber);
        if (status.paymentStatus === 'pago') {
          CartStore.clear();
          showSuccess({ ...result, paymentApproved: true, emailAutomationConfigured: true }, customerName, false);
          return;
        }
        if (['recusado', 'estornado'].includes(status.paymentStatus)) {
          showPaymentRejected(status.paymentStatus);
          return;
        }
      } catch (error) {
        console.warn('Aguardando confirmação segura do pagamento.', error);
      }
      if (Date.now() - startedAt < 15 * 60 * 1000) {
        paymentTimer = setTimeout(check, 4000);
      }
    };
    paymentTimer = setTimeout(check, 3000);
  }

  function showPaymentRejected(paymentStatus) {
    clearTimeout(paymentTimer);
    const box = $('#order-success');
    const refunded = paymentStatus === 'estornado';
    box.innerHTML = `<span class="payment-rejected-icon">!</span><small>PAGAMENTO NÃO CONCLUÍDO</small><h2>${refunded ? 'Pagamento estornado' : 'Pagamento recusado'}</h2>` +
      '<p>O pedido não foi enviado à loja e nenhuma compra foi registrada nas conversões.</p>' +
      '<button type="button" class="primary payment-retry" data-retry-payment>Voltar e escolher outra forma</button>';
    box.querySelector('[data-retry-payment]')?.addEventListener('click', () => {
      box.hidden = true;
      $('#checkout-form').hidden = false;
      step = 3;
      render();
    });
  }

  function showSuccess(result, name, isReservation = false) {
    $('#checkout-form').hidden = true;
    const box = $('#order-success');
    box.hidden = false;
    const title = result.paymentApproved ? 'PAGAMENTO APROVADO' : result.stored ? (isReservation ? 'RESERVA REGISTRADA' : 'PEDIDO REGISTRADO') : 'PEDIDO PRONTO';
    const message = result.stored
      ? (result.paymentApproved
        ? 'Seu pagamento foi confirmado e agora o pedido foi enviado para a loja.'
        : isReservation
        ? 'Sua reserva foi recebida. Fique de olho no seu e-mail e aguarde a confirmação da loja.'
        : 'Sua solicitação de pedido foi recebida. Fique de olho no seu e-mail e aguarde a confirmação da loja antes de considerar o pedido aprovado.')
      : 'Não foi possível registrar sua solicitação. Volte ao cardápio e tente novamente.';
    const emailNotice = result.stored && result.customerEmail
      ? (result.emailAutomationConfigured
        ? `<div class="email-confirmation">✉ A confirmação será enviada automaticamente para <b>${String(result.customerEmail).replace(/[&<>"']/g, '')}</b> quando a loja confirmar o pedido.</div>`
        : `<div class="email-confirmation pending">✉ Seu e-mail foi salvo. A loja ainda precisa ativar a automação de confirmação.</div>`)
      : '';
    const redirectUrl = catalog.settings.orderRedirectEnabled ? safeRedirectUrl(catalog.settings.orderRedirectUrl) : '';
    const redirectNotice = redirectUrl ? '<div class="redirect-confirmation">Você será direcionado para a próxima página em alguns segundos.</div>' : '';
    const safeQrImage = /^[A-Za-z0-9+/=\r\n]+$/.test(String(result.pixQrCodeBase64 || ''))
      ? String(result.pixQrCodeBase64).replace(/\s/g, '')
      : '';
    const pixPayment = result.paymentMode === 'pix' && (result.pixQrCode || result.pixTicketUrl)
      ? `<section class="mercadopago-pix"><span class="mp-badge">PIX MERCADO PAGO</span>` +
        `<h3>Escaneie para pagar</h3><p>Abra o aplicativo do seu banco e pague o valor exato do pedido.</p>` +
        (safeQrImage ? `<img src="data:image/png;base64,${safeQrImage}" alt="QR Code Pix do pedido">` : '') +
        (result.pixQrCode ? `<label>Pix copia e cola</label><div class="pix-copy"><input value="${escapeHtml(result.pixQrCode)}" readonly><button type="button" data-copy-mp-pix>Copiar Pix</button></div>` : '') +
        (result.pixTicketUrl ? `<a href="${escapeHtml(result.pixTicketUrl)}" target="_blank" rel="noopener">Abrir Pix no Mercado Pago</a>` : '') +
        `<small>O pagamento será confirmado automaticamente após a transferência.</small></section>`
      : '';
    const paymentError = result.paymentError
      ? `<div class="payment-error"><b>O pedido foi salvo, mas o pagamento não abriu.</b><span>${escapeHtml(result.paymentError)}</span><small>Não faça outro pedido. Informe o número acima à loja.</small></div>`
      : '';
    box.innerHTML = `<span class="success-icon">✓</span><small>${title}</small>` +
      `<h2>Obrigado ${String(name).split(' ')[0]}!</h2><p>${message}</p>` +
      `<div class="order-number"><small>NÚMERO DO PEDIDO</small><b>${result.orderNumber}</b></div>` +
      emailNotice +
      redirectNotice +
      paymentError +
      pixPayment +
      (result.pixKey ? `<div class="pix"><span><small>CHAVE PIX</small><b>${result.pixKey}</b></span><button type="button" data-copy-pix>Copiar</button></div>` : '') +
      '<div class="success-links">' +
      (result.paymentUrl ? `<a href="${escapeHtml(result.paymentUrl)}" target="_blank" rel="noopener">Pagar on-line</a>` : '') +
      (catalog.settings.autoOpenWhatsApp === true && result.whatsappUrl ? `<a class="wa" href="${result.whatsappUrl}" target="_blank" rel="noopener">Enviar pedido pelo WhatsApp</a>` : '') +
      (redirectUrl ? `<a class="redirect-link" href="${redirectUrl}">Continuar →</a>` : '') +
      '</div><button type="button" class="link-button" data-finish>Voltar ao cardápio</button>';
    box.querySelector('[data-copy-pix]')?.addEventListener('click', () => navigator.clipboard.writeText(result.pixKey));
    box.querySelector('[data-copy-mp-pix]')?.addEventListener('click', async event => {
      await navigator.clipboard.writeText(result.pixQrCode);
      event.currentTarget.textContent = 'Copiado!';
    });
    box.querySelector('[data-finish]').addEventListener('click', close);
    if (redirectUrl) {
      clearTimeout(redirectTimer);
      redirectTimer = setTimeout(() => window.location.assign(redirectUrl), 3000);
    }
  }

  async function autofillAddressFromZip(zipInput) {
    const digits = normalizePostalCode(zipInput.value);
    if (digits.length !== 8 || digits === lastZipLookup) return;
    lastZipLookup = digits;
    const form = $('#checkout-form');
    const cacheKey = `seufood_cep_${digits}`;
    try {
      let address = null;
      try { address = JSON.parse(localStorage.getItem(cacheKey) || 'null'); } catch (_) {}
      if (!address) {
        const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`, { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error('CEP indisponível');
        address = await response.json();
        if (address.erro) throw new Error('CEP não encontrado');
        try { localStorage.setItem(cacheKey, JSON.stringify(address)); } catch (_) {}
      }
      const values = { street: address.logradouro || '', neighborhood: address.bairro || '', city: address.localidade || '' };
      Object.entries(values).forEach(([name, value]) => {
        const input = form.elements.namedItem(name);
        if (!input || !value) return;
        if (!input.value.trim() || input.dataset.cepFilled === 'true') input.value = value;
        input.dataset.cepFilled = 'true';
      });
      form.elements.namedItem('number')?.focus();
      renderDeliveryQuote();
      if (step >= 3) { renderSummary(); if (step === 4) renderReview(); }
    } catch (error) {
      lastZipLookup = '';
      const quote = $('#delivery-quote');
      if (quote) quote.textContent = error.message === 'CEP não encontrado' ? 'CEP não encontrado. Confira os números e tente novamente.' : 'Não foi possível consultar o CEP agora. Preencha o endereço manualmente.';
    }
  }

  function bind() {
    if (bound) return;
    bound = true;
    $('#checkout-next').addEventListener('click', () => {
      if (validate()) { step = Math.min(4, step + 1); render(); }
    });
    $('#checkout-back').addEventListener('click', () => { step = Math.max(1, step - 1); render(); });
    $('#close-checkout').addEventListener('click', close);
    $('#checkout-overlay').addEventListener('click', event => {
      if (event.target.id === 'checkout-overlay') close();
    });
    $('#checkout-form').addEventListener('submit', submit);
    $('#use-location').addEventListener('click', useCurrentLocation);
    document.querySelectorAll('input[name="changeNeeded"]').forEach(input => {
      input.addEventListener('change', () => {
        $('#change-amount').hidden = input.value !== 'yes';
        if (input.value !== 'yes') $('#checkout-form').elements.namedItem('changeFor').value = '';
      });
    });
    const phone = $('#checkout-form').elements.namedItem('phone');
    phone.addEventListener('input', () => {
      clearTimeout(phoneTimer);
      phoneTimer = setTimeout(restoreProfile, 350);
    });
    phone.addEventListener('blur', restoreProfile);
    const checkoutForm = $('#checkout-form');
    const zip = checkoutForm.elements.namedItem('zip');
    const neighborhood = checkoutForm.elements.namedItem('neighborhood');
    zip.addEventListener('input', () => {
      const digits = normalizePostalCode(zip.value);
      zip.value = digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
      renderDeliveryQuote();
      clearTimeout(zipTimer);
      if (digits.length === 8) zipTimer = setTimeout(() => autofillAddressFromZip(zip), 280);
      if (step >= 3) { renderSummary(); if (step === 4) renderReview(); }
    });
    neighborhood.addEventListener('input', () => { renderDeliveryQuote(); if (step >= 3) renderSummary(); });
    document.querySelectorAll('input[name=fulfillment]').forEach(input => {
      input.addEventListener('change', () => { $('#address-fields').hidden = input.value === 'pickup'; renderDeliveryQuote(); if (step >= 3) renderSummary(); });
    });
  }

  document.addEventListener('DOMContentLoaded', bind);
  window.Checkout = { open, close };
})();
