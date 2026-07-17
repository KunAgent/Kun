# kms.ListKeyDetail 字段说明

## KeyState（密钥状态）

> **类型：String**

| 值 | 含义 |
|----|------|
| `Enabled` | 已启用 |
| `Disabled` | 已禁用 |
| `PendingDelete` | 计划删除中 |
| `PendingImport` | 待导入密钥材料（尚无法使用） |
| `Archived` | 已归档 |

## KeyState 过滤参数映射（查询时传数字）

| 参数值 | 对应状态 |
|--------|---------|
| `0` | 全部 |
| `1` | Enabled |
| `2` | Disabled |
| `3` | PendingDelete |
| `4` | PendingImport |
| `5` | Archived |

## Type（CMK 类型）

| 值 | 含义 |
|----|------|
| `1` | 用户密钥 |
| `4` | HSM 密钥 |

## Owner（密钥所有者）

| 值 | 含义 |
|----|------|
| `user` | 用户所有 |
| `authorize` | 云产品授权 |

## Origin（密钥材料来源）

| 值 | 含义 |
|----|------|
| `TENCENT_KMS` | 腾讯云 KMS 生成 |
| `EXTERNAL` | 用户导入（BYOK） |

## KeyUsage（密钥用途）

| 值 | 含义 |
|----|------|
| `ENCRYPT_DECRYPT` | 对称加解密（默认） |
| `ASYMMETRIC_DECRYPT_RSA_2048` | RSA 2048 非对称解密 |
| `ASYMMETRIC_DECRYPT_SM2` | SM2 非对称解密 |
| `ASYMMETRIC_SIGN_VERIFY_SM2` | SM2 签名验签 |
| `ASYMMETRIC_SIGN_VERIFY_RSA_2048` | RSA 2048 签名验签 |
| `ASYMMETRIC_SIGN_VERIFY_ECC` | ECC 签名验签 |

## 注意事项

- 非对称密钥（RSA_2048、SM2 等）不支持密钥轮换，展示时不应显示轮换状态。
- `Role=0` 查询用户创建的密钥，`Role=1` 查询云产品自动创建的密钥。
