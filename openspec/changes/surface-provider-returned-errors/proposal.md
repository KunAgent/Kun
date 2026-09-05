## Why

Kun currently renders provider responses, transport failures, and local preflight failures through the same generic runtime-error presentation. Users cannot reliably tell whether an LLM request reached the provider or whether the displayed text came from the provider, which makes overload, authentication, and local configuration failures unnecessarily difficult to diagnose.

## What Changes

- Add durable model-request failure provenance that distinguishes provider responses, requests with no response, and requests rejected before sending.
- Preserve safe provider identity, model identity, HTTP status, provider error code, category, and retry timing when available.
- Preserve structured provider error codes from HTTP and Responses/SSE failures instead of replacing them with a generic stream error code.
- Render provider-returned failures with a prominent source label, localized summary, directly visible redacted provider message, compact status/code metadata, and collapsed technical details.
- Render transport and preflight failures with distinct source copy so neither is presented as a provider response.
- Reuse the shared conversation timeline for main, side, subagent, Code, Work, Design, and Write Agent conversations.

## Capabilities

### New Capabilities

- `provider-error-provenance`: Defines durable failure-source metadata and consistent Agent conversation presentation for model-provider, transport, and preflight failures.

### Modified Capabilities

None.

## Impact

This affects Kun model response decoding, model-loop error persistence, runtime event and item contracts, renderer runtime projection, the shared Agent timeline error component, localization resources, and their regression coverage. The new fields are optional and backward compatible with existing event logs and historical Error Items.
