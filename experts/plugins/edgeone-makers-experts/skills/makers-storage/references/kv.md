# KV Storage

EdgeOne Makers KV is a globally distributed **key-value persistent storage** service deployed across multiple edge nodes. Data follows an eventual consistency model and synchronizes globally within **60 seconds**.

> ⚠️ KV Storage is **only available in Edge Functions** — NOT supported in Node Functions.

## Prerequisites (MUST complete before using KV)

**You must enable KV Storage in the EdgeOne Makers console before writing any code.**

### Step 1 — Enable KV Storage

1. Log in to the [EdgeOne Makers console](https://console.cloud.tencent.com/edgeone/pages)
2. Navigate to the **"KV Storage"** page
3. Click **"Apply Now"** to activate (free tier includes 1 GB storage)

### Step 2 — Create a Namespace

A namespace is the unit of data isolation (like a separate database):

1. On the "KV Storage" page, click **"Create Namespace"**
2. Enter a name (e.g. `my-kv-store`)
3. Wait for creation to complete

> One account can create up to **10** namespaces.

### Step 3 — Bind Namespace to Project

After creating a namespace, bind it to your EdgeOne Makers project and assign a **variable name**.

**Option A — From KV Storage page:**
1. Open the namespace → **"Associated Projects"** tab
2. Click **"Bind Project"**
3. Select project and set the **variable name** (e.g. `my_kv`)

**Option B — From Project settings:**
1. Open project details → **"KV Storage"** menu
2. Click **"Bind Namespace"**
3. Select the namespace and set the **variable name** (e.g. `my_kv`)

> The **variable name** becomes a **global variable** in your Edge Function code. Different namespaces can use different variable names.

---

## Core Concept: KV is a Global Variable

> ⚠️ **CRITICAL**: The KV namespace is accessed as a **global variable** — it is **NOT** on `context.env`.

```javascript
// ❌ WRONG — KV is NOT in context.env
export async function onRequest(context) {
  const KV = context.env.KV;
  await KV.get('key');
}

// ✅ CORRECT — my_kv is a global variable (name set when binding)
export async function onRequest(context) {
  const value = await my_kv.get('key');
}
```

---

## API Reference

All methods are called on the global KV variable (e.g. `my_kv`).

### put — Write data

```typescript
put(key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream): Promise<void>
```

- `key`: Key name (≤ 512 bytes, alphanumeric and underscores only)
- `value`: Value (≤ 25 MB)
- Returns `Promise<void>` — always `await` to confirm write

```javascript
await my_kv.put('count', '100');
await my_kv.put('user', JSON.stringify({ name: 'Alice' }));
```

### get — Read data

```typescript
get(key: string, type?: 'text' | 'json' | 'arrayBuffer' | 'stream'): Promise<string | object | ArrayBuffer | ReadableStream | null>
```

- `type` defaults to `'text'`; use `'json'` to auto-deserialize
- Returns `null` if key does not exist

```javascript
const count = await my_kv.get('count');          // '100' (string)
const user  = await my_kv.get('user', 'json');   // { name: 'Alice' }
const buf   = await my_kv.get('file', 'arrayBuffer');
```

### delete — Remove data

```typescript
delete(key: string): Promise<void>
```

```javascript
await my_kv.delete('count');
```

### list — Enumerate keys

```typescript
list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<ListResult>
```

**ListResult:**
```typescript
{
  complete: boolean;  // true if all keys have been returned
  cursor: string;     // pagination cursor for next page
  keys: Array<{ name: string }>;
}
```

**Single page:**
```javascript
const result = await my_kv.list({ prefix: 'user:' });
// result.keys → [{ name: 'user:123' }, { name: 'user:456' }]
```

**Paginate through all keys:**
```javascript
let allKeys = [];
let result;
let cursor;
do {
  result = await my_kv.list({ prefix: 'user:', limit: 256, cursor });
  allKeys.push(...result.keys);
  cursor = result.cursor;
} while (!result.complete);
```

---

## Examples

### Page view counter

```javascript
// edge-functions/api/counter.js

export async function onRequest({ request }) {
  // my_kv is a global variable — NOT context.env.my_kv
  let count = await my_kv.get('page_views');
  count = count ? Number(count) + 1 : 1;

  await my_kv.put('page_views', String(count));

  return new Response(JSON.stringify({ views: count }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
```

### CRUD with KV

```javascript
// edge-functions/api/users/[id].js

export async function onRequestGet({ params }) {
  const user = await my_kv.get(`user:${params.id}`, 'json');
  if (!user) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify(user), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost({ params, request }) {
  const data = await request.json();
  await my_kv.put(`user:${params.id}`, JSON.stringify(data));
  return new Response(JSON.stringify({ success: true }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestDelete({ params }) {
  await my_kv.delete(`user:${params.id}`);
  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
```

### List all keys with prefix

```javascript
// edge-functions/api/users.js

export async function onRequestGet() {
  const users = [];
  let result;
  let cursor;

  do {
    result = await my_kv.list({ prefix: 'user:', limit: 256, cursor });
    const fetched = await Promise.all(
      result.keys.map(k => my_kv.get(k.name, 'json'))
    );
    users.push(...fetched.filter(Boolean));
    cursor = result.cursor;
  } while (!result.complete);

  return new Response(JSON.stringify({ users }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
```

---

## Common Errors

| Symptom | Cause | Fix |
|---------|-------|-----|
| `ReferenceError: my_kv is not defined` | KV not enabled or namespace not bound | Enable KV in console → create namespace → bind to project |
| Accessing `context.env.KV` returns `undefined` | KV is a **global variable**, not on `context.env` | Use `my_kv.get(...)` directly (global) |
| `get()` returns a Promise object, not the value | Missing `await` | Always `await` KV operations |
| KV works in production but fails locally | Project not linked | Run `edgeone makers link` |
| KV not available in Node Functions | KV only works in Edge Functions | Move KV logic to Edge Functions, or use an external database in Node Functions |

---

## Limits

| Resource | Limit |
|----------|-------|
| Storage per account (free tier) | 1 GB |
| Key length | ≤ 512 bytes |
| Value size | ≤ 25 MB |
| Namespaces per account | 10 |
| Consistency | Eventual (≤ 60 s global sync) |
| List results per call | 256 max |
| Supported runtime | Edge Functions only |

---

## Best Practices

1. **Use key prefixes** to organize data: `user:123`, `cart:456`, `config:theme`
2. **Handle null** — `get()` returns `null` for missing keys
3. **Batch reads** with `Promise.all()` after `list()` instead of sequential awaits
4. **Always wrap writes in try/catch** for error handling
5. **Serialize objects** — use `JSON.stringify()` for `put()` and `'json'` type for `get()`

---

## Local Development

```bash
# 1. Link to a remote project (required for KV access)
edgeone makers link

# 2. Start dev server
edgeone makers dev

# 3. Test
curl http://localhost:8088/api/counter
```

## Production Deployment

1. Enable KV Storage in the console
2. Create a namespace
3. Bind it to the project (set the variable name)
4. Deploy:
   ```bash
   edgeone makers deploy
   ```
