# 实习公司筛选条件 🏢

筛选在特定公司实习过的候选人。

## 📋 参数信息

| 项目 | 值 |
|------|-----|
| **参数名** | `companyList` |
| **类型** | `string[]` （字符串数组） |
| **必填** | ❌ 否（不填或传空数组表示不筛选） |
| **逻辑** | OR（数组内满足任意一个即可） |

## 🎯 获取可选值

### 方式：搜索接口（动态）

调用 `search-company` 接口进行模糊搜索：

```javascript
GET /resume/campus/api/v1/dictionary/searchCampany?companyName=腾讯&size=20
```

**返回示例**：
```json
{
  "status": 0,
  "data": [
    "腾讯",
    "腾讯科技",
    "腾讯云计算",
    "腾讯音乐"
    // ... 更多匹配的公司
  ]
}
```

### 使用哪个值？

直接使用返回的公司名称字符串（如 `"腾讯"`）。

## 💡 使用示例

### 示例1：筛选在腾讯实习过的候选人

```javascript
{
  companyList: ["腾讯"]
}
```

### 示例2：筛选在大厂实习过的候选人

```javascript
{
  companyList: ["腾讯", "阿里巴巴", "字节跳动", "华为"]
}
```

**效果**：筛选在腾讯 **或** 阿里巴巴 **或** 字节跳动 **或** 华为实习过的候选人

### 示例3：不筛选实习公司

```javascript
{
  companyList: []  // 空数组
}
```

## ⚠️ 注意事项

1. **精确匹配**：公司名称必须与接口返回的名称**完全一致**
2. **先搜索后使用**：必须通过搜索接口获取准确的公司名称
3. **OR 逻辑**：数组内多个公司是 OR 关系（满足任意一个即可）
4. **AND 逻辑**：与其他筛选条件（如学校、专业）是 AND 关系
5. **自填信息**：实习公司是候选人自行填写的，可能存在名称不规范的情况

## 🔍 如何搜索公司名称

```bash
mcporter call recruit-mcp CallAPI apiId='recruit.campus-resume.get_api_dictionary_searchCampany' params='{"companyName": "腾讯", "size": "20"}'
```

## 🔗 在搜索接口中使用

```javascript
POST /resume/campus/api/v1/resume/search

{
  page: 1,
  limit: 20,
  searchId: "search-xxx",
  searchStrategy: {"version": "V3", "strategy": "strategy-V3"},
  companyList: ["腾讯", "阿里巴巴"],  // ⭐ 实习公司参数
  graduate_time_begin: "2027-01-01",
  graduate_time_end: "2027-12-31",
  // ... 其他参数
}
```

## 🤔 常见问题

**Q: 公司名称必须完整吗？**

A: 是的，必须使用完整的公司名称（从搜索接口返回的）。不能简写或使用别称。

**Q: 如果候选人在多个公司实习过，如何匹配？**

A: 系统会检查候选人所有实习经历，只要有任意一段实习在目标公司，就会被筛选出来。

## 📖 相关文档

- [`search-company`](../interfaces/search-company.md) - 实习公司搜索接口
