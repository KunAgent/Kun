# Edge Functions

V8-based lightweight functions running at the edge. Ideal for simple APIs, KV storage access, and ultra-low latency responses.

> **Runtime:** V8 (like Cloudflare Workers) — NOT Node.js. Do NOT use Node.js built-ins or npm packages.
>
> ⚠️ `Response.json()` is **NOT available** in this V8 runtime. Always use `new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })` instead.

## Basic function

File: `edge-functions/api/hello.js`

```javascript
export default function onRequest(context) {
  return new Response('Hello from Edge Functions!');
}
```

Access: `GET /api/hello`

## HTTP method handlers

```javascript
// edge-functions/api/users.js

// Handle all methods
export function onRequest(context) {
  return new Response('Any method');
}

// Or use specific method handlers:
export function onRequestGet(context) {
  return new Response(JSON.stringify({ users: [] }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost(context) {
  const body = await context.request.json();
  return new Response(JSON.stringify({ created: true }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

## EventContext object

```javascript
export function onRequest(context) {
  const {
    request,    // Standard Request object
    params,     // Dynamic route params, e.g. { id: "123" }
    env,        // Environment variables from Makers console
    waitUntil,  // Extend function lifetime for async tasks
  } = context;

  // GEO info available via:
  const geo = context.request.eo;
  // geo.geo.countryName, geo.geo.cityName, geo.geo.latitude, etc.

  return new Response('OK');
}
```

## Dynamic routes

```javascript
// edge-functions/api/users/[id].js
// Matches: /api/users/123, /api/users/abc

export function onRequestGet(context) {
  const userId = context.params.id;
  return new Response(JSON.stringify({ userId }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
```

```javascript
// edge-functions/api/[[default]].js
// Catches all unmatched routes under /api/

export function onRequest(context) {
  return new Response('Catch-all route', { status: 404 });
}
```

## KV Storage (Edge Functions only)

⚠️ **Prerequisites**: You must enable KV Storage in the EdgeOne Makers console, create a namespace, and bind it to your project before using KV. See [kv-storage.md](kv-storage.md) for full setup instructions (same directory).

The KV namespace is a **global variable** (name is set when binding in the console) — it is **NOT** on `context.env`.

```javascript
// edge-functions/api/counter.js

export async function onRequest(context) {
  // ⚠️ my_kv is a GLOBAL variable (name set when binding namespace in console)
  // Do NOT use context.env.KV ❌
  
  // Read
  const count = await my_kv.get('page_views') || '0';
  const newCount = parseInt(count) + 1;

  // Write
  await my_kv.put('page_views', String(newCount));

  return new Response(JSON.stringify({ views: newCount }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
```

For full KV Storage API reference and usage guide, see: [kv-storage.md](kv-storage.md) (same directory).

## Supported Runtime APIs

Edge Functions run on V8 and support these Web Standard APIs:
- **Fetch API** — `fetch()` for outbound HTTP requests
- **Cache API** — `caches.open()`, `cache.match()`, `cache.put()`
- **Headers / Request / Response** — standard Web API objects
- **Streams** — `ReadableStream`, `WritableStream`, `TransformStream`
- **Web Crypto** — `crypto.subtle` for encryption/signing
- **Encoding** — `TextEncoder`, `TextDecoder`
- **URL / URLSearchParams** — URL parsing

⚠️ **NOT available**: Node.js built-ins (`fs`, `path`, `http`, `crypto` from Node), `require()`, npm packages.

## Limits

| Resource | Limit |
|----------|-------|
| Code package size | 5 MB |
| Request body | 1 MB |
| CPU time per invocation | 200 ms |
| Language | JavaScript (ES2023+) only |
