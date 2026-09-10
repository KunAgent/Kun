# Local speech release requirements

## Distribution status

The Kokoro integration is not cleared for public distribution merely because
technical checks pass. Kun retains its PolyForm Noncommercial license. No
license change or third-party authorization is implied by this implementation.

`onnxruntime-node@1.23.2` and `onnxruntime-common@1.23.2` are MIT licensed.
`phonemizer@1.2.1` declares Apache-2.0 for its wrapper but embeds espeak-ng
WebAssembly and pronunciation data governed by the upstream GPL terms.
The downloaded Kokoro model and voice files declare Apache-2.0.

Before publishing phonemizer in Kun, maintainers must record a reviewed
distribution decision covering the embedded binary, its exact corresponding
source and build instructions, notices, and compatibility with Kun's terms.
A wrapper's package.json license field or a NOTICE entry does not establish
that review. If the combination cannot be distributed as intended, replace
the pronunciation implementation or obtain the necessary authorization before
release. Do not remove notices or declare approval without supporting evidence.

References:

- https://github.com/espeak-ng/espeak-ng/blob/master/COPYING
- https://www.npmjs.com/package/phonemizer/v/1.2.1
- https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX

## Technical acceptance

Run typecheck, lint, application and Kun tests, and the normal production build.
The NSIS regression test checks the pinned builder version and the actual
template's safe string-copy implementation.

The afterPack hook validates the unpacked worker's transitive relative imports,
the native binding, and the platform runtime library. The entry alone is not
sufficient. Real-model integration tests use `KUN_KOKORO_TEST_ASSETS`, pointing
to verified `model_quantized.onnx` and `af_heart.bin` files.

On each supported OS/architecture, after packaging run:

```sh
node scripts/smoke-packaged-speak.cjs --app <app-or-unpacked-directory> --assets <verified-test-assets>
```

This uses the packaged Electron executable, worker and native dependencies,
without opening a window or writing to the user's profile. It must produce
non-empty 24 kHz PCM. It does not replace interactive playback or package-size
and signing checks. A macOS run is not evidence for Windows or Linux.

Run `npm run smoke:development-speak -- --assets <verified-test-assets>` to
check the actual settings, playback, main-loop responsiveness, buffer-underrun
accounting, recording export and repeat playback.

## User-facing behavior

Speech stays local. Unsupported non-Latin scripts are rejected before model
download and are never silently sent to a remote provider. English remains the
only supported pronunciation language.

Saved recordings replay without model or voice assets. Disabling new recordings
does not delete old ones. Recordings are independent of conversations, remain
after conversation deletion, and can always be cleared in Settings. The store
is capped at 1 GiB with a 200 MiB capture ceiling. At capacity, playback
continues, existing recordings are preserved, and the UI reports that the new
recording was not saved. Clearing invalidates in-flight captures.
