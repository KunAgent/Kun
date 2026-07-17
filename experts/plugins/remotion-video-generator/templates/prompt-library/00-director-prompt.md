# Remotion 总控提示词 (Director Prompt)

> 来源：社区最佳实践整合（remotion-dev/template-prompt-to-motion-graphics、digitalsamba/claude-code-video-toolkit、Reddit r/MotionDesign）
> 用途：每次视频生成前作为"导演系统提示"注入，确保分镜优先、常量置顶、输出可运行

## 核心理念

1. **分镜优先**：先输出分镜与节奏表，等确认后再生成代码
2. **Constants-First Design**：所有文案、颜色、时间参数集中在文件顶部作为可编辑常量
3. **技能检测注入**：根据视频需求只注入相关技能规则，避免提示词膨胀
4. **迭代增量**：从简单开始、逐步加元素，比一次性要复杂效果更稳定

---

## 总控提示词（每个项目必用）

```text
你是一个 Remotion 动效导演 + 前端工程师。

## 工作流程（严格按顺序执行）

### 第一步：分镜输出
先输出分镜与节奏表（按 scene 列出）：
- 每个 scene 的：内容摘要、时长（秒）、帧范围、转场方式、动效要点、需要的素材
- 全片配色方案（主色 + 强调色 + 背景色）
- 字体选择（主字体 + 备用字体）

### 第二步：确认
等用户确认后再进入代码阶段。如果用户没有明确要求修改，可以直接进入代码阶段。

### 第三步：代码生成
生成可直接运行的 TSX/TS 文件。

## 硬性规格
- 画幅：{width}x{height}（默认 1920x1080）
- fps：{fps}（默认 30）
- 总时长：{duration} 秒

## Constants-First Design（必须遵守）
所有可编辑参数必须集中在文件顶部：
```typescript
// ============ EDITABLE CONSTANTS ============
const BRAND = {
  primaryColor: '#2563EB',
  accentColor: '#F97316',
  backgroundColor: '#0F172A',
  textColor: '#F8FAFC',
};

const TYPOGRAPHY = {
  headingFont: 'Inter',
  bodyFont: 'Inter',
  headingSize: 72,
  bodySize: 28,
};

const CONTENT = {
  title: 'Your Title Here',
  subtitle: 'Your subtitle',
  items: ['Point 1', 'Point 2', 'Point 3'],
};

const TIMING = {
  fps: 30,
  sceneDurations: [150, 300, 240, 180], // frames per scene
};
// ============================================
```

## Remotion 最佳实践（必须遵守）
- 只用 useCurrentFrame() 做动画，禁止 CSS transition/animation
- 用 <Img>/<Video>/<Audio> 组件，不用原生 HTML 标签
- 用 staticFile() 引用 public 目录资源
- 用 spring() 做弹性动画，interpolate() 做线性动画
- interpolate 必须加 extrapolateLeft/Right: 'clamp'
- 用 Sequence/Series 编排时间线
- 每个 Scene 独立成组件文件

## 输出要求
- 只输出可运行的 TSX/TS 文件内容
- 确保能直接预览与渲染
- 代码注释清晰，标注动效逻辑
```

---

## 技能检测映射表

根据视频需求自动判断需要注入哪些技能规则：

| 关键词 | 注入的技能规则 |
|--------|---------------|
| 产品发布、功能公告 | typography, transitions, sequencing |
| 数据榜单、排名动画 | charts, spring-physics, sequencing |
| 地图路线、城市 zoom | 3d, transitions, spring-physics |
| Kinetic typography | typography, spring-physics, social-media |
| App walkthrough、UI演示 | transitions, sequencing, social-media |
| Before/After 对比 | transitions, typography, sequencing |
| 音乐可视化 | charts, spring-physics |
| 教育/教程 | typography, sequencing, charts |

---

## 分镜输出格式（标准化）

```markdown
# 分镜表：{视频标题}

## 全局设定
- 画幅：1920x1080
- fps：30
- 总时长：{X} 秒（{Y} 帧）
- 配色：主色 {hex} / 强调色 {hex} / 背景 {hex}
- 字体：{主字体} / {备用字体}
- 动效风格：{smooth/snappy/bouncy}

## Scene 列表

| # | 名称 | 时长 | 帧范围 | 内容 | 转场 | 动效 | 素材 |
|---|------|------|--------|------|------|------|------|
| 1 | Hook | 4s | 0-120 | "一句话钩子" | fade-in | typewriter + scale | 无 |
| 2 | 卖点 | 8s | 120-360 | 3条核心卖点 | crossfade | stagger slide-in | icon x3 |
| ... | ... | ... | ... | ... | ... | ... | ... |

## 素材清单
- [ ] Logo (PNG, 透明背景)
- [ ] ...
```

---

## 常用动效预设

### Spring 配置预设

```typescript
// 柔和（适合标题、大面积元素）
const SMOOTH = { damping: 100, stiffness: 200 };

// 灵敏（适合按钮、小元素）
const SNAPPY = { damping: 200, stiffness: 400 };

// 弹跳（适合强调、惊喜时刻）
const BOUNCY = { damping: 50, stiffness: 300 };

// 厚重（适合大标题登场）
const HEAVY = { damping: 120, stiffness: 120, mass: 2 };
```

### 通用动效模式

```typescript
// 淡入 + 上移
const fadeSlideUp = (frame: number, start: number) => ({
  opacity: interpolate(frame, [start, start + 20], [0, 1], { extrapolateRight: 'clamp' }),
  transform: `translateY(${interpolate(frame, [start, start + 25], [30, 0], { extrapolateRight: 'clamp' })}px)`,
});

// 逐项交错出现
const stagger = (frame: number, index: number, gap = 15) => ({
  opacity: interpolate(frame, [index * gap, index * gap + 20], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
  transform: `translateX(${interpolate(frame, [index * gap, index * gap + 25], [-40, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}px)`,
});

// Typewriter 效果
const typewriter = (frame: number, text: string, speed = 2) => {
  const charsToShow = Math.min(Math.floor(frame / speed), text.length);
  return text.slice(0, charsToShow);
};
```

---

## 品牌系统（Brand Configuration）

> 参考：digitalsamba/claude-code-video-toolkit 的 brand.json 模式

### 品牌配置文件结构

```typescript
interface BrandConfig {
  name: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    backgroundAlt: string;
    text: string;
    textSecondary: string;
  };
  typography: {
    headingFont: string;
    bodyFont: string;
    headingWeight: number;
    bodyWeight: number;
  };
  spacing: {
    unit: number; // 基准间距 (8px)
    margin: number; // 画面边距
    padding: number; // 元素间距
  };
  animation: {
    style: 'smooth' | 'snappy' | 'bouncy';
    transitionDuration: number; // frames
    staggerGap: number; // frames between items
  };
}

// 默认品牌配置
const DEFAULT_BRAND: BrandConfig = {
  name: 'Default',
  colors: {
    primary: '#2563EB',
    secondary: '#7C3AED',
    accent: '#F97316',
    background: '#0F172A',
    backgroundAlt: '#1E293B',
    text: '#F8FAFC',
    textSecondary: '#94A3B8',
  },
  typography: {
    headingFont: 'Inter',
    bodyFont: 'Inter',
    headingWeight: 700,
    bodyWeight: 400,
  },
  spacing: {
    unit: 8,
    margin: 80,
    padding: 40,
  },
  animation: {
    style: 'smooth',
    transitionDuration: 20,
    staggerGap: 15,
  },
};
```

---

## 参考资源

- [Remotion Agent Skills 官方文档](https://www.remotion.dev/docs/ai/skills)
- [remotion-dev/template-prompt-to-motion-graphics](https://github.com/remotion-dev/template-prompt-to-motion-graphics) — Constants-First Design 和技能检测系统
- [digitalsamba/claude-code-video-toolkit](https://github.com/digitalsamba/claude-code-video-toolkit) — 品牌系统和工作流命令
- [JJenglert1/remotion-claude-video](https://github.com/JJenglert1/remotion-claude-video) — 技能叠加和提示词库
- [wshuyi/remotion-video-skill](https://github.com/wshuyi/remotion-video-skill) — 音频驱动时间和教育视频模式
- [Reddit r/MotionDesign 完整教程](https://www.reddit.com/r/MotionDesign/comments/1qkqxwm/) — 迭代增量工作流
