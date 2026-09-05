## Context

Kun model adapters already distinguish structured HTTP failures, network failures, and some stream failures through `ModelFailureMetadata`, but the durable runtime contracts expose only generic `message`, `code`, and `details` fields. The renderer therefore cannot reliably decide whether the provider returned a message or the request failed before a provider response. The shared `TimelineRuntimeError` component renders all Agent conversation surfaces, so one structured provenance path can provide consistent behavior without duplicating UI.

Several touched source files are close to the repository's 700-line limit. New schemas and projection helpers must live in focused modules rather than expanding already-large loop and renderer type files.

## Goals / Non-Goals

**Goals:**

- Persist a typed, backward-compatible model-request failure context through live events, Error Items, terminal events, snapshots, and replay.
- Preserve redacted provider error messages and structured provider error codes from HTTP and Responses/SSE failures.
- Make provider-returned failures visually unmistakable while preserving concise, accessible conversation flow.
- Distinguish transport and local preflight failures without misattributing them to a provider.
- Reuse one presentation across every Agent conversation timeline.

**Non-Goals:**

- Exposing request headers, credentials, full provider URLs, or unredacted payloads in the conversation.
- Redesigning Provider settings, request-history diagnostics, or non-Agent model features.
- Adding a new retry policy or changing which failures are retryable.
- Replacing the existing model-request trace inspector.

## Decisions

1. **Use an optional typed `modelRequestFailure` field.** A new shared schema carries `requestState`, provider/model identity, and safe structured failure fields. It is optional on runtime Error Events, terminal turn events, and Error Items so historical logs remain valid. A dedicated field is preferred over parsing arbitrary `details` because provenance drives user-visible semantics.

2. **Represent delivery state explicitly.** `requestState` is one of `provider_responded`, `sent_no_response`, or `not_sent`. This avoids guessing from status codes or error strings and makes the source label deterministic.

3. **Preserve provider codes at the adapter boundary.** HTTP classification supplies status and provider code through `ModelFailureMetadata`. Responses/SSE decoding extracts nested provider error codes and the streaming client annotates provider-returned stream errors. Generic transport recovery remains separate.

4. **Attach request identity in the model round.** The model round combines adapter failure metadata with the request's provider and model before recording the durable error and remembered terminal failure. Route-target identity remains authoritative when a route pool supplies an actual provider/model.

5. **Render a dual-layer provider card.** The shared error component shows a localized summary plus the redacted provider message directly. Provider/model and HTTP/provider codes remain visible as compact metadata; less common fields stay in the existing collapsed technical details. Transport, preflight, and legacy runtime errors use distinct copy and never receive the provider-return badge.

6. **Merge duplicate terminal diagnostics by failure identity.** Projection deduplication treats an immediate model Error Event and its terminal Error Item as the same failure when turn, code, message, and provenance match. The terminal snapshot enriches the existing card instead of adding another one.

## Risks / Trade-offs

- [Older events have no provenance] -> Preserve the current generic rendering when `modelRequestFailure` is absent.
- [Provider messages may contain secrets] -> Apply the existing secret redaction before persistence-to-view projection and again before rendering technical details.
- [Some stream errors omit HTTP status] -> Show the provider code/message without inventing an HTTP value.
- [Route pools can change provider identity] -> Prefer actual route metadata from the failure, then fall back to the requested provider/model.
- [More metadata could destabilize long-thread projection] -> Keep fields small, optional, and item-based; add replay and duplicate-event regression coverage.

## Migration Plan

Ship the optional fields additively. Existing persisted events and items continue to parse and render with the legacy generic card. Rollback is safe because older runtimes ignore no required fields and the generic `message`/`code` remain authoritative.

## Open Questions

None.
