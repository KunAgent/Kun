# 简历状态标签筛选条件 🏷️

快速筛选特定状态的简历（完整简历、可锁定、可发起面试、伯乐推荐等）。

## 📋 参数信息

这些参数是**独立的布尔值**，不是数组：

| 参数名 | 类型 | 必填 | 默认值 | 说明 |
|--------|------|------|--------|------|
| `is_full` | `number` | ❌ 否 | `0` | 是否仅查看完整简历 |
| `is_mine` | `number` | ❌ 否 | `0` | 是否仅查看我的简历（我锁定的） |
| `startInterviewEnable` | `number` | ❌ 否 | `0` | 是否仅查看可发起面试的简历 |
| `is_bole` | `number` | ❌ 否 | `0` | 是否仅查看伯乐推荐的简历 |

## 🎯 可选值

每个参数都是布尔值（用数字表示）：

| 值 | 含义 |
|----|------|
| `0` | 不筛选（默认） |
| `1` | 启用该筛选条件 |

## 📝 参数详解

### 1. is_full - 仅查看完整简历

**作用**：筛选信息填写完整的简历。

**完整简历的定义**：
- 基本信息齐全（姓名、手机号、学校、专业、学历等）
- 教育经历完整
- 可能包含项目经历、实习经历等

**使用场景**：
- 需要详细了解候选人背景
- 准备发起面试，需要完整信息

```javascript
{
  is_full: 1  // ✅ 只显示完整简历
}
```

---

### 2. is_mine - 仅查看我的简历

**作用**：筛选当前用户锁定的简历。

**"我的简历"定义**：
- 当前登录用户已锁定的简历
- 通常是面试官准备面试的候选人

**使用场景**：
- 查看我负责的候选人
- 跟踪我锁定的简历进度

```javascript
{
  is_mine: 1  // ✅ 只显示我锁定的简历
}
```

---

### 3. startInterviewEnable - 仅查看可发起面试的简历

**作用**：筛选可以直接发起面试的简历。

**可发起面试的条件**：
- 简历状态允许发起面试
- 候选人未在其他面试流程中
- 简历信息完整

**使用场景**：
- 快速找到可面试的候选人
- 批量发起面试

```javascript
{
  startInterviewEnable: 1  // ✅ 只显示可发起面试的简历
}
```

---

### 4. is_bole - 仅查看伯乐推荐的简历

**作用**：筛选通过伯乐推荐渠道的简历。

**伯乐推荐定义**：
- 内部员工推荐的候选人
- 通过伯乐系统提交的简历
- 通常质量较高，优先处理

**使用场景**：
- 查看内推候选人
- 优先处理推荐简历

```javascript
{
  is_bole: 1  // ✅ 只显示伯乐推荐的简历
}
```

## ⚠️ 重要：互斥关系

**🔴 关键发现：这些标签存在互斥关系！**

根据实际测试，当同时选择多个标签时，系统会自动取消某些冲突的选项。

### 已知的互斥规则：

| 场景 | 互斥说明 |
|------|---------|
| `is_mine=1` + `startInterviewEnable=1` | ⚠️ 可能冲突："我的简历"可能已锁定，无法再次发起面试 |
| `is_bole=1` + `is_mine=1` | ⚠️ 可能冲突：伯乐推荐的简历可能不是"我的" |

**📌 建议使用方式：每次仅勾选一项**

为避免冲突，建议按以下方式使用：

```javascript
// ✅ 方式1：只查看完整简历
{
  is_full: 1,
  is_mine: 0,
  startInterviewEnable: 0,
  is_bole: 0
}

// ✅ 方式2：只查看可发起面试的
{
  is_full: 0,
  is_mine: 0,
  startInterviewEnable: 1,
  is_bole: 0
}

// ✅ 方式3：只查看伯乐推荐的
{
  is_full: 0,
  is_mine: 0,
  startInterviewEnable: 0,
  is_bole: 1
}

// ✅ 方式4：只查看我的简历
{
  is_full: 0,
  is_mine: 1,
  startInterviewEnable: 0,
  is_bole: 0
}
```

## 💡 使用示例

### 示例1：查看所有完整简历（最常用）

```javascript
{
  page: 1,
  limit: 20,
  searchId: "search-xxx",
  searchStrategy: {"version": "V3", "strategy": "strategy-V3"},
  is_full: 1,              // ⭐ 只看完整简历
  is_mine: 0,
  startInterviewEnable: 0,
  is_bole: 0,
  graduate_time_begin: "2027-01-01",
  graduate_time_end: "2027-12-31"
}
```

### 示例2：查看可发起面试的简历

```javascript
{
  page: 1,
  limit: 20,
  searchId: "search-xxx",
  searchStrategy: {"version": "V3", "strategy": "strategy-V3"},
  is_full: 0,
  is_mine: 0,
  startInterviewEnable: 1,  // ⭐ 只看可发起面试的
  is_bole: 0,
  graduate_time_begin: "2027-01-01",
  graduate_time_end: "2027-12-31"
}
```

### 示例3：查看伯乐推荐的简历

```javascript
{
  page: 1,
  limit: 20,
  searchId: "search-xxx",
  searchStrategy: {"version": "V3", "strategy": "strategy-V3"},
  is_full: 0,
  is_mine: 0,
  startInterviewEnable: 0,
  is_bole: 1,              // ⭐ 只看伯乐推荐
  graduate_time_begin: "2027-01-01",
  graduate_time_end: "2027-12-31"
}
```

### 示例4：查看我的简历

```javascript
{
  page: 1,
  limit: 20,
  searchId: "search-xxx",
  searchStrategy: {"version": "V3", "strategy": "strategy-V3"},
  is_full: 0,
  is_mine: 1,              // ⭐ 只看我锁定的
  startInterviewEnable: 0,
  is_bole: 0,
  graduate_time_begin: "2027-01-01",
  graduate_time_end: "2027-12-31"
}
```

### 示例5：不使用任何状态标签（默认）

```javascript
{
  page: 1,
  limit: 20,
  searchId: "search-xxx",
  searchStrategy: {"version": "V3", "strategy": "strategy-V3"},
  is_full: 0,              // 全部设为 0
  is_mine: 0,
  startInterviewEnable: 0,
  is_bole: 0,
  graduate_time_begin: "2027-01-01",
  graduate_time_end: "2027-12-31"
}
```

**效果**：显示所有简历，不做状态筛选

## ⚠️ 注意事项

1. **参数类型**：必须使用数字 `0` 或 `1`，不能用布尔值 `true`/`false`
2. **默认值**：不传或传 `0` 表示不筛选
3. **互斥关系**：同时启用多个标签可能导致冲突，建议每次仅启用一个
4. **AND 逻辑**：这些标签与其他筛选条件（如院校等级、成绩排名）是 AND 关系
5. **优先级**：状态标签筛选优先于其他条件，会先过滤符合状态的简历

## 🤔 常见问题

### Q1: 为什么同时选择多个标签时，有些选项会自动取消？

A: 这些标签存在业务上的互斥关系。例如：
- "我的简历"通常已经锁定，不能再选"可发起面试"
- "伯乐推荐"的简历可能不是"我的"

**建议**：每次仅选择一个标签，避免冲突。

### Q2: "完整简历"的标准是什么？

A: 系统定义的完整简历通常包括：
- 基本信息完整（姓名、联系方式、学校、专业、学历）
- 教育经历完整
- 可能还需要填写项目经历或实习经历

具体标准由招聘系统定义。

### Q3: "可发起面试"和"可锁定"有什么区别？

A: 
- **可锁定**：简历可以被面试官锁定（占为己有）
- **可发起面试**：简历不仅可以锁定，还可以直接发起面试流程

通常"可发起面试"是"可锁定"的子集。

### Q4: 如果我既想看完整简历，又想看伯乐推荐，怎么办？

A: 由于存在互斥关系，建议分两次查询：
1. 第一次：`is_full=1`，查看所有完整简历
2. 第二次：`is_bole=1`，查看所有伯乐推荐

然后手动合并结果。

### Q5: 这些标签和 `flow_status`（流程状态）有什么区别？

A: 
- **状态标签**（本文档）：快捷筛选标签，用于快速过滤特定类型的简历
- **流程状态**（`flow_status`）：候选人在招聘流程中的具体阶段（待筛选、初试、复试等）

两者可以同时使用，是 AND 关系。

## 🔗 在搜索接口中使用

完整的搜索请求示例（包含状态标签）：

```javascript
POST /resume/campus/api/v1/resume/search

{
  page: 1,
  limit: 20,
  searchId: "search-xxx",
  searchStrategy: {"version": "V3", "strategy": "strategy-V3"},
  
  // ⭐ 状态标签（建议每次仅启用一个）
  is_full: 1,              // 仅查看完整简历
  is_mine: 0,              // 不限制"我的"
  startInterviewEnable: 0, // 不限制"可发起面试"
  is_bole: 0,              // 不限制"伯乐推荐"
  
  // 其他筛选条件
  graduate_time_begin: "2027-01-01",
  graduate_time_end: "2027-12-31",
  schoolLevel: ["985"],
  schoolRank: ["前5%", "前10%"],
  flow_status: [0, 1],
  // ... 其他参数
}
```

## 📖 相关文档

- [流程状态筛选](flow-status.md) - 候选人在招聘流程中的具体阶段
- [简历筛选手册](../guides/resume-filtering-manual.md) - 返回筛选导航
