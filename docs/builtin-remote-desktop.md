# Built-in remote desktop

Kun's built-in desktop viewer is an optional alternative to UU Remote. The first host implementation is macOS 13+ on Apple Silicon. Other platforms do not advertise the capability.

## Setup

1. Build a desktop package with `npm run build`. The build compiles the bounded native input/session guard under `resources/native/remote-desktop-input`; packaging includes that executable.
2. Use a backend that exposes the authenticated `/api/remote/v1/desktop/ice` endpoint with its TURN provider configured. The existing remote account, device-pairing and membership requirements still apply.
3. Sign in to Kun and enable phone access. In Connect phone, select the displays that may be shared and enable built-in desktop access.
4. Grant the specific phone `desktop.view`, and optionally `desktop.control`, in Advanced access. Control requires view. These advanced permissions and display choices last only for the current desktop application session.
5. Allow Screen Recording for viewing and Accessibility for input in macOS System Settings. The remote panel links to the existing system-permission flow. The native input process independently checks its actual Accessibility trust before control is accepted.
6. Install a KunApp binary that includes its native WebRTC module, then choose the built-in provider from an existing Code or Agent conversation.

The desktop sharing indicator identifies the display, controller and view/control mode, and provides a local end button. The indicator and capture window are protected from the older LAN workbench IPC mirroring mechanism.

## Connection and cleanup

The Electron Main process handles `desktop.*` methods before the generic runtime invocation path. A private, nonpersistent renderer owns the WebRTC sender. Its sandboxed preload exposes only the capture command/reply interface. A distinct partition and renderer ownership check are required before the native guard can supervise the capture process.

The desktop creates a sendonly video transceiver, negotiates H.264 first, and waits for the validated DataChannel hello before attaching capture to the sender. Outgoing ICE candidates are held until the answer has been accepted. Quality controls constrain source size/frame rate and sender bitrate.

Input is validated in Main and dispatched through the native helper. The same arbiter protects the existing GUI computer-use input bridge: viewing does not reserve input, human control excludes new AI input, and releasing control waits for native release acknowledgement. Mouse button and key state are mirrored for a release-only fallback if the helper exits unexpectedly.

Selected-sender health is sampled every 500 ms from real WebRTC statistics. Repeated cached timestamps do not renew health. Missing health for two seconds, a muted/ended capture track, or unavailable sender counters releases control; the phone additionally checks receive/decode progress. Duplicate source frames with stable encoded/sent counters are a valid static screen. Locking the Mac, suspending it or deactivating its login session ends the logical session without automatically resuming it.

If Accessibility trust is revoked while input is held, native release/stop returns cleanup-unconfirmed and retains its ledger. Main retains its mirrored ledger and retries release after permission is restored; capture shutdown still proceeds.

Closing terminates the logical session across media epochs. Cancel-before-start creates a bounded tombstone, and delayed start/ICE/ready callbacks cannot resurrect a closed session. Cleanup is confirmed only after capture and native input cleanup have completed; a failure remains unconfirmed and is retried. The native helper checks a short lease independently of Main, and uses high-resolution process birth identity and descendant ownership before terminating a stalled capture renderer.

Ordinary Agent/Code tasks continue when the desktop session ends. Closing the main desktop application retains the existing application-owned shutdown behavior and stops its runtime stack.

## Verification

- `npx vitest run src/main/remote-desktop/` tests session cancellation, authority and display fencing, candidate ordering, control serialization, heartbeat expiry and cleanup confirmation.
- The mobile-link regression tests cover the Main dispatch extraction and the shared admission budget. Two existing execution-stop slots remain reserved; two separate desktop-stop slots are allocated from ordinary capacity.
- `node scripts/build-remote-desktop-helper.cjs` compiles the native helper. `node scripts/smoke-remote-desktop-helper.cjs` performs the no-input process-identity and lease-termination smoke tests.
- Run Electron with `scripts/smoke-remote-desktop-peer.cjs` for a hidden synthetic-canvas WebRTC test. It checks offer-without-track negotiation, hello/replaceTrack, streamless receiver fallback, H.264 frames and complete peer/channel/track closure. It does not capture the user's screen or exercise OS input.
- `npm run check:built-preload` validates the emitted sandbox preloads. They must not require local CommonJS chunks.

A signed Mac-to-iPhone session, real capture/input permissions, touch/IME accuracy, WAN/TURN quality, native memory use and physical-device disconnect behavior still need their own release evidence. Successful synthetic peer and process smoke tests are not evidence of those device checks.
