# 合规要求词典（必须追问）

> **类目**：COMPLIANCE（命中后**进 `约束条件` 列**，并**强制触发追问** —— 合规要求会改变可选 SPU 集合）

| token | 归类 | 适用 site | 强制约束 | 来源 | 启用 |
|-------|------|----------|---------|------|------|
| 等保 2.0 | COMPLIANCE | cn | 强制专属云 / 金融云 SKU | 国家信息安全等级保护 2.0 | yes |
| 等保三级 | COMPLIANCE | cn | 强制专属云 / 金融云 SKU | 国家信息安全等级保护 | yes |
| 等保四级 | COMPLIANCE | cn | 强制专属云 / 金融云 SKU | 国家信息安全等级保护 | yes |
| 等保 | COMPLIANCE | cn | 强制专属云 / 金融云 SKU（需追问具体级别） | 国家信息安全等级保护通称 | yes |
| 国密 | COMPLIANCE | cn | 强制使用国密版本（如 SSL 证书国密版） | 国密标准 | yes |
| SM2 | COMPLIANCE | cn | 强制国密 SM2 算法 | 国密标准 | yes |
| SM3 | COMPLIANCE | cn | 强制国密 SM3 算法 | 国密标准 | yes |
| SM4 | COMPLIANCE | cn | 强制国密 SM4 算法 | 国密标准 | yes |
| 金融云 | COMPLIANCE | cn | 限制可用区 / 强制金融云 SKU | 腾讯云金融专区 | yes |
| 金融行业 | COMPLIANCE | cn | 可能需金融云 SKU（需追问） | 行业合规通称 | yes |
| 政务云 | COMPLIANCE | cn | 限制专有云部署 | 政务行业合规 | yes |
| GDPR | COMPLIANCE | intl | 限制欧洲地域 / 数据本地化 | EU GDPR | yes |
| SOC 2 | COMPLIANCE | intl | 强制审计日志 / 合规版本 | AICPA SOC 2 | yes |
| SOC2 | COMPLIANCE | intl | 强制审计日志 / 合规版本 | AICPA SOC 2（紧凑写法） | yes |
| HIPAA | COMPLIANCE | intl | 限制美国地域 / BAA 协议 | 美国 HIPAA | yes |
| PCI DSS | COMPLIANCE | cn,intl | 强制支付合规版本 | PCI 标准委员会 | yes |
| PCI-DSS | COMPLIANCE | cn,intl | 强制支付合规版本 | PCI 标准委员会 | yes |
| ISO 27001 | COMPLIANCE | cn,intl | 强制审计版本 | ISO/IEC 27001 信息安全 | yes |
| 数据本地化 | COMPLIANCE | cn,intl | 限制地域 | 数据合规 | yes |
| 数据出境 | COMPLIANCE | cn | 强制审批流程 | 国内数据合规 | yes |

> ⚠️ COMPLIANCE 命中即触发 **A 段必答追问**（决策 3）：合规要求 vs 仅作为备注 vs 跳过此清单。AI 不允许凭常识默认。
