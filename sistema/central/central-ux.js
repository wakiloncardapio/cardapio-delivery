(function () {
  const demoId = '00000000-0000-0000-0000-000000000001';
  function normalizeDemo() {
    const card = document.querySelector(`[data-store-card="${demoId}"]`);
    if (!card) return;
    card.querySelectorAll('select[name="status"],input[name="storefrontEnabled"]').forEach(field => {
      field.disabled = false;
      field.removeAttribute('disabled');
    });
  }
  new MutationObserver(normalizeDemo).observe(document.documentElement, { childList: true, subtree: true });
  normalizeDemo();
})();
