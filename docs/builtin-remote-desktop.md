# Built-in remote desktop

Kun's built-in desktop viewer is an optional alternative to UU Remote. Computer-to-computer access uses separate controller and host checks on Windows x64, macOS arm64/x64 and Linux arm64/x64. A local host switch authorizes the current login session. Game streaming and playback audio are separate opt-ins. The original phone flow is described below.

## Computer hosts

Build the Windows input helper with Go 1.22 or later. The macOS helper builds with Xcode. Linux packages carry the Python helper and use the system X11/XTest or Wayland Portal backend. The active login session must be available through logind. Linux playback capture uses the default output monitor. See the [platform setup and release checks](../../kunserve/docs/desktop-cross-platform.zh-CN.md).

## Setup

1. Build a desktop package with `npm run build`. The build compiles the bounded native input/session guard under `resources/native/remote-desktop-input`; packaging includes that executable.
2. Use a backend that exposes the authenticated `/api/remote/v1/desktop/ice` endpoint with its TURN provider configured. The existing remote account, device-pairing and membership requirements still apply.
3. Sign in to Kun and enable phone access. In Connect phone, select the displays that may be shared and enable built-in desktop access.
4. Grant the specific phone `desktop.view`, and optionally `desktop.control`, in Advanced access. Control requires view. These advanced permissions and display choices last only for the current desktop application session.
5. Allow Screen Recording for viewing and Accessibility for input in macOS System Settings. The remote panel links to the existing system-permission flow. The native input process independently checks its actual Accessibility trust before control is accepted.
6. Install a KunApp binary that includes its native WebRTC module, then choose the built-in provider from an existing Code or Agent conversation.

During a desktop session, the Kun remote desktop icon appears in the menu bar or system tray. Its menu identifies the display, controller and view/control mode and provides a local action to end the session. The capture window is protected from the older LAN workbench IPC mirroring mechanism.

### Phone-controlled privacy screen

In KunApp, take control, open **More** in the full-screen remote desktop view and turn on **Computer privacy screen**. The phone continues to operate the approved display while the computer covers its monitors with black panels. Turn the switch off to restore them. Disconnecting also restores the displays, including after a lost heartbeat. At the computer, press **Ctrl + Alt + Shift + P** (**Control + Option + Shift + P** on Mac) to end the session.

The phone, host and control package negotiate `desktop.privacy-screen.v1`. Windows 10 version 2004 (build 19041) and newer Windows x64 desktops use click-through, non-activating Win32 windows. The helper verifies capture exclusion on every monitor before confirming activation. On macOS, ScreenCaptureKit supplies a video stream that excludes the curtain process. An independent virtual Mac display keeps its existing video source. On both platforms the native window owner exits when the host, capture renderer or media lease is lost. [Windows display affinity](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity)

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

On macOS 14 or later, `node scripts/smoke-computer-desktop.cjs --privacy` verifies local black pixels and changing WebRTC video on a synthetic secondary monitor. Use `--privacy-drop` to verify restoration after an abrupt peer disconnect.

On a disposable, unlocked Windows x64 test VM with one monitor, run `node scripts/smoke-computer-desktop.cjs --privacy --disposable-windows-desktop` and repeat with `--privacy-drop`. The fixture covers the test desktop, checks the native curtains and mouse hit target, and verifies that the WebRTC receiver sees the underlying window change color while covered.
