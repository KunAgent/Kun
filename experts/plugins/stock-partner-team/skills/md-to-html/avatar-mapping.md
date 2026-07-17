# 头像映射表（唯一权威）

圆桌报告里出现的**中文头衔**，HTML body 里必须用对应的 `<img src="avatars/<kebab-case>.png">`。`embed_avatars.py` 会按下表把这些相对路径替换成 base64。

| 头衔（圆桌报告正文中出现） | HTML 中的 src | 文件实际位置 |
|---|---|---|
| 产业策略师 | `avatars/industry-strategist.png` | 插件根目录下 `avatars/industry-strategist.png` |
| 信号派首席 | `avatars/signal-chief.png` | 插件根目录下 `avatars/signal-chief.png` |
| 估值分析师 | `avatars/valuation-analyst.png` | 插件根目录下 `avatars/valuation-analyst.png` |
| 逆向投资人 | `avatars/contrarian-investor.png` | 插件根目录下 `avatars/contrarian-investor.png` |
| 财报研究员 | `avatars/fundamental-researcher.png` | 插件根目录下 `avatars/fundamental-researcher.png` |
| 短线冲浪手 | `avatars/shortterm-surfer.png` | 插件根目录下 `avatars/shortterm-surfer.png` |
| 投研主编 | `avatars/stock-partner-lead.png` | 插件根目录下 `avatars/stock-partner-lead.png` |
| 团队合影（可选，仅 hero 用） | `avatars/team.png` | 插件根目录下 `avatars/team.png` |

---

## Emoji 标记（成员识别符）

| 头衔 | 标记 |
|---|---|
| 产业策略师 | 🌊 |
| 信号派首席 | 📡 |
| 估值分析师 | 🧮 |
| 逆向投资人 | 🏔️ |
| 财报研究员 | 🔬 |
| 短线冲浪手 | ⚡ |

放在 voice-card 名字前：`🌊 产业策略师 · 星望远`。

---

## 注意

1. **只有本次上场的成员**才放进 voice-cards；没上场的成员**不要**为了凑数加进去
2. **头衔 = 名字位**：voice-card 的名字必须用中文**头衔**（"产业策略师"），花名（"星望远"）只跟在头衔后面，不单独出现
3. v2 报告**不需要 stance 色标徽章**（已废）——立场只在 Module 1 的 `cc-vote` 里以聚合数字呈现
