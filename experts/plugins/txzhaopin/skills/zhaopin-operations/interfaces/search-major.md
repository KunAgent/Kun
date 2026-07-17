# 搜索专业 - 专业名称模糊查询接口

根据专业名称关键词进行模糊搜索，返回匹配的专业名称列表，用于专业筛选的自动补全功能。

## 接口信息

| 项目 | 内容 |
|------|------|
| **接口路径** | `/resume/campus/api/v1/dictionary/getTagList` |
| **请求方法** | `GET` |
| **基础URL** | `https://zhaopin.woa.com` |
| **完整URL示例** | `https://zhaopin.woa.com/resume/campus/api/v1/dictionary/getTagList?tagType=submajor&tagName=计算机` |
| **功能说明** | 模糊匹配专业名称，返回候选专业列表 |

## 请求参数

| 参数名 | 类型 | 必填 | 说明 | 示例值 |
|--------|------|------|------|--------|
| `tagType` | string | ⭐ | 标签类型，固定值 `submajor`（专业） | `submajor` |
| `tagName` | string | ⭐ | 专业名称关键词（支持模糊匹配） | `计算机` |

### 参数说明

- **tagType**：
  - 固定传 `submajor`，表示查询专业
  - 可能还支持其他类型（如技能 skill 等），但本接口仅用于专业查询
- **tagName**：
  - 支持部分关键词匹配，如"计算机"会返回所有包含"计算机"的专业
  - 支持中文、英文
  - URL编码：需要对中文进行 URL 编码（如 `计算机` → `%E8%AE%A1%E7%AE%97%E6%9C%BA`）

## 返回数据

### 成功响应

```json
{
  "status": 0,
  "message": "",
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

### 关键字段说明

| 字段 | 说明 |
|------|------|
| `status` | 状态码，0 表示成功 |
| `message` | 提示信息 |
| `data` | 专业名称数组（字符串列表） |

## MCP 调用

```bash
mcporter call recruit-mcp CallAPI apiId='recruit.campus-resume-search.get_v1_dictionary_getTagList' params='{"tagType": "submajor", "tagName": "计算机"}'
```

### 使用技能工具调用

```bash
mcporter call recruit-mcp CallAPI apiId='recruit.campus-resume-search.get_v1_dictionary_getTagList' params='{"tagType": "submajor", "tagName": "软件工程"}'
```

## 注意事项

**参数编码：**
- 中文专业名需要进行 URL 编码
- JavaScript中可使用 `encodeURIComponent()` 函数
- 示例：`encodeURIComponent('计算机')` → `%E8%AE%A1%E7%AE%97%E6%9C%BA`

**匹配规则：**
- 模糊匹配：输入"计算机"会返回所有包含"计算机"的专业
- 精准匹配：输入完整专业名（如"计算机科学与技术"）会将精确匹配的专业排在前面
- 返回顺序：按匹配度和专业常用度排序

**业务场景：**
- 用于专业筛选框的自动补全功能
- 用户输入部分专业名，系统返回候选列表供选择
- 选中的专业名会添加到简历搜索接口的 `specialityList` 参数数组中

**与简历搜索接口配合：**
1. 用户输入专业关键词 → 调用本接口获取候选专业列表
2. 用户从候选列表中选择专业（如"计算机科学与技术"）
3. 将选中的专业名添加到 `search-campus-resume` 接口的 `specialityList` 参数：`specialityList: ["计算机科学与技术"]`
4. 执行简历搜索，返回该专业的候选人简历

**性能优化：**
- 建议使用防抖（debounce）技术，避免用户每输入一个字符就发起请求
- 建议延迟300-500ms后再发起搜索请求
- 缓存常用专业列表，减少重复请求

**数据特点：**
- 返回结果数量不固定（根据匹配度）
- 不同关键词返回的专业数量差异较大
- 建议前端限制显示数量（如最多显示20个）

## 测试验证

**测试用例1：搜索计算机相关专业**
```bash
# 请求
GET /resume/campus/api/v1/dictionary/getTagList?tagType=submajor&tagName=计算机

# 预期结果
- status: 0
- data: 包含"计算机科学与技术"、"计算机软件与理论"等相关专业
- data: 字符串数组格式
```

**测试用例2：搜索软件工程**
```bash
# 请求
GET /resume/campus/api/v1/dictionary/getTagList?tagType=submajor&tagName=软件工程

# 预期结果
- status: 0
- data: 包含"软件工程"及相关专业
```

**测试结果记录**：
- ✅ 搜索"计算机"返回6个相关专业
- ✅ 返回格式为字符串数组
- ✅ 与简历搜索接口配合：`specialityList: ["计算机科学与技术"]` 成功筛选出291条北大计算机相关专业简历

## 相关接口

- [search-campus-resume](search-campus-resume.md) - 简历搜索接口，使用本接口返回的专业名进行筛选
