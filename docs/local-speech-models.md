# Local read-aloud assets

Read-aloud (sanoTTS) is separate from Whisper speech input. On first use, Kun
fetches the shared WASM runtime and the selected voice under the application
user-data directory, `models/speech/sanotts`. Playback starts after verification.
No spoken text is sent to model hosts.

## Reproducible sources

- Runtime and GitHub voice weights: official
  [sanoTTS revision ce541238](https://github.com/Ampixa/sanoTTS/tree/ce541238903817f3f186fe47460078f06f34997e/web)
- Hugging Face voice weights (including the configured HF-Mirror transport):
  [revision c532a5d2](https://huggingface.co/ampixa/sanoTTS/tree/c532a5d21c078a16cb633718e9182bfd71a5b760/web)
- Russian pronunciation dictionary: official
  [eSpeak NG 1.52.0 revision 4870adfa](https://github.com/espeak-ng/espeak-ng/tree/4870adfa25b1a32b4361592f1be8a40337c58d6c/dictsource)

The persisted `github-pages` setting remains compatible, but now means pinned
GitHub assets. Never use the mutable GitHub Pages demo or `resolve/main` with a
fixed checksum manifest. The Hugging Face repository contains voices only;
changing voice mirrors cannot change the runtime source.

The shared runtime is 3,659,547 bytes. Voices including their metadata are:

- Amy: 5,819,317 bytes
- Chinese: 6,000,266 bytes
- Hindi: 5,999,893 bytes
- Russian: 26,472,875 bytes, including 23,336,873 bytes of pronunciation sources

Russian requires `ru_rules`, `ru_list`, `ru_emoji`, and `ru_listx`. The runtime's
small bundled dictionary is insufficient. Compile the complete matching sources
once in the worker's WASM filesystem, then free staged source files. This avoids
2,048 lazy demo shard requests and keeps subsequent speech offline. G2P and the
eSpeak dictionary are GPL-3.0; retain the existing local-speech license notice.

## Integrity and recovery

Every file is pinned by exact byte length and SHA-256. Download to `.download`,
verify, and atomically replace the destination. Abort, timeout, truncation, size
or checksum failure removes the partial file. Retry reuses already verified
complete files; it restarts an interrupted file rather than resuming unverified
ranges. Existing empty, truncated, old or corrupt assets never count as ready.
A bounded verification cache includes file identity, size, mtime and ctime.

Electron's network stack provides desktop proxy support. Connection and body
stall deadlines are separate and do not abort the remaining voice mirrors.
Settings expose voice progress and errors, with bounded status reconciliation.
A stop click releases the playback owner without canceling an independent manual
download. Runtime cancellation waits for cleanup before another transfer starts.

## Validation

Deterministic tests use loopback HTTP servers for redirect, truncation, retry,
connection/body timeout and cancellation, plus corruption and offline cache
reuse. The macOS/Windows PR package jobs run local-speech regression tests too.

Optional live download and real-WASM tests (about 48 MB for all assets):

```sh
KUN_SANOTTS_DOWNLOAD_TEST_DIR=/tmp/sanotts-assets npx vitest run src/main/services/local-sanotts-download.integration.test.ts
npx esbuild src/main/services/local-sanotts-worker-entry.ts --bundle --platform=node --format=esm --outfile=out/main/local-sanotts-worker-entry.js
KUN_SANOTTS_TEST_ASSETS=/tmp/sanotts-assets npx vitest run src/main/services/local-sanotts-synthesis-service.integration.test.ts
```

These tests check non-silent PCM, all four languages, speed direction, repeated
voice switching, cancellation, missing assets and worker release. PCM assertions
are not evidence of real speaker playback or a listening-quality assessment.
