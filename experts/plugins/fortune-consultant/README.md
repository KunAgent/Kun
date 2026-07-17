# Fortune Consultant · 玄学顾问

贯通中西命理体系的玄学顾问 agent——八字、紫微、梅花、塔罗、农历黄历，以及奇门/六爻/风水/择吉的综合兜底。一个 wrapper agent + 6 个独立 skill。

## 包含的 skills

| Skill | 覆盖 | 来源 | 实现 |
|-------|------|------|------|
| `cantian-bazi` | 八字四柱排盘、大运/流年/流月/流日/流时区间查询、真太阳时校正、黄历干支 | 第三方开源 | TypeScript（Node ≥ 18） |
| `ziwei-doushu` | 紫微斗数（北京标准排盘）、十二宫、四化、大限/流年触发 | 第三方开源 | Python |
| `meihua-yijing` | 梅花易数（时间/数字/方位起卦）、体用生克、本卦/互卦/变卦 | 第三方开源 | Python |
| `tarot-reading` | 塔罗（韦特-史密斯系统正逆位、单张/三牌/凯尔特十字/关系牌阵） | 第三方开源 (eamanc-lab/fortune-telling-skills) | 纯模型推理 + 牌义 references |
| `lunar-calendar` | 农历/公历互转、24 节气精确交节、黄历宜忌、闰月处理 | 第三方开源 | Python |
| `fortune-master` | 综合体系兜底：奇门遁甲、六爻、九宫飞星、风水、择吉、合婚、HTML 报告、用户档案、综合菜单（融合八字/紫微/塔罗/星盘/数字命理/道家玄学等多体系框架） | 第三方开源 (原 university-applications) | Node + Python，含 19 个 references framework |

## 路由

由 `agents/fortune-consultant.md` 这个 wrapper agent 负责：
- 用户明确指体系 → 直接路由到对应 skill
- 综合性问法 → fortune-master 主导 + 多体系交叉
- 不确定 → 出菜单或先问出生信息

详细路由规则、资料完整度分级（S/A/B/C）、权重矩阵见 agent prompt。

## 运行依赖

启用本 plugin 后，需要装：

```bash
# Node.js skills
cd skills/cantian-bazi && npm install
cd skills/fortune-master && npm install   # iztro + lunar-typescript

# Python（系统已有 python3 即可，无第三方依赖）
```

部分 skill 用纯计算脚本，无外部网络调用。`fortune-master` 下的 `liuyao/index.html` 是浏览器端交互界面，**默认离线**；如用户主动接入 LLM 解卦，需自填 API Key（仅存浏览器 localStorage）。

## 推送功能已禁用

原 `university-applications` 包含基于 OpenClaw cron 的每日运程推送功能（`daily-push.js` / `push-toggle.js`）。CodeBuddy 不依赖 OpenClaw runtime，且本项目专家不应自动启动定时任务，因此这两个脚本及相关 SKILL.md 章节已删除。

`daily-fortune.js`（按需查询当日运势）、`profile.js`（用户档案管理）、`preference-tracker.js`（本地偏好学习）保留，由 agent 按需调用。

## 来源声明

| Skill | 原始仓库 / 作者 |
|-------|---------------|
| fortune-master | 原 ClawHub `university-applications` skill（功能为命理大师，slug 与功能脱钩，已重命名） |
| cantian-bazi | ClawHub `cantian-bazi` |
| ziwei-doushu | ClawHub `ziwei-doushu` |
| meihua-yijing | ClawHub `meihua-yijing` |
| tarot-reading | `eamanc-lab/fortune-telling-skills` (MIT) |
| lunar-calendar | ClawHub `lunar-calendar` |

## 免责声明

本专家提供的所有命理解读、卦象推算、运势分析均为传统玄学体系的象征性参考，由 AI 基于公开方法论生成。不构成医疗、法律、财务或投资建议；命理是参考，不是定数。涉及健康、法律、重大财务决策请咨询相应专业人士。
