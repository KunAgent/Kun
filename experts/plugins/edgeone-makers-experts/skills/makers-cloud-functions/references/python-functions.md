# Python Functions

Python 3.10 runtime functions under `cloud-functions/`. Supports Handler class, WSGI (Flask/Django), and ASGI (FastAPI/Sanic) modes with automatic dependency detection.

> **Runtime:** Python 3.10 — auto-detects framework, auto-installs dependencies, no manual configuration needed.

## Development Modes

| Mode | Use Case | Routing | Framework |
|------|----------|---------|-----------|
| **Handler** | Simple APIs, Serverless style | File-system routing (file = route) | None (standard `BaseHTTPRequestHandler`) |
| **WSGI Framework** | Full Web apps, RESTful APIs | Framework built-in routing | Flask, Django |
| **ASGI Framework** | Full Web apps, RESTful APIs | Framework built-in routing | FastAPI, Sanic |

## Handler Mode

File: `cloud-functions/api/hello.py`

```python
from http.server import BaseHTTPRequestHandler

class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write('{"message": "Hello from Python Functions!"}'.encode('utf-8'))
```

Access: `GET /api/hello`

**Key rules for Handler mode:**
- Class must be named `handler` (lowercase) and inherit from `BaseHTTPRequestHandler`
- Implement `do_GET`, `do_POST`, `do_PUT`, `do_DELETE` etc. for different HTTP methods

### Handling POST requests

```python
# cloud-functions/api/users/index.py
from http.server import BaseHTTPRequestHandler
import json

class handler(BaseHTTPRequestHandler):

    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode('utf-8')
        data = json.loads(body) if body else {}

        self.send_response(201)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        response = json.dumps({'message': 'Created', 'data': data})
        self.wfile.write(response.encode('utf-8'))
```

### Handler class attributes

| Attribute/Method | Type | Description |
|-----------------|------|-------------|
| `self.path` | `str` | Request path (with query params) |
| `self.command` | `str` | HTTP method (GET, POST, etc.) |
| `self.headers` | `dict-like` | Request headers |
| `self.rfile` | `file` | Request body input stream |
| `self.wfile` | `file` | Response body output stream |
| `self.send_response(code)` | method | Send HTTP status code |
| `self.send_header(key, value)` | method | Send response header |
| `self.end_headers()` | method | End response headers |

### Getting query parameters

```python
# cloud-functions/api/search.py
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        parsed = urlparse(self.path)
        query_params = parse_qs(parsed.query)
        name = query_params.get('name', ['Guest'])[0]

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(f'{{"hello": "{name}"}}'.encode('utf-8'))
```

## Flask Framework (WSGI)

File: `cloud-functions/api/index.py`

```python
from flask import Flask, jsonify, request

app = Flask(__name__)

@app.route('/users', methods=['GET'])
def get_users():
    return jsonify({
        'users': [
            {'id': 1, 'name': 'Alice'},
            {'id': 2, 'name': 'Bob'}
        ]
    })

@app.route('/users', methods=['POST'])
def create_user():
    data = request.get_json()
    return jsonify({'message': 'User created', 'user': data}), 201
```

Access: `GET /api/users`, `POST /api/users`

> **Route prefix stripping**: The runtime auto-strips the file-system route prefix. `api/index.py` → prefix `/api`, so request `/api/users` becomes `/users` inside Flask. Define framework routes as relative paths only.

## FastAPI Framework (ASGI)

File: `cloud-functions/api/index.py`

```python
from fastapi import FastAPI

app = FastAPI()

@app.get('/items')
async def list_items():
    return {'items': [{'id': 1, 'name': 'Item A'}, {'id': 2, 'name': 'Item B'}]}

@app.get('/items/{item_id}')
async def get_item(item_id: int):
    return {'item_id': item_id, 'name': f'Item {item_id}'}

@app.post('/items')
async def create_item(item: dict):
    return {'message': 'Item created', 'item': item}
```

Access: `GET /api/items`, `GET /api/items/123`, `POST /api/items`

## File-system Routing

```
cloud-functions/
├── api/
│   ├── index.py
│   ├── hello.py
│   ├── users/
│   │   ├── index.py
│   │   ├── list.py
│   │   └── [id].py
│   ├── orders/
│   │   └── index.py
│   └── [[default]].py
```

| File path | Route |
|-----------|-------|
| `cloud-functions/api/index.py` | `example.com/api` |
| `cloud-functions/api/hello.py` | `example.com/api/hello` |
| `cloud-functions/api/users/index.py` | `example.com/api/users` |
| `cloud-functions/api/users/[id].py` | `example.com/api/users/:id` |
| `cloud-functions/api/[[default]].py` | `example.com/api/*` (catch-all) |

### Route matching priority (high → low)

1. **Static routes** — exact match (e.g. `/api/users/list`)
2. **Single-level dynamic** — `[param]` matches one segment (e.g. `/api/users/[id]`)
3. **Catch-all dynamic** — `[[param]]` matches one or more segments (e.g. `/api/[[default]]`)

### Entry file recognition

Only `.py` files with these patterns are registered as routes:
- `class handler(BaseHTTPRequestHandler)` — Handler class mode
- `app = Flask(...)` / `app = FastAPI(...)` — Framework instance mode
- `application = get_wsgi_application()` — Django WSGI mode

Other `.py` files are treated as helper modules — copied to build output for import but not registered as routes.

## Dynamic Route Parameters

```python
# cloud-functions/api/users/[id].py
from http.server import BaseHTTPRequestHandler

class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        user_id = self.path.strip('/')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(f'{{"user_id": "{user_id}"}}'.encode('utf-8'))
```

## Dependency Management

### Auto-detection

The builder scans all `.py` files under `cloud-functions/` for `import` statements and auto-detects third-party packages. Supported: `fastapi`, `flask`, `django`, `sanic`, `requests`, `httpx`, `pydantic`, `sqlalchemy`, `redis`, `pymongo`, `numpy`, `pandas`, etc.

### Manual dependencies

Place `requirements.txt` in one of these locations (priority order):
1. `cloud-functions/requirements.txt` (preferred)
2. Project root `requirements.txt`

```txt
# cloud-functions/requirements.txt
flask>=2.0.0
redis>=4.0.0
openai>=1.0.0
```

User-declared versions take highest priority when merged with auto-detected dependencies.

### Excluded directories

These are not scanned or copied to build output:
- `__pycache__`, `.git`, `node_modules`
- `venv`, `.venv` (virtual environments)
- `scripts` (local test scripts)
- `tests`, `.pytest_cache` (test files)

## Local Development

```bash
npm install -g edgeone          # Install CLI
edgeone makers dev               # Start local dev server
```

## Limits

| Resource | Limit |
|----------|-------|
| Code package size | 128 MB (including dependencies) |
| Request body | 6 MB |
| Wall clock time | 120 seconds |
| Runtime | Python 3.10 |

⚠️ Do NOT store persistent files locally — use external storage (e.g. Tencent Cloud COS) for persistent data.

## Template Projects

- **Handler mode**: [python-handler-template](https://github.com/TencentEdgeOne/python-handler-template) | [Preview](https://python-handler-template.edgeone.site)
- **FastAPI**: [python-fastapi-template](https://github.com/TencentEdgeOne/python-fastapi-template) | [Preview](https://python-fastapi-template.edgeone.site)
- **Flask**: [python-flask-template](https://github.com/TencentEdgeOne/python-flask-template) | [Preview](https://python-flask-template.edgeone.site)
- **Django**: [python-django-template](https://github.com/TencentEdgeOne/python-django-template) | [Preview](https://python-django-template.edgeone.site)
