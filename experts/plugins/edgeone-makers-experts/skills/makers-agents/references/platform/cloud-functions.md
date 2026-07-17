# agents/ vs cloud-functions/ Convention

> Covers: separation of AI inference (agents/) from data CRUD (cloud-functions/), layout, storage dependencies, store entry point differences.

---
## cloud-functions Convention (Data Persistence)

### Principle
- Separate from `agents/`: `agents/` handles AI, `cloud-functions/` handles data CRUD
- One directory per resource: `cloud-functions/<resource>/index.ts`
- Returns JSON (no streaming); used for KV / Blob / preferences / history

### Example layout
```
cloud-functions/
├── _logger.ts
├── articles/index.ts        → article CRUD
├── preferences/index.ts     → user preference read/write
└── history/index.ts         → conversation history retrieval
```

### Storage
- Access conversation-scoped storage via `context.agent.store`

### Health Check

The runtime has a **built-in `/health` endpoint** that returns `{"status": "ok", "route_count": N}` — no need to create one manually for basic process liveness checks.

If you need a custom health check (e.g., checking session state, database connectivity, or active run status), write it as an `agents/` endpoint (not cloud-functions) so it has access to `context.store` and `context.utils`:

```typescript
// agents/health.ts — custom health check with session state
export async function onRequest(context: any) {
  const activeRuns = /* check active runs */;
  return new Response(JSON.stringify({
    status: 'ok',
    activeRuns,
    uptime: process.uptime(),
  }), { headers: { 'Content-Type': 'application/json' } });
}
```

---
