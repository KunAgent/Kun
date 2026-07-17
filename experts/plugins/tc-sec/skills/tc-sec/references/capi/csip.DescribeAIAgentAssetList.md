# csip.DescribeAIAgentAssetList 字段说明

## IdentityMethod（AI Agent 检出方式）

| 值 | 含义 |
|----|------|
| `FINGER` | 主机指纹方式检出 |
| `NETWORK` | 网络访问方式检出 |
| `ASSET` | 资产方式检出 |

## ExposureStatus（暴露状态）

| 值 | 含义 |
|----|------|
| `EXPOSED` | 已暴露 |
| `UNEXPOSED` | 未暴露 |
| `UNKNOWN` | 未知 |

## MetadataRiskList（元数据风险）

| 值 | 含义 |
|----|------|
| `AK_TMP` | 临时 AK 泄露风险 |
| `USER_DATA` | 用户数据风险 |
| `null` / `UNKNOWN` | 不包含（无风险） |
