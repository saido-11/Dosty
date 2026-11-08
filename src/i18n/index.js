 'use strict';
(function(root) {
  const node = typeof module === 'object' && module.exports;
  const dictionaries = node ? { tr: require('./tr'), en: require('./en') } : root.characterLocales;
  function normalizeLanguage(locale) { return /^tr(?:[-_]|$)/i.test(String(locale || '')) ? 'tr' : 'en'; }
  function translate(language, key, params = {}) {
    const template = dictionaries[language]?.[key] ?? dictionaries.en[key] ?? dictionaries.tr[key] ?? dictionaries.en.somethingWentWrongPleaseTryAgain;
    return template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''));
  }
  function applyDocument(language) {
    document.documentElement.lang = language;
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = translate(language, el.dataset.i18n); });
    for (const attribute of ['aria-label', 'alt', 'placeholder']) {
      document.querySelectorAll('[data-i18n-' + attribute + ']').forEach(el => {
        el.setAttribute(attribute, translate(language, el.getAttribute('data-i18n-' + attribute)));
      });
    }
  }
  const api = { normalizeLanguage, translate, applyDocument };
  if (node) module.exports = api; else root.characterI18n = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
