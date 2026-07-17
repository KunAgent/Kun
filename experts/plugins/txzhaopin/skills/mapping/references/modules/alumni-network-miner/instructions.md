---
name: alumni-network-miner
description: |
  校友网络 / 前同事 / 教育背景交叉验证反向挖掘器。
  通过已知 A 人（在职）→ 挖 A 的校友 → 过滤其中也在目标公司的人 → 补全名单；
  或已知某离职人员 → 反查其前同事 → 挖目标公司在职人员。
  触发场景：
  - Tier 1-3 挖掘已跑完但覆盖不全，需要反向补齐
  - 已知某离职人员想找其前同事
  - 验证某候选人在某公司的"同期同事"
  - 所有业务线通用
  触发短语：
  "校友反查"、"前同事"、"离职反查"、"alumni network"、"反向挖人"、
  "LSE 校友会"、"清华校友"、"alumni-network-miner"。
description_zh: "校友 / 前同事反向挖掘 — 已知一人挖一群"
description_en: "Alumni Network Miner — reverse mining via school/company networks"
version: "1.0.0"
meta_rules:
  - no-hallucination@1.0.0
---

# 🎓 Alumni Network Miner · 校友 / 前同事反向挖掘

> 📌 本 Skill 遵守 [`rules/no-hallucination.md`](../../rules/no-hallucination.md)
>
> ⚠️ 这是**补盲 Skill** —— 用于其他 Skill 跑完后的"拣漏"

---

## 一、核心价值（反向挖掘）

正向挖掘（linkedin-miner / github-miner / deal-news-miner）从**目标公司**出发，挖出**员工**。
但覆盖率永远不是 100% —— 有些员工 profile 私密 / 不在搜索引擎索引 / 用中文名无法被英文搜到。

**反向挖掘**的逻辑：**已知一个 → 挖一群**。

```
已知：张三在字节推荐算法组（通过 LinkedIn Miner 挖到）
    ↓
挖张三的校友（清华 CS 2015 届）
    ↓
看哪些清华 CS 2015 届的人现在也在字节
    ↓
补全字节推荐算法组名单（+ 5-10 人）
```

**原理**：**人以群分**。相同背景的人倾向在同一公司工作。

---

## 二、核心工作流（4 种挖掘模式）

### 🎯 模式 1：学校校友反向挖

**适用**：Top 学校的毕业生高度聚集在头部公司

**步骤**：

```
1. 找到**一个**已在目标公司的员工的学校信息
   示例：张三 · 清华 CS 2015 届

2. 搜索该学校该届的其他校友
   site:linkedin.com/in "Tsinghua" "2015" "CS"
   site:linkedin.com/in "清华" "计算机" 2015
   + 校友会 / 同学录网站

3. 筛选出"当前也在目标公司"的
   交叉条件：学校 + 届 + 目标公司

4. 每人走 profile 验证（LinkedIn / GitHub）
```

**Top 挖掘源学校**（研发 / 产品 / 投资不同侧重）：

| 业务线 | 高命中学校 |
|-------|----------|
| **研发 / 算法** | 清华 姚班 / 智班，北大 图灵班，中科大 少院，上交 IEEE 试点 / ACM 班，浙大 图灵班，MIT / Stanford / CMU CS |
| **产品** | 清华经管 / 北大光华 / 复旦管院 / 交大安泰 / 中欧 / HBS / Wharton / Kellogg |
| **运营** | 清北复交经管类 / 海归英美 |
| **投资** | 北大 光华 / 清华 五道口 / 复旦 泛海 / 上交 高金 / Wharton / HBS / LSE / Booth |

---

### 🎯 模式 2：前公司同事反向挖

**适用**：目标公司大量人从某几家公司挖来

**步骤**：

```
1. 观察目标公司 Senior 层的前公司分布
   示例：字节推荐算法组 Senior 多来自"阿里妈妈 + 腾讯广告 + 美团到家"

2. 反查这些前公司的"当期同事"
   site:linkedin.com/in "Alibaba" "recommendation" "2015-2019"

3. 其中有一部分已经跳到字节（部分在 LinkedIn 更新，部分没有）

4. 未更新 LinkedIn 的人 → 可能就是"水下候选人"
   通过其他渠道（GitHub / 知乎 / 脉脉）交叉验证
```

**挖掘句式**：
- "在 {前公司} 工作过的人，现在在 {目标公司}"
- "{前公司} alumni 去向 {目标公司}"
- "从 {前公司} 跳到 {目标公司} 的"

---

### 🎯 模式 3：离职者反向挖（已知离职者挖前同事）

**适用**：已知某前员工离职去新公司了，挖他**原来**在目标公司的同事

**步骤**：

```
1. 已知：李四（前字节，现在小红书）

2. 挖李四在字节时期的同事：
   - LinkedIn：查李四的"Connections" 中在字节的
   - 看李四之前 posts 中提到过的人
   - 如果李四写过"离开字节的告别 post" → 文章里会 tag 前同事

3. 这些前同事：
   - 一部分仍在字节（继续挖）
   - 一部分也离职了（Alumni 补充）
```

**金矿场景**：
- "某离职员工写了一篇总结文章，文章里 tag 了 5-10 个前同事"
- "某人在微信朋友圈发离职感谢，列出了 bus driver 们"（需要招聘经理人脉补）

---

### 🎯 模式 4：MBA / 项目班同学反向挖

**适用**：商学院 / 特定项目的班级聚集性极强

**常见高命中班级**：

```
# 商学院
HBS MBA Class of XXXX
Wharton MBA Class of XXXX
中欧 MBA / EMBA 特定届
清华经管 MBA / PMBA

# 特定项目
长江商学院 DBA
北大 HSBC-X MBA
交大 MIT MBA Dual Degree

# 科技项目
Y Combinator Winter/Summer {年份}
字节跳动 Camp / 启明星
腾讯青年训练营
```

**挖掘方式**：

```
site:linkedin.com "Wharton MBA 2020" "{目标公司}"
site:weibo.com 长江 DBA 同学 {目标公司}
# 加入相关校友微信群 → 问群主（非自动化）
```

---

## 三、组合拳示例

挖"腾讯投资"团队：

```
Step 1: 用 linkedin-miner 挖到 10 位
        → 发现 6/10 是北大/清华经管背景

Step 2: 用 alumni-network-miner 反向挖
        → 搜 "北大光华" "腾讯投资"
        → 搜 "清华经管" "腾讯投资"
        → 再补 8-12 位

Step 3: 观察前公司分布
        → 发现 5 位来自"腾讯战投"、3 位来自"君联"
        → 反查君联当期同事 → 补 3-5 位

Step 4: Alumni 离职追踪
        → 发现 2015-2020 有 4 位已离职去 VC
        → 他们仍可能推荐前同事

总覆盖：从 10 人 → 25-30 人（增量 150-200%）
```

---

## 四、输出 Schema

```json
{
  "alumni_mining_result": {
    "seed_person": {
      "name": "张三",
      "company": "字节跳动",
      "shared_attribute": "清华 CS 2015"
    },
    "newly_discovered": [
      {
        "name": "李四",
        "current_company": "字节跳动",
        "shared_with_seed": "同届清华 CS",
        "confidence": "high | medium",
        "discovery_path": "LinkedIn 校友搜索 → 工作经历含字节",
        "sources": ["https://..."]
      }
    ],
    "departed_discovered": [
      {
        "name": "王五",
        "prior_company": "字节跳动（2018-2022）",
        "current_company": "小红书",
        "shared_with_seed": "同届清华 CS",
        "sources": ["..."]
      }
    ],
    "inferred_attributes": {
      "target_company_school_concentration": [
        {"school": "清华 CS", "count": 15, "概率": "高"},
        {"school": "北大 图灵班", "count": 8}
      ],
      "target_company_prior_company_concentration": [
        {"prior": "阿里妈妈", "count": 12},
        {"prior": "腾讯广告", "count": 8}
      ]
    }
  }
}
```

---

## 五、使用限制

### ⚠️ 注意

- **相关不等于因果**：同校不代表认识
- **隐私**：部分 alumni 不愿意暴露母校 → 搜不到
- **校友会质量参差**：部分校友会只有名单没有职业信息
- **重名问题**：中国人口多，张伟 / 王伟 / 李明 重名率高，要看"学校 + 专业 + 届 + 其他"多条件

### ⚠️ 合规

- ✅ 只基于公开 profile 信息
- ❌ 不得加入私密校友微信群并导出名单（侵犯隐私）
- ❌ 不得未经同意将校友信息转发给第三方

---

## 六、与其他 Skill 的协作

| Skill | 关系 |
|-------|-----|
| `mapping-universal` | 上游调度（所有业务线 P2，在主挖掘跑完后触发） |
| `linkedin-public-miner` | 平级 + 互补（用 alumni 发现的人再去 LinkedIn 验证） |
| `github-miner` | 交叉（研发岗校友通常 GitHub 活跃度相关） |
| `wiki-compiler` | 下游（Alumni 挖到的人也入库） |

---

## 七、Changelog

### v1.0.0 · 2026-04-28

- 首版发布
- 4 种挖掘模式（学校 / 前同事 / 离职反挖 / MBA 班级）
- 组合拳实战示例
- 标准输出 Schema
