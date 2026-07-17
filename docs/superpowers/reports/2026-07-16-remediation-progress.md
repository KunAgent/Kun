# Extension Seam Remediation Progress

**Date:** 2026-07-16  
**Based on:** `2026-07-16-experts-moa-automation-functional-test-report.md`  
**Status:** In Progress (P0 backend fixes complete, remaining: loop hooks, MoA registration, domains)

---

## Completed Issues ✅

### ISSUE-003 [P0] - Fix buildRouter seam import ✅
- **Fixed:** `kun/src/server/routes/index.ts:68` now imports from `'../../seam/index.js'` (correct path)
- **Verification:** TypeScript compilation passes, import resolves to real seam

### ISSUE-002 [P0] - Wire extensions config bag ✅
- **Fixed:** `kun/src/cli/serve.ts:171` now includes `extensions: configServe.extensions ?? {}`
- **Canonical location:** `config.serve.extensions` (not top-level)
- **Verification:** TypeScript compilation passes, config field exists in merged options

### ISSUE-010 [P0/Security] - Add Bearer auth to extension routes ✅
- **Created:** `kun/src/seam/auth.ts` - `authenticated()` wrapper using `isAuthorized()`
- **Applied to:** All experts, automation, and design routes (GET/POST /v1/experts/*, /v1/automation/*, /v1/design/*)
- **Signature:** `authenticated(handler, runtime)` wraps RouteHandler, returns 401 if unauthorized
- **Verification:** TypeScript compilation passes, all routes use authenticated wrapper

### ISSUE-008 [P1] - Fix extension service envelope ✅
- **Fixed:** experts.feature.ts now returns `{ experts: service }` and routes read `runtime.extensions.experts.experts`
- **Pattern:** All features return `{ [serviceName]: serviceInstance }`, routes destructure accordingly
- **Verification:** TypeScript compilation passes, envelope structure consistent

### Test Schema Fixes ✅
- Fixed design.test.ts to use current schema (removed `keywords`/`categories`/`frameworks`, added `query` defaults)
- Fixed SkillExecutionContext to make `userPrompt` optional
- **Verification:** 0 TypeScript errors, build passes

---

## In Progress Issues 🔧

### ISSUE-004 [P0] - Make Expert/MoA loop hooks actually take effect
**Status:** Not started  
**Blocker:** beforeLoop fires before thread read, only passes {threadId, turnId}. Hooks can't access expertId/moaPresetId.  
**Fix Required:**
1. Modify agent-loop.ts to read thread/turn before emitLoopHook('beforeLoop')
2. Pass full context including expertId, moaPresetId, current systemPrompt/model/provider
3. Add beforeModelRequest hook that actually applies mutations to ModelRequest
4. E2E test with fake model client asserting expert prompt reaches ModelClient.stream()

### ISSUE-005 [P0] - Fix MoA client registration
**Status:** Not started  
**Blocker:** registerExtensionModelClients called before moa services init (provider count 0). Each preset registers same providerId='moa' causing duplicates.  
**Fix Required:**
1. Move registerExtensionModelClients call to after initializeExtensionServices in runtime-factory.ts
2. Register single MoaDispatchModelClient that routes by request.model
3. Include seam providers in replace() stable source for hot-reload

### ISSUE-006 [P0] - Implement Automation runtime executor
**Status:** Not started  
**Blocker:** kunRuntimeRequest throws placeholder error. Tasks can't execute.  
**Fix Required:**
1. Inject ThreadService/TurnService or authenticated RuntimeClient into AutomationRuntime
2. Implement abort, timeout, SSE wait, failure mapping
3. Full task test: create thread -> start turn -> output -> policy -> approval -> completed

### ISSUE-007 [P0] - Migrate Collaboration domain
**Status:** Not started  
**Blocker:** Complete domain missing. No contracts/services/routes/UI.  
**Fix Required:**
- Implement full Stage 2 per design spec
- Plan create/validate/confirm, task dispatch, concurrency, clarification, persistence, GUI

---

## Remaining Issues (P1/P2)

- ISSUE-009 [P1]: Add extension endpoints to preload IPC allowlist
- ISSUE-011 [P1]: Complete Experts API (CRUD routes) + fix status dir
- ISSUE-012 [P1]: Expert plugin manifest compatibility (305 plugins)
- ISSUE-013 [P1]: Automation scheduler/delivery/store/abort
- ISSUE-014 [P1]: Design resources + await scan on init
- ISSUE-015 [P1]: Fix MoA built-in preset provider references
- ISSUE-001 [P0]: Implement GUI extension seam feature modules (renderer/main/shared)
- ISSUE-016 [P2]: Quality gate - cross-layer acceptance tests
- MoA extra risks: concurrency, trace isolation, dynamic router

---

## Build Status

- ✅ TypeScript compilation: PASS (0 errors)
- ✅ Build: PASS
- ⚠️ Tests: Not yet run (design.test.ts fixed but not executed)
- ❌ E2E: Not implemented
- ❌ Real routes: Not tested (404s expected until runtime-factory wiring complete)

---

## Next Steps (Priority Order)

1. **ISSUE-004**: Fix agent loop hook context (P0 - blocks expert/MoA functionality)
2. **ISSUE-005**: Fix MoA registration order + dispatch (P0 - blocks MoA)
3. **ISSUE-006**: Implement Automation executor (P0 - blocks automation)
4. **ISSUE-007**: Migrate Collaboration domain (P0 - large scope)
5. **ISSUE-009**: IPC allowlist (P1 - blocks GUI integration)
6. **ISSUE-001**: GUI seam implementation (P0 - blocks user visibility)

---

## Summary

**Completed:** 5 issues (ISSUE-002, ISSUE-003, ISSUE-008, ISSUE-010, test fixes)  
**In Progress:** 4 P0 issues (ISSUE-004, ISSUE-005, ISSUE-006, ISSUE-007)  
**Remaining:** 8 issues (P0: 1, P1: 6, P2: 1)  
**Health:** ~30/100 (up from 18/100 - backend seam + auth + config fixed, core execution paths remain blocked)
