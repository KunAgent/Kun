# 花叔数据分析专家团 · huashu-data-pro

> WorkBuddy Expert · Team 型专家
> 行业分类：04-DataAI（数据智能）

## 一句话

为「一人公司 / 超级个体」打造的本地数据分析专家团：给一份 Excel，三个专家并行分析（趋势 / 结构 / 异常），8 分钟内交付三种格式报告（网页 / Excel / PPT），敏感数据全程不出本地。

## 团队组成

| 成员 | 职责 |
|---|---|
| 主理人 | 接收任务、分派、合成、三格式渲染 |
| 趋势分析师 | 时间序列、拐点、季节性 |
| 结构分析师 | 多表交叉、占比、因子排名 |
| 异常侦察员 | 离群点扫描、风险分级 |

## 文件结构

```
huashu-data-pro/
├── .workbuddy-plugin/
│   └── plugin.json
├── settings.json
├── agents/
│   ├── huashu-data-pro-team-lead.md
│   ├── trend-analyst.md
│   ├── structure-analyst.md
│   └── anomaly-analyst.md
├── avatars/
│   ├── lead.png
│   ├── trend-analyst.png
│   ├── structure-analyst.png
│   └── anomaly-analyst.png
└── README.md
```

## 关于作者

陈云飞（@花叔 / Alchain），AI Native Coder、独立开发者、AI 自媒体博主。代表作小猫补光灯（App Store 付费榜 Top 1）、《一本书玩转 DeepSeek》。

B站 / X / YouTube / 小红书 / 公众号统一 ID：花叔。全网粉丝 30 万+，产品累计用户超百万。

## 联系方式

- 邮箱：alchaincyf3@gmail.com
- 官网：https://www.huasheng.ai/
- 完整演示视频：https://www.bilibili.com/video/BV159RQB6E4P/

## 与花叔另一个 Expert（huashu-doc-reviewer）的关系

两个专家服务的是「一人公司」工作流的两端：
- **huashu-data-pro**：处理数据类敏感文件（财务表、订单表、薪资表）
- **huashu-doc-reviewer**：处理文档类敏感文件（合同、报告、方案）

各自独立、互不重叠。详见两个专家的 `displayDescription` 和场景分类（DataAI vs SecurityCompliance）。
