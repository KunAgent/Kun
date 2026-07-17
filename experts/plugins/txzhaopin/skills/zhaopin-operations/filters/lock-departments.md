# 当前锁定部门筛选条件 🔒

筛选被特定部门锁定的候选人。

## 📋 参数信息

| 项目 | 值 |
|------|-----|
| **参数名** | `lock_idepts` |
| **类型** | `number[]` （数字数组） |
| **必填** | ❌ 否（不填或传空数组表示不筛选） |
| **逻辑** | OR（数组内满足任意一个即可） |

## 🎯 获取可选值

### 方式：接口获取

调用 `get-all-intention-departments` 接口获取：

```javascript
GET /zhaopin/campus/campusCenterApi/v1/idept/getCanSelectIdeptList?_t=<timestamp>
```

返回共120个可选部门，包含部门ID和名称。

## 💡 使用示例

```javascript
{
  lock_idepts: [123, 456]  // 部门ID数组
}
```

**效果**：筛选被部门123 **或** 部门456锁定的候选人

## ⚠️ 注意事项

1. **使用数字ID**：必须使用部门ID（数字），不是部门名称
2. **需先获取**：通过 `get-all-intention-departments` 接口获取部门ID和名称的映射关系
3. **OR 逻辑**：数组内多个部门是 OR 关系
4. **AND 逻辑**：与其他筛选条件是 AND 关系
5. **锁定含义**：候选人被部门锁定表示该部门对候选人有意向，其他部门暂时无法操作

## 📖 相关文档

- [`get-all-intention-departments`](../interfaces/get-all-intention-departments.md) - 获取部门列表接口
- [投递意向部门筛选条件](./intention-departments.md) - 查询投递了哪些部门的候选人
