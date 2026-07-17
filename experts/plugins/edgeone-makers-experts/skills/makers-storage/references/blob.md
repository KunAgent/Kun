# Blob Storage

EdgeOne Makers Blob is a distributed **object storage** service for Makers Functions. Suitable for storing images, documents, user uploads, AI-generated content, and structured data sets.

> ⚠️ Blob is for **Makers Functions (Cloud Functions)** — uses the `@edgeone/pages-blob` npm SDK (NOT a global variable like KV).

## Quick Start

### 1. Install SDK

```bash
npm install @edgeone/pages-blob@^0.1.3
```

> ⚠️ 版本要求：≥ 0.1.3（低版本有已知 bug）。

### 2. Basic Usage

```javascript
import { getStore } from "@edgeone/pages-blob";

export async function onRequest({ request }) {
  const store = getStore("my-store");

  // Write
  await store.set("hello.txt", "Hello, EdgeOne Makers!");

  // Read
  const content = await store.get("hello.txt");

  return new Response(content);
}
```

First call to `getStore("my-store")` auto-creates the namespace. No console setup required.

---

## Consistency Model

| Mode | Behavior | Use Case |
|------|----------|----------|
| **Eventual** (default) | Edge-cached, fastest; new writes may take seconds to propagate | Content display, caching, tolerance for brief staleness |
| **Strong** | Bypasses cache, reads from primary storage | Counters, state machines, must-read-latest scenarios |

```javascript
// Default: eventual consistency
const value = await store.get("key");

// Strong consistency (single read)
const fresh = await store.get("counter", { consistency: "strong" });

// Strong consistency (entire store instance)
const store = getStore({ name: "my-store", consistency: "strong" });
```

---

## API Reference

```javascript
import { getStore, listStores } from "@edgeone/pages-blob";
```

### getStore(name | options)

Get a Store instance.

**In Makers Functions:**
```javascript
const store = getStore("my-store");
const store = getStore({ name: "my-store", consistency: "strong" });
```

**Outside Makers Functions** (local scripts, external services):
```javascript
const store = getStore({
  name: "my-store",
  projectId: "makers-urtsvuwmfvli",
  token: "your-api-token",
});
```

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Namespace name |
| `projectId` | `string` | Outside Functions | Project ID |
| `token` | `string` | Outside Functions | API Token |
| `consistency` | `"eventual" \| "strong"` | No | Default read consistency |

---

### store.set(key, value, options?)

Write an object. Overwrites if key exists.

```javascript
await store.set("photos/cat.jpg", imageBuffer);
await store.set("notes/todo.txt", "Buy milk");

// Only write if key doesn't exist
await store.set("init.json", data, { onlyIfNew: true });
```

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `key` | `string` | Yes | Object key |
| `value` | `string \| ArrayBuffer \| Blob \| ReadableStream` | Yes | Content |
| `options.onlyIfNew` | `boolean` | No | Only write if key doesn't exist |

Returns: `Promise<void>`

---

### store.setJSON(key, value, options?)

Write JSON (auto-serialized). Same options as `set`.

```javascript
await store.setJSON("user/preferences", { theme: "dark", lang: "zh-CN" });
```

---

### store.get(key, options?)

Read an object. Returns `null` if key doesn't exist.

```javascript
const text = await store.get("hello.txt");
const json = await store.get("config.json", { type: "json" });
const buffer = await store.get("image.png", { type: "arrayBuffer" });
const blob = await store.get("video.mp4", { type: "blob" });
const stream = await store.get("large-file.zip", { type: "stream" });

// Strong consistency
const fresh = await store.get("counter", { consistency: "strong" });
```

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `key` | `string` | Yes | Object key |
| `options.type` | `"text" \| "json" \| "arrayBuffer" \| "blob" \| "stream"` | No | Return type (default `"text"`) |
| `options.consistency` | `"eventual" \| "strong"` | No | Read consistency |

Returns: `Promise<string | object | ArrayBuffer | Blob | ReadableStream | null>`

---

### store.getWithHeaders(key, options?)

Read object content plus response headers. Returns `null` if key doesn't exist.

```javascript
const result = await store.getWithHeaders("document.pdf");
// result.body — content
// result.headers — { "content-type": "...", "etag": "...", ... }
```

Returns: `Promise<{ body: string; headers: Record<string, string> } | null>`

---

### store.delete(key)

Delete an object. No error if key doesn't exist.

```javascript
await store.delete("photos/cat.jpg");
```

---

### store.list(options?)

List objects in the namespace. Auto-paginates by default.

```javascript
// List all
const { blobs } = await store.list();

// Filter by prefix
const { blobs } = await store.list({ prefix: "photos/" });

// Directory grouping (current level files + subdirectories)
const { blobs, directories } = await store.list({
  prefix: "photos/",
  directories: true,
});

// Strong consistency
const { blobs } = await store.list({ consistency: "strong" });

// Manual pagination
const page1 = await store.list({ paginate: false });
const page2 = await store.list({ paginate: false, cursor: page1.cursor });
```

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `options.prefix` | `string` | No | Filter by key prefix |
| `options.directories` | `boolean` | No | Group by `/`, return `directories` field |
| `options.paginate` | `boolean` | No | `false` = single page with cursor |
| `options.cursor` | `string` | No | Continue from previous page |
| `options.consistency` | `"eventual" \| "strong"` | No | Read consistency |

Returns:
```typescript
{
  blobs: Array<{ key: string; etag: string }>;
  directories?: string[];  // only when directories: true
  cursor?: string;         // only when paginate: false
}
```

---

### store.createUploadUrl(key, options?)

Generate a pre-signed PUT URL for client-side direct upload. File data bypasses the function — client uploads directly to Blob.

```javascript
const { url, key, expiresAt } = await store.createUploadUrl("files/photo.jpg", {
  expireSeconds: 3600,
  contentType: "image/jpeg",
});
```

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `key` | `string` | Yes | Object key after upload |
| `options.expireSeconds` | `number` | No | URL validity (seconds), default 3600 |
| `options.contentType` | `string` | No | If set, client must send matching Content-Type |

Returns:
```typescript
{
  url: string;        // Pre-signed URL
  key: string;        // Object key
  expiresAt: number;  // Expiry (Unix timestamp, seconds)
}
```

---

### listStores(options?)

List all namespaces in the current project.

```javascript
import { listStores } from "@edgeone/pages-blob";

// In Makers Functions
const { stores } = await listStores();

// External access
const { stores } = await listStores({
  projectId: "makers-urtsvuwmfvli",
  token: "your-api-token",
});
```

---

## Examples

### Client Direct Upload (Pre-signed URL)

**Function (sign the URL):**
```javascript
// cloud-functions/api/get-upload-url.js
import { getStore } from "@edgeone/pages-blob";

export async function onRequest({ request }) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { name, contentType } = await request.json();
  const store = getStore("user-uploads");

  const { url, key, expiresAt } = await store.createUploadUrl(
    `uploads/${Date.now()}-${name}`,
    {
      expireSeconds: 3600,
      contentType: contentType || "application/octet-stream",
    }
  );

  return new Response(JSON.stringify({ url, key, expiresAt }), {
    headers: { "Content-Type": "application/json" },
  });
}
```

**Browser (upload directly):**
```javascript
async function uploadFile(file) {
  // 1. Request upload URL from function
  const { url, key } = await fetch("/api/get-upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, contentType: file.type }),
  }).then((r) => r.json());

  // 2. Upload directly to Blob
  await fetch(url, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type },
  });

  return key;
}
```

### List Files by Directory

```javascript
// cloud-functions/api/files.js
import { getStore } from "@edgeone/pages-blob";

export async function onRequest({ request }) {
  const store = getStore("user-uploads");
  const url = new URL(request.url);
  const prefix = url.searchParams.get("path") || "";

  const { blobs, directories } = await store.list({
    prefix,
    directories: true,
  });

  return new Response(
    JSON.stringify({ files: blobs, folders: directories }),
    { headers: { "Content-Type": "application/json" } }
  );
}
```

### Conditional Write (Prevent Overwrite)

```javascript
import { getStore } from "@edgeone/pages-blob";

export async function onRequest({ request }) {
  const store = getStore("configs");

  // Only write if key doesn't exist
  await store.setJSON("app/settings", { version: 1 }, { onlyIfNew: true });

  const settings = await store.get("app/settings", { type: "json" });
  return new Response(JSON.stringify(settings), {
    headers: { "Content-Type": "application/json" },
  });
}
```

---

## Limits

| Resource | Limit |
|----------|-------|
| Storage per account (free tier) | 1 GB |
| SDK | `@edgeone/pages-blob` (Node.js only, other runtimes coming) |
| Supported runtime | Makers Functions (Cloud Functions) |
| Consistency | Eventual (default) or Strong (per-read opt-in) |

---

## Common Errors

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Cannot find module '@edgeone/pages-blob'` | SDK not installed | Run `npm install @edgeone/pages-blob@^0.1.3` |
| `get()` returns stale data | Eventual consistency after recent write | Use `{ consistency: "strong" }` for that read |
| Upload URL returns 403 | Content-Type mismatch or URL expired | Ensure client sends matching Content-Type header; check expiry |
| Trying to use Blob in Edge Functions | Blob only works in Cloud Functions | Move code to `cloud-functions/` directory |

---

## Best Practices

1. **Use key prefixes** to organize: `uploads/`, `photos/`, `reports/`
2. **Use `createUploadUrl`** for large files — avoid routing file bytes through your function
3. **Default to eventual consistency** — only use strong when you must read-after-write
4. **Use `setJSON`/`get({ type: "json" })`** for structured data instead of manual `JSON.stringify/parse`
5. **Use `directories: true`** in `list()` for folder-like browsing UIs
