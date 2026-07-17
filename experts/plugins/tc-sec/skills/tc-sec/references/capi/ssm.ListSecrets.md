# ssm.ListSecrets 字段说明

## Status（凭据状态）

> **类型：String**

| 值 | 含义 |
|----|------|
| `Enabled` | 已启用 |
| `Disabled` | 已禁用 |
| `PendingDelete` | 计划删除中 |
| `Creating` | 创建中（云产品凭据） |
| `Failed` | 创建失败（云产品凭据） |

## State 过滤参数映射（查询时传数字）

| 参数值 | 对应状态 |
|--------|---------|
| `0` | 全部（默认） |
| `1` | Enabled |
| `2` | Disabled |
| `3` | PendingDelete |
| `4` | PendingCreate |
| `5` | CreateFailed |

## SecretType（凭据类型）

| 值 | 含义 |
|----|------|
| `0` | 用户自定义凭据 |
| `1` | 云产品凭据（如 Mysql、Redis） |
| `2` | SSH 密钥对凭据 |
| `3` | 云 API 密钥对凭据 |
| `4` | Redis 类型凭据 |

## RotationStatus（轮转状态）

| 值 | 含义 |
|----|------|
| `0` | 禁止轮转 |
| `1` | 开启轮转 |

## KmsKeyType（KMS 密钥类型）

| 值 | 含义 |
|----|------|
| `DEFAULT` | SSM 自动创建的 KMS 密钥 |
| `CUSTOMER` | 用户指定的 KMS 密钥 |
