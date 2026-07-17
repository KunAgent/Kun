# 搜索实习公司 - 根据关键词搜索公司名称（自动补全）

根据关键词搜索实习公司名称，用于简历筛选中的"实习公司"字段自动补全功能。

## 接口信息

| 项目 | 值 |
|------|-----|
| URL | `/resume/campus/api/v1/tagProduce/searchCompany` |
| Method | GET |
| Content-Type | application/json |

## 输入参数

| 参数 | 类型 | 必填 | 来源 | 说明 |
|------|------|------|------|------|
| `keyword` | string | ✅ | 用户输入 | 搜索关键词（支持模糊匹配） |

## 输出结果

### 成功响应（有匹配结果）

```json
{
  "message": "",
  "status": 0,
  "data": [
    {
      "dropDownText": "腾讯",
      "selectedText": "腾讯"
    },
    {
      "dropDownText": "腾讯音乐",
      "selectedText": "腾讯音乐"
    }
  ]
}
```

### 成功响应（无匹配结果）

```json
{
  "message": "",
  "status": 0,
  "data": []
}
```

| 字段 | 说明 |
|------|------|
| `status` | 状态码，0表示成功 |
| `data` | 匹配的公司列表 |
| `data[].dropDownText` | 下拉列表显示的文本 |
| `data[].selectedText` | 选中后使用的文本值 |

## MCP 调用

```bash
# 搜索公司
mcporter call recruit-mcp CallAPI apiId='recruit.campus-resume-search.get_v1_tagProduce_searchCompany'
```

## MCP 调用

```bash
# 搜索公司
mcporter call recruit-mcp CallAPI apiId='recruit.campus-resume-search.get_v1_tagProduce_searchCompany'
```

## 使用场景

### 在简历搜索中使用

在调用 `/resume/campus/api/v1/resume/search` 接口时，将搜索到的公司名称填入 `companyList` 参数：

```bash
# 简历搜索
mcporter call recruit-mcp CallAPI apiId='recruit.campus-resume-search.post_v1_resume_search'
```

## 注意事项

- **URL编码**：关键词必须使用 `encodeURIComponent()` 进行URL编码，尤其是中文字符
- **模糊匹配**：支持部分匹配，例如搜索"腾"会返回"腾讯"、"腾讯音乐"等
- **字段区别**：
  - `dropDownText`：用于在下拉列表中显示给用户
  - `selectedText`：用于提交搜索参数的实际值
  - 大多数情况下两者相同
- **空结果**：如果关键词无匹配，返回空数组 `data: []`
- **实时搜索**：建议在用户输入时实时调用此接口，提供自动补全体验
- **去重**：返回的公司列表已去重，无需额外处理

## 示例

### 搜索其他公司

```bash
# 搜索公司
mcporter call recruit-mcp CallAPI apiId='recruit.campus-resume-search.get_v1_tagProduce_searchCompany'
```
