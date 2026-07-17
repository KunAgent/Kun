# Topic Evaluator

科技频道选题的量化评估工具——双层级4维评分、全网查重、方向推荐、go/no-go决策，输出结构化报告。

## 类型

Agent 型（单个 AI 专家）

## 功能

- **Step 0 选题预检**：提炼核心论点、分类（科普拆解/判断/事件/趋势/商单）、模糊度门禁
- **Step 1 全网查重**：跨平台（B站/知乎/小红书/YouTube/X等）搜索，输出红海温度计 + 撞车风险矩阵 + 硬源充足度评估
- **Step 2 切入方向建议**：3-5个有差异的切入方向，每个含4维预估分（知识增量/创意/商业价值/时效性），按总分排序
- **Step 3 选题整体评分**：双层级4维量化评分，每分挂证据链，附钩子强度 + 制作可行性辅助判断
- **Step 4 决策与落地**：40分制综合判断（强推→否决），给出标题候选×3、开场钩子、落地三步、风险提示

## 使用示例

- 「帮我评估这个选题：AI编程工具的下半场，Cursor和Windsurf谁更适合工程派」
- 「Apple刚发了新品，要不要做一期深度解读？」
- 「最近一周科技圈最值得做的3个选题是什么？」

## 头像

头像已自动生成在 `avatars/` 目录下。如需替换为自定义头像，要求：
- 格式：PNG（推荐）或 JPG
- 尺寸：512×512 px
- 大小：单张不超过 500KB

## 安装

将专家包目录放到以下路径：

```
~/.workbuddy/plugins/marketplaces/my-experts/plugins/topic-evaluator/
```

然后运行注册命令使其在 WorkBuddy 中可见：

```bash
python3 scripts/register_expert.py ~/.workbuddy/plugins/marketplaces/my-experts/plugins/topic-evaluator/ --session-id &lt;你的会话ID&gt;
```

## 打包分享

```bash
zip -r topic-evaluator.zip topic-evaluator/
```
