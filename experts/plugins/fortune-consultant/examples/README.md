# HTML 可视化样例库

本目录收录 `fortune-consultant` agent 输出 HTML 可视化命盘时的**参考样本**与**配色规范实例**。每个流派配色独立、视觉语言不同，agent 生成新 HTML 时应参考对应样本的风格 token（CSS 变量、字体、网格结构）。

## 流派 → 样例对照

| Skill / 流派 | 文件 | 配色调性 | 关键视觉元素 |
|:---|:---|:---|:---|
| 子平八字 (cantian-bazi) | `bazi-example.html` | 黑底 + 金色（#d4af6e） | 四柱表 / 五行统计 / 流年Tab / Timeline |
| 紫微斗数 (ziwei-doushu) | `ziwei-doushu-example.html` | 深蓝紫 + 银河（#0a0e2a / #a890ff） | 12 宫格 / 命身大限流年内联徽章 / 三方四正 / 四化 |
| 六爻 (fortune-master · liuyao) | `liuyao-example.html` | 墨黑 + 朱砂（#15110c / #b8341e） | 阴阳爻线 / 本卦↔变卦 / 动爻标记 / 六亲世应 |
| 玄空飞星·风水 (fortune-master · feixing) | `fengshui-feixing-example.html` | 墨绿 + 古铜（#0f1a1a / #e0b555 / #6dcbbf） | 九宫盘 / 山星/向星/年星三层 / 流月表 |
| 铁板神数（演绎） | `tieban-style-reference.html` | 米黄古籍 + 朱印（#fbf4dc / #a83018） | 编号条文 / 三限 / 朱印批注 |
| 奇门遁甲（演绎） | `qimen-style-reference.html` | 暗金 + 青绿（#0a1410 / #c8a64a / #6db088） | 九宫罗盘 / 九星八门八神三奇六仪 / 方位吉凶 |
| 河洛理数（演绎） | `heluo-style-reference.html` | 素纸水墨 + 太极（#f3eee2 / #1a1a1a） | 先后天数 / 体用卦 / 邵子心法 |
| 多流派导航 | `schools-index.html` | 深色 + 多彩渐变卡片 | 流派入口卡片 |
| 六爻样式参考 | `liuyao-style-reference.html` | 同上 | 同上 |

## 通用要素（所有 HTML 输出必备）

1. **顶部**：流派名 + 副标题（英文体系名）+ meta（生辰/起卦时间/性别等）
2. **主体**：核心盘面（表/格/卦象）
3. **解读卡片**：分维度说明（事业/感情/财运/健康等）
4. **三句话总结**：金色高亮的核心结论卡
5. **底部免责声明**：浅红虚线框，说明"AI 生成 · 仅供参考"

## 排版规范

- 字体：`PingFang SC / Hiragino Sans GB / STKaiti / KaiTi`（中式衬线为佳）
- 行高：`1.7-1.9`
- 中文字符间距：`letter-spacing` 4-12px（标题大、正文小）
- 移动端响应式：`@media (max-width: 720px)` 必备，宫格降为 2 列
- 角标/徽章：用 flex+gap 内联跟在标题旁，**避免使用绝对定位的浮层标签**（曾发生过覆盖文字的事故）

## Agent 何时生成 HTML

参见 `../agents/fortune-consultant.md` 的 "📤 输出形态 · 主动可视化策略" 章节。
