# 技能标签筛选条件 💻

筛选具备特定技能标签的候选人。

## 📋 参数信息

| 项目 | 值 |
|------|-----|
| **参数名** | `skillList` |
| **类型** | `string[]` （字符串数组） |
| **必填** | ❌ 否（不填或传空数组表示不筛选） |
| **逻辑** | OR（数组内满足任意一个即可） |

## 🎯 获取可选值

### 方式：搜索接口（动态）

调用 `get-skill-tags` 接口获取：

```javascript
GET /resume/campus/api/v1/dictionary/getTagList?tagType=skill&tagName=
```

**说明**：
- `tagName` 为空字符串：返回全部1103个技能标签
- `tagName` 为关键词：返回模糊匹配的技能标签

**返回示例**：
```json
{
  "status": 0,
  "data": [
    "网络安全",
    "数据安全",
    "ai安全",
    "java",
    "python",
    "c++",
    "tensorflow",
    "pytorch"
    // ... 共1103个技能标签
  ]
}
```

### 技能标签类别（1103个）

系统共支持**1103个技能标签**，涵盖以下主要类别：

- **编程语言**：java、python、c++、go、rust、javascript、php 等
- **AI/机器学习**：tensorflow、pytorch、langchain、rag、机器学习平台 等
- **大数据**：hadoop、hive、spark、flink、流计算 等
- **安全类**：网络安全、数据安全、渗透测试、模糊测试 等
- **开发工具**：git、jenkins、postman、wireshark、elk 等
- **其他技术**：搜索引擎、索引、排序、召回、hpc 等

**完整列表**：通过接口动态获取（tagName=空字符串）

## 💡 使用示例

### 示例1：筛选Python技能

```javascript
{
  skillList: ["python"]
}
```

### 示例2：筛选AI相关技能

```javascript
{
  skillList: ["tensorflow", "pytorch", "机器学习平台", "rag"]
}
```

**效果**：筛选具备 tensorflow **或** pytorch **或** 机器学习平台 **或** rag 技能的候选人

### 示例3：筛选安全相关技能

```javascript
{
  skillList: ["网络安全", "数据安全", "ai安全", "渗透测试"]
}
```

### 示例4：不筛选技能

```javascript
{
  skillList: []  // 空数组
}
```

## ⚠️ 注意事项

1. **精确匹配**：技能标签名称必须与接口返回的名称**完全一致**（区分大小写）
2. **先搜索后使用**：建议先调用接口获取准确的标签名称
3. **OR 逻辑**：数组内多个技能是 OR 关系（满足任意一个即可）
4. **AND 逻辑**：与其他筛选条件（如学校、专业）是 AND 关系
5. **自填信息**：技能标签是候选人自行填写的，系统不验证准确性

## 🔍 如何搜索技能标签

### 方法1：获取全部标签

```bash
mcporter call recruit-mcp CallAPI apiId='recruit.campus-resume.get_api_dictionary_getTagList' params='{"tagType": "skill"}'
```

### 方法2：模糊搜索

```bash
mcporter call recruit-mcp CallAPI apiId='recruit.campus-resume.get_api_dictionary_getTagList' params='{"tagType": "skill", "tagName": "python"}'
```

## 🔗 在搜索接口中使用

```javascript
POST /resume/campus/api/v1/resume/search

{
  page: 1,
  limit: 20,
  searchId: "search-xxx",
  searchStrategy: {"version": "V3", "strategy": "strategy-V3"},
  skillList: ["python", "java", "c++"],  // ⭐ 技能标签参数
  graduate_time_begin: "2027-01-01",
  graduate_time_end: "2027-12-31",
  // ... 其他参数
}
```

## 🤔 常见问题

**Q: 技能标签区分大小写吗？**

A: 是的。例如 `"python"` 和 `"Python"` 是不同的标签。建议通过接口获取准确名称。

**Q: 如何筛选"前端相关"技能？**

A: 需要先搜索前端相关的技能标签，然后将它们都添加到数组中：
```javascript
{
  skillList: ["javascript", "vue", "react", "webpack", "html", "css"]
}
```

**Q: 技能标签是如何获得的？**

A: 技能标签是候选人在简历中自行填写的。系统不会自动提取或验证技能的真实性。

## 📖 相关文档

- [`get-skill-tags`](../interfaces/get-skill-tags.md) - 获取技能标签列表接口
