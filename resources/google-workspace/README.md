# Bundled Google Workspace CLI

Kun pins the official `googleworkspace/cli` **v0.22.5** executable; it does not
resolve a global `gws`, use an npm wrapper, or download executables at runtime.
The source tag resolves to `705fb0ecac6f4249679958f6325b809b63fdde17`.

## Prepare and package

`npm run prepare:google-workspace` prepares the host platform. `npm run build`
and `npm run dev:app` invoke it automatically. The electron-builder `beforePack`
hook prepares the actual target again, including cross-architecture builds:

```sh
npm run prepare:google-workspace -- --platform darwin --arch arm64
```

Supported targets are macOS arm64/x64, Linux arm64/x64, and Windows x64.
Windows arm64, universal macOS, and other targets fail closed. Linux uses the
upstream statically linked musl builds, avoiding the GNU x64 artifact's
GLIBC_2.39 requirement on otherwise supported Linux installations.
Preparation requires build-time network access on the first run. A verified
local binary is reused without downloading. A wrong checksum, unsupported
platform, or missing release asset stops preparation and packaging.

`manifest.json` pins each official release archive's URL, size, and SHA-256,
plus the extracted executable's size and SHA-256. The archive digests were
checked against both GitHub's release asset metadata and the upstream `.sha256`
files; executable hashes were computed from the verified archives. Downloads
are bounded, and both the archive and extracted binary are checked. Extraction
only retains the requested regular file in memory; it never writes archive
paths, follows links, or invokes a shell extractor. Traversal, absolute paths,
links, duplicate executables, and oversized payloads are rejected.

Generated `current/gws` (or `gws.exe`) and `current/selected.json` are ignored.
Never commit them or other build outputs. Packaged applications receive:

- `resources/google-workspace/gws` (or `gws.exe`)
- `resources/google-workspace/selected.json`
- `resources/google-workspace/manifest.json`
- `resources/google-workspace/legal/*`

No API credentials or OAuth client configuration belong in these resources.

## Integrity and platform signatures

The afterPack validator compares the packaged manifest to the source-owned
manifest, checks target metadata, exact executable bytes, and legal files,
and requires one executable for the target. This happens before code signing.

`selected.sha256` and `selected.size` always identify the original upstream
executable. Platform signing changes binary bytes, so signed builds additionally
record `selected.packagedSha256` and `selected.packagedSize`. Runtime validation
must check the original metadata against the pinned manifest, then verify the
actual executable against the packaged digest when present (otherwise against
the original digest). A digest failure must not trigger a runtime download or
fallback to a globally installed executable.

Windows records the packaged digest after electron-builder `signIf`. The custom
macOS signing wrapper preserves electron-builder's signing options and retries.
It records the digest from the per-file callback for the outer app, after nested
code has been signed and before the app signature seals `selected.json`. Ad-hoc
macOS packaging records it after deep signing and re-seals only the outer app.
There is no manifest write after the final outer signature or notarization.

This build attestation shares the application's trust boundary: it is protected
by the signed app bundle on macOS, and installed application integrity elsewhere.
It is not an independent defense against someone who can replace the application
code and its metadata. Native signed packaging still requires testing on macOS
and Windows; the cross-platform unit tests verify hook ordering and hash checks.

## Authentication constraints verified in v0.22.5

The bundled CLI does not provide an application-owned public OAuth client.
`gws auth setup` depends on a separate `gcloud` installation. Kun instead gives
manual setup guidance: users place their Desktop OAuth client JSON directly at
`~/.config/gws/client_secret.json`, then start `gws auth login` through Settings
with the explicitly selected scopes. Kun does not import or read the client
file, credentials, token caches, or encryption keys. The default gws storage
is shared with other gws users; upstream may recognize an existing legacy path.
Users must enable the relevant APIs, configure consent and add test users when
needed. The interactive upstream setup wizard remains an external user action.

Upstream supports `GOOGLE_WORKSPACE_CLI_CONFIG_DIR`, but Kun deliberately does
not inherit it or credential/proxy overrides. Each invocation has a private
working directory with an empty `.env`, stopping upstream dotenv's parent
search from reintroducing those overrides. An empty private PATH prevents
incidental gcloud discovery, and a host-owned missing ADC path blocks fallback
to another application's Google identity. Login prints its
Google authorization URL to stderr (stdout in the proxy-aware flow) and waits
for a localhost callback. It has no `--no-browser` flag. Success returns JSON
with `status`, `account`, `credentials_file`, `encryption`, and `scopes`.

`auth status` can refresh a token and retrieve granted scopes/user information;
`auth_method: oauth2` alone does not demonstrate valid authentication. Network
failures can leave `token_valid` absent. Do not expose raw status paths, OAuth
URLs, tokens, or exported credentials in logs or agent messages. The returned
login scopes include automatically added OpenID/email/profile identity scopes.

The upstream release supplies an Apache-2.0 LICENSE. Attribution and the limits
of upstream's dependency-license inventory are recorded under `legal/`.
