(async function () {
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));
  const categoryDefaults = {
    acai: 'assets/images/categories/acai.jpg',
    lanches: 'assets/images/categories/lanches.jpg',
    pasteis: 'assets/images/categories/pasteis.jpg'
  };
  const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const weekLabels = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

  let catalog;
  let active = 'destaques';
  let query = '';
  let selected = null;
  let selections = {};
  let quantity = 1;
  let productStep = 0;
  let productTrigger = null;
  let statusTimer = null;
  let lockedScrollY = 0;

  try {
    catalog = await MenuAPI.loadCatalog();
    normalizeCatalog();
    window.CARDAPIO_CATALOG = catalog;
    boot();
  } catch (error) {
    $('#products').innerHTML = '<div class="empty"><h3>Cardápio indisponível</h3><p>Tente novamente em alguns minutos.</p></div>';
  }

  function normalizeCatalog() {
    const settings = catalog.settings || (catalog.settings = {});
    settings.logoUrl = typeof settings.logoUrl === 'string' ? settings.logoUrl : '';
    settings.primaryColor = /^#[0-9a-f]{6}$/i.test(settings.primaryColor || '') ? settings.primaryColor : '#620853';
    settings.accentColor = /^#[0-9a-f]{6}$/i.test(settings.accentColor || '') ? settings.accentColor : '#fcd307';
    settings.brandBrightColor = /^#[0-9a-f]{6}$/i.test(settings.brandBrightColor || '') ? settings.brandBrightColor : settings.primaryColor;
    settings.pageColor = /^#[0-9a-f]{6}$/i.test(settings.pageColor || '') ? settings.pageColor : '#fffaf2';
    settings.surfaceColor = /^#[0-9a-f]{6}$/i.test(settings.surfaceColor || '') ? settings.surfaceColor : '#ffffff';
    settings.buttonColor = /^#[0-9a-f]{6}$/i.test(settings.buttonColor || '') ? settings.buttonColor : settings.primaryColor;
    settings.buttonTextColor = /^#[0-9a-f]{6}$/i.test(settings.buttonTextColor || '') ? settings.buttonTextColor : '#ffffff';
    settings.containerRadius = Math.min(32, Math.max(0, Number(settings.containerRadius ?? 18)));
    settings.bodyFont = ['arial','inter','trebuchet','poppins'].includes(settings.bodyFont) ? settings.bodyFont : 'arial';
    if (!settings.headingFontVersion) { settings.headingFont = 'fredoka'; settings.headingFontVersion = 1; }
    settings.headingFont = ['fredoka','georgia','arial','inter','poppins'].includes(settings.headingFont) ? settings.headingFont : 'fredoka';
    settings.cardEffect = ['clean','shine','glass','neon'].includes(settings.cardEffect) ? settings.cardEffect : 'clean';
    settings.customCss = typeof settings.customCss === 'string' ? settings.customCss.slice(0, 8000) : '';
    settings.timezone = settings.timezone || 'America/Sao_Paulo';
    settings.establishmentName = settings.establishmentName || settings.storeName || 'Seu Delivery';
    settings.locationName = settings.locationName || settings.city || 'Sua cidade - UF';
    settings.contactPhone = typeof settings.contactPhone === 'string' ? settings.contactPhone : '';
    settings.publicEmail = typeof settings.publicEmail === 'string' ? settings.publicEmail : '';
    settings.heroEyebrow = settings.heroEyebrow || '✦ DO SEU JEITO';
    settings.heroTitle = settings.heroTitle || 'Seu pedido';
    settings.heroHighlight = settings.heroHighlight || 'do seu jeito.';
    settings.menuEyebrow = settings.menuEyebrow || 'ESCOLHA O SEU';
    settings.menuTitle = settings.menuTitle || 'Cardápio';
    settings.searchPlaceholder = settings.searchPlaceholder || 'Buscar produto ou acompanhamento';
    settings.whatsappEyebrow = settings.whatsappEyebrow || 'PREFERE PEDIR DIRETO?';
    settings.whatsappTitle = settings.whatsappTitle || 'Fale com a gente no WhatsApp';
    settings.whatsappButtonText = settings.whatsappButtonText || 'CHAMAR AGORA →';
    settings.paymentSummary = settings.paymentSummary || 'PIX cartão ou dinheiro';
    settings.cnpj = settings.cnpj || '';
    settings.instagramUrl = settings.instagramUrl || '';
    settings.facebookUrl = settings.facebookUrl || '';
    settings.tiktokUrl = settings.tiktokUrl || '';
    settings.seoTitle = settings.seoTitle || 'Cardápio on-line | Seu Delivery';
    settings.seoDescription = settings.seoDescription || 'Escolha seus produtos e faça seu pedido on-line com rapidez e segurança.';
    settings.faviconUrl = settings.faviconUrl || 'assets/images/favicon/favicon.svg';
    settings.deliveryZones = Array.isArray(settings.deliveryZones) ? settings.deliveryZones : [];
    settings.blockedPostalCodes = Array.isArray(settings.blockedPostalCodes) ? settings.blockedPostalCodes : [];
    if (!settings.infoStripIcons || typeof settings.infoStripIcons !== 'object') settings.infoStripIcons = {};
    settings.infoStripIcons = {
      service: settings.infoStripIcons.service || '',
      time: settings.infoStripIcons.time || '',
      delivery: settings.infoStripIcons.delivery || '',
      payment: settings.infoStripIcons.payment || ''
    };
    if (!settings.dailyOffer || typeof settings.dailyOffer !== 'object') settings.dailyOffer = {};
    settings.dailyOffer = {
      enabled: settings.dailyOffer.enabled === true,
      title: settings.dailyOffer.title || '',
      description: settings.dailyOffer.description || '',
      buttonText: settings.dailyOffer.buttonText || 'APROVEITAR →',
      link: settings.dailyOffer.link || '#cardapio',
      imageUrl: settings.dailyOffer.imageUrl || ''
    };
    if (!['auto', 'open', 'closed'].includes(settings.statusMode)) {
      settings.statusMode = settings.open === false ? 'closed' : 'open';
    }
    catalog.categories = (catalog.categories || []).map(category => ({
      ...category,
      imageUrl: Object.prototype.hasOwnProperty.call(category, 'imageUrl') ? category.imageUrl : (categoryDefaults[category.id] || '')
    }));
    catalog.products = (catalog.products || []).map(product => ({
      ...product,
      addonGroups: (product.addonGroups || []).map(group => ({ ...group, priceMode: group.priceMode === 'final' ? 'final' : 'additive' }))
    }));
  }

  function applyTheme(settings) {
    const fonts = {
      arial: 'Arial, sans-serif',
      inter: 'Inter, Arial, sans-serif',
      trebuchet: '"Trebuchet MS", Arial, sans-serif',
      poppins: 'Poppins, Arial, sans-serif',
      georgia: 'Georgia, serif',
      fredoka: 'Fredoka, Arial, sans-serif'
    };
    document.documentElement.style.setProperty('--brand', settings.primaryColor);
    document.documentElement.style.setProperty('--accent', settings.accentColor);
    document.documentElement.style.setProperty('--brand-bright', settings.brandBrightColor);
    document.documentElement.style.setProperty('--paper', settings.pageColor);
    document.documentElement.style.setProperty('--surface', settings.surfaceColor);
    document.documentElement.style.setProperty('--button-bg', settings.buttonColor);
    document.documentElement.style.setProperty('--button-text', settings.buttonTextColor);
    document.documentElement.style.setProperty('--container-radius', `${settings.containerRadius}px`);
    document.documentElement.style.setProperty('--body-font', fonts[settings.bodyFont] || fonts.arial);
    document.documentElement.style.setProperty('--heading-font', fonts[settings.headingFont] || fonts.fredoka);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', settings.primaryColor);
    document.body.classList.remove('card-effect-clean','card-effect-shine','card-effect-glass','card-effect-neon');
    document.body.classList.add(`card-effect-${settings.cardEffect}`);

    const custom = String(settings.customCss || '');
    const unsafe = /@import|url\s*\(|expression\s*\(|javascript\s*:|behavior\s*:|-moz-binding|<\/?style|<script/i.test(custom);
    let style = document.querySelector('#store-custom-css');
    if (!style) {
      style = document.createElement('style');
      style.id = 'store-custom-css';
      document.head.appendChild(style);
    }
    style.textContent = unsafe ? '' : custom;
  }

  function boot() {
    const settings = catalog.settings;
    applyTheme(settings);
    applySeo(settings);
    renderLogo(settings.logoUrl, settings.storeName);
    $$('[data-store-name]').forEach(element => { element.textContent = settings.storeName; });
    $('#store-tagline').textContent = settings.tagline;
    $('#hero-eyebrow').textContent = settings.heroEyebrow;
    $('#hero-title').textContent = settings.heroTitle;
    $('#hero-highlight').textContent = settings.heroHighlight;
    $('#menu-eyebrow').textContent = settings.menuEyebrow;
    $('#menu-title').textContent = settings.menuTitle;
    $('#search').placeholder = settings.searchPlaceholder;
    $('#whatsapp-eyebrow').textContent = settings.whatsappEyebrow;
    $('#whatsapp-title').textContent = settings.whatsappTitle;
    $('#whatsapp-button-text').textContent = settings.whatsappButtonText;
    $('#marketing-consent-label').textContent = `Quero receber ofertas do ${settings.establishmentName || settings.storeName}`;
    $('#store-city').textContent = settings.city;
    $('#store-time').textContent = settings.estimatedTime;
    $('#store-fee').textContent = MenuAPI.money(settings.deliveryFee);
    $('#store-payment').textContent = settings.paymentSummary;
    const addressNode = $('#store-address');
    if (addressNode) addressNode.textContent = settings.address;
    $('#hero-image').src = settings.bannerUrl;
    $('#hero-image').alt = `Banner de ${settings.establishmentName || settings.storeName}${settings.city ? ` em ${settings.city}` : ''}`;
    const whatsappNumber = String(settings.whatsapp || '').replace(/\D/g, '');
    const whatsapp = whatsappNumber ? 'https://wa.me/' + whatsappNumber : '';
    $('#nav-whatsapp').href = whatsapp || '#';
    $('#nav-whatsapp').hidden = !whatsapp;
    $('#callout-whatsapp').href = whatsapp || '#';
    $('#callout-whatsapp').closest('.whatsapp-callout').hidden = !whatsapp;
    renderInfoStrip(settings);
    renderDailyOffer(settings);
    renderFooter(settings);
    MenuAPI.injectTracking(settings);
    renderCategories();
    renderProducts();
    bind();
    CartStore.subscribe(renderCart);
    refreshStoreStatus();
    statusTimer = window.setInterval(refreshStoreStatus, 60000);
  }

  function safeLink(value) {
    try {
      const url = new URL(String(value || ''));
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch (error) {
      return '';
    }
  }

  function absoluteAsset(value, fallback = '') {
    try {
      const url = new URL(String(value || fallback), window.location.href);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch (error) {
      return '';
    }
  }

  function setMeta(selector, content) {
    const tag = document.querySelector(selector);
    if (tag && content) tag.setAttribute('content', content);
  }

  function applySeo(settings) {
    const title = String(settings.seoTitle || settings.storeName || 'Seu Delivery').trim();
    const description = String(settings.seoDescription || settings.tagline || '').trim();
    const favicon = absoluteAsset(settings.faviconUrl, 'assets/images/favicon/favicon.svg');
    const logo = absoluteAsset(settings.logoUrl, favicon);
    const image = absoluteAsset(settings.bannerUrl, logo);
    const pageUrl = new URL('./', window.location.href).href;
    document.title = title;
    setMeta('meta[name="description"]', description);
    setMeta('meta[property="og:title"]', title);
    setMeta('meta[property="og:description"]', description);
    setMeta('meta[property="og:url"]', pageUrl);
    setMeta('meta[property="og:image"]', image);
    setMeta('meta[property="og:image:secure_url"]', image);
    setMeta('meta[name="twitter:title"]', title);
    setMeta('meta[name="twitter:description"]', description);
    setMeta('meta[name="twitter:image"]', image);
    if (favicon) document.querySelectorAll('link[rel~="icon"]').forEach(link => { link.href = favicon; });
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) canonical.href = pageUrl;
    const schema = document.querySelector('#local-business-schema');
    if (!schema) return;
    const social = [settings.instagramUrl, settings.facebookUrl, settings.tiktokUrl].map(safeLink).filter(Boolean);
    const data = {
      '@context': 'https://schema.org',
      '@type': 'Restaurant',
      name: settings.establishmentName || settings.storeName || 'Seu Delivery',
      description,
      url: pageUrl,
      image,
      logo,
      telephone: settings.contactPhone || settings.whatsapp || '',
      email: settings.publicEmail || '',
      servesCuisine: (catalog.categories || []).map(category => category.name).filter(Boolean),
      priceRange: 'R$',
      address: { '@type': 'PostalAddress', streetAddress: settings.address || '', addressLocality: settings.city || settings.locationName || '', addressCountry: 'BR' },
      areaServed: { '@type': 'City', name: settings.city || settings.locationName || '' },
      hasMenu: new URL('#cardapio', pageUrl).href
    };
    if (social.length) data.sameAs = social;
    schema.textContent = JSON.stringify(data);
  }

  function renderFooter(settings) {
    $('#footer-establishment').textContent = settings.establishmentName;
    $('#footer-address').textContent = settings.address || settings.locationName;
    $('#footer-location').textContent = settings.locationName;
    const cnpj = $('#footer-cnpj');
    const cnpjRow = $('#footer-cnpj-row');
    if (cnpj) cnpj.textContent = settings.cnpj || '';
    if (cnpjRow) cnpjRow.hidden = !settings.cnpj;
    const phone = $('#footer-phone');
    phone.textContent = settings.contactPhone;
    const phoneDigits = String(settings.contactPhone).replace(/\D/g, '');
    phone.href = phoneDigits ? 'tel:+' + (phoneDigits.startsWith('55') ? phoneDigits : '55' + phoneDigits) : '';
    phone.hidden = !phoneDigits;
    const email = $('#footer-email');
    email.textContent = settings.publicEmail;
    email.href = settings.publicEmail ? 'mailto:' + settings.publicEmail : '';
    email.hidden = !settings.publicEmail;
    const contact = $('#footer-contact');
    if (contact) contact.hidden = !phoneDigits && !settings.publicEmail;
    const social = [
      ['instagramUrl', 'Instagram', '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" class="fill"/></svg>'],
      ['facebookUrl', 'Facebook', '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M14 8h3V4h-3c-3.3 0-5 2-5 5v2H6v4h3v7h4v-7h3.3l.7-4h-4V9c0-.7.3-1 1-1Z"/></svg>'],
      ['tiktokUrl', 'TikTok', '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M14 3h3c.3 2 1.5 3.5 4 4v3c-1.5 0-2.8-.4-4-1.1V16a6 6 0 1 1-6-6h1v3a3 3 0 1 0 2 3V3Z"/></svg>']
    ];
    $('#footer-social').innerHTML = social.map(([key, name, icon]) => {
      const url = safeLink(settings[key]);
      return url ? '<a href="' + escape(url) + '" target="_blank" rel="noopener noreferrer" aria-label="' + name + '" title="' + name + '">' + icon + '</a>' : '';
    }).join('');
  }

  function safeImageUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^(assets\/|data:image\/(?:png|jpeg|webp|gif);base64,)/i.test(raw)) return raw;
    return safeLink(raw);
  }

  function renderInfoStrip(settings) {
    const labels = { service: 'Atendimento', time: 'Tempo estimado', delivery: 'Entrega', payment: 'Pagamento' };
    $$('[data-info-icon]').forEach(holder => {
      const key = holder.dataset.infoIcon;
      const fallback = holder.dataset.fallback || '●';
      const url = safeImageUrl(settings.infoStripIcons?.[key]);
      if (!url) {
        holder.textContent = fallback;
        holder.classList.remove('has-image');
        return;
      }
      const image = document.createElement('img');
      image.src = url;
      image.alt = `${labels[key] || 'Informação'} de ${settings.establishmentName || settings.storeName || 'Seu Delivery'}`;
      image.addEventListener('error', () => {
        holder.textContent = fallback;
        holder.classList.remove('has-image');
      }, { once: true });
      holder.replaceChildren(image);
      holder.classList.add('has-image');
    });
  }

  function renderDailyOffer(settings) {
    const offer = settings.dailyOffer || {};
    const container = $('#daily-offer');
    container.hidden = !offer.enabled || !String(offer.title || '').trim();
    if (container.hidden) return;
    $('#daily-offer-title').textContent = offer.title;
    $('#daily-offer-description').textContent = offer.description || '';
    $('#daily-offer-description').hidden = !offer.description;
    const link = $('#daily-offer-link');
    link.textContent = offer.buttonText || 'APROVEITAR →';
    link.href = String(offer.link || '').startsWith('#') ? offer.link : (safeLink(offer.link) || '#cardapio');
    const imageBox = $('#daily-offer-image');
    const imageUrl = safeImageUrl(offer.imageUrl);
    imageBox.hidden = !imageUrl;
    if (imageUrl) {
      const image = document.createElement('img');
      image.src = imageUrl;
      image.alt = `${offer.title || 'Oferta do dia'} de ${settings.establishmentName || settings.storeName || 'Seu Delivery'}`;
      image.addEventListener('error', () => { imageBox.hidden = true; }, { once: true });
      imageBox.replaceChildren(image);
    } else {
      imageBox.replaceChildren();
    }
  }

  function renderLogo(url, name) {
    const initials = String(name || 'Seu Delivery').trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase() || 'SD';
    $$('.brand-mark').forEach(mark => {
      if (!url) {
        mark.classList.remove('has-logo');
        mark.textContent = initials;
        mark.closest('.brand')?.classList.remove('has-image');
        return;
      }
      const image = document.createElement('img');
      image.src = url;
      image.alt = `Logo de ${name || 'Seu Delivery'}`;
      image.addEventListener('error', () => {
        mark.classList.remove('has-logo');
        mark.textContent = initials;
        mark.closest('.brand')?.classList.remove('has-image');
      }, { once: true });
      mark.replaceChildren(image);
      mark.classList.add('has-logo');
      mark.closest('.brand')?.classList.add('has-image');
    });
  }

  function imageMarkup(url, alt, fallback, lazy = true) {
    if (!url) return '<em>' + escape(fallback) + '</em>';
    return '<img src="' + escape(url) + '" alt="' + escape(alt) + '" decoding="async"' + (lazy ? ' loading="lazy"' : ' fetchpriority="high"') + '><em hidden>' + escape(fallback) + '</em>';
  }

  function bindImageFallbacks(root) {
    root.querySelectorAll('img').forEach(image => {
      image.addEventListener('error', () => {
        image.hidden = true;
        if (image.nextElementSibling) {
          image.nextElementSibling.hidden = false;
          return;
        }
        const media = image.closest('.addon-option-media');
        const option = media?.closest('.addon-option');
        if (media && option) {
          media.remove();
          option.classList.add('no-media');
        }
      }, { once: true });
    });
  }

  function renderCategories() {
    const container = $('#categories');
    const localBrand = [catalog.settings.establishmentName || catalog.settings.storeName, catalog.settings.city || catalog.settings.locationName].filter(Boolean).join(' em ');
    container.innerHTML = catalog.categories.filter(category => category.active).map(category =>
      '<button type="button" data-category="' + escape(category.id) + '" class="' + (category.id === active ? 'active' : '') + '" role="tab" aria-selected="' + (category.id === active) + '">' +
        '<span class="category-media">' + imageMarkup(category.imageUrl, `${category.name} de ${localBrand}`, category.emoji || '🥣') + '</span>' +
        '<b>' + escape(category.name) + '</b>' +
      '</button>'
    ).join('');
    bindImageFallbacks(container);
  }

  function list() {
    const normalizedQuery = normalizeSearch(query);
    return catalog.products
      .filter(product => product.active)
      .filter(product => normalizedQuery
        ? normalizeSearch([
          product.name, product.description, product.badge, product.freeShippingText,
          catalog.categories.find(category => category.id === product.categoryId)?.name,
          ...(product.addonGroups || []).flatMap(group => [group.name, ...(group.options || []).map(option => option.name)])
        ].filter(Boolean).join(' ')).includes(normalizedQuery)
        : (active === 'destaques' ? product.featured : product.categoryId === active));
  }

  function normalizeSearch(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  function startingPrice(product) {
    const finalPrices = (product.addonGroups || [])
      .filter(group => group.priceMode === 'final')
      .flatMap(group => (group.options || [])
        .filter(option => option.available !== false)
        .map(option => Number(option.price))
        .filter(price => Number.isFinite(price) && price > 0));
    return finalPrices.length ? Math.min(...finalPrices) : Number(product.price || 0);
  }

  function selectCheapestFinalOption() {
    const finalGroup = productGroups().find(group => group.priceMode === 'final' &&
      group.options.some(option => Number.isFinite(Number(option.price)) && Number(option.price) > 0));
    if (!finalGroup || (selections[finalGroup.id] || []).length) return;
    const cheapest = [...finalGroup.options]
      .filter(option => Number.isFinite(Number(option.price)) && Number(option.price) > 0)
      .sort((left, right) => Number(left.price) - Number(right.price))[0];
    if (cheapest) selections[finalGroup.id] = [cheapest];
  }

  function renderProducts() {
    const products = list();
    const container = $('#products');
    if (!products.length) {
      container.innerHTML = '<div class="empty"><span>⌕</span><h3>Nenhum produto encontrado</h3><p>Tente outro nome ou categoria.</p></div>';
      return;
    }
    container.innerHTML = products.map(product => {
      const category = catalog.categories.find(item => item.id === product.categoryId) || {};
      const localBrand = [catalog.settings.establishmentName || catalog.settings.storeName, catalog.settings.city || catalog.settings.locationName].filter(Boolean).join(' em ');
      const imageUrl = product.imageUrl || category.imageUrl || '';
      const freeShipping = product.freeShippingEnabled === true ? String(product.freeShippingText || 'Entrega grátis').trim() : '';
      const helmetIcon = '<img src="assets/images/icone-capacete-entrega-gratis.svg" alt="" aria-hidden="true">';
      return '<article class="product-card"><button type="button" data-product="' + escape(product.id) + '">' +
        '<div class="product-copy"><small>' + escape(category.name || 'Seu Delivery') + '</small><h3>' + escape(product.name) + '</h3><p>' + escape(product.description) + '</p>' +
        (freeShipping ? '<em class="free-shipping">' + helmetIcon + escape(freeShipping) + '</em>' : '') +
        '<footer><b class="product-price">' + ((product.addonGroups || []).some(group => group.priceMode === 'final') ? '<small>A partir de</small>' : '') + '<strong>' + MenuAPI.money(startingPrice(product)) + '</strong></b><span aria-hidden="true">＋</span></footer></div>' +
        '<div class="product-media">' + imageMarkup(imageUrl, `${product.name} de ${localBrand}`, category.emoji || '🥣') + (freeShipping ? '<span class="delivery-free-icon" title="Entrega grátis">' + helmetIcon + '</span>' : '') + (product.badge ? '<b>' + escape(product.badge) + '</b>' : '') + '</div>' +
      '</button></article>';
    }).join('');
    bindImageFallbacks(container);
  }

  function productGroups() {
    return (selected?.addonGroups || [])
      .map(group => ({ ...group, options: (group.options || []).filter(option => option.available !== false) }))
      .filter(group => group.options.length);
  }

  function normalizeOptionName(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function isSizeGroup(group) {
    return /tamanho|copo|volume|\bml\b/.test(normalizeOptionName(group?.name));
  }

  function optionMedia(option) {
    const imageUrl = String(option.imageUrl || '').trim();
    if (!imageUrl) return '';
    return '<img src="' + escape(imageUrl) + '" alt="' + escape(option.name) + '" decoding="async" loading="lazy">';
  }

  function validateGroup(group) {
    const minimum = Number(group?.min || 0);
    const chosen = (selections[group?.id] || []).length;
    const field = [...$('#addon-list').querySelectorAll('fieldset')]
      .find(item => item.dataset.group === String(group?.id));
    field?.classList.toggle('invalid', chosen < minimum);
    if (chosen >= minimum) return true;
    const error = $('#product-error');
    error.textContent = 'Escolha ' + minimum + (minimum === 1 ? ' opção' : ' opções') + ' em “' + group.name + '” para adicionar o produto.';
    error.hidden = false;
    field?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    field?.querySelector('input')?.focus({ preventScroll: true });
    return false;
  }

  function renderProductStep() {
    if (!selected) return;
    const groups = productGroups();
    const addonList = $('#addon-list');
    $('#product-step-label').textContent = 'PERSONALIZE SEU PEDIDO';
    $('#product-step-title').textContent = 'Escolha todas as opções';
    $('#product-notes').hidden = false;
    $('#product-quantity').hidden = false;
    $('#product-overlay .modal-footer').classList.remove('review-mode');
    $('#product-error').hidden = true;

    if (groups.length) {
      addonList.innerHTML = groups.map(group => {
        const maximum = Number(group.max || 1);
        const minimum = Number(group.min || 0);
        const hideMedia = isSizeGroup(group);
        return '<fieldset data-group="' + escape(group.id) + '"><legend><span><b>' + escape(group.name) + '</b><small>' +
          (minimum ? 'Escolha pelo menos ' + minimum : 'Opcional') + ' · até ' + maximum +
          '</small></span>' + (minimum ? '<em>OBRIGATÓRIO</em>' : '') + '</legend><div class="addon-options">' +
          group.options.map(option => {
            const checked = (selections[group.id] || []).some(item => item.id === option.id);
            const media = hideMedia ? '' : optionMedia(option);
            return '<label class="addon-option' + (!media ? ' no-media' : '') + (checked ? ' selected' : '') + '"><input type="' + (maximum === 1 ? 'radio' : 'checkbox') +
              '" name="group-' + escape(group.id) + '" value="' + escape(option.id) + '"' + (checked ? ' checked' : '') +
              '>' + (media ? '<span class="addon-option-media">' + media + '</span>' : '') + '<span class="addon-option-copy"><b>' +
              escape(option.name) + '</b><small>' + (group.priceMode === 'final' ? MenuAPI.money(option.price) : (option.price ? '+ ' + MenuAPI.money(option.price) : 'Incluso')) +
              '</small></span><i aria-hidden="true"></i></label>';
          }).join('') + '</div></fieldset>';
      }).join('');
      bindImageFallbacks(addonList);
    } else {
      addonList.innerHTML = '<section class="product-review"><p>Este produto não precisa de opções adicionais.</p></section>';
    }
    updateProductTotal();
  }

  function openProduct(id, trigger) {
    selected = catalog.products.find(product => product.id === id);
    if (!selected) return;
    productTrigger = trigger || document.activeElement;
    selections = {};
    quantity = 1;
    productStep = 0;
    const category = catalog.categories.find(item => item.id === selected.categoryId) || {};
    const displayPrice = startingPrice(selected);
    selectCheapestFinalOption();
    MenuAPI.trackEcommerce('view_item', [{
      productId: selected.id,
      name: selected.name,
      basePrice: displayPrice,
      unitTotal: displayPrice,
      quantity: 1
    }], { value: displayPrice });
    $('#product-image').src = selected.imageUrl || category.imageUrl || catalog.settings.bannerUrl;
    $('#product-image').alt = selected.name;
    $('#product-name').textContent = selected.name;
    $('#product-description').textContent = selected.description;
    $('#product-base-price').textContent = MenuAPI.money(displayPrice);
    const freeShipping = selected.freeShippingEnabled === true;
    $('#product-modal-free-badge').hidden = !freeShipping;
    $('#product-delivery-label').textContent = freeShipping ? 'entrega grátis' : 'Com entrega';
    $('#product-delivery-label').classList.toggle('free', freeShipping);
    $('#item-notes').value = '';
    renderProductStep();
    const overlay = $('#product-overlay');
    overlay.hidden = false;
    overlay.scrollTop = 0;
    syncBodyLock();
    requestAnimationFrame(() => $('#product-overlay .product-presentation-close')?.focus());
  }

  function changeSelection(input) {
    if (!selected) return;
    const field = input.closest('fieldset');
    const group = productGroups().find(item => item.id === field.dataset.group);
    if (!group) return;
    const option = group.options.find(item => item.id === input.value);
    if (!option) return;
    const current = selections[group.id] || [];
    if (Number(group.max || 1) === 1) {
      selections[group.id] = input.checked ? [option] : [];
      field.querySelectorAll('.addon-option').forEach(label => label.classList.toggle('selected', label.contains(input)));
    } else if (input.checked) {
      if (current.length >= Number(group.max || 1)) {
        input.checked = false;
        const error = $('#product-error');
        error.textContent = 'Você pode escolher até ' + Number(group.max || 1) + ' opções em “' + group.name + '”.';
        error.hidden = false;
        return;
      }
      selections[group.id] = [...current, option];
      input.closest('.addon-option').classList.add('selected');
    } else {
      selections[group.id] = current.filter(item => item.id !== option.id);
      input.closest('.addon-option').classList.remove('selected');
    }
    field.classList.remove('invalid');
    $('#product-error').hidden = true;
    updateProductTotal();
  }

  function unitTotal() {
    const groups = productGroups();
    const finalGroup = groups.find(group => group.priceMode === 'final' && (selections[group.id] || []).length);
    const base = finalGroup ? Number(selections[finalGroup.id][0].price || 0) : Number(selected?.price || 0);
    const additions = groups
      .filter(group => group.priceMode !== 'final')
      .reduce((sum, group) => sum + (selections[group.id] || []).reduce((groupSum, option) => groupSum + Number(option.price || 0), 0), 0);
    return base + additions;
  }

  function updateProductTotal() {
    $('#item-quantity').textContent = quantity;
    const currentUnitTotal = unitTotal();
    const total = currentUnitTotal * quantity;
    $('#product-base-price').textContent = MenuAPI.money(currentUnitTotal);
    $('#product-action-price').textContent = MenuAPI.money(total);
    $('#add-to-cart').textContent = 'Adicionar ao pedido';
  }

  function advanceProduct() {
    if (!selected) return;
    addProduct();
  }

  function previousProductStep() {
    if (!selected) return;
    if (productStep === 0) {
      closeProduct();
      return;
    }
    productStep -= 1;
    renderProductStep();
  }

  function addProduct() {
    if (!selected) return;
    for (const group of productGroups()) {
      if (!validateGroup(group)) return;
    }
    const selectedCategory = (catalog.categories || []).find(category => String(category.id) === String(selected.categoryId)) || {};
    const cartItem = {
      productId: selected.id,
      name: selected.name,
      categoryId: selected.categoryId || '',
      categoryName: selectedCategory.name || '',
      imageUrl: selected.imageUrl,
      basePrice: selected.price,
      quantity,
      selections: (selected.addonGroups || [])
        .filter(group => (selections[group.id] || []).length)
        .map(group => ({ groupId: group.id, groupName: group.name, priceMode: group.priceMode || 'additive', options: selections[group.id] })),
      notes: $('#item-notes').value.trim(),
      unitTotal: unitTotal(),
      freeShippingEnabled: selected.freeShippingEnabled === true
    };
    CartStore.add(cartItem);
    MenuAPI.trackEcommerce('add_to_cart', [cartItem]);
    closeProduct(false, true);
    openCart();
  }

  function closeProduct(restoreFocus = true, keepLocked = false) {
    const overlay = $('#product-overlay');
    if (overlay.hidden) return;
    overlay.hidden = true;
    selected = null;
    selections = {};
    productStep = 0;
    if (!keepLocked) syncBodyLock();
    if (restoreFocus) productTrigger?.focus?.();
  }

  function renderCart() {
    const items = CartStore.get();
    const count = CartStore.count();
    const subtotal = CartStore.subtotal();
    $$('[data-cart-count]').forEach(element => { element.textContent = count; });
    $('#cart-subtotal').textContent = MenuAPI.money(subtotal);
    $('#mobile-total').textContent = MenuAPI.money(subtotal);
    $$('.mobile-cart').forEach(element => { element.hidden = !count; });
    $('#cart-footer').hidden = !count;
    const suggestions = getCartSuggestions(items);
    $('#cart-items').innerHTML = items.length ?
      '<div class="cart-lines">' + items.map(item => {
        const product = catalog.products.find(current => current.id === item.productId) || {};
        const category = catalog.categories.find(current => current.id === product.categoryId) || {};
        const imageUrl = item.imageUrl || product.imageUrl || category.imageUrl || '';
        return '<article class="cart-line"><div class="cart-product-image">' + imageMarkup(imageUrl, item.name, category.emoji || '🥣') + '</div><div class="cart-product-info">' +
          '<header><div><b>' + escape(item.name) + '</b><strong>' + MenuAPI.money(item.unitTotal * item.quantity) +
          '</strong></div></header>' +
          (item.selections || []).map(selection => '<p>' + escape(selection.groupName) + ': ' + selection.options.map(option => escape(option.name)).join(', ') + '</p>').join('') +
          (item.notes ? '<p>Obs: ' + escape(item.notes) + '</p>' : '') +
          '<div class="cart-item-actions"><div class="quantity small"><button type="button" data-minus="' + escape(item.cartId) + '" aria-label="Diminuir quantidade">−</button><b>' + item.quantity +
          '</b><button type="button" data-plus="' + escape(item.cartId) + '" aria-label="Aumentar quantidade">+</button></div><button class="cart-remove" type="button" data-remove="' +
          escape(item.cartId) + '" aria-label="Remover produto"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg></button></div></div></article>';
      }).join('') + '</div>' + renderCartSuggestions(suggestions) :
      '<div class="empty"><span>🛍</span><h3>Seu carrinho está vazio</h3><p>Escolha seus favoritos no cardápio.</p></div>';
    bindImageFallbacks($('#cart-items'));
    applyStoreStateToCheckout();
  }

  function handleCartClick(event) {
    const button = event.target.closest('button');
    if (!button || !$('#cart-items').contains(button)) return;
    const items = CartStore.get();
    if (button.dataset.remove) {
      CartStore.remove(button.dataset.remove);
      return;
    }
    if (button.dataset.minus || button.dataset.plus) {
      const cartId = button.dataset.minus || button.dataset.plus;
      const item = items.find(current => current.cartId === cartId);
      if (item) CartStore.quantity(cartId, item.quantity + (button.dataset.plus ? 1 : -1));
      return;
    }
    if (button.dataset.suggestion) {
      const productId = button.dataset.suggestion;
      closeCart();
      openProduct(productId, button);
    }
  }

  function getCartSuggestions(items) {
    const inCart = new Set(items.map(item => item.productId));
    const complementary = /bebida|refrigerante|coca|fanta|suco|pastel|porç|batata|acompanhamento/i;
    return catalog.products
      .filter(product => product.active && !inCart.has(product.id))
      .map((product, index) => {
        const category = catalog.categories.find(item => item.id === product.categoryId) || {};
        const text = `${product.name} ${category.name || ''}`;
        const score = (complementary.test(text) ? 100 : 0) + (product.featured ? 10 : 0) - index;
        return { product, category, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);
  }

  function renderCartSuggestions(suggestions) {
    if (!suggestions.length) return '';
    return '<section class="cart-suggestions"><header><small>COMBINA COM SEU PEDIDO</small><h3>Peça também</h3></header><div class="suggestion-track">' + suggestions.map(({ product, category }) => {
      const imageUrl = product.imageUrl || category.imageUrl || '';
      return '<button type="button" class="suggestion-card" data-suggestion="' + escape(product.id) + '">' +
        '<span class="suggestion-image">' + imageMarkup(imageUrl, product.name, category.emoji || '🥣') + '<i>＋</i></span>' +
        '<b>' + MenuAPI.money(product.price) + '</b><strong>' + escape(product.name) + '</strong>' +
      '</button>';
    }).join('') + '</div></section>';
  }

  function minutes(value) {
    const [hour, minute] = String(value || '00:00').split(':').map(Number);
    return (hour * 60) + minute;
  }

  function zonedNow(settings) {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: settings.timezone || 'America/Sao_Paulo',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
      });
      const parts = Object.fromEntries(formatter.formatToParts(new Date()).map(part => [part.type, part.value]));
      return {
        day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday),
        minute: (Number(parts.hour) * 60) + Number(parts.minute)
      };
    } catch (error) {
      const now = new Date();
      return { day: now.getDay(), minute: (now.getHours() * 60) + now.getMinutes() };
    }
  }

  function calculateStoreState(settings = catalog.settings) {
    const mode = settings.statusMode || (settings.open === false ? 'closed' : 'open');
    if (mode === 'open') return { open: true, text: 'Aberto e recebendo pedidos', mode };
    if (mode === 'closed') return { open: false, text: 'Fechado no momento', mode };
    const hours = settings.hours || {};
    const now = zonedNow(settings);
    const current = hours[dayKeys[now.day]];
    const previous = hours[dayKeys[(now.day + 6) % 7]];
    let closing = '';

    if (current?.enabled) {
      const start = minutes(current.open);
      const end = minutes(current.close);
      if ((end > start && now.minute >= start && now.minute < end) || (end <= start && now.minute >= start)) {
        closing = current.close;
      }
    }
    if (!closing && previous?.enabled && minutes(previous.close) <= minutes(previous.open) && now.minute < minutes(previous.close)) {
      closing = previous.close;
    }
    if (closing) return { open: true, text: 'Aberto agora · até ' + closing, mode };

    let nextText = '';
    for (let offset = 0; offset < 7; offset += 1) {
      const index = (now.day + offset) % 7;
      const schedule = hours[dayKeys[index]];
      if (!schedule?.enabled) continue;
      if (offset === 0 && now.minute < minutes(schedule.open)) nextText = ' · abre às ' + schedule.open;
      else if (offset === 1) nextText = ' · abre amanhã às ' + schedule.open;
      else if (offset > 1) nextText = ' · abre ' + weekLabels[index] + ' às ' + schedule.open;
      if (nextText) break;
    }
    return { open: false, text: 'Fechado agora' + nextText, mode };
  }

  function renderHoursModal() {
    const settings = catalog.settings;
    const today = zonedNow(settings).day;
    const state = calculateStoreState(settings);
    const hours = settings.hours || {};
    $('#hours-store-status').textContent = state.text;
    $('#hours-store-status').classList.toggle('closed', !state.open);
    $('#hours-list').innerHTML = dayKeys.map((key, index) => {
      const schedule = hours[key] || {};
      const label = weekLabels[index].charAt(0).toUpperCase() + weekLabels[index].slice(1);
      const value = schedule.enabled ? `${schedule.open || '00:00'} às ${schedule.close || '23:59'}` : 'Fechado';
      return `<div class="hours-row-public ${index === today ? 'today' : ''} ${schedule.enabled ? '' : 'closed'}"><span>${index === today ? '<small>HOJE</small>' : ''}<b>${escape(label)}</b></span><strong>${escape(value)}</strong></div>`;
    }).join('');
  }

  function openHours() {
    renderHoursModal();
    $('#hours-overlay').hidden = false;
    syncBodyLock();
    requestAnimationFrame(() => $('[data-close-hours]')?.focus());
  }

  function closeHours() {
    $('#hours-overlay').hidden = true;
    syncBodyLock();
  }

  function applyStoreStateToCheckout() {
    if (!catalog) return;
    const state = calculateStoreState();
    window.CARDAPIO_STORE_STATE = state;
    const button = $('#start-checkout');
    button.disabled = false;
    button.textContent = state.open ? 'Finalizar pedido →' : 'Reservar pedido →';
    $('#minimum-order').textContent = state.open
      ? 'Pedido mínimo para entrega: ' + MenuAPI.money(catalog.settings.minOrder)
      : state.text;
  }

  function refreshStoreStatus() {
    const state = calculateStoreState();
    window.CARDAPIO_STORE_STATE = state;
    const status = $('#store-status');
    status.textContent = state.text;
    status.classList.toggle('closed', !state.open);
    if (!$('#hours-overlay').hidden) renderHoursModal();
    applyStoreStateToCheckout();
  }

  function syncBodyLock() {
    const locked = !$('#product-overlay').hidden || $('#cart').classList.contains('open') || !$('#checkout-overlay').hidden || !$('#hours-overlay').hidden;
    const active = document.body.classList.contains('no-scroll');
    if (locked && !active) {
      lockedScrollY = window.scrollY;
      document.body.style.top = `-${lockedScrollY}px`;
      document.body.classList.add('no-scroll');
    } else if (!locked && active) {
      document.body.classList.remove('no-scroll');
      document.body.style.top = '';
      window.scrollTo(0, lockedScrollY);
    }
  }

  function openCart() {
    $('#cart').classList.add('open');
    $('#cart').setAttribute('aria-hidden', 'false');
    $('#cart-backdrop').hidden = false;
    syncBodyLock();
    requestAnimationFrame(() => {
      $('#cart-items').scrollTop = 0;
      $('[data-close-cart]')?.focus();
    });
  }

  function closeCart() {
    $('#cart').classList.remove('open');
    $('#cart').setAttribute('aria-hidden', 'true');
    $('#cart-backdrop').hidden = true;
    syncBodyLock();
  }

  function bind() {
    $('#search').addEventListener('input', event => {
      query = event.target.value;
      renderProducts();
    });
    $('#focus-search').addEventListener('click', () => {
      const input = $('#search');
      input.focus({ preventScroll: true });
      query = input.value;
      renderProducts();
    });
    $('#categories').addEventListener('click', event => {
      const button = event.target.closest('[data-category]');
      if (!button || !$('#categories').contains(button)) return;
      active = button.dataset.category;
      query = '';
      $('#search').value = '';
      renderCategories();
      renderProducts();
    });
    $('#products').addEventListener('click', event => {
      const button = event.target.closest('[data-product]');
      if (!button || !$('#products').contains(button)) return;
      openProduct(button.dataset.product, button);
    });
    $('#addon-list').addEventListener('change', event => {
      if (event.target.matches('input')) changeSelection(event.target);
    });
    $$('[data-open-cart]').forEach(button => button.addEventListener('click', openCart));
    $('#cart-items').addEventListener('click', handleCartClick);
    $('[data-close-cart]').addEventListener('click', closeCart);
    $('#cart-backdrop').addEventListener('click', closeCart);
    $$('[data-open-hours]').forEach(button => button.addEventListener('click', openHours));
    $$('[data-close-hours]').forEach(button => button.addEventListener('click', closeHours));
    $('#hours-overlay').addEventListener('click', event => {
      if (event.target.id === 'hours-overlay') closeHours();
    });
    $$('[data-close-product]').forEach(button => button.addEventListener('click', () => closeProduct()));
    $('#product-overlay').addEventListener('click', event => {
      if (event.target.id === 'product-overlay') closeProduct();
    });
    $('[data-qty-minus]').addEventListener('click', () => {
      quantity = Math.max(1, quantity - 1);
      updateProductTotal();
    });
    $('[data-qty-plus]').addEventListener('click', () => {
      quantity += 1;
      updateProductTotal();
    });
    $('#product-step-back').addEventListener('click', previousProductStep);
    $('#add-to-cart').addEventListener('click', advanceProduct);
    $('#start-checkout').addEventListener('click', () => {
      const state = calculateStoreState();
      const reservation = !state.open;
      closeCart();
      if (Checkout.open(catalog, { reservation })) {
        MenuAPI.trackEcommerce('begin_checkout', CartStore.get(), {
          value: CartStore.subtotal(),
          checkout_mode: reservation ? 'reservation' : 'order'
        });
      }
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (!$('#checkout-overlay').hidden) Checkout.close();
      else if (!$('#product-overlay').hidden) closeProduct();
      else if ($('#cart').classList.contains('open')) closeCart();
      else if (!$('#hours-overlay').hidden) closeHours();
    });
  }

  window.addEventListener('beforeunload', () => clearInterval(statusTimer));
  window.syncMenuScroll = syncBodyLock;
  window.MenuStoreStatus = { get: () => calculateStoreState(), refresh: refreshStoreStatus };
})();
