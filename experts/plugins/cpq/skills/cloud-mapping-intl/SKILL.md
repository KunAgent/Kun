---
name: cloud-mapping-intl
status: active
description: 腾讯云国际站规格映射能力。用于将用户自然语言或 Excel/JSON/Markdown/PDF/DOCX 文件中的外部云规格映射为腾讯云国际站可选购规格字段；支持 AWS、阿里云、华为云、GCP、Azure 的实例、地域、磁盘、计费、带宽等规格映射。Use when 用户要求"腾讯云国际站规格映射 / cloud-mapping intl / Tencent Cloud International CVM 对应 / 海外云资源映射 / 国际版规格清单 / Singapore / Tokyo / Frankfurt 等国际站地域映射"。不要用于询价（请用 `tencent-cloud-pricing`）或国内站规格映射（请用 `cloud-mapping`）。
---

# cloud-mapping-intl — 腾讯云国际站规格映射

> 本 skill 与 `plugins/cpq/skills/cloud-mapping/`（cn variant）是**双胞胎**结构：行格式、字典文件结构、查询流程完全一致，仅在数据集上做了国际站可售范围裁剪 + 规格替换。
>
> **派生来源**：5 个数据 `.md` 文件由 cn 数据 + `tcloud-price --site intl` 目录派生而来，不是 Excel 原始数据。每次 cn 数据补强 / `tcloud-price` 目录扩展后会重派生覆写本 skill 数据。后续增量条目请通过 [`.agent/skills/cloud-mapping-import`](../../../../.agent/skills/cloud-mapping-import) skill 选 `variant=intl` 走标准 Excel 导入流程。
>
> **派生历史**：
>
> - 首批派生（2026-05-18）：cn 数据 + `tcloud-price` 45 款产品目录 → intl variant 激活
> - M6-refresh（2026-05-19）：跟随 `tcloud-price` 升级到 64 款产品目录，重派生覆写
> - M6-orphans（2026-05-19）：cn `product-strategy.md` migraq 推断补强 +113 行 → intl orphan TC 产品 34 → 1
> - M6-orphans-extras（2026-05-19）：cn `region.md` +5 / `disk.md` +1 → intl 同步重派生覆写
>
> **当前 marketplace 状态**：本 skill 已激活但**尚未注册**到任何 marketplace 清单（`.claude-plugin/marketplace.json` / `.codebuddy-plugin/marketplace.json` / `.panshi-plus/manifest.json` / `.workbuddy-plugin/plugin.json`）。Maintainer 决定注册前请先做一次小规模 intl Excel 导入端到端自验。

## 定位

把用户给出的自然语言规格或文件规格清单，映射成**腾讯云国际站**可选购规格字段，并返回映射依据与未解析字段。

## 与 cn 产物 skill 的关系

| 项          | cn 产物 skill                                                 | intl 产物 skill（本 skill）                                                      |
| ----------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 路径        | `plugins/cpq/skills/cloud-mapping/`                           | `plugins/cpq/skills/cloud-mapping-intl/`                                         |
| 目标域      | 腾讯云国内站（buy.cloud.tencent.com / CNY）                   | 腾讯云国际站（buy.tencentcloud.com / USD）                                       |
| 数据文件    | 7 个 `.md`（5 个数据 + `field-rule.md` + `range-mapping.md`） | 5 个数据 `.md`（field-rule / range-mapping 暂沿用 cn 即可，不在本 skill 内复制） |
| TC 产品集合 | 全 128 款（cn 站可见）                                        | 国际站 64 款（`tcloud-price products --site intl`，截至 2026-05-19 M6-refresh）  |
| TC 实例族   | cn 全量                                                       | 国际站 CVM 87 个族（截至首批派生时）                                             |
| TC 地域     | cn 全量                                                       | 18 个（含 China Mainland 6 + 国际 12）                                           |

## 职责边界

### 只做

- 与 cn 版完全一致的 8 类规格识别（产品 / 厂商 / 地域 / 实例规格 / CPU/内存 / 磁盘 / 带宽 / 计费 / 购买时长）。
- 查询本 skill `references/data/cloud-mapping/` 下的 5 个字典：`region.md` / `instance.md` / `disk.md` / `enum-mapping.md` / `product-strategy.md`。
- **字典未覆盖时直接标 `unresolved`，不调用 `migraq` 兜底**（migraq 仅含腾讯云国内站产品数据，对国际站没有权威结论；调用反而会引入错误信息）。
- 输出腾讯云国际站规格、`provenance`、`unresolved`。

### 不做

- 不询价（这是 `tencent-cloud-pricing` skill 的职责）。
- 不处理国内站规格映射请求（请走 `cloud-mapping`）。
- 不直接修改本 skill 下的 5 个数据 `.md`：增量请走 `cloud-mapping-import` skill 的 intl variant 通道。

## 红线

1. **禁止用 LLM 记忆补字典盲区**：本 skill 数据是 cn 数据派生的子集；用户问到的国际站规格如果本 skill 字典没覆盖，必须标 `unresolved`，**不要**借用 cn 数据（站点不同），**也不要**调用 `migraq`（migraq 只覆盖国内站产品）。
2. **禁止 migraq 兜底**：与 cn 版的核心差异——本 skill 运行时**不调用** `migraq`。字典未命中 = `unresolved`，由人工通过 `cloud-mapping-import` skill 的 `variant=intl` 通道补条目。
3. **禁止伪权威规格**：不确定字段必须明说，不得静默默认。
4. **禁止越界执行报价链路**：涉及询价或四层编码时，应转交 `tencent-cloud-pricing` skill。
5. **禁止跨 variant 写入**：用户在 intl 上下文里要求"补一行映射"时，绝对不能在 cn 版 `plugins/cpq/skills/cloud-mapping/` 下写入；增量请走 `cloud-mapping-import` skill 的 `variant=intl`。

## 工作流

> ⚠️ **与 cn 版的关键差异**：本 skill **跳过 cn 版的 Step 0 migraq 预检和"migraq 兜底"分支**。字典未命中直接走 `unresolved`，不再调用 `migraq`。

```text
输入规格（自然语言 / 文件行）
  ↓
解析规格要素
  ↓
按字段查询 intl 字典（references/data/cloud-mapping/）
  ├─ 命中且无歧义       → 写入腾讯云国际站规格，来源 dict:<file>
  ├─ 命中多个候选       → 按候选规则处理（与 cn 版一致：用户偏好 / 字典优先级 / 标准推荐）
  └─ 未命中             → 直接标 unresolved:dict_not_found，备注写明源规格
  ↓
输出规格表或 JSON
```

`unresolved` 备注格式：

```text
[unresolved] dict_not_found: <源厂商> <源产品/规格> 未在 intl 字典中找到对标
建议: 通过 cloud-mapping-import skill (variant=intl) 提供 Excel 证据后补录
```

除了上面这一段，**文件输入流程、候选与置信度规则、references 加载路由、输出格式（4 列 Markdown 表 / JSON / `write_result.py`）全部与 cn 版完全一致**，详见 cn 版 [`SKILL.md`](../cloud-mapping/SKILL.md) 对应段落，本 skill 不重复抄录。

物理差异：

- 字典查询路径是 `plugins/cpq/skills/cloud-mapping-intl/references/data/cloud-mapping/`，不是 `cloud-mapping/`。
- 脚本路径是 `plugins/cpq/skills/cloud-mapping-intl/scripts/`（与本 skill 同根），**不要**调用 cn 版的 `cloud-mapping/scripts/`。两版脚本的差异点见下表：

  | 脚本 | 与 cn 版差异 |
  | --- | --- |
  | `scripts/batch_io.py` | 完全一致（站点无关的输入归一化） |
  | `scripts/replay_batch_io.py` | 完全一致（batch_io 自检） |
  | `scripts/write_result.py` | **删除「[unresolved] 必须提及 migraq」的强制校验**，因为 intl 红线 #2 禁止 migraq 兜底；其它行为（4 列表头、provenance 校验、Excel 排版）与 cn 版一致 |

### 候选与置信度（intl 特化）

相对 cn 版的差异：表格中删去了 `migraq(session:<id>)` 与 "migraq 不可用或回答含糊" 两行。其它行（`exact` / `strategy` / `needs_user_choice` / `unresolved`）规则不变。

## cloud-mapping 字典

位置：`references/data/cloud-mapping/`

| 文件                  | 用途                                     | 行数（首批派生） | 行数（当前） |
| --------------------- | ---------------------------------------- | ---------------- | ------------ |
| `product-strategy.md` | 产品级推荐策略与匹配方法                 | 51               | 186          |
| `instance.md`         | 友商实例规格族 → 腾讯云国际站 CVM 实例族 | 586              | 586          |
| `region.md`           | 友商地域 → 腾讯云国际站地域              | 160              | 165          |
| `disk.md`             | 友商磁盘类型 → 腾讯云国际站 CBS 磁盘类型 | 85               | 86           |
| `enum-mapping.md`     | 计费、网络、存储、OS 等枚举映射          | 117              | 170          |

> "当前" 列截至 2026-05-19 M6-orphans-extras 完成后；首批派生于 2026-05-18。

> ℹ️ 本 skill **不**复制 cn 版的 `field-rule.md` 和 `range-mapping.md`——这两个文件是站点无关的字段匹配规则与区间映射；如需引用，请直接读 cn 版 [`plugins/cpq/skills/cloud-mapping/references/data/cloud-mapping/field-rule.md`](../cloud-mapping/references/data/cloud-mapping/field-rule.md) 和 [`range-mapping.md`](../cloud-mapping/references/data/cloud-mapping/range-mapping.md)。

## 维护

- 增量条目：走 `cloud-mapping-import` skill 的 `variant=intl`，必须有 Excel 证据。
- 整体重派生：本批派生脚本和决策日志保留在 `.tmp/<user>/intl-derivation/`（gitignored），不入仓库。
- 格式规范权威源：`.agent/skills/cloud-mapping-import/references/variants/intl/format-*.md`（`status: active`）。
