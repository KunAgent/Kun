# Node.js Functions

Node.js v20.x runtime functions under `cloud-functions/`. Full npm ecosystem support. Ideal for complex backend logic, database access, Express/Koa frameworks, and WebSocket.

> **Runtime:** Node.js v20.x — supports ES modules, full npm ecosystem, and WebSocket.

## Basic function

File: `cloud-functions/api/data.js`

```javascript
export function onRequestGet(context) {
  return Response.json({
    message: 'Hello from Node.js Functions!',
    region: context.server.region,
  });
}

export async function onRequestPost(context) {
  const body = await context.request.json();
  // Process body...
  return Response.json({ received: body }, { status: 201 });
}
```

Access: `GET /api/data`, `POST /api/data`

## Handler methods

| Handler | HTTP Method |
|---------|-------------|
| `onRequest(context)` | All methods (GET, POST, PATCH, PUT, DELETE, HEAD, OPTIONS) |
| `onRequestGet(context)` | GET |
| `onRequestPost(context)` | POST |
| `onRequestPatch(context)` | PATCH |
| `onRequestPut(context)` | PUT |
| `onRequestDelete(context)` | DELETE |
| `onRequestHead(context)` | HEAD |
| `onRequestOptions(context)` | OPTIONS |

All handlers return `Response | Promise<Response>`.

## EventContext object

```javascript
export function onRequest(context) {
  const {
    uuid,       // EO-LOG-UUID unique request identifier
    request,    // Standard Request object
    params,     // Dynamic route params, e.g. { id: "123" }
    env,        // Environment variables from Makers console
    clientIp,   // Client IP address
    server,     // { region: string, requestId: string }
    geo,        // Client geolocation info
  } = context;

  return new Response('OK');
}
```

## Using npm packages

```javascript
// cloud-functions/api/data.js
import mysql from 'mysql2/promise';

export async function onRequestGet(context) {
  const connection = await mysql.createConnection({
    host: context.env.DB_HOST,
    user: context.env.DB_USER,
    password: context.env.DB_PASSWORD,
    database: context.env.DB_NAME,
  });

  const [rows] = await connection.execute('SELECT * FROM users LIMIT 10');
  await connection.end();

  return Response.json({ users: rows });
}
```

⚠️ Install dependencies in project root `package.json` — the platform builds them automatically.

## Express integration

File: `cloud-functions/api/[[default]].js`

```javascript
import express from 'express';

const app = express();
app.use(express.json());

// Add logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Root route → GET /api/
app.get('/', (req, res) => {
  res.json({ message: 'Hello from Express!' });
});

// GET /api/users/:id
app.get('/users/:id', (req, res) => {
  res.json({ userId: req.params.id });
});

// POST /api/users
app.post('/users', (req, res) => {
  res.status(201).json({ user: req.body });
});

// MUST export the app — do NOT call app.listen()
export default app;
```

**Key rules for Express/Koa:**
- All framework routes go in **one function file** using `[[...]]` naming pattern (e.g. `[[default]].js`)
- MUST `export default app` — do NOT call `app.listen()` or start HTTP server
- No need to set up port listening — the platform handles it

## Koa integration

File: `cloud-functions/api/[[default]].js`

```javascript
import Koa from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';

const app = new Koa();
const router = new Router();

app.use(bodyParser());

router.get('/hello', (ctx) => {
  ctx.body = { message: 'Hello from Koa!' };
});

router.post('/data', (ctx) => {
  ctx.body = { received: ctx.request.body };
});

app.use(router.routes());
app.use(router.allowedMethods());

// MUST export — do NOT call app.listen()
export default app;
```

## File-system Routing

```
cloud-functions/
├── index.js
├── hello-makers.js
├── api/
│   ├── users/
│   │   ├── list.js
│   │   ├── geo.js
│   │   └── [id].js
│   ├── visit/
│   │   └── index.js
│   └── [[default]].js
```

| File path | Route |
|-----------|-------|
| `cloud-functions/index.js` | `example.com/` |
| `cloud-functions/hello-makers.js` | `example.com/hello-makers` |
| `cloud-functions/api/users/list.js` | `example.com/api/users/list` |
| `cloud-functions/api/users/[id].js` | `example.com/api/users/:id` |
| `cloud-functions/api/[[default]].js` | `example.com/api/*` (catch-all) |

> **Notes:**
> - Trailing slash `/` is optional: `/hello-makers` and `/hello-makers/` both route to `cloud-functions/hello-makers.js`
> - If a Node.js route conflicts with a static asset route, the static asset takes priority
> - Routes are case-sensitive

### Express/Koa framework routing

```
cloud-functions/
└── express/
    └── [[default]].js    # Express/Koa entry file, all routes inside
```

- All routes consolidated in **one function file** with `[[...]]` naming
- No HTTP server startup needed — just export the framework instance
- The builder identifies the file as a function only when `export default app` is present

## Dynamic Routes

```javascript
// cloud-functions/api/users/[id].js
export function onRequestGet(context) {
  return new Response(`User id is ${context.params.id}`);
}
```

| File path | Example URL | Match? |
|-----------|-------------|--------|
| `api/users/[id].js` | `/api/users/1024` | ✅ Yes |
| `api/users/[id].js` | `/api/users/vip/1024` | ❌ No |
| `api/[[default]].js` | `/api/books/list` | ✅ Yes |
| `api/[[default]].js` | `/api/1024` | ✅ Yes |

## WebSocket

File: `cloud-functions/api/ws.js`

```javascript
export function onRequestGet(context) {
  const { request } = context;

  // Check for WebSocket upgrade
  const upgradeHeader = request.headers.get('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return new Response('Expected WebSocket', { status: 426 });
  }

  // Create WebSocket pair
  const { socket, response } = new WebSocketPair();

  socket.addEventListener('message', (event) => {
    socket.send(`Echo: ${event.data}`);
  });

  socket.addEventListener('close', () => {
    console.log('WebSocket closed');
  });

  return response;
}
```

## Local Development

```bash
npm install -g edgeone          # Install CLI
edgeone makers dev               # Start local dev server on port 8088
```

## Limits

| Resource | Limit |
|----------|-------|
| Code package size | 128 MB |
| Request body | 6 MB |
| Wall clock time | 120 seconds |
| Runtime | Node.js v20.x |

⚠️ Do NOT store persistent files locally — use external storage (e.g. Tencent Cloud COS) for persistent data.

## Template Projects

- **MySQL connection**: [mysql-template](https://github.com/TencentEdgeOne/mysql-template/) | [Preview](https://mysql-template.edgeone.run)
- **Express**: [express-template](https://github.com/TencentEdgeOne/express-template/) | [Preview](https://express-template.edgeone.run)
- **Koa**: [koa-template](https://github.com/TencentEdgeOne/koa-template/) | [Preview](https://koa-template.edgeone.run)
- **AI Voice Chat (WebSocket)**: [makers-ai-voice-chat](https://github.com/TencentEdgeOne/pages-ai-voice-chat) | [Preview](https://pages-ai-voice-chat.edgeone.site)
