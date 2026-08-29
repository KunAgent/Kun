# Kun Node Graph: Renderer

How the canvas draws, lays out, animates and analyses the projection that
[`node-graph.md`](./node-graph.md) defines. Split out of that document because the two
halves are read for different reasons — the contract when changing the runtime,
this one when changing what is on screen — and together they exceeded the
repository's 700-line file limit.

## Renderer

```
src/renderer/src/node-graph/
  node-graph-types.ts       contract mirror (the renderer has no @kun alias)
  node-graph-client.ts      fetch + tolerant normalization
  node-graph-settings.ts    settings, group model, ranges, persistence
  kun-node-style.ts         Kun style, derived from the shell's focus mode
  node-graph-animation.ts   entry, hover and flow timing; reduced-motion
  node-graph-query.ts       the group/filter query language
  node-graph-filter.ts      the filter pipeline
  node-graph-analysis.ts    centrality, clustering, shortest path, summary
  node-graph-views.ts       saved view snapshots
  node-graph-simulation.ts  deterministic force layout
  node-graph-store.ts       zustand state
src/renderer/src/components/node-graph/
  NodeGraphView.tsx         the stage: top bar, rail, canvas, side panel
  NodeGraphTopBar.tsx       identity, scope, search, labelled actions
  NodeGraphCanvas.tsx       canvas host: rAF loop, pan/zoom/drag, hit testing
  NodeGraphMinimap.tsx      overview map with the viewport box
  NodeGraphZoomBar.tsx      zoom readout and layout lock
  NodeGraphControls.tsx     the left rail: collapsible control sections
  node-graph-control-primitives.tsx  section, slider, and toggle rows
  NodeGraphKindLegend.tsx   canvas key that doubles as the kind filter
  NodeGraphGroupsSection.tsx  group editor: name, color, query, member count
  NodeGraphContextMenu.tsx  right-click a node: color and group assignment
  node-graph-kun-icons.ts   the Kun artwork, inlined as data URIs
  use-node-graph-reduced-motion.ts  the viewer's motion preference
  NodeGraphSidePanel.tsx    Insights / Inspector tabs
  NodeGraphInsights.tsx     stat tiles, centrality, clusters, orphans
  NodeGraphStatCards.tsx    stat tile, ring, sparkline, cluster mark
  NodeGraphInspector.tsx    property sheet + directional connections
  node-graph-paint.ts       camera transforms, hit test, painter
  node-graph-shapes.ts      per-kind silhouettes, canvas and SVG
  node-graph-theme.ts       per-kind colors and shapes, theme token reads
```

### Layout

One command row on top (identity, scope, search, labelled actions), a collapsible
control rail on the left with the node-kind legend pinned to its bottom, the
canvas in the middle with an overview map and zoom readout floating over it, and
a tabbed panel on the right.

The search box claims **no keyboard shortcut**. `⌘K` already opens the workbench
command palette (`useWorkbenchKeyboardShortcuts`), and a window-level listener
here calling `preventDefault()` swallowed it for the whole app while the graph was
open.

Insights and the inspector are **tabs, not a stack**. Stacked, the inspector took
canvas height with nothing selected and insights scrolled away as soon as
something was; selecting a node now switches to the Inspector tab, which is what
selecting was for. Search lives in the top bar rather than inside the filter rail
because it is the fastest way into a large graph and should not require opening a
panel first.

### Kind is encoded twice

Colour alone fails anyone who cannot separate the hues, and it fails everyone
once nine kinds share one canvas — so each kind has both a colour and a
silhouette (hexagon, rounded square, circle, cylinder, page, star, diamond), and
either one alone is enough to read the graph. `node-graph-shapes.ts` is the single
source for both the canvas path and the SVG path the legend and inspector use, so
the key cannot drift from what is painted.

Every silhouette is inscribed in the node's radius. That is load-bearing rather
than tidy: hit testing is a single radius comparison, so a shape drawn wider than
its radius would be visible in places it cannot be clicked — the page and the
cylinder both had that bug until a test measured every traced point against the
radius.

Relationship names are drawn along the edges, in a second pass so a label is
never buried under a later line, upright regardless of edge direction, and only
above a zoom threshold — below it a dense graph becomes a wall of overlapping
words. Node labels are two lines, kind above name, which is what makes an
unfamiliar silhouette self-explaining.

### Kun style, and why it has no switch of its own

Workspace, thread, folder and document nodes can wear their Kun artwork instead
of a coloured silhouette. This is not a graph setting. It follows the shell's
**Focus** toggle, whose own title already reads "Focus mode: quiet Kun
animations" — Focus **off** means the mascot is present, so the graph draws the
icons; Focus **on** means the shell is quiet, so the graph returns to colour and
shape. One switch, one meaning, in the sidebar where the user already found it.

The state is read from the `data-focus-mode` attribute the workbench mirrors onto
`<html>`, through one shared `MutationObserver` in `kun-node-style.ts`. That is
what lets the graph follow the toggle from the Work tab as well as the chat
centre view, neither of which is inside the component tree that owns the
preference. The stored preference is the fallback for the window between first
paint and the workbench's effect writing the attribute.

Under Kun style the colour controls are **withheld, not disabled**: the group
editor, the "Color by cluster" action, and the right-click swatch and group rows
all disappear, because every one of them edits a colour nothing is painting. The
rail shows a note naming the switch that brings them back, since a section that
silently vanishes reads as a bug. The four remaining kinds, the minimap dots, and
every group colour a user already saved are untouched and return intact.

Three details are load-bearing:

- The icon occupies a square **inscribed** in the node's hit circle
  (`nodeGraphIconBox`, side `radius * sqrt(2)`), for the same reason every silhouette
  is inscribed: artwork drawn to the full diameter would be visible in corners
  that cannot be clicked.
- Below a painted radius of 3px the silhouette takes over. An icon that small is
  noise, and this is the same trade the label fade already makes.
- The artwork is **inlined as data URIs**, not emitted as asset files. The
  packaged app loads the renderer from `file://`, where every file is its own
  opaque origin, so drawing a `file://` image taints the canvas and makes
  `toBlob` throw — Save as PNG would break the moment an icon was painted.
  Verified in Chromium both ways, and a test asserts the sources are `data:` so
  the plain import cannot come back. The node graph is lazy-loaded, so the bytes
  arrive with the view that draws them.

  Because they are inlined, the artwork is sized for what is actually drawn. The
  source PNGs inside the SVGs are 256px on their long edge and palette-quantized
  to 256 colours, which is ample for a node painted at roughly 34px (and for the
  largest box the zoom and node-size ranges can produce at a 2x backing store).
  That is 104KB of asset instead of 716KB, and a 250KB lazy chunk instead of
  871KB. Measured against the original art in Chromium, the worst mean channel
  difference at 34px, 120px and 240px is under 2%, and the alpha channel is
  unchanged. The `viewBox`, the `<image>` width/height and the `<use>` offset are
  untouched, so the rendered geometry is identical.

The minimap keeps kind colours in both modes: its dots are one or two pixels, and
colour is the only encoding that survives at that size.

### Motion

All of it is time-in, numbers-out. `node-graph-animation.ts` owns the timings and
the canvas owns the clock, so the paint pass stays a pure function of one
`NodeGraphMotionFrame` and every duration is testable without a canvas or a frame
loop. Durations follow the shell's own motion rule — subtle, fast, ease-out.

- **Entry** (320ms) scales and fades a node up into place, staggered 16ms per
  node and capped at 14 steps, so a fresh graph assembles instead of blinking on
  and a 400-node graph costs the same as a 14-node one. Only nodes that were not
  already on screen animate: re-stamping the whole set would make the graph
  strobe on every background refresh. An edge is only as present as its dimmer
  end, so a link never outlives the node it hangs off.
- **Hover** (140ms halo and lift, 180ms dimming) grows the focused node by 16%
  and lays a radial-gradient halo behind it — a gradient rather than a stroke, so
  it stays distinguishable from the selection ring, which is a stroke.
- **Flow** marches a dash pattern along every edge touching the focus or the
  active path, at 42px/s from source to target, so a highlighted link also states
  its direction. The pattern is always cleared afterwards; leaving it set would
  leak onto every line drawn after it.

The dimming **reverses**. It eases toward its target from wherever it currently
sits, so flicking the pointer across several nodes stays continuous rather than
restarting each time, and the painter takes its focus from the motion frame
rather than the live pointer — including the node that is still fading out, which
would otherwise flash dark on the way out. Neighbours follow the same frame, and
are cached on the focus id so a painted frame does not walk every edge again.

`settled` is what keeps this cheap. The frame loop still returns early when
nothing moved, and an unsettled frame is the only thing that overrides that, so
the canvas idles exactly as it did before once every animation lands. Flowing
edges never settle by definition, which is why flow is gated on something
actually being highlighted.

Under `prefers-reduced-motion` every value collapses to its end state and
`settled` is always true — the same graph, without the travel, and without
spending a core on it.

### The overview map

A force graph is easy to get lost in: once panned, the only cues are the nodes
still on screen. The minimap draws every node plus the current viewport box, and
clicking it moves the camera without changing zoom. The zoom percentage beside it
is not decoration either — both the text-fade threshold and the edge-label cutoff
are zoom-dependent, so the readout explains why labels came or went, and clicking
it returns to 100%.

### Obsidian parity

- **Filters** — search box, toggles for the two node kinds every workspace
  always has (`USER_TOGGLEABLE_NODE_KINDS`: workspaces, conversations), a
  **minimum-connections** cut, orphans toggle, changed-files toggle.

  The other seven kinds — agents, knowledge bases, documents, sections,
  memories, tags, files — have no toggle. They stay enabled and appear on their
  own once that data exists, rather than sitting in the panel as a column of
  zeros. `kind:` and `-kind:` in the search box still filter by any kind.

  A kind with no toggle **never reads its value back from storage**
  (`normalizeNodeGraphSettings`): a value persisted while the control existed
  would otherwise leave that kind hidden forever with no way to re-enable it.
  Those kinds always take their default, which is enabled for all of them
  except `section` — sub-document fragments outnumber documents by an order of
  magnitude, so they stay off.

  There is deliberately **no relationship-type filter**. One existed briefly;
  it was removed along with `edgeKinds` from the settings model rather than
  merely hidden, for the same stuck-value reason.
- **Groups** — up to 24 named, freely colored sets (any hex, plus a 16-swatch
  quick palette). Membership has two sources: **hand-assigned** nodes, added by
  right-clicking a node, and an optional **query**. A node belongs to at most
  one group because it has exactly one color; assigning it elsewhere moves it.
  `resolveGroupColors` applies assignments first and only then falls through to
  queries, so an explicit choice is never overridden by a pattern that happens
  to match. Among queries the first match wins, making group order a visible
  priority list.
- **Node context menu** (`NodeGraphContextMenu`) — right-click a node to color
  it from the swatch row, move it between groups, create a group seeded with
  that node, clear its group, open its conversation, or focus its local graph.
  Arbitrary hex colors live in the Groups panel, not the menu, which keeps the
  menu to one-click choices.
  An **"Also apply to N connected"** checkbox extends the next color, group
  assignment, group creation, or clear to the node's direct connections — one
  hop only, and only the connections currently visible, so a hidden node kind is
  never silently recolored from a menu the user cannot see. It governs every
  group action in the menu, not just color, because the mental model is the same.
  Coloring reuses an existing plain color group (no name, no query) so repeated
  coloring cannot pile up groups, but it never hijacks a named or query-driven
  group the user built. Membership rewrites go through one `withGroupMembership`
  pass and a single settings patch, so recoloring a hub with 25 children persists
  once rather than 26 times. The menu closes if a filter or refresh removes the
  node it is pinned to, and its `fixed` coordinates go through the same UI-scale
  conversion as the canvas.
- **Display** — arrows, text fade threshold, node size, link thickness.
- **Forces** — center force, repel force, link force, link distance, mapped
  one-to-one onto the simulation.
- **Local graph** — double-click (or Enter on a selection) anchors the graph on
  a node; a depth slider controls how many hops are shown. Double-clicking the
  same node again returns to the global graph.
- **Interactions** — hover highlights a node and its neighbors and dims the
  rest; drag a node to pin it; drag the background to pan; wheel zooms at the
  cursor; `+`/`-` zoom, arrows pan, `Shift` accelerates, `Escape` deselects.
  The grab handle is **exactly the painted circle** (`paintedNodeRadius` is
  shared by the painter and `nodeGraphHitTest`) — there is no tolerance halo,
  because a halo swallows clicks on links running near a node and lets a drag
  start while the pointer is on empty canvas. A node drawn small must be zoomed
  into before it can be grabbed. A drag also preserves the **grab offset**
  (`nodeGraphGrabOffset` / `nodeGraphDragPosition`): the node translates by the
  pointer delta rather than snapping its center onto the cursor. The cursor
  reports the target: `pointer` over a node, `grab` over the background,
  `grabbing` while dragging. The focus ring is keyboard-only, since the canvas
  takes programmatic focus on pointerdown to receive key events.
- Node radius grows with `sqrt(degree)`, so one hub cannot swallow the canvas.

### Analysis (`node-graph-analysis.ts`)

Everything here runs over the **visible** subgraph, so the numbers in the panel
always match the canvas, and everything is **deterministic** — a requirement,
not a nicety, because the output becomes user-visible colors and saved groups.
Label propagation is normally seeded by a random node order and is famously
unstable between runs; here nodes are processed in sorted id order and ties
break on the smallest label.

- **Centrality** — undirected PageRank (damping 0.85, early exit at 1e-7).
  On an undirected graph this tracks degree closely; the teleport term smooths
  rank across the network so equal-degree nodes are separated by neighbourhood
  shape rather than by id. Rank leaked by isolated nodes is redistributed so the
  scores stay a comparable distribution.
- **Clusters** — label propagation, returned largest-first so the numbering is
  stable for a given graph. "Color by cluster" turns them into real groups,
  replacing the group list rather than layering on hand-built groups.
- **Shortest path** — BFS over sorted adjacency, so tied routes resolve the same
  way every time. Driven from the context menu ("trace path from/to here"); the
  path is drawn in the accent color at 2.6x thickness with everything else
  dimmed to 8-16%, its labels always visible.
- **Summary** — orphan ids, cluster count, largest cluster, average degree.

**Empty files are nodes too.** `scanKnowledgeSources` used to skip a zero-byte
source outright, which is right for retrieval — there is nothing to read — but
wrong for a graph: deleting the last line of a note made the note itself vanish
along with the `contains` edge to its folder. Empty sources are now carried
through the scan flagged `empty`, become `document` nodes with no children, and
record `available: false` / `error: 'Empty file'` so retrieval still refuses to
read them. Their presence changes the scan fingerprint, so existing indexes
rebuild on their own without a schema bump.

`buildAdjacency` drops edges whose endpoints are not both known nodes. The
filter pipeline already guarantees that, but a dangling id would otherwise enter
the adjacency and receive PageRank as though it were a node.

**Analysis recomputes only when the visible subgraph can change.** The view —
and the adjacency, PageRank, and clustering derived from it — is memoized on
the filter fields alone (`NodeGraphFilterSettings`: search, kinds, min degree,
orphans, local depth, groups), so a display or physics slider tick costs
nothing. The search term feeds the memo through `useDeferredValue`, so typing
into a large graph stays responsive: the keystroke lands immediately and the
heavy recompute follows at deferred priority.

### Reading an edge's direction

`link`, `parent`, `fork`, `mount`, `agent`, `memoryOf`, `tagged` and `touches`
all mean something different depending on which end you are standing at, so the
inspector labels a connection by direction: `→ links to` versus `← linked from`,
with outgoing connections listed first. Labelling both directions identically
made an *incoming* link read as one the selected file had written — which is
indistinguishable from a link the user had deleted still being present, and sent
a bug report chasing the wrong layer. The canvas draws links undirected unless
**Display → Arrows** is on.

### Navigation and export

Zoom in/out, **fit to view** (the single most common way out of a stray pan),
**freeze layout** for a settled graph, and **save as PNG**. The canvas exposes
these through a `NodeGraphCanvasHandle` imperative ref rather than props, so the
camera stays owned by the canvas and driving it costs no re-render. PNG export
goes straight from `canvas.toBlob` to an object URL that is revoked immediately;
no main-process channel is involved because the renderer already owns the bytes.

### Query language

Whitespace separates AND terms, a leading `-` negates, and field terms target
structure instead of text:

```
kind:document   path:docs/   folder:notes   tag:testing
state:running   workspace:/repo   plain-substring   -excluded
```

The same parser drives the Filters search box and every group query. An empty
query matches nothing, so a blank group never colors the graph.

### Rendering choice

The graph is painted on a 2D `<canvas>`, not React Flow. `@xyflow/react` (used
by the Graph Mode run canvas) mounts a DOM node per graph node and caps out in
the low hundreds; a vault-scale graph needs thousands. Repulsion uses a uniform
spatial hash bounded by a cutoff radius rather than an all-pairs pass.

The simulation contains no `Math.random()`: seed positions come from a
phyllotaxis spiral, so the same graph always relaxes into the same layout and
the whole layout is unit-testable. Nodes that survive a filter change or a
refresh keep their positions, so the graph nudges instead of reshuffling.

Canvas pixels cannot inherit CSS, so `readNodeGraphCanvasTheme()` resolves the
`--ds-*` design tokens and a `MutationObserver` on `data-theme` repaints after a
theme switch.

**One coordinate space.** The shell applies `body { zoom: var(--ds-ui-scale) }`
(`styles/base-shell/window-navigation-logo.css`), and under CSS zoom
`getBoundingClientRect()` reports zoom-multiplied *client* pixels while
`clientWidth` and every CSS length inside the element stay in unscaled *layout*
pixels. Feeding a client-space rect into a layout-space CSS size offsets every
node from its hit region by the UI scale, growing with distance from the canvas
corner — nodes look grabbable in the wrong place. So the canvas measures itself
with `clientWidth`/`clientHeight`, keeps its `h-full w-full` CSS size, converts
pointer events with `nodeGraphLayoutPoint()`, and derives the factor by
measurement (`nodeGraphZoomFactor(rect.width, clientWidth)`) rather than reading
`--ds-ui-scale`, so any zoomed ancestor is covered. The backing store folds the
zoom into its density so the canvas stays crisp when scaled. A second
`MutationObserver` watches the inline `style` attribute on `<html>`, because the
UI scale is written there and does not always change the host's layout box.

### Clearing the window controls

With the app sidebar collapsed the top bar starts at the window's left edge,
which on macOS is where the traffic lights sit. The leading group takes the
shared `ds-window-controls-collapsed-titlebar-inset` and the shared
`SidebarTitlebarToggleButton`, the same pair Workflow and Schedule use, so the
graph lines up with its sibling views rather than sliding under the window
controls. The token is `0` off macOS, so it costs nothing there. Embedded in
Work there is no sidebar toggle and no window edge to clear, so no inset is
applied.
