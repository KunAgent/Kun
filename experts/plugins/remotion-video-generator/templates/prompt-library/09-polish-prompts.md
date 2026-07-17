# 抛光 / 迭代提示词 (Polish Prompts)

> 来源：社区经验提炼 — 把"能看"变成"很高级"的第二轮指令
> 用途：在初版视频生成后，用这些提示词做 1-3 轮迭代提升质感
> 关键原则：从简单开始、逐步加元素（Reddit 最佳实践）

---

## 使用方法

1. 先用类型提示词生成初版视频
2. 预览初版，识别需要提升的方面
3. 从下方选择合适的抛光提示词
4. 每次只用 1-2 个抛光提示词（不要一次全上）
5. 预览 → 满意后渲染

---

## 🎨 抛光 1：统一视觉系统

```text
请做一次视觉统一：
- 选一个主字体 + 备用字体（全片只用这两套）
- 设定 1 个主色 + 1 个强调色（其余用灰阶）
- 所有间距按 8px grid 对齐
- 把这些做成 constants 并全片引用
- 检查所有文字对比度 ≥ 4.5:1

具体检查项：
1. 所有 heading 使用同一字体和 weight
2. 所有 body 使用同一字体和 weight
3. 颜色不超过 4 种（主色、强调色、背景、文字）
4. 所有 padding/margin 是 8 的倍数
5. 所有圆角半径统一（8/12/16px 中选一套）
```

---

## 🔄 抛光 2：转场高级感

```text
把所有硬切换改成平滑转场：
- 场景之间使用 crossfade + subtle blur + 轻微位移
- 避免画面跳动（不要一帧突然变化）
- 如果元素位置变化，使用淡出再淡入，保证不抖动
- 转场时长控制在 15-25 帧（0.5-0.8s）

具体实现：
1. 每个 scene 最后 15 帧渐出（opacity 1→0）
2. 下个 scene 前 15 帧渐入（opacity 0→1）
3. 转场期间叠加轻微 blur（0→3→0 px）
4. 如有必要，用 Remotion 的 <TransitionSeries> 替代手动管理
```

---

## ✨ 抛光 3：动效自然化

```text
把所有动画变得更自然：
1. 线性动画尽量换成 spring（弹性要很轻，damping 高一些）
2. interpolate 全部加 clamp
3. 每个 scene 给一个极弱的背景慢动（但不干扰阅读）：
   - 渐变角度缓慢旋转（frame * 0.05 度/帧）
   - 或噪点纹理缓慢漂移
   - 或极弱的 scale 呼吸（1.0 → 1.005 → 1.0，周期 120 帧）
4. 文字入场不要全部同时出现，加 stagger（间隔 10-20 帧）
5. 退场比入场快 30%（入 20 帧，出 14 帧）
```

---

## 📐 抛光 4：排版精修

```text
请检查并优化排版：
1. 所有文字在安全区内（距边缘 80px 以上）
2. 标题和内容之间有足够间距（40-60px）
3. 列表项间距一致
4. 文字对齐方式统一（不要同一页面混用左对齐和居中）
5. 长文本行宽不超过 60 字符（英文）或 30 字符（中文）
6. 字号层级清晰：
   - Hero: 72px+
   - H1: 48-60px
   - H2: 36-48px
   - Body: 24-32px
   - Caption: 16-20px
```

---

## 🎬 抛光 5：节奏感调整

```text
请优化视频节奏：
1. 检查每个场景的阅读时间是否充足（每行文字至少 2 秒）
2. 关键信息出现后加 hold（保持 30-60 帧不变化）
3. 不要所有场景等长 — 重要内容给更多时间
4. 片头 hook 要快（2-3 秒内必须出现核心信息）
5. 片尾 CTA 至少保持 3 秒
6. 场景之间有"呼吸"（短暂的静止或极弱动效）

节奏模板：
- 快-慢-快 节奏（hook 快 → 内容稳 → CTA 快）
- 每 8-10 秒有一个视觉变化点（避免视觉疲劳）
```

---

## 🌈 抛光 6：色彩精修

```text
请优化配色方案：
1. 检查色彩对比度（WCAG AA 标准）：
   - 普通文字：4.5:1
   - 大文字：3:1
   - 图形元素：3:1
2. 背景色不要纯黑 #000000（用 #0A0A0A 或 #0F172A）
3. 文字色不要纯白 #FFFFFF（用 #F8FAFC 或 #F1F5F9）
4. 强调色不要饱和度过高（降 10-20%）
5. 同一场景不超过 3 种颜色
6. 深色模式下减少纯色块，增加渐变和阴影层次
```

---

## 🔤 抛光 7：字体优化

```text
请优化字体使用：
1. 使用 @remotion/google-fonts 加载字体（不要依赖系统字体）
2. 标题用 weight 700-800（不要用 400 做标题）
3. 正文用 weight 400-500
4. 数字用 tabular-nums（等宽数字，避免数字跳动）
5. 英文：Inter / Poppins / Montserrat（选一个）
6. 中文：Noto Sans SC / 思源黑体
7. 代码：JetBrains Mono / Fira Code
8. 确保所有 font-family 有 fallback

加载示例：
import { loadFont } from "@remotion/google-fonts/Inter";
const { fontFamily } = loadFont();
```

---

## 🖼 抛光 8：阴影和层次

```text
给画面增加层次感：
1. 卡片/面板加 box-shadow：
   - 浅色背景：0 4px 12px rgba(0,0,0,0.1)
   - 深色背景：0 8px 24px rgba(0,0,0,0.4)
2. 文字在图片上时加半透明底板或 text-shadow
3. 前景元素比背景略大一点的阴影（营造纵深）
4. 避免阴影过重（模糊半径大于颜色深度）
5. 可选：极弱的玻璃拟态效果（backdrop-filter: blur(10px)）
```

---

## ⚡ 抛光 9：性能优化

```text
请优化渲染性能：
1. 检查是否有不必要的重复计算
2. spring() 配置缓存为常量（不要在 render 中创建）
3. 图片使用 <Img> 组件（支持预加载）
4. 避免在 render 函数中做字符串拼接或数组操作
5. 复杂计算用 useMemo
6. 大图片压缩到合理大小（1920x1080 JPEG < 500KB）
7. 视频图片格式使用 jpeg（比 png 快）
```

---

## 🎵 抛光 10：音频整合（可选）

```text
如果需要添加音频：
1. 背景音乐：
   - 使用 <Audio src={staticFile("music.mp3")} volume={0.3} />
   - 音量不超过 0.3（不要盖过画面）
   - 片尾 2 秒渐出（volume interpolate 到 0）
2. 音效：
   - 场景切换时轻微 whoosh
   - 关键数字出现时 pop
   - 不要每个动画都加音效（克制使用）
3. 音频时长必须 ≥ 视频时长
```

---

## 迭代策略

### 推荐迭代顺序（由内到外）

1. **第一轮：结构** — 确保内容正确、时间线合理（抛光 5）
2. **第二轮：视觉** — 统一设计系统（抛光 1 + 6 + 7）
3. **第三轮：动效** — 让画面活起来（抛光 2 + 3）
4. **第四轮：细节** — 排版和层次（抛光 4 + 8）
5. **第五轮：性能** — 优化渲染（抛光 9）

### 常见问题 → 对应抛光

| 问题 | 使用抛光 |
|------|---------|
| 看起来很"AI生成" | 抛光 1 + 3 + 6 |
| 转场生硬 | 抛光 2 |
| 文字看不清 | 抛光 6 + 8 |
| 画面单调 | 抛光 3 + 8 |
| 节奏怪异 | 抛光 5 |
| 排版凌乱 | 抛光 4 + 7 |
| 渲染太慢 | 抛光 9 |

---

## 反模式清单（避免这些！）

> 来源：remotion-dev/template-prompt-to-motion-graphics 的反模式文档

### 文字动画反模式

❌ **逐字符 opacity 做打字机效果** — 会导致布局跳动
✅ 用 string.slice(0, n) 截取字符串

❌ **光标闪烁用 Math.round(Math.sin())** — 太突兀
✅ 用 interpolate 做平滑的 0→1→0 过渡

❌ **词轮播不设固定宽度** — 布局会来回抖动
✅ 用 measureText 获取最长词的宽度，设为固定容器宽度

### 转场反模式

❌ **突然切换场景（无过渡）** — 画面跳动
✅ 总是使用 crossfade（至少 15 帧过渡）

❌ **过渡时间太长（>45帧）** — 节奏拖沓
✅ 控制在 15-25 帧

### 动画反模式

❌ **使用 CSS transition/animation** — Remotion 不支持
✅ 用 useCurrentFrame() + interpolate/spring

❌ **线性动画做所有效果** — 机械感强
✅ 关键动作用 spring()，只在需要匀速时用线性

❌ **interpolate 不加 clamp** — 值可能超出范围
✅ 始终加 extrapolateLeft/Right: 'clamp'

### 资源反模式

❌ **使用 HTML <img> 标签** — 不支持预加载
✅ 用 Remotion 的 <Img> 组件

❌ **硬编码资源路径** — 不可移植
✅ 用 staticFile("assets/image.png")

---

## 参考资源

- [Reddit: Complete Guide to Setup Remotion Agent Skills](https://www.reddit.com/r/MotionDesign/comments/1qkqxwm/) — 迭代增量工作流
- [remotion-dev/template-prompt-to-motion-graphics](https://github.com/remotion-dev/template-prompt-to-motion-graphics) — 反模式文档
- [digitalsamba/claude-code-video-toolkit](https://github.com/digitalsamba/claude-code-video-toolkit) — 品牌系统
- [Remotion Typography Skill](https://github.com/remotion-dev/template-prompt-to-motion-graphics) — 文字动画最佳实践
