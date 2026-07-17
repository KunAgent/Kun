# 乐包（Credits）说明

> **版本**：2.1.1  
> **受众**：写作者 / 主编；与 `scene-packs/credits-ledger.json` 行为一致。

## 定位

乐包是**本地行为激励点数**，用于解锁部分增值体裁场景包门槛；**不是现金充值货币**，也**不提供应用内购买**。余额与流水仅存本机 `scene-packs/` 目录（与 `enterprise.json` 同层），不依赖网络即可累计与查询。

## 如何获得

| 来源 | 默认奖励 | 说明 |
|------|----------|------|
| 首次安装 | +100 | 幂等，仅一次 |
| 每日首次使用 | +5 | 同一自然日一次 |
| 完成一章 | +10 | 由 `markChapterDone` 等埋点触发 |
| 完成一本书 | +50 | |
| 章节质检通过 | +3 | |
| 完成 S6 转化 | +12 | |
| 写入发布映射 | +8 | |

具体数值以 `scripts/wecom/lib/credits-ledger.mjs` 内 `CREDIT_SOURCES` 为准。

## 如何消耗

解锁部分付费体裁场景包时，若门槛未满足，会提示「还差 X 个乐包」。消耗规则与体裁门槛表以 `GENRE_THRESHOLDS`（与 `entitlement` 逻辑对齐）为准，例如：`genealogy` 100、`personal-book` 500 等。

## 如何查询

- CLI：`node scripts/fbs-cli-bridge.mjs credits balance` 或 `… credits balance --json`
- Skill：`CHECK_BALANCE` / `UPGRADE_HINT` 意图（见 `section-nlu.md`）

## 与「后端 / 企微」的关系

企微智能表格用于运营侧配置拉取；**拉取失败时自动降级到本地规则与离线缓存**，乐包账本仍本地累计，不因网络不可用而清零。若看到场景包相关告警，含义是「远端配置未拉到」，不是「乐包失效」。
