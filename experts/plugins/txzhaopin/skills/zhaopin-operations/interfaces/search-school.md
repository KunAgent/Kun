# 搜索学校 - 学校名称模糊查询接口

根据学校名称关键词进行模糊搜索，返回匹配的学校名称列表，用于学校筛选的自动补全功能。

## 接口信息

| 项目 | 内容 |
|------|------|
| **接口路径** | `/resume/campus/api/v1/dictionary/searchSchool` |
| **请求方法** | `GET` |
| **基础URL** | `https://zhaopin.woa.com` |
| **完整URL示例** | `https://zhaopin.woa.com/resume/campus/api/v1/dictionary/searchSchool?schoolName=北京大学&size=20` |
| **功能说明** | 模糊匹配学校名称，返回候选学校列表 |

## 请求参数

| 参数名 | 类型 | 必填 | 说明 | 示例值 |
|--------|------|------|------|--------|
| `schoolName` | string | ⭐ | 学校名称关键词（支持模糊匹配） | `北京大学` |
| `size` | number | ❌ | 返回结果数量（默认20） | `20` |

### 参数说明

- **schoolName**：
  - 支持部分关键词匹配，如"北京"会返回所有包含"北京"的学校
  - 支持中文、英文
  - URL编码：需要对中文进行 URL 编码（如 `北京大学` → `%E5%8C%97%E4%BA%AC%E5%A4%A7%E5%AD%A6`）
- **size**：
  - 控制返回结果数量
  - 建议使用默认值20，满足大部分场景

## 返回数据

### 成功响应

```json
{
  "status": 0,
  "message": "",
  "data": [
    "北京大学",
    "北京航空航天大学",
    "北京邮电大学",
    "北京交通大学",
    "北京理工大学",
    "北京科技大学",
    "北京师范大学",
    "北京北大方正软件职业技术学院",
    "北京工商大学",
    "北京工业大学",
    "北京工业大学耿丹学院",
    "北京航空航天大学北海学院",
    "北京化工大学",
    "北京建筑大学",
    "北京开放大学",
    "北京科技大学天津学院",
    "北京理工大学珠海学院",
    "北京联合大学",
    "北京林业大学",
    "北京师范大学-香港浸会大学联合国际学院"
  ]
}
```

### 关键字段说明

| 字段 | 说明 |
|------|------|
| `status` | 状态码，0 表示成功 |
| `message` | 提示信息 |
| `data` | 学校名称数组（字符串列表） |

## MCP 调用

```bash
mcporter call recruit-mcp CallAPI apiId='recruit.campus-resume-search.get_v1_dictionary_searchSchool' params='{"schoolName": "北京大学", "size": "20"}'
```

### 使用技能工具调用

```bash
mcporter call recruit-mcp CallAPI apiId='recruit.campus-resume-search.get_v1_dictionary_searchSchool' params='{"schoolName": "清华", "size": "20"}'
```

## 注意事项

**参数编码：**
- 中文学校名需要进行 URL 编码
- JavaScript中可使用 `encodeURIComponent()` 函数
- 示例：`encodeURIComponent('北京大学')` → `%E5%8C%97%E4%BA%AC%E5%A4%A7%E5%AD%A6`

**匹配规则：**
- 模糊匹配：输入"北京"会返回所有包含"北京"的学校
- 精准匹配：输入完整学校名（如"北京大学"）会将精确匹配的学校排在前面
- 返回顺序：按匹配度和学校重要性排序

**业务场景：**
- 用于学校筛选框的自动补全功能
- 用户输入部分学校名，系统返回候选列表供选择
- 选中的学校名会添加到简历搜索接口的 `school` 参数数组中

**与简历搜索接口配合：**
1. 用户输入学校关键词 → 调用本接口获取候选学校列表
2. 用户从候选列表中选择学校（如"北京大学"）
3. 将选中的学校名添加到 `search-campus-resume` 接口的 `school` 参数：`school: ["北京大学"]`
4. 执行简历搜索，返回该学校的候选人简历

**性能优化：**
- 建议使用防抖（debounce）技术，避免用户每输入一个字符就发起请求
- 建议延迟300-500ms后再发起搜索请求
- 缓存常用学校列表，减少重复请求

## 测试验证

**测试用例1：搜索北京大学**
```bash
# 请求
GET /resume/campus/api/v1/dictionary/searchSchool?schoolName=北京大学&size=20

# 预期结果
- status: 0
- data: 包含"北京大学"及相关学校（如北京航空航天大学、北京邮电大学等）
- data.length: 20（或更少）
- data[0]: "北京大学"（精确匹配排在首位）
```

**测试用例2：搜索清华**
```bash
# 请求
GET /resume/campus/api/v1/dictionary/searchSchool?schoolName=清华&size=10

# 预期结果
- status: 0
- data: 包含"清华大学"及相关学校
- data.length: ≤ 10
```

**测试结果记录**：
- ✅ 搜索"北京大学"返回20条结果
- ✅ 精确匹配的"北京大学"排在首位
- ✅ 返回结果包含相关学校（北京航空航天大学、北京邮电大学等）
- ✅ 与简历搜索接口配合：`school: ["北京大学"]` 成功筛选出3,083条北大简历
