# 专业筛选条件 📚

筛选候选人的专业名称（如计算机科学与技术、软件工程）。

## 📋 参数信息

| 项目 | 值 |
|------|-----|
| **参数名** | `specialityList` |
| **类型** | `string[]` （字符串数组） |
| **必填** | ❌ 否（不填或传空数组表示不筛选） |
| **逻辑** | OR（数组内满足任意一个即可） |

## 🎯 获取可选值

### 方式：搜索接口（动态）

调用 `search-major` 接口进行模糊搜索：

```javascript
GET /resume/campus/api/v1/dictionary/getTagList?tagType=submajor&tagName=计算机
```

**返回示例**：
```json
{
  "status": 0,
  "data": [
    "计算机科学与技术",
    "计算机软件与理论",
    "电子与计算机工程",
    "计算机系统结构",
    "计算机技术",
    "计算机应用技术"
  ]
}
```

### 使用哪个值？

直接使用返回的专业名称字符串（如 `"计算机科学与技术"`）。

## 💡 使用示例

### 示例1：筛选计算机科学与技术专业

```javascript
{
  specialityList: ["计算机科学与技术"]
}
```

### 示例2：筛选计算机相关专业

```javascript
{
  specialityList: [
    "计算机科学与技术",
    "软件工程",
    "计算机应用技术"
  ]
}
```

**效果**：筛选专业为计算机科学与技术 **或** 软件工程 **或** 计算机应用技术的候选人

### 示例3：不筛选专业

```javascript
{
  specialityList: []  // 空数组
}
```

## ⚠️ 注意事项

1. **精确匹配**：专业名称必须与接口返回的名称**完全一致**
2. **先搜索后使用**：不要凭记忆填写专业名，必须通过搜索接口获取准确名称
3. **OR 逻辑**：数组内多个专业是 OR 关系（满足任意一个即可）
4. **AND 逻辑**：与其他筛选条件（如学校、学历）是 AND 关系
5. **专业层次**：系统不区分本科/硕士/博士的专业，统一使用专业名称

## 🔍 如何搜索专业名称

### 步骤1：调用搜索接口

```bash
mcporter call recruit-mcp CallAPI apiId='recruit.campus-resume.get_api_dictionary_getTagList' params='{"tagType": "submajor", "tagName": "软件"}'
```

### 步骤2：从结果中选择

从返回的专业列表中选择需要的专业名称，添加到 `specialityList` 参数数组中。

## 🔗 在搜索接口中使用

```javascript
POST /resume/campus/api/v1/resume/search

{
  page: 1,
  limit: 20,
  searchId: "search-xxx",
  searchStrategy: {"version": "V3", "strategy": "strategy-V3"},
  specialityList: ["计算机科学与技术", "软件工程"],  // ⭐ 专业参数
  graduate_time_begin: "2027-01-01",
  graduate_time_end: "2027-12-31",
  // ... 其他参数
}
```

## 🤔 常见问题

**Q: 如何筛选"计算机相关"专业？**

A: 需要先通过搜索接口获取所有计算机相关专业，然后将它们都添加到数组中：
```javascript
{
  specialityList: [
    "计算机科学与技术",
    "软件工程",
    "计算机应用技术",
    "计算机系统结构",
    "计算机软件与理论",
    "电子与计算机工程"
  ]
}
```

**Q: 专业名称区分大小写吗？**

A: 是的，必须严格匹配。建议通过搜索接口获取准确名称，而不是手动输入。

**Q: 如果候选人有多个学历，专业是如何匹配的？**

A: 系统会检查候选人所有学历的专业信息，只要有任意一个学历的专业匹配，就会被筛选出来。

## 📖 相关文档

- [`search-major`](../interfaces/search-major.md) - 专业名称搜索接口
