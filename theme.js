(function () {
  function setTheme(theme) {
    const selected = theme || 'default';
    const body = document.body;
    if (!body) return;

    body.classList.remove('theme-default', 'theme-crystal', 'theme-blossom', 'dark-theme');
    body.classList.add(`theme-${selected}`);
    document.documentElement.dataset.theme = selected;
    localStorage.setItem('gcp_theme', selected);

    const selector = document.getElementById('theme-select');
    if (selector && selector.value !== selected) {
      selector.value = selected;
    }
  }

  function initTheme() {
    const saved = localStorage.getItem('gcp_theme') || 'default';
    setTheme(saved);

    const selector = document.getElementById('theme-select');
    if (selector && !selector.dataset.themeBound) {
      selector.addEventListener('change', (event) => {
        setTheme(event.target.value);
      });
      selector.dataset.themeBound = 'true';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTheme);
  } else {
    initTheme();
  }

  window.applyTheme = setTheme;
  window.initTheme = initTheme;
})();
