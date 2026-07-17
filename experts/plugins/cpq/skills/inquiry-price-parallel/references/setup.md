# 前置配置（首次使用 / 鉴权失败 / 怀疑配置异常时必读）

> **加载触发**：
>
> - **MANDATORY READ ENTIRE FILE** — 当用户首次使用本 skill / `--ensure-auth` 退出码非 0 / 编排器报 "缺依赖" / Python 版本疑似低于 3.9 时
> - **Do NOT Load** — 同一会话内已成功跑过任意 run（说明 Python / 依赖 / 鉴权全部 OK），后续批次不必重读本文件
>
> 本文件由 `SKILL.md` 在需要时按需加载，集中说明 Python 版本、依赖、路径约定，以及鉴权机制。

---

## Python 版本

**要求 Python 3.9+**。调用脚本时请使用 `python3` 而非 `python`。

> 如果当前环境的 Python 版本低于 3.9（可通过 `python3 --version` 检查），AI 调用方应使用 `install_binary` 工具安装合适的 Python 版本（如 3.12.0），再用对应路径执行脚本。

## 依赖安装

```bash
pip install requests openpyxl
```

## 路径约定（跨机器 / 跨 IDE 可分发）

本 skill 中的 `SKILL_BASE_DIR` 表示当前 skill 的根目录。调用脚本时不要写死 `.claude/skills/...`、`.codebuddy/skills/...` 或本机绝对路径。

执行方应使用加载 skill 时显示的 Base directory 作为 `SKILL_BASE_DIR`：

```bash
SKILL_BASE_DIR="<加载 skill 时显示的 Base directory>"
python3 "$SKILL_BASE_DIR/scripts/call_knot_agent.py" --message "..."
```

> 在 CodeBuddy 中，加载 skill 后会显示类似 `Base directory for this skill: ...` 的路径；后续命令直接使用该路径即可。同事安装到任何目录都不需要修改本文档。

---

## 鉴权（OAuth · 首次自动弹浏览器）

本 skill 默认通过 **TAI Ticket OAuth**（`mcp.cpq.woa.com` 网关）完成鉴权，**不需要任何 shell 环境变量**：

- **首次调用**：脚本会自动弹出默认浏览器到企业微信授权页；用户在浏览器里点同意后，ticket 写到本地缓存
- **后续调用**：直接读缓存 ticket；ticket 有效期 **24 小时**，提前 1 小时自动刷新
- **缓存位置**：`~/.workbuddy/cpq/knot-ticket.json`（仅本机用户可读）

### 环境预热（避免并发 fan-out 时多个 worker 集体崩溃）

进入并发编排（`parallel_orchestrator.py`）之前，**必须先跑一次预热**：

```bash
python3 "$SKILL_BASE_DIR/scripts/call_knot_agent.py" --ensure-auth
```

预热一次性串行检查 3 件事：

1. **Python 版本** ≥ 3.9
2. **必需依赖** `requests` / `openpyxl` 已 import
3. **OAuth ticket** 有效（已缓存时秒返回，未授权时弹浏览器）

返回值：

| stdout                                                                              | 退出码 | 含义                                           |
| ----------------------------------------------------------------------------------- | ------ | ---------------------------------------------- |
| `{"authenticated": true, "staffname": "...", "auth_mode": "oauth"}`                 | 0      | 环境与鉴权全部 OK，可以拉起编排器              |
| `{"authenticated": false, "error": "缺依赖: requests, ...", "missing_deps": [...]}` | 1      | 缺依赖 → 按提示 `pip install` 后重跑           |
| `{"authenticated": false, "error": "Python 3.7.x < 3.9 ..."}`                       | 1      | Python 版本不足 → 安装/切换 Python 3.9+ 后重跑 |
| `{"authenticated": false, "error": "..."}`                                          | 1      | OAuth 失败（授权超时 / 网络异常 / 用户拒绝）   |

> ⚠️ **为什么需要预热**：编排器会并发拉起多个 worker，每个 worker 独立 `import requests` + 调 `call_knot_agent`：
>
> - **缺依赖**：6 个 worker 同时报 `ModuleNotFoundError`，被 stderr 重定向掩盖，主进程只看到 `worker died without result (rc=1) × 6`，排查极困难
> - **ticket 过期**：6 个 worker 同时尝试弹浏览器、抢同一个回调端口（19876），全部失败
>
> 预热在主流程串行完成上述检查后，worker 直接复用环境 + ticket 缓存，零并发污染。

### 鉴权失败的常见原因

- **浏览器没装/没默认设置**：`subprocess.Popen` 起不了浏览器 → 手动复制脚本 stderr 打印的授权 URL 到任意浏览器粘贴
- **回调端口被占**：`19876` 端口已被其他进程占用 → `lsof -i:19876` 查看并 kill 占用进程
- **ticket 缓存损坏**：删 `~/.workbuddy/cpq/knot-ticket.json` 后重新预热
- **企微未登录**：在浏览器里先登录 `https://work.weixin.qq.com/` 再重试

---

## 历史兼容（已 deprecated · 不要新用）

`KNOT_API_TOKEN` / `KNOT_API_USER` 环境变量与 `--token` / `--user` CLI 参数仍然保留，但**仅供旧版自动化脚本兜底**：

- 设置 `KNOT_API_TOKEN` 后，脚本会跳过 OAuth 直接走旧式 `x-knot-api-token` 头
- **不要**在文档 / 教程 / 新人引导里再写"先 export KNOT_API_TOKEN ..."这类指引
- **不要**自动写入 `~/.zshrc` / `~/.bashrc` 持久化这两个变量

如果你之前在 shell profile 里手动加过 `export KNOT_API_TOKEN=...`，可以放心删除——本 skill 不再依赖。
