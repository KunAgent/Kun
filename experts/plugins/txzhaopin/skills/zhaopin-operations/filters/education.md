# 学历筛选条件 🎓

筛选候选人的学历层次（大专/本科/硕士/博士）。

## 📋 参数信息

| 项目 | 值 |
|------|-----|
| **参数名** | `education` |
| **类型** | `number[]` （数字数组） |
| **必填** | ❌ 否（不填或传空数组表示不筛选） |
| **逻辑** | OR（数组内满足任意一个即可） |

## 🎯 获取可选值

### 方式：字典接口（动态）

调用 `get-filter-dictionary` 接口获取：

```javascript
GET /resume/campus/api/v1/dictionary/?types=Education
```

**返回示例**：
```json
{
  "status": 0,
  "data": {
    "Education": [
      {"did": 1, "psId": 4, "name": "大专", "type": "Education"},
      {"did": 2, "psId": 3, "name": "本科", "type": "Education"},
      {"did": 3, "psId": 2, "name": "硕士研究生", "type": "Education"},
      {"did": 4, "psId": 1, "name": "博士研究生", "type": "Education"},
      {"did": 6, "psId": 6, "name": "高中", "type": "Education"}
    ]
  }
}
```

### 学历代码映射（5个）

| did | name | psId | 说明 |
|-----|------|------|------|
| **1** | 大专 | 4 | 专科学历 |
| **2** | 本科 | 3 | 本科学历 |
| **3** | 硕士研究生 | 2 | 硕士学历 |
| **4** | 博士研究生 | 1 | 博士学历（最高优先级） |
| **6** | 高中 | 6 | 高中学历 |

**使用哪个字段？**  
使用 `did` 字段（数字ID）作为参数值，**不是** `name` 字段！

## 💡 使用示例

### 示例1：仅筛选硕士

```javascript
{
  education: [3]
}
```

### 示例2：筛选硕士或博士

```javascript
{
  education: [3, 4]
}
```

**效果**：筛选出学历为硕士研究生 **或** 博士研究生的候选人

### 示例3：筛选本科及以上

```javascript
{
  education: [2, 3, 4]
}
```

**效果**：筛选出本科、硕士、博士学历的候选人（不包括大专和高中）

### 示例4：全选（等同不筛选）

```javascript
{
  education: [1, 2, 3, 4, 6]  // 全选所有学历
}
```

**或者使用空数组**（推荐）：

```javascript
{
  education: []  // 不筛选
}
```

## ⚠️ 注意事项

1. **使用数字ID**：必须使用 `did` 字段的数字ID（如 `3`），**不能**使用文字名称（如 `"硕士研究生"`）
2. **psId 表示优先级**：数字越小优先级越高（博士=1，硕士=2，本科=3）
3. **OR 逻辑**：数组内多个值是 OR 关系（满足任意一个即可）
4. **AND 逻辑**：与其他筛选条件（如学校、专业）是 AND 关系
5. **高中学历**：did=6，很少使用（校招通常要求本科及以上）

## 🔗 在搜索接口中使用

```javascript
POST /resume/campus/api/v1/resume/search

{
  page: 1,
  limit: 20,
  searchId: "search-xxx",
  searchStrategy: {"version": "V3", "strategy": "strategy-V3"},
  education: [3, 4],  // ⭐ 学历参数（使用 did 数字）
  graduate_time_begin: "2027-01-01",
  graduate_time_end: "2027-12-31",
  // ... 其他参数
}
```

## 🤔 常见问题

**Q: 为什么学历用数字而不是文字？**

A: 系统内部使用数字ID作为标识符，更高效且避免文字匹配问题。从字典接口获取的 `did` 字段就是要传递的参数值。

**Q: 如何筛选"硕士及以上"？**

A: 使用 `education: [3, 4]`（硕士=3，博士=4）

**Q: 空数组和全选有什么区别？**

A: 对于学历来说，效果相同。但推荐使用空数组 `[]`，语义更清晰（表示"不限制学历"）。

## 📖 相关文档

- [`get-filter-dictionary`](../interfaces/get-filter-dictionary.md) - 获取学历字典
