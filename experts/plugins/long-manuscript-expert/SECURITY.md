# Security

## Trust Boundary

`long-manuscript-expert` is designed to deliver first value without assuming connector, MCP, or service-side tool availability.

Security-sensitive behaviors are intentionally constrained:

- no automatic workspace write before explicit user request
- no automatic product-credit claim from local-equivalent evidence
- no payment-closure claim from entitlement or claim signals
- same-binding remains required before any closure wording can be upgraded

## Data Handling Baseline

The package is intended to process only the materials the user explicitly provides in the current conversation or requested task flow, such as:

- outlines
- old drafts
- interview notes
- transcripts
- research notes
- whitepaper source packs

The package should not be treated as requiring hidden local file scans or background workspace indexing for first value.

## Identity And Progression Boundary

When service-side observation is present, the intended closed-loop boundary is:

- anonymous-first binding
- delayed identify
- unlock not before `continued_use_completed`
- host rendering and next-step steering separated from product-credit decisions

Anonymous binding keys remain primary until an explicit later-stage bind exists:

- `anonymousUserCodeHash`
- `serverBindingId`
- `chainFingerprint`

## Official Listing Boundary

Official listing and official-entry runtime behavior are separate from local-equivalent testing.

Before official listing:

- `my-experts` is local-equivalent evidence only
- official marketplace absence is not a package-structure failure
- official-entry followthrough and route-fixability warnings must remain open

After official listing:

- rerun official-entry followthrough for WorkBuddy
- rerun official-entry followthrough for WorkBuddyAI
- rerun official-entry route-fixability and aggregate reverify reports

## Reviewer Notes

- `PRIVACY.md` describes the package privacy baseline.
- `references/quality/quality-check.md` describes the reviewer-facing verification baseline.
- `contracts/review-orchestration-contract.json` describes support, review, install, and evidence boundaries.

These documents are submission-facing trust materials. They do not replace runtime or service-side evidence.

## Disclosure And Remediation Boundary

If a reviewer or operator finds a package-level issue, treat it in this order:

1. verify whether it is a package-content issue, a local host issue, or an official-entry-only issue
2. preserve the current latest reports before changing package structure
3. rerun the smallest relevant validation chain after the fix

For WorkBuddyAI validation, any validator shadow path is compatibility-only evidence and must not be reported as the real install surface.
