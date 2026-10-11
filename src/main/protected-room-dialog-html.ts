import { protectedRoomDialogStyles } from './protected-room-dialog-styles'

export type ProtectedRoomDialogContent = {
  title: string
  subtitle: string
  body: string
  workspace?: string
  workspaceLabel: string
  footnote: string
  cancelLabel: string
  confirmLabel: string
  dark: boolean
  accent?: boolean
  kind?: 'command' | 'file' | 'network' | 'mcp' | 'external-effect' | 'unknown' | 'permissions'
  description?: string
  bodyLabel?: string
  details?: string
  detailsLabel?: string
  language?: 'zh' | 'en'
  variant?: 'confirmation' | 'notice'
  /** Shown as before/after rows in place of the plain body text. */
  changes?: ReadonlyArray<{ label: string; before: string; after: string }>
}

const ACTION_ICON_PATHS = {
  command: '<path d="m5 7 5 5-5 5M13 17h6"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  network: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18Z"/>',
  mcp: '<path d="M12 8V3M8 12H3M16 12h5M12 16v5"/><rect x="8" y="8" width="8" height="8" rx="2"/>',
  'external-effect': '<path d="M14 3h7v7M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
  permissions: '<path d="M4 7h6M14 7h6M4 17h2M10 17h10"/><circle cx="12" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  unknown: '<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="M12 8v5M12 16h.01"/>'
} as const

function svg(paths: string, className = ''): string {
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
}

function safeScriptValue(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

export function protectedRoomDialogHtml(content: ProtectedRoomDialogContent, nonce: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(nonce)) throw new Error('Invalid protected dialog nonce')
  const language = content.language ?? (/[\u3400-\u9fff]/.test(content.cancelLabel) ? 'zh' : 'en')
  const kind = content.kind && Object.hasOwn(ACTION_ICON_PATHS, content.kind) ? content.kind : 'unknown'
  const labels = language === 'zh'
    ? { action: '操作详情', moreInformation: '更多信息', waiting: '正在处理…' }
    : { action: 'Action details', moreInformation: 'More information', waiting: 'Processing…' }
  const payload = safeScriptValue({ ...content, ...labels, bodyLabel: content.bodyLabel || labels.action, detailsLabel: content.detailsLabel || labels.moreInformation })
  const folderIcon = svg('<path d="M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2Z"/>')
  const infoIcon = svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>')
  return `<!doctype html><html lang="${language}" data-theme="${content.dark ? 'dark' : 'light'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'">
<style nonce="${nonce}">${protectedRoomDialogStyles}</style></head>
<body><main role="dialog" aria-modal="true" aria-labelledby="title" aria-describedby="description note" data-protected-confirmation data-kind="${kind}" data-emphasis="${kind === 'permissions' && content.accent ? 'permissions' : 'none'}">
<header id="dialog-header"><div class="heading-icon">${svg(ACTION_ICON_PATHS[kind])}</div><div class="heading-copy"><div class="brand" id="brand">Kun</div><h1 id="title"></h1><p id="subtitle" class="subtitle"></p></div></header>
<div class="content-scroll">
  <p id="description" class="description"></p>
  <section class="action-card" id="action-card" aria-labelledby="body-label"><div class="section-label" id="body-label"></div><pre id="body" tabindex="0" aria-labelledby="body-label"></pre><div id="changes" class="changes" role="list" aria-labelledby="body-label" hidden></div></section>
  <section class="workspace" id="workspace" aria-labelledby="workspace-label">${folderIcon}<div><h2 id="workspace-label"></h2><p id="workspace-value"></p></div></section>
  <details id="details"><summary><span id="details-label"></span>${svg('<path d="m9 5 7 7-7 7"/>', 'chevron')}</summary><pre id="details-body" tabindex="0" aria-labelledby="details-label"></pre></details>
</div>
<footer><div class="scope-note">${infoIcon}<p id="note"></p></div><div class="actions"><span id="status" role="status" aria-live="polite"></span><button id="cancel" type="button" data-approval-cancel></button><button id="confirm" class="primary" type="button" data-approval-confirm></button></div></footer>
</main>
<script nonce="${nonce}">(() => {
  const data = ${payload};
  const requestNonce = ${safeScriptValue(nonce)};
  const byId = (id) => document.getElementById(id);
  document.title = 'Kun · ' + data.title;
  for (const [id, value] of Object.entries({ title: data.title, subtitle: data.subtitle, body: data.body,
    description: data.description || '', note: data.footnote, cancel: data.cancelLabel, confirm: data.confirmLabel,
    'body-label': data.bodyLabel, 'workspace-label': data.workspaceLabel, 'workspace-value': data.workspace || '',
    'details-label': data.detailsLabel, 'details-body': data.details || '' })) byId(id).textContent = value;
  byId('description').hidden = !data.description;
  byId('action-card').hidden = !data.body;
  byId('subtitle').hidden = !data.subtitle;
  byId('workspace').hidden = !data.workspace;
  byId('details').hidden = !data.details;
  // The subtitle already names Kun on app-level prompts; one mark is enough.
  byId('brand').hidden = /^Kun( |$)/.test(data.subtitle || '');
  const changes = Array.isArray(data.changes) ? data.changes : [];
  for (const change of changes) {
    const row = document.createElement('div');
    row.className = 'change';
    row.setAttribute('role', 'listitem');
    for (const [part, value] of [['label', change.label], ['before', change.before], ['arrow', '→'], ['after', change.after]]) {
      const cell = document.createElement('span');
      cell.className = 'change-' + part;
      if (part === 'arrow') cell.setAttribute('aria-hidden', 'true');
      cell.textContent = String(value);
      row.append(cell);
    }
    byId('changes').append(row);
  }
  byId('changes').hidden = changes.length === 0;
  byId('body').hidden = changes.length > 0;
  document.querySelector('.scope-note').hidden = !data.footnote;
  byId('cancel').hidden = data.variant === 'notice';
  const syncHeadingOverflow = () => {
    const header = byId('dialog-header');
    if (!header) return;
    header.tabIndex = header.scrollHeight > header.clientHeight ? 0 : -1;
  };
  syncHeadingOverflow();
  window.addEventListener('resize', syncHeadingOverflow);
  window.requestAnimationFrame(syncHeadingOverflow);
  let submitted = false;
  const decide = (value) => {
    if (submitted) return;
    submitted = true;
    for (const button of document.querySelectorAll('button')) button.disabled = true;
    document.querySelector('main').setAttribute('aria-busy', 'true');
    byId('status').textContent = data.waiting;
    window.kunProtectedRoom.confirm(value, requestNonce);
  };
  byId('cancel').onclick = (event) => { if (event.isTrusted) decide(false); };
  byId('confirm').onclick = (event) => { if (event.isTrusted) decide(true); };
  document.addEventListener('keydown', (event) => {
    if (!event.isTrusted) return;
    if (event.key === 'Escape') { event.preventDefault(); decide(false); return; }
    if (event.key !== 'Tab') return;
    const stops = Array.from(document.querySelectorAll('button:not(:disabled), summary, [tabindex="0"]')).filter((element) => {
      if (element.closest('[hidden]')) return false;
      const details = element.closest('details');
      return !details || details.open || element.tagName === 'SUMMARY';
    });
    if (!stops.length) { event.preventDefault(); return; }
    const first = stops[0], last = stops[stops.length - 1];
    if (event.shiftKey && (document.activeElement === first || !stops.includes(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !stops.includes(document.activeElement))) {
      event.preventDefault(); first.focus();
    }
  });
  byId(data.variant === 'notice' ? 'confirm' : 'cancel').focus();
})();</script></body></html>`
}
