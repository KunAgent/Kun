# Local speech release requirements

## Distribution status

The sanoTTS integration is not cleared for public distribution merely because
technical checks pass. Kun retains its PolyForm Noncommercial license. No
license change or third-party authorization is implied by this implementation.

sanoTTS runtime files (G2P WASM wrapping espeak-ng, the piperlite voice WASM,
and per-voice weights) are downloaded on demand into the user data directory.
They are not statically linked into `Kun.app`. The application does not vendor
`sanotts-web` sources.

G2P is GPL-3.0 because it embeds espeak-ng. The neural inference C runtime is
MIT. Voice files are published by Ampixa on Hugging Face (`ampixa/sanoTTS`).
Settings must keep the license note visible before a download starts.

This is not a legal opinion. Maintainers must still record a reviewed
distribution decision covering the downloaded G2P binary, corresponding source,
notices, and compatibility with Kun's terms before a public release.

References:

- https://github.com/Ampixa/sanoTTS
- https://github.com/espeak-ng/espeak-ng/blob/master/COPYING
- https://huggingface.co/ampixa/sanoTTS

## Technical acceptance

Run typecheck, lint, application and Kun tests, and the normal production build.
The NSIS regression test checks the pinned builder version and the actual
template's safe string-copy implementation.

The afterPack hook validates the unpacked worker's transitive relative imports.
The entry alone is not sufficient. Real-model integration tests use
`KUN_SANOTTS_TEST_ASSETS`, pointing at a directory that holds
`runtime/{snt_g2p.js,snt_g2p.wasm,snt_g2p.data,snt_voice.js,snt_voice.wasm}` and
`voices/amy/{meta.json,front_f32.bin,dec_f32.bin}`.

On each supported OS/architecture, after packaging run:

```sh
node scripts/smoke-packaged-speak.cjs --app <app-or-unpacked-directory> --assets <verified-test-assets>
```

This uses the packaged Electron executable and worker without opening a window
or writing to the user's profile. It must produce non-empty 22.05 kHz PCM. It
does not replace interactive playback or package-size and signing checks. A
macOS run is not evidence for Windows or Linux.

Run `npm run smoke:development-speak -- --assets <verified-test-assets>` to
check the actual settings, playback, main-loop responsiveness, buffer-underrun
accounting, recording export and repeat playback.

## User-facing behavior

Speech stays local. Script support follows the selected voice: Chinese voices
may speak Han, Russian voices may speak Cyrillic, Hindi voices may speak
Devanagari, and English voices still reject those scripts. Japanese, Korean,
Thai, and Arabic scripts are rejected for every v1 voice. The UI does not
switch voices mid-answer.

Saved recordings replay without runtime or voice assets. Disabling new
recordings does not delete old ones. Recordings are independent of
conversations, remain after conversation deletion, and can always be cleared in
Settings. The store is capped at 1 GiB with a 200 MiB capture ceiling. At
capacity, playback continues, existing recordings are preserved, and the UI
reports that the new recording was not saved. Clearing invalidates in-flight
captures.
