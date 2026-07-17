# 终稿状态机与版本治理（FBS）

> 版本：2.1.1  
> 目标：解决“多版本终稿漂移”与“交付不可追溯”问题。

---

## 1. 状态机定义

终稿状态采用固定四态：

- `draft`：草稿阶段，可持续改写。
- `candidate`：候选终稿，进入收口与验收。
- `release`：已确认交付版，需固定哈希与变更说明。
- `archived`：归档版，不再作为当前交付基线。

允许迁移：

- `draft -> candidate`
- `candidate -> draft`（回退修订）
- `candidate -> release`
- `release -> candidate`（发布后回退修订）
- `release -> archived`

默认不允许跨级跳转；确需越级时可用 `--force`，并在 `--reason` 写明原因。

---

## 2. 脚本入口

```bash
node scripts/final-draft-state-machine.mjs --book-root <本书根> --action status --json
node scripts/final-draft-state-machine.mjs --book-root <本书根> --action transition --to candidate --reason "S4质检通过"
node scripts/final-draft-state-machine.mjs --book-root <本书根> --action transition --to release --artifact <交付文件> --reason "用户确认交付"
```

脚本输出：

- `.fbs/final-draft-state.json`：当前状态、最近迁移、产物 hash、历史迁移链。
- 轻索引事件：写入 `.fbs/book-state.db`（`final_draft_transition`）。

---

## 3. 与门禁链衔接建议

- 进入 `release` 前建议满足：
  - 扩写门禁与质检门禁已通过；
  - `chapter-status.md` 与磁盘真值一致；
  - 用户确认可交付。
- 每次 `release` 建议绑定 `--artifact`，自动写入 hash，便于后续“版本对齐”和“回归定位”。

---

## 4. 回退策略

- 若发布后发现问题：`release -> candidate`，修复后再回到 `release`。
- 若版本不再维护：`release -> archived`。
- 禁止直接覆盖旧终稿文件而不记录状态迁移。

---

## 5. 与复盘闭环衔接

- 复盘项里涉及“终稿命名混乱 / 版本漂移 / 多份并存”时，优先检查状态机与 hash 记录是否完整。
- 可结合：
  - `node scripts/retro-to-skill-candidates.mjs --book-root <根>`
  - `node scripts/runtime-nudge.mjs --book-root <根>`

将问题沉淀为后续可复用流程。
