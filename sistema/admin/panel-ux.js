(function () {
  function buildSettingsWorkspace(panelName, placeholderText) {
    const grid = document.querySelector(`[data-panel="${panelName}"] .settings-grid`);
    if (!grid || grid.classList.contains('settings-workspace')) return;
    const cards = [...grid.querySelectorAll(':scope > .card')];
    if (!cards.length) return;

    const menu = document.createElement('nav');
    menu.className = 'settings-menu';
    menu.setAttribute('aria-label', 'Áreas de configuração');
    const detail = document.createElement('section');
    detail.className = 'settings-detail';
    const placeholder = document.createElement('div');
    placeholder.className = 'settings-placeholder';
    placeholder.textContent = placeholderText;
    detail.append(placeholder);

    cards.forEach((card, index) => {
      const oldToggle = card.querySelector(':scope > .config-toggle');
      const title = card.querySelector(':scope > h3');
      const label = oldToggle?.querySelector('span')?.textContent?.trim() || title?.textContent?.trim() || `Configuração ${index + 1}`;
      oldToggle?.remove();
      card.classList.remove('config-collapsible', 'config-open');
      card.hidden = true;
      if (title) title.classList.add('config-original-title');

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'settings-menu-button';
      button.textContent = label;
      button.setAttribute('aria-expanded', 'false');
      button.onclick = () => {
        const reopening = !card.hidden;
        cards.forEach(item => { item.hidden = true; });
        menu.querySelectorAll('button').forEach(item => {
          item.classList.remove('active');
          item.setAttribute('aria-expanded', 'false');
        });
        if (reopening) {
          placeholder.hidden = false;
          return;
        }
        placeholder.hidden = true;
        card.hidden = false;
        button.classList.add('active');
        button.setAttribute('aria-expanded', 'true');
      };
      menu.append(button);
      detail.append(card);
    });

    grid.classList.add('settings-workspace');
    grid.replaceChildren(menu, detail);
  }

  buildSettingsWorkspace('settings', 'Escolha uma área ao lado para abrir suas configurações.');
  buildSettingsWorkspace('appearance', 'Escolha o elemento visual que deseja personalizar.');
})();
