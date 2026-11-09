# Desktop pet activity

All three built-in pets use the same animation scheduler. Idle sprites sleep between
frame boundaries; only the open-eye frames hold for seconds. Moving scenes paint
transforms at the display refresh rate without rerendering the overlay. Hidden,
paused and reduced-motion surfaces stop their animation callbacks.

Typing, in-app voice and bottle-drop reactions are enabled while a pet is visible.
Settings > Pets > Automatic companionship shows system typing status. Following
other apps' recording state remains an explicit opt-in. In-app input and voice
reactions continue to work on all platforms.

- On macOS, typing uses a read-only CoreGraphics event tap. Physical key codes
  are used only inside the helper to match presses and releases.
  IPC receives left/right/both paw masks, never key names, codes, characters, text
  fields or clipboard contents. Held-key heartbeats do not create extra strikes. Input
  Monitoring permission is requested only by the explicit settings action.
  Secure input remains protected by the OS.
- On macOS 14.2 or later, recording uses CoreAudio process input-running flags.
  It follows the existence of an active input stream, not speech or amplitude.
  No microphone is opened, audio collected, application identified or transcript
  generated. Device/driver reporting determines availability.
- Other platforms report unsupported for these global sources. The settings
  clearly show this; in-app reactions remain available.

The native observer is packaged as `Contents/Resources/native/pet-activity` and
built for both macOS architectures. It runs only while a pet is visible.
Closing the pet, suspending or quitting stops
it. The owner supplies a heartbeat; EOF, owner death or a 15-second heartbeat
expiry also terminates the helper. A failed observer reports unavailable and can
be restarted by hiding and waking the pet. No startup or automatic retry prompts for
permission.

Only whitelisted states cross main-process IPC, with activity expiring after
1.8 seconds. Detailed in-app voice levels win over global recording heartbeats.
Activity never enters settings, chat history or the model context.

Validation:

- `npx vitest run src/main/pets src/renderer/src/pets src/shared/pets`
- `npm run smoke:pet-activity` builds the helper and checks its protocol, read-only
  OS availability probe, EOF cleanup and heartbeat expiry. It neither injects
  keystrokes nor starts recording. Real Input Monitoring authorization and active
  recording transitions still require a user-controlled app/device smoke test.
- `node scripts/smoke-pet-activity.cjs /path/to/kun-dv.app/Contents/Resources/native/pet-activity`
  repeats these checks against the packaged binary.

Apple references: [Input Monitoring](https://support.apple.com/guide/mac-help/mchl4cedafb6/mac),
[listen-event permission](https://developer.apple.com/documentation/coregraphics/cgrequestlisteneventaccess%28%29),
[process input-running state](https://developer.apple.com/documentation/coreaudio/kaudioprocesspropertyisrunninginput).

## Keyboard desk reaction

Typing uses a small keyboard on the same canvas as the resident. Physical left
and right key groups move the corresponding paw; Space moves both. A short tap
remains visible for one complete strike, a held key stays down without auto-tapping,
and releasing the last key for a paw lets it spring back. Keycap depression and
hand contact use the same geometry. Only the original head pixels blink.

The active macOS observer is the authoritative source while available, preventing
Kun's editor events from counting the same key twice. Without it, editor key
edges and an IME fallback still work in the app. Focus loss clears editor state;
tap resets, permission loss, reconciliation and source expiry clear system state.
No input content or keyboard history is persisted.

Interaction reference: [BongoCat input semantics](https://github.com/ayangweb/BongoCat/blob/47a73ed1765b13fdd674ec356d51b5b16a6b5a5b/shared/behavior/input-semantics.md).
Kun uses its own artwork, renderer and implementation; no BongoCat model assets
or Live2D runtime are bundled.

Older custom packages without a joint rig retain their declared sprite typing clip.
