/**
 * Page-side prelude for Gen UI documents. It runs before the model-authored
 * fragment and exposes `window.kun` (widget state, follow-up messages, external
 * links) over a private JSON-RPC channel to `window.parent` (the Kun shell).
 * It intentionally offers no tool calls, resource reads or file access.
 *
 * Kept as plain JavaScript text: it is served verbatim into the sandbox and
 * must not depend on any bundler output.
 */
export const GEN_UI_BRIDGE_SCRIPT = String.raw`(function () {
  'use strict';
  var boot = window.__KUN_GEN_UI_BOOT__ || {};
  delete window.__KUN_GEN_UI_BOOT__;
  var parentWindow = window.parent;
  var sequence = 0;
  var pending = new Map();
  var lastHeight = -1;

  function post(message) {
    try { parentWindow.postMessage(message, '*'); } catch (error) { /* shell gone */ }
  }
  function request(method, params) {
    sequence += 1;
    var id = 'kun-' + sequence;
    return new Promise(function (resolve, reject) {
      pending.set(id, { resolve: resolve, reject: reject });
      post({ jsonrpc: '2.0', id: id, method: method, params: params || {} });
    });
  }
  function notify(method, params) {
    post({ jsonrpc: '2.0', method: method, params: params || {} });
  }
  function applyTheme(theme) {
    if (theme !== 'light' && theme !== 'dark') return;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }

  var current = {
    widgetState: boot.widgetState === undefined ? null : boot.widgetState,
    theme: boot.theme === 'dark' ? 'dark' : 'light',
    locale: typeof boot.locale === 'string' ? boot.locale : 'en'
  };
  var api = {
    get widgetState() { return current.widgetState; },
    get theme() { return current.theme; },
    get locale() { return current.locale; },
    setWidgetState: function (state) {
      var next = state && typeof state === 'object' ? state : {};
      var snapshot = {
        modelContent: next.modelContent === undefined ? null : next.modelContent,
        privateContent: next.privateContent === undefined ? null : next.privateContent
      };
      return request('kun/gen-ui/state', { state: snapshot }).then(function () {
        current.widgetState = snapshot;
        return undefined;
      });
    },
    sendFollowUpMessage: function (input) {
      var value = input && typeof input === 'object' ? input : {};
      return request('kun/gen-ui/follow-up', {
        prompt: String(value.prompt || ''),
        title: value.title === undefined ? undefined : String(value.title)
      }).then(function (result) {
        if (!result || result.sent !== true) throw new Error('The message was not sent.');
        return undefined;
      });
    },
    openExternal: function (input) {
      var href = input && typeof input === 'object' ? String(input.href || '') : '';
      return request('kun/gen-ui/open-link', { href: href }).then(function () { return undefined; });
    }
  };
  Object.defineProperty(window, 'kun', { value: Object.freeze(api), configurable: false, writable: false });
  applyTheme(current.theme);

  window.addEventListener('message', function (event) {
    if (event.source !== parentWindow) return;
    var data = event.data;
    if (!data || typeof data !== 'object' || data.jsonrpc !== '2.0') return;
    if (data.id !== undefined && pending.has(data.id)) {
      var entry = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) entry.reject(new Error(String(data.error.message || 'Request failed')));
      else entry.resolve(data.result);
      return;
    }
    if (data.method === 'kun/gen-ui/globals') {
      var globals = data.params || {};
      if (globals.theme === 'light' || globals.theme === 'dark') { current.theme = globals.theme; applyTheme(globals.theme); }
      if (Object.prototype.hasOwnProperty.call(globals, 'widgetState')) current.widgetState = globals.widgetState;
      window.dispatchEvent(new CustomEvent('kun:set_globals', { detail: { globals: globals } }));
    }
  });

  document.addEventListener('click', function (event) {
    var target = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!target) return;
    var href = target.getAttribute('href') || '';
    if (href.charAt(0) === '#') return;
    event.preventDefault();
    if (/^https?:\/\//i.test(href)) {
      api.openExternal({ href: href }).catch(function () {
        window.dispatchEvent(new CustomEvent('kun:error', { detail: 'Could not open the link.' }));
      });
    }
  }, true);
  document.addEventListener('submit', function (event) { event.preventDefault(); }, true);

  function measure() {
    var body = document.body;
    if (!body) return;
    var rect = body.getBoundingClientRect();
    var style = window.getComputedStyle(body);
    var height = Math.ceil(rect.height + parseFloat(style.marginTop || '0') + parseFloat(style.marginBottom || '0'));
    if (Math.abs(height - lastHeight) < 2) return;
    lastHeight = height;
    notify('kun/gen-ui/size', { height: height });
  }
  var scheduled = false;
  function scheduleMeasure() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () { scheduled = false; measure(); });
  }
  window.addEventListener('error', function (event) {
    notify('kun/gen-ui/log', { level: 'error', message: String(event.message || 'Script error').slice(0, 500) });
  });
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason && event.reason.message ? event.reason.message : String(event.reason);
    notify('kun/gen-ui/log', { level: 'error', message: reason.slice(0, 500) });
  });
  document.addEventListener('DOMContentLoaded', function () {
    if (typeof ResizeObserver === 'function') new ResizeObserver(scheduleMeasure).observe(document.body);
    scheduleMeasure();
  });
  window.addEventListener('load', function () {
    scheduleMeasure();
    notify('kun/gen-ui/ready', {});
  });
})();`
