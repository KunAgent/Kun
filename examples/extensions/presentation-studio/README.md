# Kun PPT

Kun PPT is a runnable Kun Extension API v1 example for repeatedly
editing one standalone HTML slide deck with a person and the main Kun Agent. Each deck
is stored as a root-level `*.kun-ppt.html` workspace file. A bounded,
schema-versioned model embedded in that file is authoritative; the visible HTML
is a deterministic projection that remains useful in a regular browser.

The extension contributes a responsive right-sidebar Webview with a dedicated
presentation icon, four View commands, and five narrow workspace tools. When
installed, those tools are available to the main conversation Agent. The
Webview contains no second prompt box, private Agent profile, or Agent run;
visual and main-Agent changes use the same typed operation reducer. Host persistence
requires an expected revision, serializes writes per path, records bounded
idempotency receipts, and verifies every write by reading it back through the
public workspace broker. Extension API v1 does not expose an atomic
create-only or conditional write: the service rechecks immediately before
persistence and protects races inside one Extension Host, but cross-process
atomicity remains a platform limitation.

## Safety and format boundaries

- Only a single root-level filename ending in `.kun-ppt.html` is accepted.
- The Host uses `context.workspace`; it does not access workspace files with
  Node filesystem APIs or private Kun imports.
- Presentation text is structured data. It is never executed or injected as
  arbitrary HTML, CSS, JavaScript, event handlers, or remote resources in the
  bridge-bearing Webview.
- A revision conflict fails closed. Reload the latest project and deliberately
  reapply the intended operations.
- Export creates another `.kun-ppt.html` copy only after checking that its
  destination is absent or already identical. The API v1 cross-process race
  limitation above still applies. Native PPTX/PDF conversion remains a
  separate, future workflow; Kun's managed PPT Master flow is unchanged.

## Commands and Host messages

The Webview invokes these local command IDs through `ExtensionHostClient`:

- `presentation-create`: `{ path, title? }`
- `presentation-load`: `{ path }`
- `presentation-save`: `{ path, expectedRevision, operations, operationId? }`
- `presentation-export-copy`: `{ path, destinationPath, expectedRevision }`

After a successful create, save, or export-copy, the Host attempts a fail-soft
message on channel `presentation.changed` with this payload:

```json
{
  "path": "roadmap.kun-ppt.html",
  "revision": 2,
  "source": "command",
  "changedIds": ["slide-agenda", "element-title"]
}
```

The source is either `command` or `tool`. A closed View does not turn a durable
workspace write into a failed tool invocation.

The sidebar has three focused tabs: Slides, Canvas, and Properties. Ask the main
Kun Agent in the normal conversation to create or revise a deck; a successful
tool mutation publishes `presentation.changed` and the open sidebar follows the
Agent-written path and reloads the new revision automatically. When the sidebar
opens without a restored deck, it discovers and loads the most recently modified
root-level `.kun-ppt.html` file so a deck created while the View was closed is
still rendered immediately.

The shell is designed for the workbench sidebar rather than a full document
window. Its compact header keeps New visible and moves Load/Export into a menu;
the numbered thumbnail rail remains beside Canvas and Properties from 420 px
up, the active pane owns the full remaining height, and insert/history controls
sit directly below the scaled 16:9 canvas. Below 360 px the dedicated Slides tab
can temporarily take the full width.

Selecting a canvas element reveals explicit Edit (for text) and Delete actions
in the canvas toolbar. A repeated click on text enters inline editing; Enter also
edits a focused text layer, while Delete or Backspace removes a focused element.
View and edit modes use the same positioned HTML text layer. Editing keeps the
existing content, typography, color, alignment, and transparent slide background,
then places the caret at the end instead of replacing the element with a white
form field or selecting all text. Escape cancels the draft and Ctrl/Cmd+Enter
commits it through the typed undo/autosave path. The Properties tab remains
available for content, geometry, layer, and CSS edits.

Image opens the operating system's file chooser directly. Selecting one PNG,
JPEG, GIF, or WebP copies its bounded bytes into a unique workspace-relative
asset (using the existing `assets/` directory when present) and inserts the new
image element immediately. Cancelling the chooser leaves the deck unchanged;
unsupported, empty, and over-6-MiB files fail without exposing an absolute path
to the Webview or overwriting an existing workspace file.

Properties also exposes a DOM/Layers tree for the current slide. Text and shape
elements correspond to projected `div` nodes and images correspond to `img`
nodes. Selecting a layer reveals a bounded CSS declaration editor for layout,
rotation, opacity, typography, borders, fills, and image fit. Applying CSS emits
an `element.style` typed operation, so direct manipulation, human CSS edits, and
main-Agent edits share revision checks, undo, autosave, and deterministic HTML
projection. Selectors, at-rules, comments, URLs, unsupported properties, and
out-of-canvas geometry are rejected rather than injected into the Webview.

For `presentation-apply`, `operationId` is optional and Kun derives a bounded
key from the tool invocation when it is omitted. Inserted slides default an
omitted `backgroundColor` to `null` (the deck theme), and text elements may use
an optional `fontFamily` override. `element.style` accepts the same bounded CSS
declarations shown in Properties for an existing element. These defaults keep
normal main-Agent calls compact while the saved model remains canonical.

## Chat handoff

When an Agent turn finishes after a successful presentation write, Kun shows a
deduplicated presentation file card below the final reply. The primary action
uses the operating system's default file association: `.kun-ppt.html` normally
opens in the default browser, while native `.ppt`/`.pptx` output from PPT Master
opens in WPS, PowerPoint, LibreOffice, or whichever compatible application the
user configured. The card can also reveal the exact workspace file in the
platform file manager. Before opening a standalone HTML deck, Kun verifies its
current SHA-256 against the digest returned by the successful Studio write, so
a file changed afterward must be saved again in Kun PPT. Kun never
launches a presentation automatically and does not probe or execute
application-specific commands.

## Development

From the repository root:

```bash
npm --prefix examples/extensions/presentation-studio run typecheck
npm --prefix examples/extensions/presentation-studio run test
npm --prefix examples/extensions/presentation-studio run build
node examples/extensions/validate-manifest.mjs \
  examples/extensions/presentation-studio/kun-extension.json
```

`npm run check:extension-examples` additionally validates and packs every
example with the repository's Kun CLI.

`npm run dev` and production builds also package Kun PPT into the
product-owned bundled extension catalog. On startup, Kun seeds it through the
normal extension registry beside Kun Video Editor. A user who explicitly
uninstalls it remains in control; later launches do not silently reinstall it.
The right-side activity rail shows the Kun PPT icon; selecting it
opens the revision-aware editor in its sidebar layout without replacing the
main conversation page.

## Clean-room reference note

The interaction vocabulary was informed by the separately inspected
NQ-PPT-HTML-Editor project: a 16:9 canvas, slide rail, direct manipulation,
property inspector, preview, and iterative Agent editing. No source code,
runtime DOM snapshot format, temporary-ID scheme, iframe bridge, styling, or
assets were copied. Kun PPT was implemented against Kun's public
Extension API v1 and this repository's OpenSpec artifacts.
