(() => {
  const key = 'xyvora.theme';
  const root = document.documentElement;
  const system = matchMedia('(prefers-color-scheme: dark)');
  const valid = (v) => v === 'dark' || v === 'light';
  let saved;
  function read() {
    try {
      const value = localStorage.getItem(key);
      saved = valid(value) ? value : undefined;
    } catch { /* Fall back to the current tab or the OS. */ }
  }
  function label() {
    const name = `Switch to ${root.dataset.theme === 'dark' ? 'light' : 'dark'} theme`;
    for (const button of document.querySelectorAll('[data-theme-switch]')) {
      button.setAttribute('aria-label', name);
      button.title = name;
    }
  }
  function apply(theme) {
    root.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#181621' : '#f8f7fb');
    label();
    window.dispatchEvent(new CustomEvent('xyvora:theme', { detail: theme }));
  }
  function set(theme) {
    if (!valid(theme)) return;
    saved = theme;
    try { localStorage.setItem(key, theme); } catch { /* This tab still updates. */ }
    apply(theme);
  }
  function restore() { read(); apply(saved ?? (system.matches ? 'dark' : 'light')); }
  window.xyvoraTheme = { set };
  restore();
  document.addEventListener('DOMContentLoaded', label, { once: true });
  window.addEventListener('storage', (event) => { if (event.key === key || event.key === null) restore(); });
  window.addEventListener('pageshow', (event) => { if (event.persisted) restore(); });
  system.addEventListener('change', () => { if (!saved) restore(); });
})();
