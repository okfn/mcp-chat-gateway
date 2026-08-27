// i18n: gateway-owned strings only.
//
// Loads /static/i18n/{locale}.yaml for the active locale, plus en.yaml as a
// fallback, plus an optional /static/i18n/overrides.yaml for operator-level
// rebrands. Translations are merged at runtime (overrides > active locale >
// English > key name).
//
// Plugin-supplied content (descriptions, sample questions) is rendered in
// the plugin's own language — that's where translation belongs. This module
// only covers the gateway UI shell.
//
// Depends on js-yaml (window.jsyaml), loaded via <script> in each template.
//
// Public API (exposed on window.i18n):
//   .t(key, vars?)   → translate a flat dot-notation key
//   .applyAll()      → apply translations to every [data-i18n] in the DOM
//   .setLocale(code) → switch language, re-fetch if needed, re-apply, persist
//   .getLocale()     → current locale code
//   .available       → array of supported locale codes
//   .ready           → promise that resolves once initial load completes

(function () {
  "use strict";

  const AVAILABLE = ["en", "es", "pt"];
  const STORAGE_KEY = "okfn-mcp-chat-lang";
  const I18N_BASE = "static/i18n";

  // bundled[locale] holds the parsed-and-flattened keys from each yaml file.
  // overrides holds the parsed overrides.yaml (keyed by locale, same shape).
  const bundled = Object.create(null);
  let overrides = Object.create(null);
  let activeLocale = pickInitialLocale();

  // ---- locale resolution -------------------------------------------------

  function pickInitialLocale() {
    const stored = safeStorageGet(STORAGE_KEY);
    if (stored && AVAILABLE.indexOf(stored) !== -1) return stored;
    const navCode = (navigator.language || "en").slice(0, 2).toLowerCase();
    return AVAILABLE.indexOf(navCode) !== -1 ? navCode : "en";
  }

  function safeStorageGet(key) {
    try { return window.localStorage.getItem(key); } catch (_) { return null; }
  }

  function safeStorageSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (_) { /* ignore */ }
  }

  // ---- YAML loading + flattening ----------------------------------------

  async function fetchYaml(url) {
    const resp = await fetch(url);
    if (!resp.ok) {
      if (resp.status === 404) return null;
      throw new Error(`Failed to load ${url}: HTTP ${resp.status}`);
    }
    const text = await resp.text();
    return window.jsyaml.load(text) || {};
  }

  // Convert {a: {b: "x"}} → {"a.b": "x"} so lookups can use the
  // dot-notation keys we already have in data-i18n attributes.
  function flatten(obj, prefix, out) {
    out = out || Object.create(null);
    if (obj == null) return out;
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      const path = prefix ? prefix + "." + k : k;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        flatten(v, path, out);
      } else {
        out[path] = v;
      }
    }
    return out;
  }

  async function loadLocale(code) {
    if (bundled[code]) return bundled[code];
    const raw = await fetchYaml(`${I18N_BASE}/${code}.yaml`);
    bundled[code] = flatten(raw);
    return bundled[code];
  }

  async function loadOverrides() {
    // Optional file. 404 just means "no overrides configured".
    const raw = await fetchYaml(`${I18N_BASE}/overrides.yaml`);
    if (!raw) return;
    // overrides.yaml uses the same nested structure as the bundled
    // locale files, so flatten each locale section the same way.
    overrides = Object.create(null);
    for (const code of Object.keys(raw)) {
      overrides[code] = flatten(raw[code]);
    }
  }

  // ---- translation lookup -----------------------------------------------

  function lookup(key) {
    const localeOver = overrides[activeLocale];
    if (localeOver && localeOver[key] != null) return localeOver[key];
    const localeBundle = bundled[activeLocale];
    if (localeBundle && localeBundle[key] != null) return localeBundle[key];
    const enOver = overrides.en;
    if (enOver && enOver[key] != null) return enOver[key];
    const enBundle = bundled.en;
    if (enBundle && enBundle[key] != null) return enBundle[key];
    return key;
  }

  function t(key, vars) {
    let s = lookup(key);
    if (typeof s === "string" && vars) {
      for (const k in vars) s = s.replace("{" + k + "}", vars[k]);
    }
    return s;
  }

  // ---- DOM application --------------------------------------------------

  function applyAll(root) {
    const scope = root || document;
    scope.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      const attr = el.getAttribute("data-i18n-attr");
      const text = t(key);
      if (attr) el.setAttribute(attr, text);
      else el.innerHTML = text;
    });
    // Update the active-state marker on any language switcher present.
    document.querySelectorAll("[data-lang-switch]").forEach((btn) => {
      const code = btn.getAttribute("data-lang-switch");
      btn.classList.toggle("is-active", code === activeLocale);
      btn.setAttribute("aria-pressed", code === activeLocale ? "true" : "false");
    });
    document.documentElement.lang = activeLocale;
  }

  // ---- setLocale + initial load -----------------------------------------

  async function setLocale(code) {
    if (AVAILABLE.indexOf(code) === -1) return;
    activeLocale = code;
    safeStorageSet(STORAGE_KEY, code);
    await loadLocale(code);
    applyAll();
  }

  function wireSwitcherButtons() {
    document.querySelectorAll("[data-lang-switch]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        setLocale(btn.getAttribute("data-lang-switch"));
      });
    });
  }

  // Always load English (fallback) plus the active locale.
  // Overrides are fetched in parallel; a missing file is fine.
  const ready = (async function init() {
    const tasks = [loadLocale("en"), loadOverrides()];
    if (activeLocale !== "en") tasks.push(loadLocale(activeLocale));
    await Promise.all(tasks);
    applyAll();
    wireSwitcherButtons();
  })();

  window.i18n = {
    t: t,
    applyAll: applyAll,
    setLocale: setLocale,
    getLocale: function () { return activeLocale; },
    available: AVAILABLE.slice(),
    ready: ready,
  };
})();
