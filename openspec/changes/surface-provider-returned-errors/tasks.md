## 1. Failure Provenance Contract

- [x] 1.1 Add the typed optional model-request failure context to Kun events, Error Items, terminal failures, and renderer contracts
- [x] 1.2 Preserve HTTP and Responses/SSE provider codes and classify provider, transport, and preflight request states
- [x] 1.3 Propagate provider/model identity and structured failure metadata through live errors, terminal settlement, snapshots, and replay

## 2. Shared Agent Error UI

- [x] 2.1 Project model-request failure context into durable shared conversation blocks without duplicate terminal cards
- [x] 2.2 Implement the dual-layer provider response card and distinct transport/preflight presentations in the shared Agent timeline
- [x] 2.3 Add localized labels and summaries for every supported renderer locale

## 3. Verification

- [x] 3.1 Add adapter, loop, persistence/projection, deduplication, and shared timeline regression tests
- [x] 3.2 Validate targeted tests, typecheck, Kun build, file-line gate, full build, diff hygiene, and isolated visual states
