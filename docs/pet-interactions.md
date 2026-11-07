# Joint pet interactions

The built-in cast is Xiao Kun, iKun and DS (`whale-girl`). Each retains its original
solo sprite sheet. Visits are authored as one scene on one transparent canvas,
with a shared clock, coordinate system, object ownership and contact solution.
There are no separately playing character clips during a joint scene.

Four joint activities are available:

- **Lift a bubble:** hands cradle the same bubble. A common lift and landing move
  the bubble, bodies and feet together; the hands release before it floats away.
- **Catch and return:** the ball changes ownership through explicit handoffs.
  Receivers reach before impact, cushion its weight, transfer it across the body
  and return it. Three pets form a passing chain.
- **Hand-in-hand dance:** both ends of every hand link resolve to the same world
  point while the partners share a balance and exchange steps.
- **Bounce a star:** a shared blanket is attached to the actual hands. The star's
  impact deforms the blanket and compresses all supporting bodies before launch.

`interactions.joint` in each pet package stores a validated, declarative rig:
neutral sprite row, blink cells, head pivot, shoulder/hand anchors, feet and ground.
The renderer uses the original pixels, with a textured mesh for articulated arms,
body lean, head tilt and planted or stepping feet. Faces are not replaced. iKun's
empty-handed source row prevents a second painted-in ball during a pass.

The `joint/` modules divide responsibilities:

- `geometry.ts` and `mesh.ts`: contact anchors and texture deformation.
- `scenes.ts`: coupled actions and shared object state.
- `timeline.ts`: entrances, interruption, exits and one scene hit region.
- `webgl-renderer.ts`: one GPU canvas, shared floor, character meshes, objects and
  a final hand pass so fingers can wrap around an object.
- `canvas-renderer.ts`: the same geometry with a coarser 2D fallback.
- `assets.ts`: decode once, retain only seven small cells per character, and
  crossfade to the original solo pose at the transition.

The entire scene can be dragged from a character or its shared object. Unrelated
transparent areas pass through to the desktop. Keyboard controls and the context
menu use one focus target. Hidden/reduced-motion scenes stop their animation loop;
GPU context restoration reloads resources without requiring an application restart.

The resident normally stays alone. Visits remain finite and automatic, with no
member selection. Model visits currently match DeepSeek to DS. Old saved activity
names are mapped to the four joint activities, and retired AI selections migrate
to DS without reopening a hidden overlay. Imported custom pets keep their own
namespaces and files.

Validation covers rendered hand/contact equality, bounded reach, continuity at
handoffs, shared impact response, entry/interruption/exit placement, reduced motion,
asset validation, cache migration and Electron rendering through the real pet
asset protocol. Visual review includes pairs and all three pets on a single canvas.
