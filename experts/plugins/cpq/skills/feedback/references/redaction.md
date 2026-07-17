# 自动脱敏规则

> 从 SKILL.md 提取 · 装配器(`lib/redaction.ts`)执行 · Agent 不需手动脱敏 PII

提交前 CLI 会本地完成多层脱敏，再打印完整预览，等用户确认 `y/N` 才真正调工蜂 API：

- UIN（11–14 位数字）→ `[REDACTED-UIN]` 或 HMAC 摘要
- 手机号、邮箱、金额、AKSK、Cookie/PAT 类 token、Home 路径中的用户名
- URL Query string 全替换为 `[REDACTED-QUERY]`

详细规则见 [`docs/evolution/pipelines/a-feedback.md`](../../../../../docs/evolution/pipelines/a-feedback.md)
与 `.agent/rules/evolution-feedback.mdc`。
