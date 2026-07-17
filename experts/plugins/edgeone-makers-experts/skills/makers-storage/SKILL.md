# EdgeOne Makers Storage

EdgeOne Makers provides two storage services. **Choose based on your runtime and data type:**

| Storage | Runtime | Data Type | SDK | Use Case |
|---------|---------|-----------|-----|----------|
| **KV** | Edge Functions only | Small key-value pairs (≤ 25 MB) | Global variable (no npm) | Counters, config, session tokens, simple CRUD |
| **Blob** | Cloud Functions (Makers Functions) | Files & objects (images, docs, uploads) | `@edgeone/pages-blob` (npm) | User uploads, AI-generated content, file management |

## Decision Tree

```
Need persistent storage?
├─ Edge Function (V8 runtime, no npm)?
│   → KV Storage (global variable)           → read references/kv.md
└─ Cloud Function (Node.js, has npm)?
    ├─ Storing files / images / large objects?
    │   → Blob Storage                       → read references/blob.md
    └─ Storing small key-value data?
        → Blob with setJSON                  → read references/blob.md
```

## Routing

| Task | Read |
|------|------|
| KV Storage (Edge Functions, global variable, put/get/delete/list) | [references/kv.md](references/kv.md) |
| Blob Storage (Cloud Functions, npm SDK, file upload/download, pre-signed URLs) | [references/blob.md](references/blob.md) |
