# Go Functions

Go runtime functions under `cloud-functions/`. High-performance compiled language with low memory footprint and fast cold start. Supports Handler mode (file-system routing) and Framework mode (Gin, Echo, Fiber, Chi).

> **Runtime:** Go 1.26+ — cross-compiled automatically by the platform. No manual build configuration needed.

## Development Modes

| Mode | Use Case | Routing | Framework |
|------|----------|---------|-----------|
| **Handler** | Simple APIs, Serverless style | File-system routing (file = route) | None (standard `net/http`) |
| **Framework** | Full Web apps, RESTful APIs | Framework built-in routing | Gin / Echo / Fiber / Chi |

⚠️ You can only use **one mode** per project — do NOT mix Handler and Framework modes.

## Handler Mode

Each `.go` file exports a handler function matching the `http.HandlerFunc` signature.

File: `cloud-functions/hello.go`

```go
package handler

import (
    "encoding/json"
    "net/http"
)

func Handler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(map[string]string{
        "message": "Hello from Go Functions on EdgeOne Makers!",
    })
}
```

Access: `GET /hello`

**Key rules for Handler mode:**
- Package must be `handler`
- Exported function must match `http.HandlerFunc` signature: `func(http.ResponseWriter, *http.Request)`
- Function name can be any valid exported Go name (e.g. `Handler`, `ServeHTTP`, `GetUsers`)

## Framework Mode (Gin example)

**Zero-config, out-of-the-box**: Write standard framework code — the platform auto-handles port adaptation and path mapping at build time.

File: `cloud-functions/api.go`

```go
package main

import (
    "net/http"
    "github.com/gin-gonic/gin"
)

func main() {
    r := gin.Default()

    v1 := r.Group("/v1")
    {
        v1.GET("/hello", func(c *gin.Context) {
            c.JSON(http.StatusOK, gin.H{
                "message": "Hello from Gin on EdgeOne Makers!",
            })
        })

        users := v1.Group("/users")
        {
            users.GET("", listUsersHandler)
            users.GET("/:id", getUserHandler)
            users.POST("", createUserHandler)
        }
    }

    r.Run(":9000")
}
```

Access: `GET /api/v1/hello`, `GET /api/v1/users`, etc.

### Entry file name determines URL prefix

| Entry file | URL prefix | Frontend path | Framework route |
|-----------|-----------|--------------|----------------|
| `index.go` | `/` (no prefix) | `/v1/hello` | `/v1/hello` |
| `main.go` | `/main` | `/main/v1/hello` | `/v1/hello` |
| `api.go` | `/api` | `/api/v1/hello` | `/v1/hello` |

> When the entry file is NOT `index.go`, the frontend must add the filename prefix. But framework routes stay unchanged — the prefix is stripped before reaching the framework.

## Framework Mode — Echo example

File: `cloud-functions/api.go`

```go
package main

import (
    "net/http"
    "github.com/labstack/echo/v4"
)

func main() {
    e := echo.New()

    e.GET("/hello", func(c echo.Context) error {
        return c.JSON(http.StatusOK, map[string]string{
            "message": "Hello from Echo!",
        })
    })

    e.Logger.Fatal(e.Start(":9000"))
}
```

## File-system Routing (Handler mode)

```
cloud-functions/
├── index.go
├── hello-makers.go
├── helloworld.go
├── api/
│   ├── users/
│   │   ├── list.go
│   │   ├── geo.go
│   │   └── [id].go
│   ├── visit/
│   │   └── index.go
│   └── [[default]].go
```

| File path | Route |
|-----------|-------|
| `cloud-functions/index.go` | `example.com/` |
| `cloud-functions/hello-makers.go` | `example.com/hello-makers` |
| `cloud-functions/api/users/list.go` | `example.com/api/users/list` |
| `cloud-functions/api/users/[id].go` | `example.com/api/users/:id` |
| `cloud-functions/api/[[default]].go` | `example.com/api/*` (catch-all) |

## Dynamic Routes

| File path | Example URL | Match? |
|-----------|-------------|--------|
| `api/users/[id].go` | `/api/users/1024` | ✅ Yes |
| `api/users/[id].go` | `/api/users/vip/1024` | ❌ No |
| `api/[[default]].go` | `/api/books/list` | ✅ Yes |
| `api/[[default]].go` | `/api/1024` | ✅ Yes |

## Supported Frameworks

- **Gin** — [go-gin-template](https://github.com/TencentEdgeOne/go-gin-template)
- **Echo** — [go-echo-template](https://github.com/TencentEdgeOne/go-echo-template)
- **Chi** — [go-chi-template](https://github.com/TencentEdgeOne/go-chi-template)
- **Fiber** — supported, similar pattern
- **Standard `net/http`** — Handler mode, no framework needed

## Local Development

Prerequisites: Go installed locally.

```bash
npm install -g edgeone          # Install CLI
edgeone makers dev               # Start local dev server
```

## Limits

| Resource | Limit |
|----------|-------|
| Code package size | 128 MB |
| Request body | 6 MB |
| Wall clock time | 120 seconds |
| Runtime | Go 1.26+ (backward compatible) |

⚠️ Do NOT store persistent files locally — use external storage (e.g. Tencent Cloud COS) for persistent data.

## Template Projects

- **Handler mode**: [go-handler-template](https://github.com/TencentEdgeOne/go-handler-template) | [Preview](https://go-handler-template.edgeone.site)
- **Gin framework**: [go-gin-template](https://github.com/TencentEdgeOne/go-gin-template) | [Preview](https://go-gin-template.edgeone.site)
- **Echo framework**: [go-echo-template](https://github.com/TencentEdgeOne/go-echo-template) | [Preview](https://go-echo-template.edgeone.site)
- **Chi framework**: [go-chi-template](https://github.com/TencentEdgeOne/go-chi-template) | [Preview](https://go-chi-template.edgeone.site)
