# Collaboration Network Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a self-hosted native Collaboration server, encrypted invitations, RFC 9420 meeting E2EE, TaskKey isolation, cross-member-device synchronization, restricted remote employee invocation, and encrypted manual artifact delivery.

**Architecture:** A Rust `kun-collab-server` stores and sequences ciphertext without linking MLS. Electron Main owns identity, OpenMLS state through a Rust N-API binding, TaskKeys, encrypted Outbox, local projections, reception execution, and artifact application; Renderer receives sanitized DTOs only.

**Tech Stack:** Rust, Axum, SQLite, rustls TLS 1.3, OpenMLS, napi-rs, Electron `safeStorage`, Argon2id fallback, TypeScript/Zod, Vitest, Rust tests, Playwright/Electron three-client harness.

---

### Task 1: Freeze the Authoritative Wire Protocol

**Files:**
- Create: `packages/collaboration-protocol/package.json`
- Create: `packages/collaboration-protocol/src/schema.ts`
- Create: `packages/collaboration-protocol/src/schema.test.ts`
- Create: `packages/collaboration-protocol/schema/collaboration-v1.json`
- Modify: `package.json`

- [ ] **Step 1: Write failing frame and namespace tests**

```typescript
expect(ClientFrameSchema.parse({ version: 1, kind: 'command', commandId: 'c1', payload: encrypted })).toBeTruthy()
expect(() => ServerEventSchema.parse({ kind: 'collaboration_task_created' })).toThrow()
expect(ServerEventSchema.parse({ kind: 'human_task_created', sequence: 1, ciphertext })).toBeTruthy()
```

- [ ] **Step 2: Verify failure**

```powershell
npx vitest run packages/collaboration-protocol/src/schema.test.ts
```

Expected: FAIL because the protocol package does not exist.

- [ ] **Step 3: Implement one generated schema source**

Define handshake/version negotiation, auth, command/event envelopes, signed receipts, invitations, membership, presence, snapshots, blob manifests, errors, size limits, optimistic version, sequence, epoch metadata, command ID, and ciphertext bytes. Generate JSON Schema from the Zod source and fail CI on drift.

- [ ] **Step 4: Run protocol tests and schema check**

```powershell
npx vitest run packages/collaboration-protocol/src/schema.test.ts
npm run check:collaboration-schema
```

Expected: PASS and no schema diff.

- [ ] **Step 5: Commit the protocol**

```powershell
git add packages/collaboration-protocol package.json package-lock.json
git commit -m "feat(collaboration): define encrypted wire protocol"
```

### Task 2: Pass the OpenMLS Client Binding Gate

**Files:**
- Create: `native/kun-collab-crypto/Cargo.toml`
- Create: `native/kun-collab-crypto/src/lib.rs`
- Create: `native/kun-collab-crypto/src/group.rs`
- Create: `native/kun-collab-crypto/tests/mls_vectors.rs`
- Create: `src/main/collaboration/crypto/mls-adapter.ts`
- Test: `src/main/collaboration/crypto/mls-adapter.test.ts`

- [ ] **Step 1: Write failing vector, persistence, and removal tests**

```rust
assert!(run_official_vector("test_vectors/messages.json"));
assert!(restored_group.decrypt(&ciphertext).is_ok());
assert!(removed_member.decrypt(&post_remove_ciphertext).is_err());
```

- [ ] **Step 2: Verify failure**

```powershell
cargo test --manifest-path native/kun-collab-crypto/Cargo.toml
```

Expected: FAIL because the binding crate does not exist.

- [ ] **Step 3: Implement the narrow OpenMLS wrapper**

Expose only key package creation, create/join, add/remove commit, encrypt/decrypt, export/import encrypted state, epoch, and checkpoint digest. Use OpenMLS crypto providers; do not expose raw group secrets to JavaScript.

- [ ] **Step 4: Build the N-API binding and run both test suites**

```powershell
cargo test --manifest-path native/kun-collab-crypto/Cargo.toml
npm run build:collaboration-native
npx vitest run src/main/collaboration/crypto/mls-adapter.test.ts
```

Expected: official vectors, Add/Remove, offline catch-up, tamper/replay/stale epoch, persist/restore, and removed-member tests PASS.

- [ ] **Step 5: Commit the MLS gate**

```powershell
git add native/kun-collab-crypto src/main/collaboration/crypto package.json package-lock.json
git commit -m "feat(collaboration): bind OpenMLS in Electron main"
```

### Task 3: Add IdentityVault and Password Fallback

**Files:**
- Create: `src/main/collaboration/identity-vault.ts`
- Test: `src/main/collaboration/identity-vault.test.ts`
- Create: `src/main/collaboration/identity-vault-file.ts`
- Test: `src/main/collaboration/identity-vault-file.test.ts`

- [ ] **Step 1: Write failing safeStorage/fallback/rotation tests**

```typescript
expect(await vault.loadOrCreate()).toMatchObject({ memberId: expect.any(String), deviceId: expect.any(String) })
expect(await readFile(vaultPath, 'utf8')).not.toContain(privateKeyCanary)
await expect(fallback.unlock('wrong password')).rejects.toMatchObject({ code: 'identity_password_invalid' })
```

- [ ] **Step 2: Verify failure**

```powershell
npx vitest run src/main/collaboration/identity-vault.test.ts src/main/collaboration/identity-vault-file.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement secure storage**

Prefer Electron `safeStorage`; otherwise derive an encryption key with Argon2id using a random salt, authenticated encryption, strict file permissions, bounded retries, and explicit password rotation. Never log key bytes or passwords.

- [ ] **Step 4: Run vault and headless fallback tests**

```powershell
npx vitest run src/main/collaboration/identity-vault.test.ts src/main/collaboration/identity-vault-file.test.ts
```

Expected: PASS on available platform paths; fallback tests run independently of the OS keychain.

- [ ] **Step 5: Commit identity storage**

```powershell
git add src/main/collaboration/identity-vault.ts src/main/collaboration/identity-vault.test.ts src/main/collaboration/identity-vault-file.ts src/main/collaboration/identity-vault-file.test.ts
git commit -m "feat(collaboration): secure device identity"
```

### Task 4: Build the Native Ciphertext-Only Server

**Files:**
- Create: `native/kun-collab-server/Cargo.toml`
- Create: `native/kun-collab-server/src/main.rs`
- Create: `native/kun-collab-server/src/protocol.rs`
- Create: `native/kun-collab-server/src/store.rs`
- Create: `native/kun-collab-server/src/auth.rs`
- Create: `native/kun-collab-server/src/rbac.rs`
- Create: `native/kun-collab-server/tests/server_integration.rs`

- [ ] **Step 1: Write failing sequencing, idempotency, RBAC, and plaintext-canary tests**

```rust
assert_eq!(replay.sequence, first.sequence);
assert_eq!(store.events_for(meeting_id).len(), 1);
assert!(unauthorized_result.is_forbidden());
assert!(!scan_server_files(plaintext_canary));
```

- [ ] **Step 2: Verify failure**

```powershell
cargo test --manifest-path native/kun-collab-server/Cargo.toml
```

Expected: FAIL because the server crate does not exist.

- [ ] **Step 3: Implement server boundaries**

Use rustls TLS 1.3, Axum WebSocket/HTTP endpoints, SQLite transactions, monotonic per-meeting sequence allocation, unique command IDs, server-visible membership/RBAC metadata, ciphertext blobs, quotas, rate limits, signed receipts, and backup/restore. Do not depend on OpenMLS or expose a payload-decryption API.

- [ ] **Step 4: Run integration and dependency-boundary tests**

```powershell
cargo test --manifest-path native/kun-collab-server/Cargo.toml
cargo tree --manifest-path native/kun-collab-server/Cargo.toml | Select-String -Pattern "openmls" -Quiet
```

Expected: tests PASS and the dependency scan returns no OpenMLS match.

- [ ] **Step 5: Commit server foundation**

```powershell
git add native/kun-collab-server
git commit -m "feat(collaboration): add ciphertext-only native server"
```

### Task 5: Add TLS-Pinned Transport, Invitations, and Membership

**Files:**
- Create: `src/main/collaboration/network/collaboration-transport.ts`
- Test: `src/main/collaboration/network/collaboration-transport.test.ts`
- Create: `src/main/collaboration/network/invitation-service.ts`
- Test: `src/main/collaboration/network/invitation-service.test.ts`
- Modify: `src/main/collaboration/local-collaboration-service.ts`

- [ ] **Step 1: Write failing pin, one-time invitation, and removal tests**

```typescript
await expect(connect(replacedCertificate)).rejects.toMatchObject({ code: 'server_identity_changed' })
expect(await invitation.consume()).toMatchObject({ status: 'joined' })
await expect(invitation.consume()).rejects.toMatchObject({ code: 'invitation_consumed' })
expect(removedMemberCanDecryptLaterEpoch).toBe(false)
```

- [ ] **Step 2: Verify failure**

```powershell
npx vitest run src/main/collaboration/network
```

Expected: FAIL.

- [ ] **Step 3: Implement connection and membership state machines**

Pin server instance ID and SPKI, support verified migration proof, import/export one-time credentials, target approval, editable display name with stable member ID, custom role union, self-escalation denial, and MLS Add/Remove commits.

- [ ] **Step 4: Run transport/membership tests**

```powershell
npx vitest run src/main/collaboration/network
```

Expected: PASS.

- [ ] **Step 5: Commit invitations and membership**

```powershell
git add src/main/collaboration/network src/main/collaboration/local-collaboration-service.ts
git commit -m "feat(collaboration): secure invitations and membership"
```

### Task 6: Add Encrypted Projection, TaskKeys, and Outbox Recovery

**Files:**
- Create: `src/main/collaboration/sync/encrypted-outbox.ts`
- Test: `src/main/collaboration/sync/encrypted-outbox.test.ts`
- Create: `src/main/collaboration/sync/collaboration-sync-engine.ts`
- Test: `src/main/collaboration/sync/collaboration-sync-engine.test.ts`
- Create: `src/main/collaboration/crypto/task-key-service.ts`
- Test: `src/main/collaboration/crypto/task-key-service.test.ts`

- [ ] **Step 1: Write failing restart, re-encryption, sponsor, and fork tests**

```typescript
expect(await restarted.flush()).toHaveLength(1)
expect(sentFrame.epoch).toBe(currentEpoch)
expect(sentFrame.ciphertext).not.toEqual(oldCiphertext)
expect(await syncAfterFork()).toMatchObject({ state: 'SECURITY_SYNC_REQUIRED', writable: false })
```

- [ ] **Step 2: Verify failure**

```powershell
npx vitest run src/main/collaboration/sync src/main/collaboration/crypto/task-key-service.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement durable encrypted synchronization**

Persist last verified sequence/checkpoint, MLS state, encrypted Outbox, command receipts, projection version, and TaskKey custody. Re-encrypt across epoch/generation changes, deduplicate concurrent key requests, rotate when task or meeting membership is removed, and enter read-only security recovery on signature/checkpoint/history inconsistency.

- [ ] **Step 4: Run sync/fault tests**

```powershell
npx vitest run src/main/collaboration/sync src/main/collaboration/crypto
```

Expected: PASS for duplicate/reorder/drop, server restart, client crash, stale epoch, and sponsor transfer.

- [ ] **Step 5: Commit sync and TaskKeys**

```powershell
git add src/main/collaboration/sync src/main/collaboration/crypto
git commit -m "feat(collaboration): recover encrypted collaboration sync"
```

### Task 7: Encrypt Remote Employee Invocation

**Files:**
- Modify: `src/main/collaboration/reception-invocation-gateway.ts`
- Modify: `src/main/collaboration/reception-invocation-gateway.test.ts`
- Create: `src/main/collaboration/network/remote-invocation-service.ts`
- Test: `src/main/collaboration/network/remote-invocation-service.test.ts`

- [ ] **Step 1: Write failing publication-scope and owner-only execution tests**

```typescript
await expect(invokeUnpublished()).rejects.toMatchObject({ code: 'employee_not_published' })
expect(execution.deviceId).toBe(employee.ownerDeviceId)
expect(remoteResponse).not.toHaveProperty('toolSchemas')
expect(remoteResponse).not.toHaveProperty('credentialSourceId')
```

- [ ] **Step 2: Verify failure**

```powershell
npx vitest run src/main/collaboration/network/remote-invocation-service.test.ts src/main/collaboration/reception-invocation-gateway.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement caller-owner encryption and offline confirmation**

Encrypt request/result for the two members, enforce meeting/task publication scope, execute only through the owner gateway, keep offline calls awaiting owner confirmation, publish sanitized progress, and propagate interrupt to the owner turn.

- [ ] **Step 4: Run remote invocation tests**

```powershell
npx vitest run src/main/collaboration/network/remote-invocation-service.test.ts src/main/collaboration/reception-invocation-gateway.test.ts
```

Expected: PASS and `danger-full-access` remains unreachable.

- [ ] **Step 5: Commit remote invocation**

```powershell
git add src/main/collaboration/network/remote-invocation-service.ts src/main/collaboration/network/remote-invocation-service.test.ts src/main/collaboration/reception-invocation-gateway.ts src/main/collaboration/reception-invocation-gateway.test.ts
git commit -m "feat(collaboration): encrypt remote employee invocation"
```

### Task 8: Add Encrypted Resumable Delivery and Manual Apply

**Files:**
- Create: `src/main/collaboration/artifacts/artifact-package.ts`
- Test: `src/main/collaboration/artifacts/artifact-package.test.ts`
- Create: `src/main/collaboration/artifacts/artifact-transfer.ts`
- Test: `src/main/collaboration/artifacts/artifact-transfer.test.ts`
- Create: `src/main/collaboration/artifacts/artifact-apply.ts`
- Test: `src/main/collaboration/artifacts/artifact-apply.test.ts`
- Create: `src/renderer/src/collaboration/DeliveryReview.tsx`
- Test: `src/renderer/src/collaboration/DeliveryReview.test.tsx`

- [ ] **Step 1: Write failing resume/path/manual-apply tests**

```typescript
expect(resumed.uploadedChunkIndexes).toEqual(missingOnly)
await expect(applyManifest(pathTraversalManifest)).rejects.toMatchObject({ code: 'artifact_path_invalid' })
expect(await workspaceHash()).toBe(beforePreviewHash)
await reviewer.clickApply()
expect(await workspaceHash()).not.toBe(beforePreviewHash)
```

- [ ] **Step 2: Verify failure**

```powershell
npx vitest run src/main/collaboration/artifacts src/renderer/src/collaboration/DeliveryReview.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement encrypted chunks and isolated review**

Sign manifests, encrypt chunks with a delivery content key wrapped only to current recipients, verify ciphertext/plaintext hashes, resume missing chunks, render text/diff/binary metadata without execution, and require explicit apply after baseline/path/symlink/reserved-name/size validation.

- [ ] **Step 4: Run artifact tests**

```powershell
npx vitest run src/main/collaboration/artifacts src/renderer/src/collaboration/DeliveryReview.test.tsx
```

Expected: PASS including Windows reserved names and cross-platform normalization.

- [ ] **Step 5: Commit encrypted delivery**

```powershell
git add src/main/collaboration/artifacts src/renderer/src/collaboration/DeliveryReview.tsx src/renderer/src/collaboration/DeliveryReview.test.tsx
git commit -m "feat(collaboration): review encrypted deliveries locally"
```

### Task 9: Package, Fault-Test, and Accept Three Clients

**Files:**
- Modify: `electron-builder.config.cjs`
- Create: `scripts/build-collaboration-native.mjs`
- Create: `scripts/collaboration-three-client-e2e.mjs`
- Create: `scripts/collaboration-plaintext-canary.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing package/load tests**

```javascript
assert.ok(packagedFiles.includes('kun-collab-server'))
assert.ok(packagedFiles.some((path) => path.endsWith('kun-collab-crypto.node')))
```

- [ ] **Step 2: Verify failure**

```powershell
node --test scripts/collaboration-plaintext-canary.test.mjs
npm run test:collaboration-three-client -- --protocol-only
```

Expected: FAIL until native artifacts and harness are wired.

- [ ] **Step 3: Add cross-platform native packaging and harness**

Build per target OS/architecture, unpack the N-API library, ship the server as a separately installable native binary/service, and start A/B/C clients with isolated dataDir, ports, identities, and shared test server.

- [ ] **Step 4: Run release gates**

```powershell
npm run test:collaboration
npm run test:collaboration-three-client
npm run typecheck
npm run test
npm run build
npm audit --audit-level=high
```

Expected: invitation, Add/Remove, reconnect, tamper rejection, TaskKey rotation, Outbox re-encryption, remote employee invocation, 100 MB resumed delivery, manual apply, and plaintext canary scans all PASS.

- [ ] **Step 5: Commit production gates**

```powershell
git add electron-builder.config.cjs scripts package.json package-lock.json
git commit -m "test(collaboration): gate encrypted multi-client release"
```
