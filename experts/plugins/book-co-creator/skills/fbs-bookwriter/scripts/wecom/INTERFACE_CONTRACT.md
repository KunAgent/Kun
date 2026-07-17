# FBS-BookWriter v2.0 企业微信集成层 — 接口契约文件
# scripts/wecom/INTERFACE_CONTRACT.md

> v2.0 定位：企微智能表格为**只读**配置载体（企微→FBS 方向）。
> 书稿落本地磁盘，写入方向为 `磁盘/对话`，不通过企微写入。
> 本文件描述当前生效的 `.mjs` 函数式接口，供集成调试和维护参考。

> **说明**：`connector-manifest.json`（若存在）为**草稿/占位**连接器清单，**不包含**在 Marketplace 发布 zip 中；运行时集成以 `scene-pack-admin` / `scene-pack-loader` 与本仓库 `channel-manifest.json` → `scriptBridge` 为准（非对外 MCP Server）。

---

## 1. 共享基础层（`lib/utils.mjs`）

```js
export class WecomError extends Error
  // .code: 'AUTH_*' | 'NET_*' | 'RATE_*' | 'RATE_EXHAUSTED' | 'BIZ_*'
  // .rawOutput: string（已脱敏）

export function sanitizeForLog(str)        // → string
export function appendAuditLog(bookRoot, entry)   // → void
export function readAuditLog(bookRoot)     // → { exists, entries[] }
export function resolveBookRoot(raw)       // → string，throws WecomError
export const WECOM_PLATFORM_PKG            // string
export const HOSTNAME                      // string
export const C   // { reset, bold, green, yellow, red, cyan, gray }
```

---

## 2. `wecom-client.mjs`

```js
export const POLL_MAX_RETRIES   // = 10
export const POLL_INTERVAL_MS   // = 500
export const scenePackToken     // Object.freeze({ value, present })

export function resolveExePath()  // → string | null

/**
 * 执行 wecom-cli 命令，返回 inner 对象（双层 JSON 解析）
 * opts.bookRoot  → 写审计日志（可选）
 * opts.sessionId → UUID 前 8 位（可选）
 * opts.source    → 日志来源标注（可选）
 * throws WecomError
 */
export async function wecomRun(category, method, params?, opts?)
```

---

## 3. `auth-check.mjs`（只读探测）

v2.0 仅做只读探测，不引导企微写入，不调用 `setWecomUserId`。

```js
/**
 * 检测企微凭证可用性
 * - 可用 → { ready: true,  mode: 'wecom' }
 * - 不可用（cli 不存在 / 凭证无效）→ { ready: false, mode: 'local' }
 * - AUTH_ 类错误内部捕获，不向调用方重抛
 */
export async function assertAuthReady()  // → { ready, mode: 'wecom'|'local' }

/**
 * 追加 .gitignore 条目（.fbs-wecom-state.json / .fbs-wecom-audit.log）
 */
export async function ensureGitignore(bookRoot)  // → void

export { scenePackToken } from './wecom-client.mjs'
```

---

## 4. `scene-pack-loader.mjs`（场景包只读加载）

```js
/**
 * 拉取指定体裁的场景包，四级降级路径：
 *   1 → disk_cache   书内 .fbs-wecom-state.json
 *   1.5 → offline_cache  scene-packs/.offline-cache/{genre}.json
 *   2 → local_rule   references/scene-packs/{genre}.md
 *   3 → no_pack      跳过，不阻断写书
 *
 * 降级时写审计日志（scene_pack_fallback 事件）
 */
export async function loadScenePack(bookRoot, genre, stage?)
  // → { data: { quality[], outline[], search[], init[], visual[] }, meta }

/** 格式化为可注入 Markdown 字符串（向后兼容） */
export function formatPackForContext(result)  // → string

/** 用于 wecom:ping 诊断（平台侧） */
export async function pingScenePackTable()   // → void

/** 批量预热 offline_cache（平台侧管理员工具） */
export async function syncAllPacks()         // → void
```

---

## 5. `scene-pack-admin.mjs`（⚙️ 平台侧管理员工具）

仅供平台侧管理员使用，需 wecom-cli 授权。用户侧写书流程不依赖此文件。

```js
export function checkConfig()               // 校验本地配置（无需授权）
export function showStatus()                // 查看缓存状态（无需授权）
export async function initSheets(opts)      // 初始化表格 Sheet 结构（需授权）
export async function pushLocalRules(genre, opts)  // 推送内置规范（需授权）
export async function corpSetup(opts)       // 企业客户一键交付（需授权）
```

---

## 6. 错误码速查

| code | 含义 | 处理方 |
|------|------|--------|
| `AUTH_CLI_NOT_FOUND` | exe 不存在 | auth-check → mode='local' |
| `AUTH_REJECTED` | 凭证无效/未 init | auth-check → mode='local' |
| `NET_TIMEOUT` | spawn 超时 60s | wecomRun 重试 3 次 |
| `NET_SPAWN_FAIL` | spawn 失败 | wecomRun 重试 3 次 |
| `NET_POLL_TIMEOUT` | 轮询超 10 次 | scene-pack-loader 降级 |
| `RATE_LIMITED` | API 限频 | wecomRun 三档退避 |
| `RATE_EXHAUSTED` | 三档限频耗尽 | 调用方决策 |
| `BIZ_INVALID_BOOK_ROOT` | bookRoot 非法/网络路径 | 立即抛出 |
| `BIZ_INVALID_GENRE` | 体裁值不在 VALID_GENRES | 立即抛出 |
| `BIZ_LOCAL_MODE` | 本地模式，管理员写操作不可用 | 立即抛出（admin 命令） |

---

## 7. `.fbs-wecom-state.json` 结构（v2.0）

```json
{
  "session_id": "UUID（完整格式）",
  "scenePackCache": {
    "genre":    "string",
    "version":  "string",
    "cachedAt": "ISO8601",
    "data": {
      "quality":     [],
      "outline":     [],
      "search":      [],
      "init":        [],
      "visual":      []
    }
  }
}
```

> v2.0 不含 `docId / docUrl / chapters` 字段（书稿落本地磁盘，无企微文档写入）。
