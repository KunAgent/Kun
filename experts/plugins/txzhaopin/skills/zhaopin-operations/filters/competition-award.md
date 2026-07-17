# 竞赛获奖筛选条件 🏆

筛选获得过特定竞赛奖项的候选人。

## 📋 参数信息

| 项目 | 值 |
|------|-----|
| **参数名** | `award` |
| **类型** | `string[]` （字符串数组） |
| **必填** | ❌ 否（不填或传空数组表示不筛选） |
| **逻辑** | OR（数组内满足任意一个即可） |

## 🎯 获取可选值

### 方式：标签接口（动态）

调用 `query-resume-tags` 接口获取：

```javascript
POST /resume/campus/api/v1/resume/tag/queryTags?_t=<timestamp>

Body:
["label_campus_resume_Competition"]
```

**返回示例**：
```json
{
  "status": 0,
  "data": {
    "label_campus_resume_Competition": [
      {"labelValueCode": "蓝桥杯大赛", "labelValueName": "蓝桥杯大赛"},
      {"labelValueCode": "腾讯广告算法大赛", "labelValueName": "腾讯广告算法大赛"},
      {"labelValueCode": "美国大学生数学建模竞赛", "labelValueName": "美国大学生数学建模竞赛"},
      {"labelValueCode": "ICPC国际大学生程序设计竞赛", "labelValueName": "ICPC国际大学生程序设计竞赛"},
      // ... 共32种竞赛
    ]
  }
}
```

### 使用哪个字段？

使用 `labelValueCode` 字段作为参数值（通常与 `labelValueName` 相同）。

## 📝 常见竞赛列表（32种）

### 编程类竞赛
- `"ICPC国际大学生程序设计竞赛"`
- `"中国大学生程序设计竞赛（ACMCCPC）"`
- `"蓝桥杯大赛"`
- `"全国青少年信息学奥林匹克竞赛（NOI）"`
- `"CCF大学生计算机系统与程序设计竞赛（CCSP）"`
- `"TopCoder"`
- `"Facebook Hacker Cup"`

### 算法类竞赛
- `"腾讯广告算法大赛"`
- `"天池算法大赛"`
- `"KAGGLE"`
- `"KDDCUP"`

### 数学类竞赛
- `"美国大学生数学建模竞赛"`
- `"全国大学生数学建模竞赛"`
- `"全国大学生数学竞赛"`
- `"国际数学奥林匹克竞赛IMO"`

### 机器人竞赛
- `"全国大学生机器人大赛-RoboCon"`
- `"全国大学生机器人大赛-RoboMaster"`
- `"全国大学生机器人大赛-RoboTac"`
- `"机器人世界杯（RoboCup）"`

### 信息安全类
- `"中国大学生信息安全竞赛"`
- `"全国大学生信息安全竞赛"`
- `"DEFCONCTF"`

### 创新创业类
- `"挑战杯"`
- `"挑战杯中国大学生创业计划竞赛"`
- `"挑战杯全国大学生课外学术科技作品竞赛"`
- `"互联网+大学生创新创业大赛"`

### 其他类
- `"全国大学生电子设计竞赛"`
- `"中国大学生计算机设计大赛"`
- `"中国软件杯大学生软件设计竞赛"`
- `"国际化学奥林匹克竞赛IChO"`
- `"国际物理奥林匹克竞赛IPhO"`
- `"国际信息学奥林匹克竞赛IOI"`

## 💡 使用示例

### 示例1：筛选ICPC获奖者

```javascript
{
  award: ["ICPC国际大学生程序设计竞赛"]
}
```

### 示例2：筛选算法类竞赛获奖者

```javascript
{
  award: [
    "ICPC国际大学生程序设计竞赛",
    "中国大学生程序设计竞赛（ACMCCPC）",
    "腾讯广告算法大赛",
    "KAGGLE",
    "KDDCUP"
  ]
}
```

**效果**：筛选出获得过上述**任意一个**竞赛奖项的候选人

### 示例3：不筛选竞赛

```javascript
{
  award: []  // 空数组
}
```

## ⚠️ 注意事项

1. **精确匹配**：竞赛名称必须与 `labelValueCode` 完全一致
2. **区分大小写**：严格区分大小写
3. **OR 逻辑**：数组内多个竞赛是 OR 关系（获得过任意一个即可）
4. **AND 逻辑**：与其他筛选条件（如学校、专业）是 AND 关系
5. **完整名称**：必须使用完整名称（如 `"ICPC国际大学生程序设计竞赛"`，不能简写为 `"ICPC"`）

## 🔗 在搜索接口中使用

```javascript
POST /resume/campus/api/v1/resume/search

{
  page: 1,
  limit: 20,
  searchId: "search-xxx",
  searchStrategy: {"version": "V3", "strategy": "strategy-V3"},
  award: ["ICPC国际大学生程序设计竞赛", "蓝桥杯大赛"],  // ⭐ 竞赛获奖参数
  graduate_time_begin: "2027-01-01",
  graduate_time_end: "2027-12-31",
  // ... 其他参数
}
```

## 📖 相关接口文档

- [`query-resume-tags`](../interfaces/query-resume-tags.md) - 查询简历标签接口
