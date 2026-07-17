# CreateAdvisorAuthorization — 开启智能顾问授权

开启智能顾问授权。会同步开启报告解读和云架构协作权限。

> **⚠️ 重要**：此接口为**写入操作**，会开通智能顾问服务。**必须在用户明确同意后才能调用**，严禁自动调用。

## 参数

无业务参数，直接传空 JSON `{}` 即可。

## 调用示例

```bash
python3 {baseDir}/scripts/tcloud_api.py \
  advisor \
  advisor.tencentcloudapi.com \
  CreateAdvisorAuthorization \
  2020-07-21 \
  '{}'
```

## 返回示例

```json
{
  "success": true,
  "action": "CreateAdvisorAuthorization",
  "data": {
    "Message": "Already authorized"
  },
  "requestId": "97aa2227-1814-4d39-9470-dadca094be1f"
}
```

## 返回字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `Message` | String | 返回信息，如 `"Already authorized"` 表示已开通 |

## 使用场景

当用户查询智能顾问数据时返回空结果或提示未授权，可能是当前账号尚未开通智能顾问服务。此时应：

1. **告知用户**当前账号可能未开通智能顾问，询问是否需要开通
2. **等待用户明确同意**后才可调用此接口
3. 调用成功后，提示用户智能顾问已开通，可重新查询

## 展示规则

调用前向用户展示：

```
当前账号（AK/SK 对应账号）似乎尚未开通智能顾问服务。
开通智能顾问后，将同步开启报告解读和云架构协作权限。

是否同意开通智能顾问服务？
```

调用成功后向用户展示：

```
✅ 智能顾问服务已成功开通！现在可以正常使用架构图管理、风险评估等功能。
```
