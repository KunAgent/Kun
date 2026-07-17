# Debugging & Troubleshooting

## Local Preview / Dev Server Verification（本地预览验证规范）

> **适用范围：仅 WorkBuddy。** 以下现象与结论在 **WorkBuddy** 环境实测验证过。
> **CodeBuddy 等其他宿主未验证，行为可能不同**——在 CodeBuddy 中遇到本机 dev server
> 验证问题时，请按下方「定位流程」用探针 + 服务端日志实测，再判断是否适用，切勿直接套用。

⚠️ 在 **WorkBuddy** 中验证 `edgeone makers dev` 起的本机服务时，**绝不要用 WorkBuddy 沙箱里的 Bash `curl` 判断成败**。

### 现象（WorkBuddy 实测）
- 在 WorkBuddy 的 Bash 工具里 `curl http://localhost:8088/`，任何路径
  （`/`、`index.html`、`style.css`、`/api/*`）都返回 `404` + 一个 HTML 兜底页。
- 但同一时刻：用户系统终端 `curl` 同地址是 `200`，浏览器 / WorkBuddy 内置浏览器预览页面完全正常。

### 真因（WorkBuddy）
WorkBuddy 的 **Bash 工具运行在隔离沙箱网络**，与 dev server 所在的宿主机网络**不互通**。
沙箱内的 `localhost:8088` 被路由到沙箱内部兜底服务，对任意路径回 `404`，
**请求根本到不了真实 dev server**（dev server 访问日志里看不到这些请求即为铁证）。
这与项目代码、静态托管、`setLocalData` 的 EPERM **均无关**。

### 正确验证方法（WorkBuddy，按优先级）
1. **WorkBuddy 内置浏览器预览**（`present_files` 传 `http://localhost:8088/`）——走宿主机网络，可靠。
2. **让用户在系统终端验证**：`curl -I http://localhost:8088/` 或直接浏览器打开。
3. **直接部署到线上**用真实 URL 验证（最接近生产环境）。

### 禁止 / 误区（WorkBuddy）
- ❌ 不要用 WorkBuddy 沙箱 Bash `curl localhost:<port>` 的状态码判断 dev server 死活。
- ❌ 不要把"`setLocalData` EPERM 先打印"脑补成"它拖垮了静态服务"——
  日志里 `Development server is running` / `Running at: 8088` 已证明服务正常起来了。

### 定位流程（任何宿主通用，必须用日志证据，不靠因果脑补）
1. 发一个带唯一标记的探针：`curl ".../__probe_unique_xxx__"`。
2. 看 dev server 访问日志**有没有**这条 `__probe_unique_xxx__`：
   - 有 → 请求到达了，404 是它发的，再查静态路由 / 目录配置。
   - 无 → 请求没到达（在 WorkBuddy 即沙箱网络隔离），换内置浏览器预览或系统终端，问题不在项目。

### 附：`setLocalData` EPERM（WorkBuddy 观察到，独立问题，不影响静态服务）
- 现象：`[File] setLocalData error [EPERM ... open '~/.edgeone/...']`。
- 原因：WorkBuddy 沙箱隔离禁止写 home 下的 `~/.edgeone`（非项目目录），但允许写当前项目目录。
- 影响：仅影响 CLI 本地状态持久化（登录态 / 每日选择记忆），**不影响**静态托管与页面访问。
- 若需 CLI 在沙箱 / CI / 只读 home 下健壮：可在写入失败（EPERM/EACCES）时回退到项目目录下
  的 `.edgeone/` 或 `EDGEONE_STATE_DIR` 指定路径，但应保留 `~/.edgeone` 作为首选以维持跨项目共享登录态。

## General Issues

| Issue | Solution |
|-------|----------|
| Function not found / 404 | Check file location matches expected route path under `cloud-functions/` |
| Env vars not available | Run `edgeone makers env pull` and restart dev server |
| Hot reload not working | Check you're using `edgeone makers dev`, not a custom dev server |
| Middleware runs on static assets | Add `config.matcher` to limit middleware to specific paths |

## Edge Functions

| Issue | Solution |
|-------|----------|
| `require is not defined` | Edge Functions use ES modules — use `import` instead |
| npm package fails | Edge Functions don't support npm — move to Cloud Functions (Node.js) |
| `Response.json()` not available | Use `new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })` |
| Exceeds CPU limit | Move heavy computation to Cloud Functions (120s limit vs 200ms) |

## KV Storage

| Issue | Solution |
|-------|----------|
| KV returns `undefined` | Run `edgeone makers link` first to connect your project |
| `ReferenceError: my_kv is not defined` | KV not enabled or namespace not bound — enable KV in the console, create namespace, and bind to project |
| Accessing `context.env.KV` returns `undefined` | KV is a **global variable**, not on `context.env` — use `my_kv.get(...)` directly |
| KV `get()` returns a Promise | Missing `await` — always `await` KV operations |
| KV not working in Cloud Functions | KV is only available in Edge Functions — use an external database for Cloud Functions |

## Cloud Functions — Node.js

| Issue | Solution |
|-------|----------|
| Express `app.listen()` error | Remove `app.listen()` — export the app directly with `export default app` |
| WebSocket not connecting | Ensure you're using Cloud Functions (Node.js), not Edge Functions |
| `res.send()` not working | Non-framework functions return Web `Response` objects, not Express-style `res` |
| Framework routes not matching | Check entry file uses `[[default]].js` pattern and routes don't include the file-system prefix |

## Cloud Functions — Go

| Issue | Solution |
|-------|----------|
| Build fails with Go errors | Ensure `go.mod` exists in project root with correct module path |
| Handler function not found | Handler mode requires `package handler` with an exported func matching `http.HandlerFunc` signature |
| Framework routes return 404 | Check entry file name — it determines the URL prefix (e.g. `api.go` → `/api` prefix) |
| Mixed mode error | Cannot mix Handler and Framework modes — choose one per project |
| Port binding error in Framework mode | Use `r.Run(":9000")` or similar — platform maps the port automatically |

## Cloud Functions — Python

| Issue | Solution |
|-------|----------|
| Python file not registered as route | File must contain entry pattern: `class handler(BaseHTTPRequestHandler)`, `app = Flask(...)`, `app = FastAPI(...)`, or `application = get_wsgi_application()` |
| Import errors / missing dependencies | Add to `cloud-functions/requirements.txt` or project root `requirements.txt` — auto-detect may miss some packages |
| Flask route returns 404 | Framework routes don't include file-system prefix — use `@app.route('/users')` not `@app.route('/api/users')` for `api/index.py` |
| FastAPI async issues | Ensure Python 3.10 compatible async patterns — `async def` handlers work natively |
| Django not working | Use `application = get_wsgi_application()` pattern in entry file |
| `__pycache__` or `venv` causing issues | These directories are auto-excluded from build — no action needed |
