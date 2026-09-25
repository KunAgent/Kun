# Remote 手机端 · UI 布局优化计划（Code 模式优先）

> 日期：2026-09-23
> 范围：Remote 手机 Web 的 Code 模式（项目列表 → 项目会话列表 → 会话页 → 各类底部面板），外加手机端全局外壳。Rooms / Work 模式后续按同样的规范跟进。
> 相关文档：[功能修复计划](./remote-mobile-code-plan.zh-CN.md)、[Review 修复计划](./remote-mobile-review-fix-plan.zh-CN.md)。
> 依据：用内置浏览器以 390×844、375×812、320×568 三种视口实地查看 + 读代码。注意 Remote 提供的是**已安装的打包版**，工作区里未提交的改动不在其中，涉及新组件（详情面板、设置面板）的部分以代码为准。

---

## 0. 现状测量

| 指标 | 390×844 | 320×568 | 说明 |
| --- | --- | --- | --- |
| 会话页顶栏高度 | 60px | 60px | 标题 + 完整绝对路径 |
| 输入区高度（未聚焦） | 114px | 114px | 输入行 52px + 独立的「模式 · 模型」行 44px + 上下内边距 |
| 消息区可用高度 | 670px（79%） | ≈394px（69%） | 小屏损失明显 |
| 会话列表单行高度 | ≈88px | ≈88px | 标题 / 模型名 / 绝对日期三行，一屏只能看到 5–6 条 |
| 项目行高度 | 68px | 68px | 只有项目名 + 父目录名 |
| 消息操作按钮 | `opacity: 0` | 同左 | 悬停才显示，触屏点不到；命中区 21–28px |
| 「归档到此处」 | 一个会话里出现 6 次 | 同左 | 桌面专属 |
| 横向溢出 | 无 | 助手操作行 / 子代理卡片右侧超出 7px | 被父级裁切 |

实际遇到的问题（截图观察）：
1. 路由一旦进入 `settings` 就永远停在「加载中」，刷新也出不来（见 U1）。
2. 项目会话页左上角「← 项目」的箭头和文字被拆成两行：箭头偏左上，文字居中。
3. 子代理卡片在 390 宽时文字被截成 `< | | DS…`，在 320 宽时右上角的「完成」标签被切掉一半。
4. 模型选择面板只列裸模型 ID，不按供应商分组，面板底部孤零零显示一个供应商 ID。

---

## 1. 通用规范（所有条目都遵守）

### 1.1 作用域：绝不影响桌面端

- 手机端专属样式一律挂在 `html[data-remote-surface='mobile']`（由 `useRemoteSurface` 设置）或 `.kun-mobile-app` 下面。
- 覆盖共享组件（时间线、卡片）的样式，统一写在一个新文件 `src/renderer/src/mobile/chat/mobile-timeline-overrides.css` 里，由 `MobileCodeConversation.tsx` 引入。**不要**改共享组件自己的 Tailwind 类。
- 桌面端回归检查：每个 PR 在 1280×800 的桌面 Electron 下看一遍会话页、侧栏、设置页。

### 1.2 统一的手机端设计变量

现在 `--kun-mobile-gutter` / `--kun-mobile-touch` 只定义在 `.kun-mobile-home` 上，底部面板又自己定义了 `--kun-mobile-touch-size`，三处各自为政。改成在 `mobile-app-shell.css` 里统一定义：

```css
/* mobile-app-shell.css —— 放在文件顶部，替换各处重复定义 */
html[data-remote-surface='mobile'] {
  --kun-mobile-safe-bottom: max(8px, calc(env(safe-area-inset-bottom, 0px) - var(--kun-mobile-bottom, 0px)));
  --kun-mobile-gutter: 16px;          /* 页面左右留白 */
  --kun-mobile-touch: 44px;           /* 最小触控尺寸（Apple HIG） */
  --kun-mobile-header-h: 52px;        /* 顶栏内容高度（不含刘海安全区） */
  --kun-mobile-row-min: 60px;         /* 列表行最小高度 */
  --kun-mobile-radius: 12px;          /* 卡片 / 输入框圆角 */
  --kun-mobile-radius-lg: 22px;       /* 底部面板 / 输入行圆角 */
  --kun-mobile-font-body: 15px;       /* 正文 */
  --kun-mobile-font-meta: 12.5px;     /* 次要信息 */
  --kun-mobile-font-input: 16px;      /* 输入框：必须 ≥16px，否则 iOS 聚焦时会自动放大页面 */
}
```

随后删掉 `mobile-home.css:2-3` 和 `mobile-sheet.css:2`（`--kun-mobile-touch-size`）里的重复定义，并把 `var(--kun-mobile-touch-size)` 全部替换成 `var(--kun-mobile-touch)`。

### 1.3 只用已存在的颜色 token

可用的 `--ds-*`（已核对）：
`--ds-text` `--ds-text-muted` `--ds-text-faint` `--ds-bg-main` `--ds-surface-subtle` `--ds-surface-elevated` `--ds-surface-hover` `--ds-border` `--ds-border-muted` `--ds-border-strong` `--ds-accent` `--ds-accent-soft` `--ds-success` `--ds-success-soft` `--ds-danger` `--ds-danger-soft` `--ds-warning-soft` `--ds-permission-accent` `--ds-permission-soft` `--ds-radius-pill` `--ds-shadow-chip` `--ds-shadow-overlay` `--ds-focus-ring`。

- **没有** `--ds-warning`，琥珀色（等待输入）用 `--ds-permission-accent` / `--ds-permission-soft`。
- 不写死颜色值。深色模式和各主题插件靠 token 自动适配。
- 不用 `color-mix()`（iOS 16.2 以下不支持）。

### 1.4 样式钩子：加 `data-*` 属性，不要选 Tailwind 类

像 `.flex.shrink-0.items-center` 这类选择器会随着组件重构失效。凡是手机端要覆盖的共享组件，都先在 TSX 里加语义化的 `data-*` 属性（对桌面零影响），再用属性选择器写样式。本计划需要新增的钩子：

| 文件 | 元素 | 新增属性 |
| --- | --- | --- |
| `components/chat/message-timeline-bubbles.tsx:139` | 助手消息操作行 | `data-assistant-action-row` |
| 同上 `:152/:167` 以及 Speak / SpeakTrack / Export / Copy 各按钮 | 各操作按钮 | `data-assistant-action="rollback / fork / speak / speak-track / export / copy"` |
| `components/chat/message-timeline-user-bubbles.tsx:408` | 用户消息操作行 | `data-user-action-row` |
| `components/chat/message-timeline-media-views.tsx:134` | 图片悬停按钮 | `data-media-action` |
| `components/chat/SubagentCallCard.tsx:275` | 卡片头部行 | `data-subagent-header` |
| 同上 `:327-412` | 耗时 + 按钮 + 箭头 | 包一层 `<div data-subagent-trailing className="flex shrink-0 items-center gap-2">` |
| `components/chat/message-timeline-conversation-turn.tsx:532` | 「归档到此处」 | 已有 `data-archive-history-action`，直接用 |
| `components/chat/TurnUsageRow.tsx:161` | 用量行 | 已有 `.turn-usage-row`，直接用 |

### 1.5 触控、字号、动效

- 所有可点区域 ≥44×44px。视觉上需要更小的控件（例如 28px 高的标签），用 `::after` 把命中区扩大到 44px（写法见 U2）。
- 按下反馈统一用 `:active { background: var(--ds-surface-hover) }`，不依赖 `:hover`。
- 所有动画都要加 `@media (prefers-reduced-motion: reduce)` 关闭。
- 文字截断统一用 `overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`，并且父元素必须设 `min-width: 0`（flex / grid 子元素默认不收缩，是截断失效的常见原因）。

### 1.6 容器查询

卡片的窄屏布局用容器查询（iOS 16+、Chrome 105+ 支持），不看整个视口，而是看时间线的实际宽度：

```css
/* mobile-code-conversation.css */
.kun-mobile-code-timeline { container: kun-timeline / inline-size; position: relative; }
```

---

## 2. 条目总览

| ID | 优先级 | 问题 | 主要改动 | 预估 |
| --- | --- | --- | --- | --- |
| U1 | P0 | 设置页永远「加载中」，刷新也出不来 | AppShell 分支 + 手机设置整页 + 去掉恢复键 | 0.5 天 |
| U2 | P0 | 消息操作在触屏上不可见、点不到 | 操作行常显 + 「更多」面板 | 1 天 |
| U3 | P0 | 新详情 / 设置面板没有样式 | 新增表单基础样式文件 | 0.5 天 |
| U4 | P0 | 项目会话页顶栏错位、按钮位置反直觉 | 顶栏重排 + CSS | 0.25 天 |
| U5 | P1 | 会话页副标题是完整路径，信息价值低 | 顶栏改为「项目 · 模式 · 模型」并可点击 | 0.5 天 |
| U6 | P1 | 输入区 114px 太高 | 去掉独立的选项行 | 0.25 天 |
| U7 | P1 | 会话列表每行 88px、无状态 | 两行紧凑布局 + 状态标签 + 相对时间 | 0.75 天 |
| U8 | P1 | 项目列表缺少「最近会话」 | 新增最近会话区 + 项目行元信息 | 0.75 天 |
| U9 | P1 | 时间线桌面专属元素太多 | 隐藏归档到此处 / 用量行 | 0.25 天（CSS）+ 0.5 天（改 prop） |
| U10 | P1 | 子代理 / 工具卡片在窄屏上挤压、溢出 | 容器查询换行 + 隐藏头像 | 0.5 天 |
| U11 | P1 | 模型选择面板简陋 | 分段控件 + 按供应商分组 | 0.5 天 |
| U12 | P1 | 长会话无法快速回到最新 | 悬浮「回到最新」按钮 | 0.5 天 |
| U13 | P2 | 跨过 767px 整个界面重载 | 切换留缓冲区间 + 手动切换入口 | 0.5 天 |
| U14 | P2 | 底部导航细节；键盘弹出时导航占空间 | 导航样式 + 键盘状态属性 | 0.25 天 |
| U15 | P2 | 列表加载只有文字「加载中」 | 骨架屏 | 0.25 天 |

---


## 3. 分册

| 分册 | 内容 |
| --- | --- |
| [P0 条目（U1–U4）](./p0.zh-CN.md) | 设置页加载死循环、触屏操作、表单样式、顶栏错位 |
| [P1 条目（U5–U12）](./p1.zh-CN.md) | 顶栏信息、输入区、列表、时间线、卡片、模型面板、回到最新 |
| [P2 条目与验证方案（U13–U15）](./p2-and-verification.zh-CN.md) | 视口切换、底部导航、骨架屏 + §8 验证方案 |

## 6. 文件清单

| 类型 | 文件 | 条目 |
| --- | --- | --- |
| 新增 CSS | `mobile/sheets/mobile-sheet-form.css` | U2（操作列表）、U3、U11 |
| 新增 CSS | `mobile/chat/mobile-timeline-overrides.css` | U2、U9、U10、U12 |
| 新增 CSS | `mobile/settings/mobile-settings-screen.css` | U1 |
| 修改 CSS | `mobile/mobile-app-shell.css`（统一变量） | 1.2 |
| 修改 CSS | `mobile/screens/mobile-home.css` | U4、U7、U15 |
| 修改 CSS | `mobile/screens/mobile-projects.css` | U8 |
| 修改 CSS | `mobile/chat/mobile-code-conversation.css` | U5、1.6 |
| 修改 CSS | `mobile/chat/mobile-composer.css` | U6 |
| 修改 CSS | `mobile/chat/mobile-code-options.css`（重写） | U11 |
| 修改 CSS | `mobile/mobile-mode-nav.css`（重写） | U14 |
| 新增 TSX | `mobile/settings/MobileSettingsScreen.tsx`、`mobile/chat/MobileMessageActionsSheet.tsx` | U1、U2 |
| 修改 TSX（手机端） | `MobileHome.tsx`、`MobileCodeHome.tsx`、`MobileCodeConversation.tsx`、`MobileCodeOptions.tsx`、`MobileCodeThreadDetails.tsx`、`MobileCodeSettings.tsx`、`use-mobile-viewport.ts`、`remote-surface.ts`、`use-remote-surface.ts` | 多项 |
| 修改 TSX（共享，只加属性或新增 prop） | `message-timeline-bubbles.tsx`、`message-timeline-user-bubbles.tsx`、`message-timeline-media-views.tsx`、`message-timeline-conversation-turn.tsx`、`MessageTimeline.tsx`、`LazyMessageTimeline.tsx`、`SubagentCallCard.tsx`、`sidebar-project-selectors.ts` | U2、U9、U10、U12、U8 |
| 修改（全局） | `AppShell.tsx`、`extensions/ProtectedRendererSurface.tsx`、`store/chat-store-initial-state.ts` | U1 |
| i18n | `locales/{en,zh}/common/sidebar.json`：`mobileRecentSessions`、`mobileJumpLatest`、`mobileMessageActions`、`mobileUseDesktop`、`mobileUseMobile`、`mobileDesktopSetupRequired` 等 | 多项 |

---

## 7. 实施顺序与 PR 拆分

| PR | 内容 | 说明 |
| --- | --- | --- |
| PR-1（P0 阻塞） | U1 + U3 + U4 | 先保证不卡死、面板可用、顶栏正确；改动集中在手机端，风险最低 |
| PR-2（P0 触屏） | 1.2 统一变量 + 1.4 加 data 属性 + U2 | 会动到共享的时间线组件（只加属性和一个可选 prop），需要做桌面回归检查 |
| PR-3（P1 空间） | U5 + U6 + U9 + U12 | 会话页的纵向空间整体优化，一起验收效果最好 |
| PR-4（P1 列表） | U7 + U8 + U15 | 首页与项目页 |
| PR-5（P1 卡片与面板） | U10 + U11 | 引入容器查询 |
| PR-6（P2） | U13 + U14 | 外壳行为 |

⚠️ 现在工作区里还有另一个会话在改同一批手机端文件（修复计划 A–E 批）。开工前先把那批改动提交，再从最新代码拉分支，避免冲突。

---

