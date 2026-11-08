# Native mobile plugin previews

A view may opt into KunApp with a `mobile` declaration in its existing manifest contribution.
The desktop entry remains required and continues to work as before. See the maintained example
in `examples/extensions/workspace-dashboard/kun-extension.json`.

```json
{
  "id": "dashboard",
  "title": "Workspace Dashboard",
  "entry": "dist/webview/index.html",
  "mobile": {
    "version": 1,
    "description": "Native mobile preview",
    "blocks": [
      { "id": "scope", "type": "stat", "label": "Scope", "value": "Workspace" },
      { "id": "detail", "type": "toggle", "label": "Details", "initial": false },
      { "id": "layout", "type": "choice", "label": "Layout", "initial": "compact",
        "options": [{ "value": "compact", "label": "Compact" }] }
    ]
  }
}
```

Version 1 supports `text`, `stat`, `toggle`, and `choice`. Toggle and choice values are local
preview state only: they reset when the panel closes and never persist configuration or invoke
commands. This declaration describes packaged content, not live workspace data. A plugin must
label static information honestly; refreshing this panel rereads its declaration only.

Limits: 1–24 blocks, unique lowercase local IDs (64 characters maximum), labels up to 128
characters, text up to 2,000, stat values up to 256, descriptions up to 1,000, and 1–12 choices.
Choice values must be unique and include the initial value. NUL, unknown fields, scripts, HTML
blocks, executable URL fields, callbacks, and command/action declarations are rejected. HTML-like text remains
ordinary text. No desktop WebView, extension session, or plugin Host is created by opening this preview.

The installed plugin must be enabled and compatible, with its existing view permissions granted.
The phone independently needs `extensions.read`. The existing `plugin.catalog` advertises native
previews; `plugin.view` returns their validated `content`. Missing, invalid, disabled, incompatible,
or ungranted declarations never expose an available native preview. A view without `mobile`
retains the `desktop_only` response for older callers. Protocol wire version and operation names
are unchanged; updated clients use the additive `@kun/remote-protocol` 0.29 schema.

Validate with `npm run check:extension-schema`, extension API manifest/mobile-view tests, and
`kun/src/remote/authorization/scoped-adapters.test.ts`. KunApp validates responses again and
fences account, computer, plugin version and authorization changes before displaying content.
Native device and packaging verification are separate from these source-level checks.
