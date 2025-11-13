// Main JavaScript for Michael John Peña's website

// Dark mode toggle
(function () {
  'use strict';

  // Theme switcher functionality
  function initThemeSwitcher() {
    const theme = localStorage.getItem('theme') || 'auto';
    document.documentElement.setAttribute('data-theme', theme);
  }

  // Initialize on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initThemeSwitcher);
  } else {
    initThemeSwitcher();
  }
})();
