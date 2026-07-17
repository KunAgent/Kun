# 投递意向部门筛选条件 🏢

筛选候选人投递的意向部门。

## 📋 参数信息

| 项目 | 值 |
|------|-----|
| **参数名** | `idepts` |
| **类型** | `number[]` （数字数组） |
| **必填** | ❌ 否（不填或传空数组表示不筛选） |
| **逻辑** | OR（数组内满足任意一个即可） |

## 🎯 获取可选值

### 方式：接口获取（推荐）

调用以下接口获取所有可选的投递意向部门：

```javascript
GET /zhaopin/campus/campusCenterApi/v1/intentionDepartment/getAllIntentionDepartment
```

**返回数据结构**：
```json
{
  "status": 0,
  "message": "",
  "data": [
    {
      "id": 80,
      "name": "TEG技术工程事业群/AI Lab",
      "level": 2,
      "parentId": 5,
      // ... 其他字段
    },
    {
      "id": 81,
      "name": "TEG技术工程事业群/AI平台部",
      "level": 2,
      "parentId": 5,
      // ... 其他字段
    }
    // ... 更多部门
  ]
}
```

**字段说明**：
- `id`: 部门ID（用于筛选参数）
- `name`: 部门全称（事业群/部门）
- `level`: 部门层级
- `parentId`: 父部门ID

### 在浏览器 Console 中获取

如果需要在浏览器中快速获取部门列表，可以在 Console 执行：

```bash
# 此接口已改为读取本地数据文件
cat data/intention-departments.json
```

## 💡 使用示例

### 示例1：筛选 AI Lab 和 AI平台部

```javascript
{
  idepts: [80, 81]  // TEG技术工程事业群/AI Lab, TEG技术工程事业群/AI平台部
}
```

### 示例2：筛选单个部门

```javascript
{
  idepts: [243]  // 某个特定部门
}
```

### 示例3：筛选多个事业群下的部门

```javascript
{
  idepts: [80, 81, 100, 101, 102]  // 多个部门
}
```

**效果**：筛选投递意向为这些部门**之一**的候选人

### 示例4：不筛选意向部门

```javascript
{
  idepts: []  // 空数组
}
```

## 🔗 在搜索接口中使用

```javascript
POST /resume/campus/api/v1/resume/search

{
  page: 1,
  limit: 20,
  searchId: "search-xxx",
  searchStrategy: {"version": "V3", "strategy": "strategy-V3"},
  idepts: [80, 81],  // ⭐ 投递意向部门参数
  graduate_time_begin: "2027-01-01",
  graduate_time_end: "2027-12-31",
  // ... 其他参数
}
```

## ⚠️ 注意事项

1. **使用数字ID**：必须使用部门ID（数字），**不能**使用部门名称字符串
2. **需先获取映射**：通过 `getAllIntentionDepartment` 接口获取部门ID和名称的对应关系
3. **OR 逻辑**：数组内多个部门是 OR 关系（满足任意一个即可）
4. **AND 逻辑**：与其他筛选条件（如学校、学历）是 AND 关系
5. **层级结构**：部门有层级关系（事业群 → 部门），筛选时使用具体的部门ID
6. **部门变动**：部门列表可能随组织架构调整而变化，建议定期更新

## 🔍 与锁定部门的区别

| 筛选条件 | 参数名 | 含义 |
|---------|--------|------|
| **投递意向部门** | `idepts` | 候选人**投递时选择**的意向部门 |
| **当前锁定部门** | `lock_idepts` | 候选人**当前被锁定**在的部门 |

**使用场景**：
- 想找"对 AI Lab 感兴趣的候选人" → 使用 `idepts`
- 想找"AI Lab 已经锁定的候选人" → 使用 `lock_idepts`

## 🤔 常见问题

**Q: 如何快速找到某个部门的ID？**

A: 在 Console 执行：
```bash
# 此接口已改为读取本地数据文件
cat data/intention-departments.json
```

**Q: 可以同时筛选多个事业群吗？**

A: 可以！`idepts` 数组可以包含不同事业群下的部门ID。

**Q: 部门列表有多少个？**

A: 根据系统数据，通常有100+个可选部门，覆盖腾讯各大事业群。

## 📖 相关文档

- [`search-campus-resume`](../interfaces/search-campus-resume.md) - 校园简历搜索接口
- [`get-all-intention-departments`](../interfaces/get-all-intention-departments.md) - 获取投递意向部门列表接口
- [当前锁定部门筛选条件](./lock-departments.md) - 查询被哪些部门锁定的候选人
- [简历筛选手册](../guides/resume-filtering-manual.md) - 返回筛选导航
