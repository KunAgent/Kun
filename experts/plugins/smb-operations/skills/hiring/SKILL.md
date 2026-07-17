---
name: hiring
description: >-
  Job posting creation: generate JDs, interview questions, and offer letter templates. Triggers on: job posting, JD, write job description, interview questions, offer letter, hiring.
---

# Hiring

## Purpose

Generate complete hiring packages: job descriptions, interview question sets, and offer letter templates — all tailored to the role, level, and company culture.

## Workflow

1. **Collect role info**
   - Title, level (junior / mid / senior / lead), department
   - Compensation range and benefits highlights
   - Culture cues: values, work style, team size, remote policy
   - Must-have vs nice-to-have qualifications

2. **Generate JD**
   - Company intro (1-2 sentences, culture-forward)
   - Role summary
   - Key responsibilities (5-8 bullet points)
   - Requirements: must-have and nice-to-have separated
   - Growth path: what this role leads to
   - How to apply section

3. **Produce interview questions** (8-12 total)
   - Role-specific (3-4): test domain knowledge and problem-solving
   - Behavioral (3-4): past experiences mapped to role challenges
   - Culture-fit (2-4): values alignment, work-style compatibility
   - Each question includes what to look for in the answer

4. **Draft offer letter template**
   - 标准要素：岗位、入职日期、薪酬结构（月薪 × 13/14 薪 / 年终奖、绩效奖金、补贴）
   - **必备合同条款**（按《劳动合同法》强制要求）：
     - 试用期上限（合同 1 年内不超 1 月、1-3 年不超 2 月、3 年以上或无固定期限不超 6 月）
     - 社会保险（养老/医疗/失业/工伤/生育）和住房公积金缴纳基数与缴纳地
     - 工时制度（标准工时 / 综合计算工时 / 不定时工时，后两类需当地人社局审批）
     - 加班费规则（工作日 1.5 倍、休息日 2 倍、法定节假日 3 倍）
     - 保密义务、竞业限制（如适用，明确补偿金，按当地标准一般为离职前 12 个月平均工资的 30%-50%）
     - 知识产权归属（职务作品 / 发明）
   - 应届毕业生补充：三方协议（普通高等学校毕业生就业协议书）签署节奏
   - 解除条件按《劳动合同法》第 39-41 条
   - 签字栏（offer 一般 7-15 天有效期）
   - 谈判备注（薪资 band、社保基数、年假、远程政策等哪些可谈、哪些不可谈）

5. **Deliver**
   - Output all deliverables or only the requested ones
   - 标出需要客户自行替换的内容（公司具体福利、社保缴纳城市、工资 band 等）

## Output Format

```
## Job Description: [Title]

### About Us
[Company intro]

### Role Summary
[1-2 sentence overview]

### Key Responsibilities
- ...

### Requirements
**Must-have:**
- ...

**Nice-to-have:**
- ...

### Growth Path
[Where this role leads]

---

## Interview Questions

### Role-Specific
1. [Question]
   - What to look for: ...

### Behavioral
1. [Question]
   - What to look for: ...

### Culture-Fit
1. [Question]
   - What to look for: ...

---

## Offer Letter Template
[Standard offer letter structure with placeholders]
```

## Notes

- If the user only asks for a JD, don't generate interview questions or offer letters unless asked
- Always flag sections that need customization (company-specific benefits, legal terms)
- Keep JD length under 400 words unless the user requests detail
