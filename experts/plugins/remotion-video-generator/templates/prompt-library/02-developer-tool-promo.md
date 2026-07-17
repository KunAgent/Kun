# 开源项目 / 开发者工具 Promo 提示词

> 来源：GitHub/X 社区常见的开发者工具推广视频
> 时长：12-18 秒 | 画幅：16:9 (1920x1080) | fps: 30

## 适用场景
- 开源项目推广
- CLI 工具宣传
- 开发者 SDK 介绍
- DevTool 产品演示

---

## 核心提示词

```text
输入：这是一个开源项目简介（我会贴 README 片段）。

目标：生成一条 {duration} 秒开发者工具 promo（16:9，30fps）。

画面元素：
- 终端风格卡片（命令滚动、输出高亮）
- 2–3 张"伪 UI 截图"（用矢量卡片模拟，不需要真实截图）

结构：
- 0-3s：一句"痛点"（"{pain_point}"）
- 3-10s：三步上手（install → run → result）
  1. {step_1_command}
  2. {step_2_command}
  3. {step_3_result}
- 10-15s：metrics/社会证明（{stars} stars、{speedup} 速度提升、{time_saved} 节省时间）

动效：终端光标闪烁、卡片滑入、数字滚动计数器。
```

---

## Constants-First 代码模板

```typescript
// ============ EDITABLE CONSTANTS ============
const PROJECT = {
  name: 'your-tool',
  tagline: 'The developer tool that saves your sanity',
  painPoint: 'Tired of writing boilerplate?',
};

const STEPS = [
  { label: 'Install', command: 'npm install your-tool', output: '✓ Installed in 2.3s' },
  { label: 'Run', command: 'npx your-tool init', output: '✓ Project scaffolded' },
  { label: 'Result', command: 'npx your-tool build', output: '✓ 0 errors, built in 0.8s' },
];

const METRICS = [
  { icon: '⭐', value: 12500, label: 'GitHub Stars' },
  { icon: '⚡', value: 10, suffix: 'x', label: 'Faster' },
  { icon: '⏱️', value: 40, suffix: '%', label: 'Time Saved' },
];

const TERMINAL = {
  bg: '#1E1E2E',
  text: '#CDD6F4',
  prompt: '#89B4FA',
  success: '#A6E3A1',
  comment: '#6C7086',
  border: '#313244',
  cursorColor: '#F5E0DC',
};

const BRAND = {
  bg: '#0B0B0F',
  text: '#E2E8F0',
  accent: '#22D3EE',
  muted: '#64748B',
};

const TIMING = {
  fps: 30,
  painFrames: 90,    // 3s
  stepsFrames: 210,  // 7s
  metricsFrames: 150, // 5s
};
// ============================================
```

---

## 动效要点

### 终端卡片
```typescript
// 终端窗口外观
const TerminalCard: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{
    backgroundColor: TERMINAL.bg,
    borderRadius: 12,
    border: `1px solid ${TERMINAL.border}`,
    padding: 24,
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 20,
    boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
    width: 800,
  }}>
    {/* 窗口按钮 */}
    <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
      <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#FF5F57' }} />
      <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#FEBC2E' }} />
      <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#28C840' }} />
    </div>
    {children}
  </div>
);
```

### 命令逐字输入
```typescript
// 模拟终端命令输入
const CommandTyping: React.FC<{ command: string; startFrame: number }> = ({ command, startFrame }) => {
  const frame = useCurrentFrame();
  const relFrame = frame - startFrame;
  
  // 提示符立即显示
  const prompt = '$ ';
  
  // 命令逐字出现
  const charsToShow = Math.min(Math.floor(relFrame / 2), command.length);
  const visibleCommand = command.slice(0, charsToShow);
  
  // 光标闪烁
  const showCursor = charsToShow < command.length && Math.sin(relFrame * 0.2) > 0;
  
  return (
    <div>
      <span style={{ color: TERMINAL.prompt }}>{prompt}</span>
      <span style={{ color: TERMINAL.text }}>{visibleCommand}</span>
      {showCursor && <span style={{ color: TERMINAL.cursorColor }}>█</span>}
    </div>
  );
};
```

### 数字滚动计数器
```typescript
// 数字从 0 动画到目标值
const CountUp: React.FC<{ target: number; startFrame: number; duration: number; suffix?: string }> = 
  ({ target, startFrame, duration, suffix = '' }) => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [startFrame, startFrame + duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const value = Math.floor(target * progress);
  
  return <span>{value.toLocaleString()}{suffix}</span>;
};
```

### 输出高亮
```typescript
// 命令输出带颜色高亮
const CommandOutput: React.FC<{ output: string; startFrame: number }> = ({ output, startFrame }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [startFrame, startFrame + 10], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  
  // ✓ 用绿色
  const coloredOutput = output.startsWith('✓') 
    ? { color: TERMINAL.success }
    : { color: TERMINAL.text };
  
  return (
    <div style={{ opacity, ...coloredOutput, marginTop: 8 }}>
      {output}
    </div>
  );
};
```

---

## 变体模式

### 模式 A：CLI Focus（纯终端）
- 全屏终端窗口，命令逐行执行
- 适合 CLI 工具、npm 包

### 模式 B：终端 + UI 分屏
- 左侧终端，右侧 UI 预览
- 适合全栈框架、UI 库

### 模式 C：Before/After 开发体验
- 上：旧方式（冗长代码）
- 下：新方式（一行命令）
- 适合 DX 改进类工具

---

## 质量检查清单

- [ ] 终端字体使用等宽字体（JetBrains Mono / Fira Code）
- [ ] 命令输入速度自然（每 2 帧一个字符）
- [ ] 输出有适当延迟（模拟执行时间）
- [ ] 光标闪烁频率自然（不要太快）
- [ ] 数字计数器平滑（不要跳帧）
- [ ] 深色背景对比度充足
- [ ] GitHub stars 等数字准确
