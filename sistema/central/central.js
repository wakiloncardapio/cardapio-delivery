(function () {
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  const db = () => SupabaseStore.getClient();
  const DEMO_STORE_ID = '00000000-0000-0000-0000-000000000001';
  let platform = { stores: [], members: [], domains: [], branding: { logo_url: '' } };
  let query = '';
  let statusFilter = 'all';

  function notice(message, error = false, link = '') {
    const box = $('#notice');
    box.className = `notice${error ? ' error' : ''}`;
    box.innerHTML = `<span>${esc(message)}</span>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(link)}</a>` : ''}`;
    box.hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showLoginError(message) {
    $('#login-error').textContent = message;
    $('#login-error').hidden = false;
  }

  async function invoke(action, payload = {}) {
    const { data, error } = await db().functions.invoke('platform-admin', { body: { action, ...payload } });
    if (error) {
      let message = error.message || 'Falha na Central Seu Food.';
      try {
        const detail = await error.context?.clone?.().json();
        if (detail?.error) message = detail.error;
      } catch (_) {}
      throw new Error(message);
    }
    if (data?.error) throw new Error(data.error);
    return data || {};
  }

  function updateMetrics() {
    $('#metric-stores').textContent = platform.stores.length;
    $('#metric-active').textContent = platform.stores.filter(store => store.status === 'active').length;
    $('#metric-members').textContent = platform.members.filter(member => member.active).length;
    $('#metric-domains').textContent = platform.domains.length;
  }

  function applyPlatformBranding() {
    const logoUrl = String(platform.branding?.logo_url || '');
    document.querySelectorAll('[data-platform-logo]').forEach(mark => {
      if (!logoUrl) {
        mark.classList.remove('has-image');
        mark.textContent = 'SF';
        return;
      }
      mark.innerHTML = `<img src="${esc(logoUrl)}" alt="Logo do painel Seu Food">`;
      mark.classList.add('has-image');
      mark.querySelector('img').addEventListener('error', () => {
        mark.classList.remove('has-image');
        mark.textContent = 'SF';
      }, { once: true });
    });
    const removeButton = $('#platform-logo-remove');
    if (removeButton) removeButton.hidden = !logoUrl;
  }

  async function loadPublicBranding() {
    const { data } = await db().from('catalogs').select('data')
      .eq('store_id', DEMO_STORE_ID).eq('id', 'settings').maybeSingle();
    platform.branding = { logo_url: String(data?.data?.platformLogoUrl || '') };
    applyPlatformBranding();
  }

  function publicUrl(store) {
    const url = new URL('../../', window.location.href);
    url.searchParams.set('loja', store.slug);
    return url.href;
  }

  function adminUrl(store) {
    const url = new URL('../admin/', window.location.href);
    url.searchParams.set('loja', store.slug);
    return url.href;
  }

  function storeMembers(storeId) {
    return platform.members.filter(member => member.store_id === storeId);
  }

  function storeDomains(storeId) {
    return platform.domains.filter(domain => domain.store_id === storeId);
  }

  function storeLogo(store, className = 'store-avatar') {
    const initial = String(store.name || 'E').trim()[0]?.toUpperCase() || 'E';
    return store.logo_url
      ? `<span class="${className} has-image"><img src="${esc(store.logo_url)}" alt="Logo de ${esc(store.name)}"></span>`
      : `<span class="${className}">${esc(initial)}</span>`;
  }

  async function saveStoreLogo(storeId, logoUrl) {
    const result = await invoke('update_store', { storeId, logoUrl });
    platform = result.platform;
    render();
  }

  async function uploadStoreLogo(store, file, folder = 'logos', suggestedName = '') {
    if (!file) return '';
    SupabaseStore.chooseStore(store);
    return SupabaseStore.uploadImage(file, folder, suggestedName || `${store.name}-logo`);
  }

  function memberMarkup(store) {
    const members = storeMembers(store.id);
    return `
      <div class="member-list">${members.length ? members.map(member => `
        <div class="member-row"><span><b>${esc(member.email || member.user_id)}</b><small>${esc(member.role)} · ${member.active ? 'acesso liberado' : 'acesso suspenso'}</small></span>
        <button class="${member.active ? 'off' : ''}" data-member-active="${esc(member.user_id)}" data-store-id="${store.id}" data-active="${member.active ? 'false' : 'true'}">${member.active ? 'Suspender' : 'Liberar'}</button></div>
      `).join('') : '<div class="empty">Nenhum responsável vinculado.</div>'}</div>
      <form class="member-form" data-member-form="${store.id}"><label>E-mail do responsável<input name="email" type="email" required placeholder="responsavel@empresa.com"></label><div><label>Permissão<select name="role"><option value="owner">Proprietário</option><option value="manager">Gestor</option><option value="staff">Atendimento</option></select></label><button type="submit">Liberar acesso</button></div></form>`;
  }

  function domainMarkup(store) {
    const domains = storeDomains(store.id);
    return `
      <div class="domain-list">${domains.length ? domains.map(domain => `
        <div class="domain-row"><span><b>${esc(domain.hostname)}</b><small>${esc(domain.kind)} · ${esc(domain.status)}${domain.is_primary ? ' · principal' : ''}</small></span><button data-delete-domain="${domain.id}">Remover</button></div>
      `).join('') : '<div class="empty">Nenhum domínio conectado.</div>'}</div>
      <form class="domain-form" data-domain-form="${store.id}"><label>Domínio ou subdomínio<input name="hostname" required placeholder="cardapio.empresa.com.br"></label><div><label>Tipo<select name="kind"><option value="custom">Domínio do cliente</option><option value="subdomain">Subdomínio Seu Food</option></select></label><button type="submit">Salvar domínio</button></div></form>`;
  }

  function storeMarkup(store) {
    const disabled = store.is_demo ? 'disabled' : '';
    return `<article class="store-card" data-store-card="${store.id}">
      <header><div class="store-identity">${storeLogo(store)}<div><h2>${esc(store.name)}</h2><p>seufood.com/${esc(store.slug)}</p></div></div>
      <div class="badges">${store.is_demo ? '<span class="badge demo">Demonstração</span>' : ''}<span class="badge ${esc(store.status)}">${esc(store.status)}</span></div>
      <div class="store-actions"><a href="${esc(publicUrl(store))}" target="_blank">Ver cardápio</a><a href="${esc(adminUrl(store))}" target="_blank">Abrir painel</a></div></header>
      <div class="store-body">
        <section class="panel store-config"><h3>Empresa e disponibilidade</h3><form data-store-form="${store.id}">
          <div class="store-logo-editor">
            ${storeLogo(store, 'store-logo-preview')}
            <div class="store-logo-copy"><b>Logo da empresa</b><small>Sugestão: 1000 × 500 px · PNG ou WebP</small>
              <div class="store-logo-actions"><label class="logo-upload-button">Trocar logo<input type="file" data-store-logo-upload="${store.id}" accept="image/png,image/jpeg,image/webp"></label>${store.logo_url ? `<button type="button" data-remove-store-logo="${store.id}">Excluir</button>` : ''}</div>
            </div>
          </div>
          <div class="store-settings"><label>Nome<input name="name" value="${esc(store.name)}" required></label><label>Endereço<input name="slug" value="${esc(store.slug)}" required></label>
          <label>Situação<select name="status" ${disabled}><option value="active" ${store.status === 'active' ? 'selected' : ''}>Ativa</option><option value="suspended" ${store.status === 'suspended' ? 'selected' : ''}>Suspensa</option><option value="archived" ${store.status === 'archived' ? 'selected' : ''}>Arquivada</option></select></label>
          <label class="switch">Cardápio público<input name="storefrontEnabled" type="checkbox" ${store.storefront_enabled ? 'checked' : ''} ${disabled}></label></div>
          <section class="future-fields"><header><div><small>CONTROLE DA CONTA</small><h4>Plano, vencimento e limites</h4><p>Prepare as regras comerciais agora. Campos vazios continuam sem cobrança e sem bloqueio.</p></div><span>OPCIONAL</span></header>
            <div class="plan-fields">
              <label class="limit-field plan"><span class="limit-icon">P</span><span class="limit-copy"><b>Plano da empresa</b><small>Identificação interna</small></span><input name="planName" value="${esc(store.plan_name || '')}" placeholder="Sem plano definido"></label>
              <label class="limit-field expiry"><span class="limit-icon">V</span><span class="limit-copy"><b>Vencimento</b><small>Data preparada para uso futuro</small></span><input name="accessExpiresAt" type="datetime-local" value="${esc(store.access_expires_at ? String(store.access_expires_at).slice(0,16) : '')}"></label>
            </div>
            <div class="future-fields-grid">
              <label class="limit-field"><span class="limit-icon">01</span><span class="limit-copy"><b>Produtos</b><small>Quantidade máxima</small></span><input name="maxProducts" type="number" min="0" value="${esc(store.max_products ?? '')}" placeholder="Sem limite"></label>
              <label class="limit-field"><span class="limit-icon">02</span><span class="limit-copy"><b>Pedidos mensais</b><small>Total por mês</small></span><input name="maxOrdersMonth" type="number" min="0" value="${esc(store.max_orders_month ?? '')}" placeholder="Sem limite"></label>
              <label class="limit-field"><span class="limit-icon">03</span><span class="limit-copy"><b>Armazenamento</b><small>Espaço para imagens</small></span><div class="input-unit"><input name="maxStorageMb" type="number" min="0" value="${esc(store.max_storage_mb ?? '')}" placeholder="Sem limite"><span>MB</span></div></label>
            </div>
          </section><button class="primary save-store" type="submit">Salvar empresa</button></form></section>
        <section class="panel"><h3>Pessoas com acesso</h3>${memberMarkup(store)}</section>
        <section class="panel"><h3>Domínios</h3>${domainMarkup(store)}</section>
      </div></article>`;
  }

  function render() {
    applyPlatformBranding();
    updateMetrics();
    const normalized = query.toLowerCase();
    const stores = platform.stores.filter(store =>
      (statusFilter === 'all' || store.status === statusFilter) &&
      (!normalized || `${store.name} ${store.slug}`.toLowerCase().includes(normalized))
    );
    $('#store-list').innerHTML = stores.length ? stores.map(storeMarkup).join('') : '<div class="empty">Nenhuma empresa encontrada.</div>';
  }

  async function load() {
    const data = await invoke('list');
    platform = data;
    render();
  }

  async function boot() {
    if (!SupabaseStore.configured) return showLoginError('Configure o Supabase antes de usar a central.');
    try { await loadPublicBranding(); } catch (_) {}
    const session = await SupabaseStore.getSession();
    if (!session) return;
    if (!(await SupabaseStore.isPlatformAdmin())) return showLoginError('Este usuário não é o administrador central do Seu Food.');
    $('#auth-screen').hidden = true;
    $('#central-app').hidden = false;
    try { await load(); } catch (error) { notice(`${error.message} Execute primeiro a migração 004_multi_tenant.sql e publique a função platform-admin.`, true); }
  }

  $('#login-form').onsubmit = async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    try {
      await SupabaseStore.signIn($('#login-email').value.trim(), $('#login-password').value);
      if (!(await SupabaseStore.isPlatformAdmin())) throw new Error('Este usuário não possui acesso à Central Seu Food.');
      location.reload();
    } catch (error) { showLoginError(error.message); }
    finally { button.disabled = false; }
  };
  $('#logout').onclick = async () => { await SupabaseStore.signOut(); location.reload(); };
  $('#platform-logo-upload').onchange = async event => {
    const file = event.target.files?.[0];
    const demoStore = platform.stores.find(store => store.is_demo) || platform.stores.find(store => store.id === DEMO_STORE_ID);
    if (!file || !demoStore) return;
    const holder = event.target.closest('.platform-logo-actions');
    holder?.classList.add('busy');
    try {
      const logoUrl = await uploadStoreLogo(demoStore, file, 'plataforma', 'seu-food-logo-painel');
      const result = await invoke('update_platform_branding', { logoUrl });
      platform = result.platform;
      render();
      notice('Logo do painel atualizada.');
    } catch (error) { notice(error.message, true); }
    finally { holder?.classList.remove('busy'); event.target.value = ''; }
  };
  $('#platform-logo-remove').onclick = async event => {
    event.target.disabled = true;
    try {
      const result = await invoke('update_platform_branding', { logoUrl: '' });
      platform = result.platform;
      render();
      notice('Logo do painel excluída.');
    } catch (error) { notice(error.message, true); }
    finally { event.target.disabled = false; }
  };
  $('#store-search').oninput = event => { query = event.target.value.trim(); render(); };
  $('#store-status-filter').onchange = event => { statusFilter = event.target.value; render(); };
  $('#open-new-store').onclick = () => { $('#new-store-dialog').hidden = false; $('#new-store-name').focus(); };
  document.querySelectorAll('[data-close-dialog]').forEach(button => button.onclick = () => { $('#new-store-dialog').hidden = true; });
  $('#new-store-name').oninput = event => {
    if ($('#new-store-slug').dataset.edited === 'true') return;
    $('#new-store-slug').value = event.target.value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  };
  $('#new-store-slug').oninput = event => { event.target.dataset.edited = 'true'; };
  $('#new-store-logo').onchange = event => {
    const file = event.target.files?.[0];
    const preview = $('#new-store-logo-preview');
    $('#new-store-logo-name').textContent = file ? file.name : 'Nenhum arquivo selecionado';
    if (!file) return preview.innerHTML = '<span>SF</span>';
    const objectUrl = URL.createObjectURL(file);
    preview.innerHTML = `<img src="${objectUrl}" alt="Prévia da logo">`;
    preview.querySelector('img').onload = () => URL.revokeObjectURL(objectUrl);
  };
  $('#new-store-form').onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    form.classList.add('busy');
    try {
      const logoFile = $('#new-store-logo').files?.[0];
      const result = await invoke('create_store', { name: $('#new-store-name').value, slug: $('#new-store-slug').value, ownerEmail: $('#new-store-owner').value });
      platform = result.platform;
      let logoWarning = '';
      if (logoFile) {
        try {
          const logoUrl = await uploadStoreLogo(result.store, logoFile);
          await saveStoreLogo(result.store.id, logoUrl);
        } catch (error) {
          logoWarning = ` A empresa foi criada, mas a logo não foi enviada: ${error.message}`;
        }
      }
      render();
      form.reset();
      $('#new-store-slug').dataset.edited = '';
      $('#new-store-logo-name').textContent = 'Nenhum arquivo selecionado';
      $('#new-store-logo-preview').innerHTML = '<span>SF</span>';
      $('#new-store-dialog').hidden = true;
      notice(`${result.invitationLink ? 'Empresa criada. Copie o convite abaixo e envie ao responsável.' : 'Empresa criada com sucesso.'}${logoWarning}`, Boolean(logoWarning), result.invitationLink || '');
    } catch (error) { notice(error.message, true); }
    finally { form.classList.remove('busy'); }
  };

  $('#store-list').onsubmit = async event => {
    event.preventDefault();
    const form = event.target;
    form.classList.add('busy');
    try {
      if (form.dataset.storeForm) {
        const data = new FormData(form);
        const result = await invoke('update_store', {
          storeId: form.dataset.storeForm,
          name: data.get('name'), slug: data.get('slug'), status: data.get('status'),
          storefrontEnabled: data.get('storefrontEnabled') === 'on', planName: data.get('planName'),
          accessExpiresAt: data.get('accessExpiresAt'), maxProducts: data.get('maxProducts'),
          maxOrdersMonth: data.get('maxOrdersMonth'), maxStorageMb: data.get('maxStorageMb')
        });
        platform = result.platform;
        notice('Empresa atualizada.');
      } else if (form.dataset.memberForm) {
        const data = new FormData(form);
        const result = await invoke('set_member', { storeId: form.dataset.memberForm, email: data.get('email'), role: data.get('role'), active: true });
        platform = result.platform;
        notice(result.invitationLink ? 'Acesso criado. Copie o convite abaixo e envie ao responsável.' : 'Acesso liberado.', false, result.invitationLink || '');
      } else if (form.dataset.domainForm) {
        const data = new FormData(form);
        const result = await invoke('save_domain', { storeId: form.dataset.domainForm, hostname: data.get('hostname'), kind: data.get('kind') });
        platform = result.platform;
        notice('Domínio salvo como pendente. A conexão com o Cloudflare será ativada quando o domínio principal estiver configurado.');
      }
      render();
    } catch (error) { notice(error.message, true); }
    finally { form.classList.remove('busy'); }
  };

  $('#store-list').onchange = async event => {
    const input = event.target.closest('[data-store-logo-upload]');
    if (!input) return;
    const store = platform.stores.find(item => item.id === input.dataset.storeLogoUpload);
    const file = input.files?.[0];
    if (!store || !file) return;
    const editor = input.closest('.store-logo-editor');
    editor?.classList.add('busy');
    try {
      const logoUrl = await uploadStoreLogo(store, file);
      await saveStoreLogo(store.id, logoUrl);
      notice('Logo enviada e aplicada no painel e no cardápio.');
    } catch (error) { notice(error.message, true); }
    finally { editor?.classList.remove('busy'); input.value = ''; }
  };

  $('#store-list').onclick = async event => {
    const memberButton = event.target.closest('[data-member-active]');
    const domainButton = event.target.closest('[data-delete-domain]');
    const logoButton = event.target.closest('[data-remove-store-logo]');
    if (!memberButton && !domainButton && !logoButton) return;
    event.target.disabled = true;
    try {
      if (logoButton) {
        await saveStoreLogo(logoButton.dataset.removeStoreLogo, '');
        notice('Logo removida. A empresa voltou a usar a inicial do nome.');
        return;
      }
      const result = memberButton
        ? await invoke('set_member_active', { storeId: memberButton.dataset.storeId, userId: memberButton.dataset.memberActive, active: memberButton.dataset.active === 'true' })
        : await invoke('delete_domain', { domainId: domainButton.dataset.deleteDomain });
      platform = result.platform;
      render();
      notice(memberButton ? 'Permissão atualizada.' : 'Domínio removido.');
    } catch (error) { notice(error.message, true); event.target.disabled = false; }
  };

  boot();
})();
