(function () {
  const root = document.documentElement;
  let finished = false;

  function screen() {
    return document.querySelector('#store-loading-screen');
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
      // O app aplica nome, cores e URLs antes deste timer executar.
      // Logo e banner continuam carregando progressivamente e não bloqueiam a abertura.
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
