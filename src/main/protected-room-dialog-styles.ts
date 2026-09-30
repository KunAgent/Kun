/** Kun's neutral dialog tokens, scoped to the isolated approval document. */
export const protectedRoomDialogStyles = `
:root {
  color-scheme: light;
  --ds-bg-main: #fafafa;
  --ds-surface-card: #fff;
  --ds-surface-subtle: #f4f5f7;
  --ds-surface-hover: #eceef2;
  --ds-border: #e7e9ee;
  --ds-text: #20242d;
  --ds-text-muted: #687083;
  --ds-text-faint: #9299a8;
  --ds-control: #20242d;
  --ds-control-foreground: #fff;
  --ds-focus-ring: #6f8bff;
  --ds-radius-card: 18px;
  --ds-radius-control: 10px;
}
[data-theme="dark"] {
  color-scheme: dark;
  --ds-bg-main: #1a1a1a;
  --ds-surface-card: #252525;
  --ds-surface-subtle: #222;
  --ds-surface-hover: #303030;
  --ds-border: #363636;
  --ds-text: #ededed;
  --ds-text-muted: #b4b4b8;
  --ds-text-faint: #939399;
  --ds-control: #eee;
  --ds-control-foreground: #252222;
  --ds-focus-ring: #8ba8dc;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { width: 100%; height: 100%; overflow: hidden; }
body {
  margin: 0; background: var(--ds-bg-main); color: var(--ds-text);
  font: 13px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
}
main { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
header { display: flex; flex: none; align-items: flex-start; gap: 14px; padding: 25px 26px 20px; max-height: 40%; overflow-y: auto; }
.heading-icon {
  display: grid; place-items: center; flex: none; width: 44px; height: 44px;
  margin-top: 3px; border: 1px solid var(--ds-border); border-radius: 13px;
  background: var(--ds-surface-card); color: var(--ds-text-muted);
}
.heading-icon svg { width: 22px; height: 22px; }
[data-emphasis="permissions"] .heading-icon { color: #a15c0c; background: #fbf2e6; border-color: #efd9b8; }
[data-theme="dark"] [data-emphasis="permissions"] .heading-icon { color: #e3b47a; background: #342b20; border-color: #58452d; }
.heading-copy { min-width: 0; }
.brand { color: var(--ds-text-faint); font-size: 11px; font-weight: 600; line-height: 1.4; letter-spacing: .035em; }
h1 { margin: 3px 0 0; font-size: 19px; font-weight: 620; line-height: 1.35; letter-spacing: -.02em; overflow-wrap: anywhere; }
.subtitle { margin: 5px 0 0; color: var(--ds-text-muted); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.content-scroll { flex: 1; min-height: 0; overflow: auto; padding: 0 26px 20px; scrollbar-gutter: stable; }
.description { margin: 0 0 14px; font-size: 13px; line-height: 1.65; color: var(--ds-text-muted); white-space: pre-wrap; overflow-wrap: anywhere; }
.action-card { overflow: hidden; border: 1px solid var(--ds-border); border-radius: 13px; background: var(--ds-surface-card); }
.section-label { padding: 10px 14px; border-bottom: 1px solid var(--ds-border); color: var(--ds-text-muted); font-size: 11px; font-weight: 600; }
pre {
  margin: 0; padding: 14px; overflow: auto; color: var(--ds-text);
  font: 12px/1.7 "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  white-space: pre-wrap; overflow-wrap: anywhere; tab-size: 2;
}
#body { min-height: 64px; max-height: 240px; }
[data-kind="permissions"] #body, [data-kind="unknown"] #body { font-family: inherit; font-size: 13px; }
.workspace { display: flex; gap: 9px; align-items: flex-start; margin-top: 16px; }
.workspace > svg { flex: none; width: 15px; height: 15px; margin-top: 2px; color: var(--ds-text-faint); }
.workspace > div { min-width: 0; }
.workspace h2 { margin: 0 0 4px; font-size: 11px; font-weight: 500; line-height: 1.5; color: var(--ds-text-muted); }
.workspace p { margin: 0; font: 11.5px/1.6 "SFMono-Regular", Consolas, monospace; overflow-wrap: anywhere; }
details { margin-top: 16px; }
summary { display: inline-flex; align-items: center; gap: 6px; padding: 3px 0; cursor: pointer; color: var(--ds-text-muted); font-size: 12px; list-style: none; border-radius: 3px; }
summary::-webkit-details-marker { display: none; }
summary:hover { color: var(--ds-text); }
.chevron { width: 12px; height: 12px; transition: transform 150ms ease; }
details[open] .chevron { transform: rotate(90deg); }
#details-body { margin-top: 8px; border: 1px solid var(--ds-border); border-radius: var(--ds-radius-control); background: var(--ds-surface-subtle); max-height: 200px; }
footer { flex: none; padding: 16px 26px 21px; border-top: 1px solid var(--ds-border); background: var(--ds-bg-main); }
.scope-note { display: flex; gap: 7px; align-items: flex-start; margin-bottom: 16px; color: var(--ds-text-muted); }
.scope-note svg { width: 14px; height: 14px; flex: none; margin-top: 2px; color: var(--ds-text-faint); }
#note { margin: 0; font-size: 11.5px; line-height: 1.6; overflow-wrap: anywhere; }
.actions { display: flex; align-items: center; justify-content: flex-end; gap: 9px; }
#status { margin-right: auto; color: var(--ds-text-muted); font-size: 11px; }
button {
  flex: none; min-height: 38px; min-width: 82px; padding: 8px 17px;
  border: 1px solid var(--ds-border); border-radius: var(--ds-radius-control);
  background: var(--ds-surface-card); color: var(--ds-text); font: 550 12.5px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  cursor: pointer; transition: background 150ms ease, opacity 150ms ease;
}
button:not(:disabled):hover { background: var(--ds-surface-hover); }
button.primary { border-color: transparent; background: var(--ds-control); color: var(--ds-control-foreground); }
button.primary:not(:disabled):hover { background: var(--ds-control); opacity: .88; }
button:disabled { opacity: .5; cursor: default; }
button:focus-visible, summary:focus-visible, pre:focus-visible { outline: 2px solid var(--ds-focus-ring); outline-offset: 3px; }
pre:focus-visible { outline-offset: -3px; }
header:focus-visible { outline: 2px solid var(--ds-focus-ring); outline-offset: -3px; }
@media (max-width: 420px) {
  header { padding: 20px 18px 16px; gap: 11px; }
  h1 { font-size: 17px; }
  .heading-icon { width: 38px; height: 38px; border-radius: 11px; }
  .content-scroll { padding: 0 18px 16px; }
  footer { padding: 14px 18px 18px; }
  .actions { flex-wrap: wrap; }
  #status:not(:empty) { flex-basis: 100%; }
  button { min-width: 0; flex: 1; padding-inline: 12px; }
}
@media (max-height: 380px) {
  header { padding-top: 15px; padding-bottom: 12px; }
  .subtitle { margin-top: 3px; }
  footer { padding-top: 12px; padding-bottom: 13px; }
  .scope-note { margin-bottom: 10px; }
}
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; } }
`
