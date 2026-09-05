(function () {
  'use strict';

  const CONSENT_COOKIE = 'cardapio_consent_v1';
  const ATTRIBUTION_COOKIE = 'cardapio_attribution_v1';
  const CONSENT_VERSION = 1;
  const CONSENT_MAX_AGE = 60 * 60 * 24 * 180;
  const ATTRIBUTION_MAX_AGE = 60 * 60 * 24 * 90;
  const defaultState = {
    version: CONSENT_VERSION,
    necessary: true,
    analytics: false,
    marketing: false,
    decided: false,
    updatedAt: ''
  };

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  window.gtag('consent', 'default', {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    functionality_storage: 'granted',
    security_storage: 'granted',
    wait_for_update: 500
  });

  function readCookie(name) {
    const prefix = encodeURIComponent(name) + '=';
    const value = document.cookie.split(';').map(function (part) { return part.trim(); })
      .find(function (part) { return part.indexOf(prefix) === 0; });
    if (!value) return '';
    try { return decodeURIComponent(value.slice(prefix.length)); }
    catch (error) { return ''; }
  }

  function writeCookie(name, value, maxAge) {
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = encodeURIComponent(name) + '=' + encodeURIComponent(value) +
      '; Path=/; Max-Age=' + maxAge + '; SameSite=Lax' + secure;
  }

  function expireCookie(name) {
    document.cookie = encodeURIComponent(name) + '=; Path=/; Max-Age=0; SameSite=Lax';
  }

  function normalizeState(value) {
    if (!value || value.version !== CONSENT_VERSION || value.necessary !== true) {
      return { ...defaultState };
    }
    return {
      version: CONSENT_VERSION,
      necessary: true,
      analytics: value.analytics === true,
      marketing: value.marketing === true,
      decided: value.decided === true,
      updatedAt: String(value.updatedAt || '')
    };
  }

  function loadState() {
    try { return normalizeState(JSON.parse(readCookie(CONSENT_COOKIE))); }
    catch (error) { return { ...defaultState }; }
  }

  let state = loadState();

  function consentSignals(value) {
    return {
      analytics_storage: value.analytics ? 'granted' : 'denied',
      ad_storage: value.marketing ? 'granted' : 'denied',
      ad_user_data: value.marketing ? 'granted' : 'denied',
      ad_personalization: value.marketing ? 'granted' : 'denied',
      functionality_storage: 'granted',
      security_storage: 'granted'
    };
  }

  function applyConsent(value, eventName) {
    window.gtag('consent', value.decided ? 'update' : 'default', consentSignals(value));
    window.dataLayer.push({
      event: eventName || 'cardapio_consent_state',
      cookie_analytics_consent: value.analytics,
      cookie_marketing_consent: value.marketing,
      consent_version: value.version
    });
  }

  function safeValue(value, limit) {
    return String(value || '').trim().slice(0, limit || 160);
  }

  function referrerHost() {
    if (!document.referrer) return '';
    try {
      const referrer = new URL(document.referrer);
      return referrer.hostname === location.hostname ? '' : safeValue(referrer.hostname, 120);
    } catch (error) {
      return '';
    }
  }

  function captureTouch() {
    const params = new URLSearchParams(location.search);
    const gclid = safeValue(params.get('gclid'), 180);
    const fbclid = safeValue(params.get('fbclid'), 180);
    const ttclid = safeValue(params.get('ttclid'), 180);
    const referrer = referrerHost();
    let source = safeValue(params.get('utm_source'), 120);
    let medium = safeValue(params.get('utm_medium'), 120);
    if (!source && gclid) source = 'google';
    if (!source && fbclid) source = 'meta';
    if (!source && ttclid) source = 'tiktok';
    if (!source && referrer) source = referrer;
    if (!source) source = 'direct';
    if (!medium && (gclid || fbclid || ttclid)) medium = 'paid';
    if (!medium && referrer) medium = 'referral';
    if (!medium) medium = 'direct';
    return {
      source: source,
      medium: medium,
      campaign: safeValue(params.get('utm_campaign'), 160),
      content: safeValue(params.get('utm_content'), 160),
      term: safeValue(params.get('utm_term'), 160),
      src: safeValue(params.get('src'), 160),
      sck: safeValue(params.get('sck'), 160),
      gclid: gclid,
      fbclid: fbclid,
      ttclid: ttclid,
      referrer: referrer,
      landingPage: safeValue(location.pathname, 180),
      capturedAt: new Date().toISOString()
    };
  }

  const currentTouch = captureTouch();

  function hasCampaignTouch(touch) {
    return Boolean(touch && (
      touch.campaign || touch.content || touch.term || touch.gclid || touch.fbclid ||
      touch.ttclid || touch.referrer || (touch.source && touch.source !== 'direct')
    ));
  }

  function readAttribution() {
    try {
      const value = JSON.parse(readCookie(ATTRIBUTION_COOKIE));
      return value && value.firstTouch && value.lastTouch ? value : null;
    } catch (error) {
      return null;
    }
  }

  let attribution = readAttribution();

  function persistAttribution() {
    if (!state.decided || (!state.analytics && !state.marketing)) {
      attribution = null;
      expireCookie(ATTRIBUTION_COOKIE);
      return;
    }
    const existing = readAttribution();
    const firstTouch = existing && existing.firstTouch ? existing.firstTouch : currentTouch;
    const lastTouch = hasCampaignTouch(currentTouch)
      ? currentTouch
      : (existing && existing.lastTouch ? existing.lastTouch : currentTouch);
    attribution = { version: 1, firstTouch: firstTouch, lastTouch: lastTouch };
    writeCookie(ATTRIBUTION_COOKIE, JSON.stringify(attribution), ATTRIBUTION_MAX_AGE);
    window.dataLayer.push({
      event: 'cardapio_traffic_source_ready',
      traffic_source: lastTouch.source,
      traffic_medium: lastTouch.medium,
      traffic_campaign: lastTouch.campaign,
      traffic_content: lastTouch.content,
      traffic_term: lastTouch.term
    });
  }

  function clearMarketingCookies() {
    ['_fbp', '_fbc', '_gcl_au', '_gcl_aw'].forEach(expireCookie);
  }

  function save(next) {
    const previous = { ...state };
    state = normalizeState({
      version: CONSENT_VERSION,
      necessary: true,
      analytics: next.analytics === true,
      marketing: next.marketing === true,
      decided: true,
      updatedAt: new Date().toISOString()
    });
    writeCookie(CONSENT_COOKIE, JSON.stringify(state), CONSENT_MAX_AGE);
    if (!state.marketing) clearMarketingCookies();
    applyConsent(state, 'cardapio_consent_update');
    persistAttribution();
    renderVisibility();
    window.dispatchEvent(new CustomEvent('cardapio:consent-changed', { detail: get() }));

    if (previous.decided && previous.marketing !== state.marketing) {
      window.setTimeout(function () { window.location.reload(); }, 180);
    }
  }

  function get() {
    return { ...state };
  }

  function getAttribution() {
    if (!state.decided || (!state.analytics && !state.marketing)) return null;
    if (!attribution) persistAttribution();
    return attribution ? JSON.parse(JSON.stringify(attribution)) : null;
  }

  function forOrder() {
    const value = getAttribution();
    if (!value) return null;
    return {
      first_touch: value.firstTouch,
      last_touch: value.lastTouch
    };
  }

  function showPreferences() {
    const banner = document.getElementById('cookie-consent');
    const preferences = document.getElementById('cookie-preferences');
    if (!banner || !preferences) return;
    document.getElementById('consent-analytics').checked = state.analytics;
    document.getElementById('consent-marketing').checked = state.marketing;
    banner.hidden = true;
    preferences.hidden = false;
    document.body.classList.add('cookie-dialog-open');
    document.getElementById('consent-analytics').focus();
  }

  function closePreferences() {
    const preferences = document.getElementById('cookie-preferences');
    if (preferences) preferences.hidden = true;
    document.body.classList.remove('cookie-dialog-open');
    renderVisibility();
  }

  function renderVisibility() {
    const banner = document.getElementById('cookie-consent');
    const preferences = document.getElementById('cookie-preferences');
    if (preferences && !preferences.hidden) return;
    if (banner) banner.hidden = state.decided;
    document.body.classList.toggle('cookie-banner-visible', !state.decided);
  }

  function createInterface() {
    if (document.getElementById('cookie-consent')) return;
    const container = document.createElement('div');
    container.innerHTML =
      '<section class="cookie-consent" id="cookie-consent" role="dialog" aria-modal="false" aria-labelledby="cookie-title" hidden>' +
        '<div class="cookie-copy"><span class="cookie-icon" aria-hidden="true">🍪</span><div>' +
          '<h2 id="cookie-title">Sua privacidade importa</h2>' +
          '<p>Usamos cookies necessários para o cardápio funcionar. Com sua autorização, também medimos acessos e personalizamos anúncios. <a href="politicas.html#cookies">Saiba mais</a>.</p>' +
        '</div></div>' +
        '<div class="cookie-actions">' +
          '<button type="button" class="cookie-button secondary" data-consent-necessary>Somente necessários</button>' +
          '<button type="button" class="cookie-button secondary" data-consent-customize>Personalizar</button>' +
          '<button type="button" class="cookie-button primary" data-consent-all>Aceitar todos</button>' +
        '</div>' +
      '</section>' +
      '<div class="cookie-preferences-backdrop" id="cookie-preferences" hidden>' +
        '<section class="cookie-preferences" role="dialog" aria-modal="true" aria-labelledby="cookie-preferences-title">' +
          '<button type="button" class="cookie-close" data-consent-close aria-label="Fechar">×</button>' +
          '<header><small>CONTROLE DE PRIVACIDADE</small><h2 id="cookie-preferences-title">Personalizar cookies</h2><p>Você pode mudar esta escolha quando quiser pelo rodapé do cardápio.</p></header>' +
          '<div class="cookie-options">' +
            '<label><span><b>Necessários</b><small>Carrinho, segurança e registro da sua escolha.</small></span><input type="checkbox" checked disabled></label>' +
            '<label><span><b>Analytics</b><small>Mede acessos, origem da visita e desempenho do cardápio.</small></span><input id="consent-analytics" type="checkbox"></label>' +
            '<label><span><b>Marketing</b><small>Permite Meta e Google Ads para medição e remarketing.</small></span><input id="consent-marketing" type="checkbox"></label>' +
          '</div>' +
          '<footer><button type="button" class="cookie-button secondary" data-consent-necessary>Somente necessários</button><button type="button" class="cookie-button primary" data-consent-save>Salvar escolhas</button></footer>' +
        '</section>' +
      '</div>';
    while (container.firstChild) document.body.appendChild(container.firstChild);

    document.querySelectorAll('[data-consent-all]').forEach(function (button) {
      button.addEventListener('click', function () { save({ analytics: true, marketing: true }); });
    });
    document.querySelectorAll('[data-consent-necessary]').forEach(function (button) {
      button.addEventListener('click', function () { save({ analytics: false, marketing: false }); });
    });
    document.querySelectorAll('[data-consent-customize]').forEach(function (button) {
      button.addEventListener('click', showPreferences);
    });
    document.querySelectorAll('[data-consent-close]').forEach(function (button) {
      button.addEventListener('click', closePreferences);
    });
    document.querySelector('[data-consent-save]').addEventListener('click', function () {
      save({
        analytics: document.getElementById('consent-analytics').checked,
        marketing: document.getElementById('consent-marketing').checked
      });
    });
    document.getElementById('cookie-preferences').addEventListener('click', function (event) {
      if (event.target.id === 'cookie-preferences') closePreferences();
    });

    const footerNav = document.querySelector('.footer-bottom nav');
    if (footerNav && !footerNav.querySelector('[data-cookie-settings]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cookie-settings-link';
      button.dataset.cookieSettings = '';
      button.textContent = 'Configurar cookies';
      button.addEventListener('click', showPreferences);
      footerNav.appendChild(button);
    }
    document.querySelectorAll('[data-cookie-settings]').forEach(function (button) {
      if (!button.dataset.cookieBound) {
        button.dataset.cookieBound = '1';
        button.addEventListener('click', showPreferences);
      }
    });
    renderVisibility();
  }

  applyConsent(state, 'cardapio_consent_default');
  if (state.decided) persistAttribution();

  window.MenuConsent = {
    get: get,
    save: save,
    open: showPreferences,
    getAttribution: getAttribution
  };
  window.MenuAttribution = { get: getAttribution, forOrder: forOrder };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createInterface);
  } else {
    createInterface();
  }
})();