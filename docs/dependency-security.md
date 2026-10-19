# Dependency security overrides

## Solid's Seroval dependency

`kun/package.json` temporarily overrides only `solid-js@1.9.12`'s `seroval`
dependency to `1.6.4`. The TUI remains on `@opentui/core@0.6.6`,
`@opentui/solid@0.6.6`, and `solid-js@1.9.12`; OpenTUI declares an exact Solid
peer version. The existing `seroval-plugins@1.5.6` stays unchanged and accepts
Seroval `^1.0`.

Solid pins Seroval to `~1.5.0`, which cannot resolve the fixes covered by
[GHSA-jp82-f5mq-hwhp](https://github.com/lxsmnsyc/seroval/security/advisories/GHSA-jp82-f5mq-hwhp).
The advisory lists `1.6.3` as patched. We use `1.6.4` because it additionally
validates that a TypedArray or DataView backing source is actually an
ArrayBuffer. A small array-like source is still accepted by the published
`1.6.3` package. The distinction is documented in the
[upstream changelog](https://github.com/lxsmnsyc/seroval/blob/main/packages/seroval/CHANGELOG.md).

This is a narrowly scoped dependency override, not an audit exclusion or a
forced Solid peer upgrade. Kun's terminal build uses Solid's reactive client
entry points rather than its web/server serializer, but the vulnerable
production dependency must still be removed.

`kun/src/tui/solid-serialization.test.ts` resolves Seroval from the installed
Solid package. It checks asynchronous and piped SSR serialization with the
existing web plugins, then rejects a malformed backing source using only
eight elements. The malformed-input assertion fails against `1.5.6` and
`1.6.3` and passes against `1.6.4`.

Remove this override when a compatible OpenTUI/Solid release naturally
resolves a patched Seroval version. Re-run the regression test, TUI build and
tests, and production dependency audit before removing it; do not bypass
OpenTUI's peer constraint with `--force` or `--legacy-peer-deps`.
