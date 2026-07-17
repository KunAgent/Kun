# Middleware

Lightweight request interception running at the edge (V8 runtime). Use for redirects, rewrites, auth guards, A/B testing, and header injection.

> ⚠️ **Framework projects (Next.js, Nuxt, etc.)**: Do NOT use this platform middleware format. Use the framework's built-in middleware instead (e.g. Next.js `middleware.ts` with `NextRequest`/`NextResponse`). The patterns below are for non-framework or pure static projects only.

## Basic middleware

File: `middleware.js` (project root)

```javascript
export function middleware(context) {
  const { request, next, redirect, rewrite } = context;

  // Pass through — no modification
  return next();
}
```

## Context API

| Property | Type | Description |
|----------|------|-------------|
| `request` | `Request` | Current request object |
| `next(options?)` | `Function` | Continue to origin; optionally modify headers |
| `redirect(url, status?)` | `Function` | Redirect (default 307) |
| `rewrite(url)` | `Function` | Rewrite request path (transparent to client) |
| `geo` | `GeoProperties` | Client geolocation |
| `clientIp` | `string` | Client IP address |

## Route matching

By default middleware runs on ALL routes. Use `config.matcher` to limit scope:

```javascript
// Only run on /api/* routes
export const config = {
  matcher: ['/api/:path*'],
};

export function middleware(context) {
  // Auth check for API routes only
  const token = context.request.headers.get('Authorization');
  if (!token) {
    return new Response('Unauthorized', { status: 401 });
  }
  return context.next();
}
```

**Matcher patterns:**

```javascript
// Single path
export const config = { matcher: '/about' };

// Multiple paths
export const config = { matcher: ['/api/:path*', '/admin/:path*'] };

// Regex
export const config = { matcher: ['/api/.*', '^/user/\\d+$'] };
```

## Common patterns

### URL Redirect

```javascript
export function middleware(context) {
  const url = new URL(context.request.url);

  if (url.pathname === '/old-page') {
    return context.redirect('/new-page', 301);
  }
  return context.next();
}
```

### URL Rewrite (transparent proxy)

```javascript
export function middleware(context) {
  const url = new URL(context.request.url);

  if (url.pathname.startsWith('/blog')) {
    return context.rewrite('/content' + url.pathname);
  }
  return context.next();
}
```

### Add request headers

```javascript
export function middleware(context) {
  return context.next({
    headers: {
      'x-request-id': crypto.randomUUID(),
      'x-client-ip': context.clientIp,
      'x-country': context.geo.countryCodeAlpha2,
    },
  });
}
```

### Auth guard

```javascript
export const config = {
  matcher: ['/api/:path*', '/admin/:path*'],
};

export function middleware(context) {
  const token = context.request.headers.get('Authorization');
  if (!token || !token.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return context.next();
}
```

### Geo-based routing

```javascript
export function middleware(context) {
  const country = context.geo.countryCodeAlpha2;

  if (country === 'CN') {
    return context.rewrite('/zh' + new URL(context.request.url).pathname);
  }
  return context.next();
}
```

### A/B Testing

```javascript
export function middleware(context) {
  const url = new URL(context.request.url);

  if (url.pathname === '/landing') {
    const variant = Math.random() < 0.5 ? '/landing-a' : '/landing-b';
    return context.rewrite(variant);
  }
  return context.next();
}
```

### Direct JSON response

```javascript
export function middleware(context) {
  const url = new URL(context.request.url);

  if (url.pathname === '/api/health') {
    return new Response(JSON.stringify({ status: 'ok', timestamp: Date.now() }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return context.next();
}
```

## GeoProperties

Available on `context.geo`:

| Property | Type | Example |
|----------|------|---------|
| `countryName` | string | Singapore |
| `countryCodeAlpha2` | string | SG |
| `countryCodeAlpha3` | string | SGP |
| `regionName` | string | — |
| `cityName` | string | Singapore |
| `latitude` | number | 1.29027 |
| `longitude` | number | 103.851959 |
| `asn` | number | 132203 |
