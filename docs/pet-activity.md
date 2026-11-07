# Desktop pet activity

All three built-in pets use the same animation scheduler. Idle sprites sleep between
frame boundaries; only the open-eye frames hold for seconds. Moving scenes paint
transforms at the display refresh rate without rerendering the overlay. Hidden,
paused and reduced-motion surfaces stop their animation callbacks.

Settings > Pets > Companion across apps exposes two independent opt-ins. These
preferences default to off, including after migration. Existing in-app input and
voice reactions continue to work on all platforms.

- On macOS, typing uses a read-only CoreGraphics event tap. It emits at most five
  activity pulses per second, without reading key codes, characters, text fields
  or clipboard contents. Command/Control shortcuts are ignored. macOS Input
  Monitoring permission is requested only by the explicit settings action.
  Secure input remains protected by the OS.
- On macOS 14.2 or later, recording uses CoreAudio process input-running flags.
  It follows the existence of an active input stream, not speech or amplitude.
  No microphone is opened, audio collected, application identified or transcript
  generated. Device/driver reporting determines availability.
- Other platforms report unsupported for these global sources. The settings
  clearly show this; in-app reactions remain available.

The native observer is packaged as `Contents/Resources/native/pet-activity` and
built for both macOS architectures. It runs only while a pet and its reactions
are enabled. Closing the pet, disabling reactions, suspending or quitting stops
it. The owner supplies a heartbeat; EOF, owner death or a 15-second heartbeat
expiry also terminates the helper. A failed observer reports unavailable and can
be restarted by toggling the source. No startup or automatic retry prompts for
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
