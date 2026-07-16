# Stage 1: Experts Migration - Progress

**Status:** In Progress  
**Start:** 2026-07-16

## Completed

### Backend Domain
- ✅ **kun/src/experts/contracts/experts.ts** - ExpertProfile, ExpertTeam, CreateCustomExpert schemas
- ✅ **kun/src/experts/services/expert-service.ts** - Plugin scanning, custom expert CRUD
- ✅ **kun/src/experts/services/expert-status-store.ts** - Enable/disable state persistence
- ✅ **kun/src/experts/adapters/expert-plugin-resolver.ts** - .codebuddy-plugin parser
- ✅ **kun/src/experts/adapters/expert-profile-mapper.ts** - SubagentProfileConfig mapper

### Extension Integration
- ✅ **kun/src/seam/features/experts.feature.ts** - Extension registration
  - Routes: GET /v1/experts, GET /v1/experts/:id
  - Service initialization from config.extensions.experts
  - Loop hooks stub (deferred to Stage 2)
- ✅ **kun/src/seam/features/index.ts** - Enabled expertsExtension

### Tests
- ✅ expert-plugin-resolver.test.ts - 3/3 passing
- ✅ expert-status-store.test.ts - 3/3 passing
- ✅ Total: 6/6 tests passing

### Build Verification
- ✅ TypeScript compilation: PASS
- ✅ GUI build (npm run build): PASS (built in 1m 9s)
- ✅ Kun backend build (npm run build): PASS

### Resources
- 🔄 **experts/plugins/** - 305 plugins copying from workStone (68/305 complete)
  - Source: D:/soft/workStone/experts/plugins/
  - Target: D:/soft/Kun/experts/plugins/
  - Status: Background copy in progress

## Deferred to Stage 2

### Thread Schema Migration (Blocker)
- ❌ expert-context-hook.ts - Requires thread.expertId, thread.expertTeamId, thread.conversationMode
- ❌ Loop hook registration - Inject expert systemPrompt based on thread metadata

Current ThreadRecord schema missing:
- `expertId?: string`
- `expertTeamId?: string`
- `conversationMode?: 'chat' | 'task'`

**Decision:** Remove expert-context-hook from Stage 1; implement in Stage 2 after extending ThreadRecord schema.

### Simplified Route Implementation
Removed workStone's experts.ts routes file (dependencies on unmigrated helpers). Implemented inline routes in experts.feature.ts:
- ✅ GET /v1/experts → list experts and teams
- ✅ GET /v1/experts/:id → get expert or team
- ⏸️ POST /v1/experts/custom → deferred (needs frontend)
- ⏸️ POST /v1/experts/custom-teams → deferred (needs frontend)
- ⏸️ PUT /v1/experts/:id → deferred (needs frontend)
- ⏸️ DELETE /v1/experts/:id → deferred (needs frontend)

## Commit History

```
0839c908 feat(experts): migrate experts domain from workStone (Stage 1)
```

## Next Steps

1. Wait for experts/plugins/ copy completion (68/305 → 305/305)
2. Verify plugin loading with sample config
3. Test GET /v1/experts endpoint with real plugins
4. Document Stage 1 completion
5. Begin Stage 2: Thread schema extension + expert-context-hook

## Configuration Example

```json
{
  "extensions": {
    "experts": {
      "pluginRoots": ["./experts/plugins"],
      "customExpertsDir": "~/.kun/experts/custom"
    }
  }
}
```

## Known Limitations

- Expert selection requires frontend UI (not in scope for Stage 1)
- Expert context injection requires thread schema migration (Stage 2)
- Custom expert CRUD routes implemented but not tested (require frontend)
- Loop hooks registered but no listeners yet (Stage 2)
