## Why

Kun can generate native PPTX files through the managed PPT Master workflow, but it does not yet have a slide workspace where the main Kun Agent and a user can repeatedly edit the same presentation. The NQ PPT HTML Editor demonstrates that a 16:9 HTML canvas, slide rail, direct text editing, and property inspector can make this workflow approachable. Its temporary DOM identifiers, unsandboxed arbitrary HTML, and full-document snapshot export are not suitable as a stable Kun extension contract.

## What Changes

- Add a complete `presentation-studio` Kun extension example whose user-visible name is `Kun PPT`, with a right-sidebar Webview, a dedicated presentation icon, and typed presentation tools exposed to the main Kun Agent.
- Store each deck as a standalone `.kun-ppt.html` file whose embedded, versioned presentation model is the source of truth and whose visible HTML is a deterministic projection.
- Give slides and elements stable IDs and route both visual edits and Agent edits through one revision-aware typed-operation reducer.
- Provide create, read, apply, validate, and copy/export operations with bounded schemas, optimistic revision checks, idempotency records, and serialized writes.
- Provide slide thumbnails, a 16:9 canvas, text/shape/image elements, property editing, drag/resize, slide ordering, undo/redo, preview, and autosave in a sidebar-first tabbed layout.
- Surface completed Agent-generated presentation artifacts below the final reply and open them through the operating system's default application association, with a safe file-manager fallback.
- Render only the structured presentation model inside the Webview. Agent-authored arbitrary HTML or scripts never execute in the bridge-bearing extension page.
- Document the extension and add it to the repository extension-example validation gate.
- Package Kun PPT in the product-owned bundled extension catalog so clean and existing profiles receive it through the normal default-extension seeder.

## Capabilities

### New Capabilities

- `agent-html-presentation-extension`: Defines a stable, visually editable HTML presentation format and the extension APIs used by people and Kun Agent runs to edit it safely.

### Modified Capabilities

None.

## Impact

- Adds one public Extension API v1 example under `examples/extensions/presentation-studio`.
- Updates extension example documentation and validation enumeration, plus the existing chat artifact presentation and PPT Master result metadata.
- Adds no private renderer IPC, runtime route, second Agent runtime, provider surface, or PPT generation-pipeline change.
- Does not copy the NQ editor implementation; it clean-room reuses the interaction ideas while preserving Kun's Webview and tool security boundaries.
