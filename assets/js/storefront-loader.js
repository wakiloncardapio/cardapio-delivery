(function () {
  const root = document.documentElement;
  let finished = false;

  function screen() {
    return document.querySelector('#store-loading-screen');
  }

  function preload(url) {
    if (!String(url || '').trim()) return Promise.resolve();
    return new Promise(resolve => {
      const image = new Image();
      let timer = window.setTimeout(resolve, 3000);
      const done = () => {
        window.clearTimeout(timer);
        resolve();
      };
      image.onload = done;
      image.onerror = done;
      image.src = String(url);
      if (image.complete) done();
    });
  }

  function reveal() {
    if (finished) return;
    finished = true;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      root.classList.remove('store-loading');
      root.classList.add('store-ready');
      const loader = screen();
      if (loader) loader.hidden = true;
    }));
  }

  function fail() {
    finished = true;
    const loader = screen();
    if (!loader) return;
    loader.classList.add('failed');
    loader.innerHTML = '<div><b>Cardápio indisponível</b><span>Não foi possível carregar esta empresa.</span><button type="button" onclick="location.reload()">Tentar novamente</button></div>';
  }

  if (!window.MenuAPI?.loadCatalog) {
    fail();
    return;
  }

  const loadCatalog = window.MenuAPI.loadCatalog.bind(window.MenuAPI);
  window.MenuAPI.loadCatalog = async function () {
    try {
      const catalog = await loadCatalog();
      const settings = catalog?.settings || {};
      await Promise.all([
        preload(settings.logoUrl),
        preload(settings.bannerUrl)
      ]);
      window.setTimeout(reveal, 0);
      return catalog;
    } catch (error) {
      fail();
      throw error;
    }
  };

  // Evita uma tela presa indefinidamente caso um script externo não carregue.
  window.setTimeout(() => {
    if (!finished && !window.CARDAPIO_CATALOG) fail();
  }, 12000);
})();
