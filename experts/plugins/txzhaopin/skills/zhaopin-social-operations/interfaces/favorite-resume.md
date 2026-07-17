# interfaces/favorite-resume.md

社招简历收藏接口（可批量）。

## 基本信息

- **apiId**: `recruit.social-resume.post_api_favorite_favorite_resume`
- **方法**: POST
- **操作类型**: ⚠️ 写操作
- **幂等**: 是（重复收藏同一简历不报错）

## 参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `employeeId` | int | ✅ | 简历 EmployeeId，**等于搜索返回的 `ExtId` 转 int** |
| `postId` | int | ❌ | 岗位 ID，可不传 |
| `searchId` | string | ❌ | 搜索 ID（精读产出的 JSON 里有 `meta.search_id` 时传）|
| `memo` | string | ❌ | 备注 |

> ⚠️ `employeeId` ≠ `rid`。`rid` 是 UUID 字符串，`employeeId` 是 int 类型的业务 ID（= `ExtId`）。

## 调用方式

```bash
mcporter call recruit-mcp CallAPI \
  apiId='recruit.social-resume.post_api_favorite_favorite_resume' \
  params='{"employeeId": 12345678}'
```

批量收藏：在对话中循环调用即可（每次间隔 300-500ms 避免限流），或由用户指定的 rid 列表生成批量命令。

## 返回示例

```json
{"code": 0, "success": true, "data": true}
```

## 使用时机

阶段 6 下一步建议完成后，用户明确说"收藏"或"收藏这 N 个"时才调用。**默认不主动收藏**，必须显式确认。
