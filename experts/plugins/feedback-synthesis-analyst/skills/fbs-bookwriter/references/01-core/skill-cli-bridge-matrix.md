# Skill ↔ 脚本 ↔ CLI 联动矩阵（非 MCP）

> **版本**：2.1.2  
> **范围**：检索前置合同、企微场景包（只读/校验/状态）、乐包账本、生命周期入口。  
> **明确非目标**：不把上述能力拆成 MCP Server；一律通过本 Skill 内 **Node 脚本** 与统一 CLI 完成。

---

## 1. 统一入口

| 项目 | 路径 |
|------|------|
| 统一 CLI | `node scripts/fbs-cli-bridge.mjs help` |
| 机读契约 | `fbs-runtime-hints.json` → `scriptBridge` |
| 通道声明 | `workbuddy/channel-manifest.json` / `codebuddy/channel-manifest.json` → `scriptBridge` |

---

## 2. 能力与命令对照

| 能力域 | NLU / 场景 | 推荐脚本（直接） | 统一 CLI 等价 |
|--------|------------|------------------|----------------|
| 检索前置合同 | S0–S3 检索前宣告 | `node scripts/record-search-preflight.mjs …` | `node scripts/fbs-cli-bridge.mjs preflight -- …` |
| 合同 JSON Schema | `search-policy` 对齐 | `references/05-ops/search-preflight-contract.json` | `--print-contract` 见 preflight |
| 企微场景包 / 表格 | 校验、初始化、状态（管理员工具） | `node scripts/wecom/scene-pack-admin.mjs …` | `node scripts/fbs-cli-bridge.mjs scene-pack -- …` |
| 场景包加载（写作路径） | `loadScenePack` | `scripts/wecom/scene-pack-loader.mjs`（由 intake / S3 gate 调用） | —（一般不手工调） |
| 乐包余额 / 升级提示 | `CHECK_BALANCE` / `UPGRADE_HINT` | `scripts/wecom/lib/credits-ledger.mjs`（API） | `… fbs-cli-bridge.mjs credits balance` 或 `credits hint` |
| 开场 / 退出 | 激活 / STOP | `intake-router.mjs` / `session-exit.mjs` | `… fbs-cli-bridge.mjs intake -- …` / `exit -- …` |
| 宿主能力 | Tier1/Tier2 | `host-capability-detect.mjs` | `… fbs-cli-bridge.mjs host -- …` |

---

## 3. 企微与只读策略

- **产品侧声明**：`_plugin_meta.json` → `capabilities.wecom_spreadsheets: "readonly"`。  
- **运行时**：场景包增强规则优先走 **智能表格 URL**；无凭证或失败时按 `scene-pack-loader` 四级降级，**不阻断**本地写作。  
- **运维/校验**：使用 `scene-pack check` / `status`，而非在正文中写密钥。

---

## 4. npm 脚本别名（可选）

在技能根目录执行：

- `npm run fbs:search-preflight` → `record-search-preflight.mjs`
- `npm run scene-pack:check` / `scene-pack:status` → `scene-pack-admin.mjs`
- `npm run fbs:cli` → `fbs-cli-bridge.mjs`（见 `package.json`）

---

## 5. 相关文档

- [`runtime-mandatory-contract.md`](./runtime-mandatory-contract.md) — 开场/退出强制契约  
- [`section-nlu.md`](./section-nlu.md) — 意图与路由  
- [`section-4-commands.md`](./section-4-commands.md) — 短指令与 session-exit  

返回主文档：[`SKILL.md`](../../SKILL.md)
