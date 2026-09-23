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

## 3. P0 条目

### U1 设置页永远「加载中」，刷新也出不来

**现状**
- `AppShell.tsx:176-183`：`route === 'settings'` 时，不管是不是手机端，都渲染 `<ProtectedRendererSurface><SettingsView/></ProtectedRendererSurface>`。
- `extensions/ProtectedRendererSurface.tsx:33`：它会调用 `window.kunGui.extensionSyncHostContentScripts(...)`，而 Remote bridge 里**没有这个 API**。调用失败后按「失败即关闭」处理，永远显示 fallback「加载中」。
- 同一个组件还调用了 `markProtectedSurfaceRestore('settings')`，把 `kun:protected-surface-restore=settings` 写进 sessionStorage。`store/chat-store-initial-state.ts:15` 启动时读到它，又回到设置页，**刷新也出不来**，只能关掉标签页。
- 手机端还会进入设置路由的入口：
  - `MobileAppShell.tsx:216`（Work 页的设置按钮）；
  - `openSettings`（`store/chat-store-app-actions.ts:320`）；
  - 运行时缺配置时的自动跳转（`chat-store-claw-actions.ts:406/493/606`、`chat-store-maintenance-interaction-actions.ts:313`、`probeRuntime` 的 `needsSettings`）；
  - 时间线错误卡片的「打开设置」。

**目标**：手机端永远不渲染桌面版设置页；Remote 网页里（包括桌面尺寸的平板）不会被保护层卡死；残留的恢复键不再生效。

**改动**

1. `AppShell.tsx` 的路由分支：

   ```tsx
   <Suspense fallback={<RouteFallback />}>
     {route === 'settings' ? (
       surface === 'mobile'
         ? <MobileSettingsScreen />            // 手机端：只用精简设置页
         : (
           <ProtectedRendererSurface kind="account-credentials" restoreTarget="settings" fallback={<RouteFallback />}>
             <SettingsRouteView />
           </ProtectedRendererSurface>
         )
     ) : surface === 'mobile' ? <MobileApp /> : <WorkbenchView />}
   </Suspense>
   ```

   `MobileSettingsScreen` 以懒加载方式放在 `src/renderer/src/mobile/settings/MobileSettingsScreen.tsx`。

2. 新增 `mobile/settings/MobileSettingsScreen.tsx`（整页版本）：
   - 把 `MobileCodeSettings.tsx` 里 `MobileSheet` 内部的内容抽成 `MobileCodeSettingsBody`，底部面板和整页共用；
   - 顶栏：返回按钮调用 `setRoute(settingsReturnRoute ?? 'chat')`，标题「设置」；
   - 如果是因为「运行时缺配置」跳过来的，顶部显示提示卡片：「需要在桌面端完成模型 / 密钥配置」。

3. `ProtectedRendererSurface.tsx`：在 Remote 网页里直接放行。浏览器里不存在 Direct DOM 扩展主体，需要防护的场景不存在；而且凭据相关的 IPC 本来就不在 Remote 允许列表里。

   ```tsx
   useEffect(() => {
     if (window.kunGui?.isRemoteWeb === true) {   // 浏览器里没有扩展内容脚本
       clearProtectedSurfaceRestore(restoreTarget)
       setReady(true)
       return
     }
     // …原逻辑不变
   }, [kind, restoreTarget])
   ```

4. `store/chat-store-initial-state.ts:15`：Remote 网页忽略并清除恢复键。

   ```ts
   const protectedSurfaceRestore = window.kunGui?.isRemoteWeb === true
     ? (clearProtectedSurfaceRestore('settings'), clearProtectedSurfaceRestore('initial-setup'), undefined)
     : readProtectedSurfaceRestore()
   ```

5. 首次设置向导（`initialSetupOpen`）在手机端不渲染向导，改为在页面上显示一张说明卡片：「请先在桌面端完成初始设置」。

**CSS**（新文件 `mobile/settings/mobile-settings-screen.css`）

```css
.kun-mobile-settings-screen {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  color: var(--ds-text);
  background: var(--ds-bg-main);
}
.kun-mobile-settings-screen > header {
  display: grid;
  grid-template-columns: var(--kun-mobile-touch) minmax(0, 1fr) var(--kun-mobile-touch);
  align-items: center;
  gap: 8px;
  min-height: var(--kun-mobile-header-h);
  padding: env(safe-area-inset-top, 0px) 4px 0;
  border-bottom: 1px solid var(--ds-border);
}
.kun-mobile-settings-screen > header h1 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  text-align: center;
}
.kun-mobile-settings-screen > header button {
  display: inline-flex;
  width: var(--kun-mobile-touch);
  height: var(--kun-mobile-touch);
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 9999px;
  color: inherit;
  background: transparent;
}
.kun-mobile-settings-screen > header button:active { background: var(--ds-surface-hover); }
.kun-mobile-settings-screen > main {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 16px var(--kun-mobile-gutter) calc(24px + var(--kun-mobile-safe-bottom));
}
```

表单内容复用 U3 的基础样式。

**测试**
- `AppShell` 单测：surface 为 mobile 且 route 为 settings 时，渲染 `MobileSettingsScreen`，不渲染 `ProtectedRendererSurface`。
- `ProtectedRendererSurface` 单测：`isRemoteWeb` 为 true 时立即渲染 children，且**不调用** `extensionSyncHostContentScripts`。
- `chat-store-initial-state` 单测：Remote 下即使 sessionStorage 里有 `settings`，初始 route 也是 `chat`，并且该键被清除。

**验收**：手机端从 Work 页点设置、断开运行时触发「需要配置」、以及时间线错误卡片点「打开设置」，都会打开手机设置页，返回键能回到原页面；刷新后回到正常首页。

---

### U2 消息操作在触屏上不可见、点不到

**现状**
- `message-timeline-bubbles.tsx:41-46`：`assistantActionRowClass` 默认是 `opacity-0`，只在 `group-hover/message:opacity-100` 时显示。触屏没有悬停，所以复制、分叉、朗读、导出、回滚全都点不到。
- 按钮尺寸：复制 28×28，分叉 / 朗读 21px 高，都低于 44px。
- 在 320 宽下，这一行宽 299px，超出屏幕右边 7px。
- 用户消息的操作行（`message-timeline-user-bubbles.tsx:408`）同样只在悬停时可见，但它已经带有 `group-focus-within:visible`。
- 图片预览的悬停按钮（`message-timeline-media-views.tsx:134`）同理。

**目标**：手机上每条助手消息下方常驻一行小操作栏：左边时间，右边「复制」「更多」两个按钮。「更多」打开底部面板，里面列出全部操作。

**TSX 改动**
1. 按 1.4 的表格加上 `data-assistant-action-row` / `data-assistant-action`。
2. 新增时间线层面的上下文 `TimelineSurfaceContext`（取值 `'desktop' | 'mobile'`），由 `MobileCodeConversation` 通过 `LazyMessageTimeline` 的新 prop `surface="mobile"` 传入。
3. `surface === 'mobile'` 时，在操作行末尾多渲染一个 `<MobileMessageMoreButton data-assistant-action="more" />`，点击后打开 `MobileMessageActionsSheet`（新文件 `mobile/chat/MobileMessageActionsSheet.tsx`）。面板内容：复制全文、分叉新会话、回滚工作区（有 `rollbackAction` 时）、朗读、导出（PDF / DOCX / PNG / HTML）、本轮用量（接收 U9 移过来的 `TurnUsageRow` 数据）。
   - 回调直接复用该气泡作用域里的 `forkAction.onFork`、`rollbackAction.onRollback`，以及 `AssistantExportButton` / `CopyFeedbackButton` 里的逻辑（把核心逻辑抽成函数，避免在 JSX 里复制粘贴）。
4. 用户消息：在 mobile 下给气泡外层 `group` 容器加 `tabIndex={0}`。点按后获得焦点，已有的 `group-focus-within:visible` 就会让操作行显示出来，不需要额外写 JS。
5. （可选增强）长按：在时间线容器上监听 `contextmenu` 事件（Android 长按会触发），找到最近的 `[data-timeline-block-id]` 后打开同一个面板。iOS 长按会弹系统的文本选择菜单，不去拦截，以免影响复制文字。

**CSS**（`mobile/chat/mobile-timeline-overrides.css`）

```css
/* —— 助手消息操作行：手机端常驻显示 —— */
html[data-remote-surface='mobile'] .kun-mobile-app [data-assistant-action-row] {
  opacity: 1;                      /* 覆盖 Tailwind 的 opacity-0 */
  min-height: 32px;
  margin-top: 2px;
  font-size: var(--kun-mobile-font-meta);
}
/* 次要操作收进「更多」面板，行内只保留复制和更多 */
html[data-remote-surface='mobile'] .kun-mobile-app
  [data-assistant-action-row] :is(
    [data-assistant-action='rollback'],
    [data-assistant-action='fork'],
    [data-assistant-action='speak'],
    [data-assistant-action='speak-track'],
    [data-assistant-action='export']
  ) {
  display: none;
}
/* 视觉 32px，命中区用 ::after 扩到 44px */
html[data-remote-surface='mobile'] .kun-mobile-app [data-assistant-action] {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  min-height: 32px;
  border-radius: 9999px;
  color: var(--ds-text-muted);
}
html[data-remote-surface='mobile'] .kun-mobile-app [data-assistant-action]::after {
  content: '';
  position: absolute;
  inset: -6px;                     /* 32 + 6×2 = 44 */
}
html[data-remote-surface='mobile'] .kun-mobile-app [data-assistant-action]:active {
  background: var(--ds-surface-hover);
}
/* 操作按钮里的文字标签在手机上隐藏，只留图标 */
html[data-remote-surface='mobile'] .kun-mobile-app [data-assistant-action] > span {
  display: none;
}

/* —— 用户消息：获得焦点（点按）后显示操作行 —— */
html[data-remote-surface='mobile'] .kun-mobile-app [data-user-action-row] {
  min-height: 32px;
}
html[data-remote-surface='mobile'] .kun-mobile-app .group:focus { outline: none; }

/* —— 图片悬停按钮：触屏常驻 —— */
html[data-remote-surface='mobile'] .kun-mobile-app [data-media-action] {
  opacity: 1;
  width: 36px;
  height: 36px;
}
```

「更多」面板的列表样式（放在 U3 的 `mobile-sheet-form.css` 里）：

```css
.kun-mobile-action-list { display: grid; margin: 0; padding: 0; list-style: none; }
.kun-mobile-action-list button {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 52px;
  padding: 0 4px;
  border: 0;
  border-bottom: 1px solid var(--ds-border-muted);
  color: var(--ds-text);
  background: transparent;
  font: inherit;
  font-size: var(--kun-mobile-font-body);
  text-align: start;
}
.kun-mobile-action-list li:last-child button { border-bottom: 0; }
.kun-mobile-action-list button:active { background: var(--ds-surface-hover); }
.kun-mobile-action-list button > svg { flex-shrink: 0; color: var(--ds-text-muted); }
.kun-mobile-action-list button[data-variant='danger'] { color: var(--ds-danger); }
.kun-mobile-action-list button[data-variant='danger'] > svg { color: currentColor; }
```

**测试**
- 冒烟脚本：在 320 / 390 下，`[data-assistant-action-row]` 的计算后 `opacity === '1'`，行右边界不超过 `innerWidth`；每个可见的 `[data-assistant-action]` 的 `getBoundingClientRect()` 至少 32×32（命中区由 `::after` 保证）。
- 点「更多」后打开面板，点「复制全文」后面板关闭并出现「已复制」提示。
- 桌面：操作行仍然只在悬停时出现（桌面 E2E / 截图对比）。

---

### U3 新详情 / 设置面板没有样式

**现状**：`MobileCodeThreadDetails.tsx` 和 `MobileCodeSettings.tsx` 用了 `<dl>`、`<input type="text">`、`<div><button>…</button></div>`，但 `mobile-code-options.css` 只给 `fieldset`、`label`、`select`、`p` 写了样式。结果：
- `dd` 带着浏览器默认的 40px 左缩进；
- 文本框是默认的小尺寸、字号小于 16px，iOS 聚焦时会放大页面；
- 按钮是灰色的系统小按钮，高度不到 44px。

**做法**：新建一组表单基础样式，三个面板（选项、详情、设置）以及 U1 的设置整页都统一使用。

**TSX 改动**（把类名写在元素上，不再依赖 `.kun-mobile-code-options div` 这种后代选择器）：

```tsx
<div className="kun-mobile-form">
  {error ? <p role="alert" className="kun-mobile-form-error">{error}</p> : null}
  <label className="kun-mobile-field">
    <span>{t('sidebarThreadRename')}</span>
    <input type="text" … />
  </label>
  {editing ? (
    <div className="kun-mobile-actions">
      <button type="button" className="kun-mobile-button" data-variant="primary">{t('mobileSave')}</button>
      <button type="button" className="kun-mobile-button">{t('cancel')}</button>
    </div>
  ) : null}
  <dl className="kun-mobile-kv">
    <dt>{t('mobileDetailsProject')}</dt><dd>{projectName}</dd>
    <dt>{t('mobileDetailsPath')}</dt><dd data-mono>{thread?.workspace}</dd>
    …
  </dl>
  <div className="kun-mobile-actions">
    <button className="kun-mobile-button">{t('sidebarThreadCopyId')}</button>
    <button className="kun-mobile-button" data-variant="danger">{t('sidebarThreadArchive')}</button>
  </div>
  <p className="kun-mobile-hint">{t('mobileSettingsDesktopHint')}</p>
</div>
```

**CSS**（新文件 `mobile/sheets/mobile-sheet-form.css`，由 `MobileSheet.tsx` 引入，让所有面板都能用）

```css
.kun-mobile-form { display: grid; gap: 16px; min-width: 0; }

/* 字段：上方小标题 + 下方控件 */
.kun-mobile-field {
  display: grid;
  gap: 6px;
  min-width: 0;
  color: var(--ds-text-muted);
  font-size: 13px;
}
.kun-mobile-field > :is(input, select, textarea) {
  box-sizing: border-box;
  width: 100%;
  min-height: var(--kun-mobile-touch);
  padding: 10px 12px;
  border: 1px solid var(--ds-border);
  border-radius: var(--kun-mobile-radius);
  color: var(--ds-text);
  background: var(--ds-bg-main);
  font: inherit;
  font-size: var(--kun-mobile-font-input);   /* 16px，防止 iOS 自动放大 */
  line-height: 22px;
}
.kun-mobile-field > select {
  appearance: none;
  padding-inline-end: 36px;
  /* 自绘下拉箭头：currentColor 无法用于背景图，这里用中性灰 */
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m4 6 4 4 4-4'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
}
.kun-mobile-field > :is(input, select, textarea):focus {
  outline: 2px solid var(--ds-accent);
  outline-offset: -2px;
}

/* 信息展示：左标签右值的两列表格 */
.kun-mobile-kv {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px 16px;
  margin: 0;
  padding: 12px 14px;
  border: 1px solid var(--ds-border);
  border-radius: var(--kun-mobile-radius);
  background: var(--ds-surface-subtle);
}
.kun-mobile-kv dt { color: var(--ds-text-muted); font-size: 13px; line-height: 20px; white-space: nowrap; }
.kun-mobile-kv dd { margin: 0; min-width: 0; font-size: 14px; line-height: 20px; overflow-wrap: anywhere; }
.kun-mobile-kv dd[data-mono] {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12.5px;
}
/* 超窄屏（<340px）改成上下堆叠 */
@media (max-width: 339px) {
  .kun-mobile-kv { grid-template-columns: minmax(0, 1fr); gap: 2px; }
  .kun-mobile-kv dd + dt { margin-top: 8px; }
}

/* 按钮组：宽度自适应平分，放不下就自动换行 */
.kun-mobile-actions {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
}
.kun-mobile-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: var(--kun-mobile-touch);
  padding: 10px 14px;
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-pill, 9999px);
  color: var(--ds-text);
  background: var(--ds-surface-elevated);
  font: inherit;
  font-size: var(--kun-mobile-font-body);
}
.kun-mobile-button:active:not(:disabled) { background: var(--ds-surface-hover); }
.kun-mobile-button:disabled { opacity: .45; }
.kun-mobile-button[data-variant='primary'] {
  color: var(--ds-bg-main);
  background: var(--ds-text);
  border-color: var(--ds-text);
}
.kun-mobile-button[data-variant='danger'] {
  color: var(--ds-danger);
  background: var(--ds-danger-soft);
  border-color: transparent;
}

.kun-mobile-form-error {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--kun-mobile-radius);
  color: var(--ds-danger);
  background: var(--ds-danger-soft);
  font-size: 13px;
  overflow-wrap: anywhere;
}
.kun-mobile-hint { margin: 0; color: var(--ds-text-muted); font-size: 13px; line-height: 1.5; }
```

之后把 `mobile-code-options.css` 里对 `label` / `select` / `p` 的通用规则删掉，改用这些类（见 U11），避免两套样式互相覆盖。

**验收**：三个面板在 320 / 390 下都没有默认浏览器样式；输入框聚焦时 iOS 不放大页面；所有按钮高度都是 44px。

---

### U4 项目会话页顶栏错位、按钮位置反直觉

**现状**
- `MobileHome.tsx:43-53` 的顶栏顺序是 `[⚙ 设置] [← 项目] [+ 新建]`。
- `.kun-mobile-workspace`（`mobile-home.css:31`）是个普通 `<button>`，里面是 `<ArrowLeft/>` + 文本。Tailwind 的基础样式把 `svg` 设成了 `display: block`，于是箭头独占一行、文字换到下一行居中，出现「箭头在左上、文字在中间」的错位。
- 左上角放设置按钮，和手机「左上角是返回」的习惯冲突。

**TSX 改动**（`MobileHome.tsx`）

```tsx
<header className="kun-mobile-home-header">
  {onWorkspace ? (
    <button type="button" className="kun-mobile-back" onClick={onWorkspace}>
      <ArrowLeft size={20} aria-hidden /><span>{labels.workspace}</span>
    </button>
  ) : <span />}
  <div className="kun-mobile-home-actions">
    <button type="button" className="kun-mobile-icon-button" onClick={onSettings} aria-label={labels.settings}>
      <Settings size={20} aria-hidden />
    </button>
    <button type="button" className="kun-mobile-icon-button" onClick={onNewConversation} disabled={loading} aria-label={labels.newConversation}>
      <Plus size={22} aria-hidden />
    </button>
  </div>
</header>
```

**CSS**（替换 `mobile-home.css:13-42`）

```css
.kun-mobile-home-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: var(--kun-mobile-header-h);
  padding: 4px 8px 0 4px;
}
.kun-mobile-back {
  display: inline-flex;              /* 关键：让箭头和文字在同一行 */
  align-items: center;
  gap: 2px;
  min-width: 0;
  max-width: 60%;
  min-height: var(--kun-mobile-touch);
  padding: 0 10px 0 6px;
  border: 0;
  border-radius: 9999px;
  color: var(--ds-accent);           /* 返回链接用强调色，符合 iOS 习惯 */
  background: transparent;
  font: inherit;
  font-size: 16px;
}
.kun-mobile-back > svg { flex-shrink: 0; }
.kun-mobile-back > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kun-mobile-back:active { background: var(--ds-surface-hover); }
.kun-mobile-home-actions { display: flex; align-items: center; gap: 0; }
.kun-mobile-icon-button:active:not(:disabled) { background: var(--ds-surface-hover); }
.kun-mobile-icon-button:disabled { opacity: .45; }

/* 大标题 */
.kun-mobile-home h1 {
  margin: 4px var(--kun-mobile-gutter) 12px;
  font-size: 26px;
  font-weight: 600;
  line-height: 32px;
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

删掉旧的 `.kun-mobile-workspace` 规则。检查 Rooms / Work 首页是否也用了这个类（`grep kun-mobile-workspace`），有的话一并迁移到 `.kun-mobile-back`。

**验收**：箭头和「项目」两个字在同一行、垂直居中；设置和新建按钮在右侧；320 宽下长项目名能正确截断。

---

## 4. P1 条目

### U5 会话页顶栏：项目名 + 运行状态 + 模型入口

**现状**：`MobileCodeConversation.tsx:83-86` 的副标题是 `thread?.workspace`，也就是完整绝对路径（`/Users/zxy/codeproject/ds_project/DeepSe…`），信息价值很低；也看不出会话是否正在运行。

**目标**：
- 第一行：会话标题；
- 第二行：`● 项目名 · 模式 · 模型 ▾`；
- 整个标题区可以点击，打开模型 / 模式面板（这样 U6 就能把输入区的选项行去掉）；
- 状态点：运行中（强调色、呼吸动画）、等待输入（琥珀色）、失败（红色）、空闲（灰色）。

**TSX 改动**

```tsx
const status = sidebarThreadActivity(thread, activityContext)  // 复用侧栏的状态计算
<header>
  <button type="button" aria-label={t('back')} onClick={onBack}><ArrowLeft aria-hidden /></button>
  <button type="button" className="kun-mobile-conversation-title" onClick={() => setOptionsOpen(true)}
    aria-label={t('composerModelControls')}>
    <h1>{thread?.title ?? t('loading')}</h1>
    <p>
      <span className="kun-mobile-status-dot" data-status={status} aria-hidden />
      <span>{projectName(thread?.workspace ?? '')}</span>
      <span aria-hidden>·</span>
      <span>{modeLabel}</span>
      <span aria-hidden>·</span>
      <span className="kun-mobile-conversation-model">{state.composerModel || t('autoLabel')}</span>
      <ChevronDown size={14} aria-hidden />
    </p>
  </button>
  <button type="button" aria-label={t('mobileMore')} onClick={() => setDetailsOpen(true)}><MoreHorizontal aria-hidden /></button>
</header>
```

`projectName` 复用 `MobileCodeHome.tsx` 里的同名函数，建议挪到 `lib/workspace-label.ts`。

**CSS**（替换 `mobile-code-conversation.css:2-6`）

```css
.kun-mobile-code-conversation > header {
  display: grid;
  grid-template-columns: var(--kun-mobile-touch) minmax(0, 1fr) var(--kun-mobile-touch);
  align-items: center;
  gap: 4px;
  min-height: var(--kun-mobile-header-h);
  padding: env(safe-area-inset-top, 0px) 4px 0;
  border-bottom: 1px solid var(--ds-border);
  background: var(--ds-bg-main);
}
.kun-mobile-code-conversation > header > button:not(.kun-mobile-conversation-title) {
  display: inline-flex;
  width: var(--kun-mobile-touch);
  height: var(--kun-mobile-touch);
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 9999px;
  color: inherit;
  background: transparent;
}
.kun-mobile-code-conversation > header > button:active { background: var(--ds-surface-hover); }

.kun-mobile-conversation-title {
  display: grid;
  justify-items: center;
  gap: 1px;
  min-width: 0;
  min-height: var(--kun-mobile-touch);
  padding: 4px 8px;
  border: 0;
  border-radius: var(--kun-mobile-radius);
  color: inherit;
  background: transparent;
  font: inherit;
}
.kun-mobile-conversation-title h1 {
  max-width: 100%;
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  line-height: 22px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kun-mobile-conversation-title p {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  min-width: 0;
  margin: 0;
  color: var(--ds-text-muted);
  font-size: 12px;
  line-height: 16px;
}
.kun-mobile-conversation-title p > span { flex-shrink: 0; white-space: nowrap; }
/* 模型名最长，只让它收缩截断 */
.kun-mobile-conversation-title .kun-mobile-conversation-model {
  flex-shrink: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.kun-mobile-conversation-title p > svg { flex-shrink: 0; }

/* 状态点：会话列表（U7）也复用 */
.kun-mobile-status-dot {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: 9999px;
  background: var(--ds-text-faint);
}
.kun-mobile-status-dot[data-status='running'] {
  background: var(--ds-accent);
  animation: kun-mobile-pulse 1.4s ease-in-out infinite;
}
.kun-mobile-status-dot[data-status='awaiting-input'] { background: var(--ds-permission-accent); }
.kun-mobile-status-dot[data-status='failed'] { background: var(--ds-danger); }
.kun-mobile-status-dot[data-status='unread'] { background: var(--ds-success); }
@keyframes kun-mobile-pulse { 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) {
  .kun-mobile-status-dot[data-status='running'] { animation: none; }
}
```

**验收**：顶栏高度从 60px 降到 52px（加安全区）；320 宽下标题、项目名、模式都能完整显示，只有模型名被截断；运行中状态点会闪烁。

---

### U6 输入区瘦身（去掉独立的选项行）

**现状**：`MobileComposer.tsx` 在输入行下面另起一行放 `kun-mobile-composer-options`（「agent · deepseek-v4-pro」），高 44px，输入区合计 114px。

**做法**
- U5 完成后，模型 / 模式入口已经在顶栏，`MobileCodeConversation` 给 `MobileComposer` 传 `onOptions={null}`。组件已经支持传 null，选项行就不会渲染。
- Work 模式的 `MobileWorkAssistant` 暂时保留选项行，等 Work 顶栏也改造后再去掉。
- 调整输入行的内边距和圆角：

```css
/* mobile-composer.css */
.kun-mobile-composer {
  flex-shrink: 0;
  min-height: 0;
  max-height: 60%;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 6px 10px var(--kun-mobile-safe-bottom, max(8px, env(safe-area-inset-bottom, 0px)));
  color: var(--ds-text);
  background: var(--ds-bg-main);
  border-top: 1px solid var(--ds-border-muted);   /* 与消息区的细分隔线 */
}
.kun-mobile-composer-row {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  min-width: 0;
  padding: 4px;
  border: 1px solid var(--ds-border);
  border-radius: var(--kun-mobile-radius-lg);       /* 22px：单行时是胶囊形 */
  background: var(--ds-surface-elevated);
  transition: border-radius .15s ease, border-color .15s ease;
}
.kun-mobile-composer-row:focus-within {
  border-color: var(--ds-border-strong);
  border-radius: 16px;
}
@media (prefers-reduced-motion: reduce) { .kun-mobile-composer-row { transition: none; } }

/* 附件标签横向滚动，不再撑高输入区 */
.kun-mobile-composer > :is(.ds-composer-attachments, [data-composer-attachments]) {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
  overflow-x: auto;
  scrollbar-width: none;
}
.kun-mobile-composer > :is(.ds-composer-attachments, [data-composer-attachments])::-webkit-scrollbar { display: none; }
```

（附件容器的真实类名需要到 `FloatingComposerAttachments.tsx` 里核对；没有稳定类名就加上 `data-composer-attachments`。）

**验收**：空闲时输入区高度 ≤ 66px（6 + 52 + 8，不含底部安全区）；390×844 下消息区 ≥ 726px（86%），320×568 下 ≥ 450px（79%）。

---

### U7 会话列表：两行紧凑布局 + 状态 + 相对时间

**现状**：`MobileHome.tsx` 的每一行是三行文字：标题 / `summary || preview || model`（现在大多显示模型名）/ `toLocaleDateString()` 绝对日期。行高约 88px，也没有运行中 / 等待输入 / 未读等状态。

**目标布局**

```
┌──────────────────────────────────────────┐
│ 修改未推送 commit 的工作时间      2 小时前 │  ← 标题（15.5px/500） + 时间（右对齐，12px）
│ [● 运行中] 把 git 提交时间改到工作时间外…  │  ← 状态标签（可选） + 摘要（13px，灰色）
└──────────────────────────────────────────┘  最小高度 60px
```

**TSX 改动**
- `MobileHome` 新增 prop：`activityOf?: (thread) => SidebarThreadActivity`，以及 `locale`。
- `MobileProjectHome` 从 store 取 `activeThreadId / busy / watchTurnCompletion / unreadThreadIds / awaitingUserInputThreadIds`，拼成上下文，调用 `sidebarThreadActivity`。
- 时间改用 `formatRelativeTime(updatedAt, locale)`（`lib/format-relative-time.ts`）。
- 第二行文字的取值顺序：`summary || preview`；两者都没有时不显示模型名（模型名移到会话页顶栏）。

```tsx
<li key={thread.id} className="kun-mobile-thread">
  <button type="button" className="kun-mobile-thread-open" onClick={() => onOpenThread(thread.id)}>
    <span className="kun-mobile-thread-title">{thread.title}</span>
    <time className="kun-mobile-thread-time" dateTime={thread.updatedAt}>{relative}</time>
    <span className="kun-mobile-thread-meta">
      {activity !== 'read' ? (
        <span className="kun-mobile-thread-badge" data-activity={activity}>{activityLabel}</span>
      ) : null}
      {preview ? <span className="kun-mobile-thread-preview">{preview}</span> : null}
    </span>
  </button>
</li>
```

状态文案复用侧栏已有的 key（`attentionStatusRunning` 等，定义在 `locales/*/common/sidebar.json`）。

**CSS**（替换 `mobile-home.css:74-90`）

```css
.kun-mobile-thread { border-bottom: 0; }
.kun-mobile-thread + .kun-mobile-thread .kun-mobile-thread-open {
  border-top: 1px solid var(--ds-border-muted);   /* 分隔线画在行之间 */
}
.kun-mobile-thread-open {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas:
    'title time'
    'meta  meta';
  align-items: baseline;
  column-gap: 12px;
  row-gap: 3px;
  width: calc(100% + 2 * var(--kun-mobile-gutter));
  min-height: var(--kun-mobile-row-min);
  /* 按下的高亮铺满整行：负外边距抵消列表的左右留白，再用内边距补回来 */
  margin-inline: calc(-1 * var(--kun-mobile-gutter));
  padding: 10px var(--kun-mobile-gutter);
  border: 0;
  color: inherit;
  background: transparent;
  text-align: start;
}
.kun-mobile-thread-open:active { background: var(--ds-surface-hover); }
.kun-mobile-thread-title {
  grid-area: title;
  min-width: 0;
  font-size: 15.5px;
  font-weight: 500;
  line-height: 22px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kun-mobile-thread-time {
  grid-area: time;
  color: var(--ds-text-faint);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.kun-mobile-thread-meta {
  grid-area: meta;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  min-height: 18px;
}
.kun-mobile-thread-preview {
  min-width: 0;
  color: var(--ds-text-muted);
  font-size: 13px;
  line-height: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kun-mobile-thread-badge {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 8px;
  border-radius: 9999px;
  color: var(--ds-text-muted);
  background: var(--ds-surface-subtle);
  font-size: 11.5px;
  font-weight: 500;
  line-height: 20px;
}
.kun-mobile-thread-badge::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background: currentColor;
}
.kun-mobile-thread-badge[data-activity='running'] { color: var(--ds-accent); background: var(--ds-accent-soft); }
.kun-mobile-thread-badge[data-activity='awaiting-input'] { color: var(--ds-permission-accent); background: var(--ds-permission-soft); }
.kun-mobile-thread-badge[data-activity='failed'] { color: var(--ds-danger); background: var(--ds-danger-soft); }
.kun-mobile-thread-badge[data-activity='unread'] { color: var(--ds-success); background: var(--ds-success-soft); }
.kun-mobile-thread-badge[data-activity='scheduled'] { color: var(--ds-text-muted); }
```

注意：`.kun-mobile-home-list` 目前有左右内边距（`padding: 0 var(--kun-mobile-gutter)`），上面的负外边距正是为了抵消它。如果 `.kun-mobile-home-list` 设置了 `overflow-x: hidden`，负外边距会被裁掉，这时改成把内边距从列表容器挪到行上。

**测试**：`MobileHome.test.ts` 断言行结构（标题 / 时间 / 状态标签）；冒烟脚本在 390×844 下断言单行高度 ≤ 64px，并且一屏至少能看到 9 行。

---

### U8 项目列表：最近会话 + 项目行元信息

**现状**：`MobileCodeHome` 只有项目列表，每行只有「项目名 + 父目录名」，下方大片空白。在手机上最常做的事是「接着上一个会话继续」，现在必须先选项目、再选会话，多一步。

**目标布局**

```
项目                                  [+] [⚙]
[ 🔍 搜索 ]
最近会话
  修改未推送commit的工作时间      [● 运行中]
  DeepSeek-GUI · 2 小时前
  StepFun coding plan 默认…
  DeepSeek-GUI · 5 小时前
  （最多 5 条）
项目
  📁 DeepSeek-GUI              ● 2 小时前  >
     ds_project
  📁 KunRemoteExtend              9月7日   >
     ds_project
```

**TSX 改动**
- 新增选择器 `selectRecentCodeThreads(threads, { limit: 5, clawChannels, registries })`，放在 `sidebar-project-selectors.ts`：取 Code 会话，排除已归档、侧边会话和对话临时目录，按 `updatedAt` 倒序取前 5 条。
- 点击最近会话：直接 `selectThread(id)` 并进入会话页，不经过项目页。
- 项目行的 `small` 改为「父目录 · 最近活跃时间」。最近活跃时间取已加载会话里该项目最大的 `updatedAt`。有运行中的会话时，在时间前面显示状态点（复用 U5 的 `.kun-mobile-status-dot`）。
- 搜索框有输入时，隐藏「最近会话」区，只显示匹配的项目。

**CSS**（追加到 `mobile-projects.css`）

```css
.kun-mobile-section-title {
  margin: 14px 0 4px;
  color: var(--ds-text-muted);
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: .02em;
}
.kun-mobile-recent { margin: 0; padding: 0; list-style: none; }
/* 最近会话行复用 U7 的 .kun-mobile-thread-open 网格，第二行是「项目 · 时间」 */
.kun-mobile-recent .kun-mobile-thread-open { min-height: 56px; }
.kun-mobile-recent-project {
  min-width: 0;
  color: var(--ds-text-muted);
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 项目行：右侧显示最近活跃时间 */
.kun-mobile-project-row {
  grid-template-columns: auto minmax(0, 1fr) auto auto;   /* 图标 | 名称 | 时间 | 箭头 */
  min-height: var(--kun-mobile-row-min);
  padding: 10px 0;
}
.kun-mobile-project-row time {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ds-text-faint);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.kun-mobile-project-row > svg:first-child {
  width: 20px;
  height: 20px;
  padding: 8px;
  box-sizing: content-box;
  border-radius: 10px;
  color: var(--ds-text-muted);
  background: var(--ds-surface-subtle);    /* 图标加底色块，列表更有层次 */
}
```

**验收**：打开手机端后，一次点击就能进入最近的会话；列表里运行中的会话一眼可见。

---

### U9 时间线降噪

**现状**：`message-timeline-conversation-turn.tsx:532-543` 在每轮对话结尾渲染「归档到此处」（一个会话里出现 6 次）；`TurnUsageRow` 显示「0 tokens 价格不可用」这类统计信息。在手机上都是噪音，还占纵向空间。

**两步走**

1. **先用 CSS 快速隐藏**（`mobile-timeline-overrides.css`）：

   ```css
   html[data-remote-surface='mobile'] .kun-mobile-app :is(
     [data-archive-history-action],
     .turn-usage-row
   ) {
     display: none;
   }
   ```

2. **再改成按 prop 不渲染**（避免渲染了又隐藏）：
   - `MessageTimeline` 新增 `surface?: 'desktop' | 'mobile'`（和 U2 共用同一个 prop），传给 `ConversationTurn`；
   - `surface === 'mobile'` 时：不渲染「归档到此处」，把它挪进会话详情面板，作为「归档此前的历史」操作；不渲染 `TurnUsageRow`，把本轮用量的数据交给 U2 的「更多」面板展示；
   - 完成后删掉第 1 步的 CSS。

同时检查 Markdown 在窄屏上的表现（加进 `mobile-timeline-overrides.css`，先核对 `styles/markdown-code.css` 里已有的规则，避免重复）：

```css
html[data-remote-surface='mobile'] .kun-mobile-app .ds-markdown :is(pre, table) {
  max-width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
html[data-remote-surface='mobile'] .kun-mobile-app .ds-markdown table { display: block; }
html[data-remote-surface='mobile'] .kun-mobile-app .ds-markdown pre {
  font-size: 12.5px;
  line-height: 1.55;
}
html[data-remote-surface='mobile'] .kun-mobile-app .ds-chat-answer {
  font-size: var(--kun-mobile-font-body);
  line-height: 1.65;
}
```

---

### U10 子代理 / 工具卡片的窄屏布局

**现状**：`SubagentCallCard.tsx:275` 的头部是一整行：头像（40px） + 标题区（`flex-1`） + 耗时 + 继续 / 预览 / 查看过程三个按钮 + 箭头。在 390 宽下标题被挤成 `< | | DS…`，在 320 宽下超出屏幕右边。桌面上已经有先例：专注模式会用 `[data-focus-mode='on'] .ds-subagent-focus-decoration` 隐藏头像（`styles/base-shell/composer-reasoning-controls.css:202`）。

**TSX 改动**：按 1.4 的表格加上 `data-subagent-header`，并把耗时 + 按钮 + 箭头包进 `<div data-subagent-trailing>`。这层包裹对桌面是透明的（它本身也是 flex 行）。

**CSS**（`mobile-timeline-overrides.css`，基于 1.6 的容器查询）

```css
/* 手机端一律隐藏子代理卡片里的吉祥物头像 */
html[data-remote-surface='mobile'] .kun-mobile-app .ds-subagent-focus-decoration { display: none; }

@container kun-timeline (max-width: 440px) {
  /* 头部改为两行：第一行标题区，第二行耗时 + 操作按钮（右对齐） */
  [data-subagent-header] {
    flex-wrap: wrap;
    row-gap: 6px;
    padding-inline: 12px;
  }
  [data-subagent-header] > .min-w-0.flex-1 { flex-basis: 100%; }  /* 标题区独占一行 */
  [data-subagent-trailing] {
    flex-basis: 100%;
    justify-content: space-between;
  }
  /* 卡片内按钮命中区扩到 44px */
  [data-subagent-trailing] button { position: relative; }
  [data-subagent-trailing] button::after { content: ''; position: absolute; inset: -8px -4px; }
}
```

> 注：上面的 `.min-w-0.flex-1` 是临时写法，违反了 1.4 的规定。实施时给标题区也加上 `data-subagent-title`，再改成 `[data-subagent-header] > [data-subagent-title]`。

**同一轮还要检查**：`ToolEntry`（工具调用行）、`TurnChangeSummary`（文件改动摘要，已有 `compact` 参数）、`ReviewPlanCard`、`GeneratedFilesPanel`。用冒烟脚本逐个在 320 宽下检查是否超出屏幕右边，超出的按同样方式处理：先加 data 属性，再写容器查询。

**验收**：320 / 390 下，时间线里所有元素的右边界都不超过 `innerWidth`；子代理卡片标题完整显示一行，按钮都能点到。

---

### U11 模型 / 模式选择面板

**现状**：`MobileCodeOptions.tsx` 的模式用 3 个胶囊按钮，模型下拉框只列裸模型 ID（`composerPickList`），面板底部孤零零显示一个供应商 ID。

**TSX 改动**
- 模式：改成分段控件 `.kun-mobile-segmented`。
- 模型：按 `composerModelGroups` 生成 `<optgroup label={group.label}>`，选项文字优先用模型的显示名（有的话）；去掉底部的供应商 ID 文本，改为在下拉框下方用一行提示「当前：{供应商} · {模型}」。
- 推理强度：6 个选项在 320 宽下放不下一排，改成 3×2 网格的 `.kun-mobile-chip-grid`，每个选项文字在 i18n 里已有（`composerReasoning*`）。
- 所有字段改用 U3 的 `.kun-mobile-field`。

**CSS**（替换 `mobile-code-options.css` 的全部内容）

```css
.kun-mobile-code-options { display: grid; gap: 18px; }

/* 分段控件 */
.kun-mobile-segmented {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  gap: 4px;
  padding: 4px;
  border-radius: var(--kun-mobile-radius);
  background: var(--ds-surface-subtle);
}
.kun-mobile-segmented button {
  min-height: 40px;                 /* 40 + 外层 4px 内边距，实际可点区域 ≥44 */
  border: 0;
  border-radius: 9px;
  color: var(--ds-text-muted);
  background: transparent;
  font: inherit;
  font-size: 14px;
  font-weight: 500;
}
.kun-mobile-segmented button[aria-pressed='true'] {
  color: var(--ds-text);
  background: var(--ds-surface-elevated);
  box-shadow: 0 1px 2px rgb(0 0 0 / 8%), var(--ds-shadow-chip);
}

/* 标签网格（推理强度） */
.kun-mobile-chip-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}
.kun-mobile-chip-grid button {
  min-height: var(--kun-mobile-touch);
  padding: 0 8px;
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-pill, 9999px);
  color: var(--ds-text);
  background: transparent;
  font: inherit;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kun-mobile-chip-grid button[aria-pressed='true'] {
  border-color: var(--ds-text);
  background: var(--ds-surface-subtle);
  font-weight: 600;
}
.kun-mobile-code-options legend,
.kun-mobile-code-options .kun-mobile-field > span {
  margin-bottom: 6px;
  color: var(--ds-text-muted);
  font-size: 13px;
}
.kun-mobile-code-options fieldset { min-width: 0; margin: 0; padding: 0; border: 0; }
```

---

### U12 长会话快速回到最新

**现状**：`mobile-app-shell.css:45` 隐藏了桌面的轮次跳转栏（`.timeline-jump-rail-anchor`），但手机上没有替代：长会话往上翻看之后，只能手动滑回底部；有新消息时也没有提示。

**TSX 改动**
- `MessageTimeline` 在 `surface === 'mobile'` 时，监听 `containerRef` 的滚动。当距离底部超过 1.5 屏时，显示一个「回到最新」按钮，点击后平滑滚到底部。
- 离开底部期间如果收到新的助手输出，给按钮加上 `data-unread="true"`（显示一个小圆点）。
- 可选：长按这个按钮时，打开「轮次列表」面板（数据复用 `visibleTurnAnchors`），可以直接跳到某一轮。

**CSS**（`mobile-timeline-overrides.css`）

```css
.kun-mobile-jump-latest {
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 5;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: 1px solid var(--ds-border);
  border-radius: 9999px;
  color: var(--ds-text);
  background: var(--ds-surface-elevated);
  box-shadow: var(--ds-shadow-overlay);
  transition: opacity .15s ease, transform .15s ease;
}
.kun-mobile-jump-latest[hidden] { display: none; }
.kun-mobile-jump-latest::after { content: ''; position: absolute; inset: -4px; }   /* 40 → 48 命中区 */
.kun-mobile-jump-latest[data-unread='true']::before {
  content: '';
  position: absolute;
  top: 1px;
  right: 1px;
  width: 9px;
  height: 9px;
  border: 2px solid var(--ds-surface-elevated);
  border-radius: 9999px;
  background: var(--ds-accent);
}
.kun-mobile-jump-latest:active { transform: scale(.94); }
@media (prefers-reduced-motion: reduce) { .kun-mobile-jump-latest { transition: none; } }
```

按钮用绝对定位挂在时间线容器内部。1.6 已经给 `.kun-mobile-code-timeline` 设置了 `position: relative`，所以按钮会跟着输入区高度自动上下移动，不需要计算键盘高度。

---

## 5. P2 条目

### U13 跨过 767px 时整个界面重载

**现状**：`mobile/remote-surface.ts:20` 用 `viewportWidth <= 767` 一刀切。平板横竖屏切换、拖动浏览器窗口宽度，在 767 附近来回跨越时，`AppShell` 会在 `<MobileApp/>` 和 `<WorkbenchView/>` 之间整体切换：桌面工作台是懒加载的，会出现「加载中」，手机端的页面状态（面板、滚动位置、草稿）也全部丢失。

**改动**
1. 切换留缓冲区间：进入手机模式的阈值是 ≤767，退出手机模式的阈值是 >900。

   ```ts
   export const MOBILE_MAX_WIDTH = 767
   export const MOBILE_EXIT_WIDTH = 900

   export function resolveRemoteSurface(
     environment: RemoteSurfaceEnvironment,
     previous?: RemoteSurface
   ): RemoteSurface {
     if (!environment.remote) return 'desktop'
     if (environment.override) return environment.override          // 见第 2 步
     const width = environment.viewportWidth
     if (previous === 'mobile' && isPositiveFinite(width) && width <= MOBILE_EXIT_WIDTH) return 'mobile'
     // …原有判断不变
   }
   ```

   `use-remote-surface.ts` 的 `update` 改为 `setSurface((previous) => currentRemoteSurface(previous))`。

2. 手动切换：URL 参数 `?surface=desktop|mobile` 会被写入 `sessionStorage['kun.remote.surface']`，作为 `override`。在手机设置页（U1）加「使用桌面版」，在桌面尺寸的 Remote 顶栏加「使用手机版」。
3. 测试：`remote-surface.test.ts` 补充——宽度 800 且上一次是 mobile 时仍是 mobile；宽度 800 且上一次是 desktop 时是 desktop；有 override 时以 override 为准。

### U14 底部导航

**现状**：「Code / bot / Work」大小写不统一（`roomsLabel` 是产品决定的小写 bot）；选中态整块灰底；徽标位置固定为 `left: 13px`，跟不同宽度的图标对不齐；搜索框聚焦弹出键盘时，导航栏会被顶到键盘上方，占掉约 60px。

**改动**
1. `use-mobile-viewport.ts` 的 `update()` 里加一行：`root.dataset.mobileKeyboard = bottom > 80 ? 'open' : 'closed'`（`bottom` 就是现在的 `--kun-mobile-bottom`），cleanup 时删除这个属性。
2. CSS（替换 `mobile-mode-nav.css`）：

```css
.kun-mobile-mode-nav {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  flex-shrink: 0;
  padding: 4px 8px calc(4px + env(safe-area-inset-bottom, 0px));
  border-top: 1px solid var(--ds-border-muted);
  background: var(--ds-surface-elevated);
}
/* 键盘弹出时隐藏导航，把空间还给内容 */
html[data-mobile-keyboard='open'] .kun-mobile-mode-nav { display: none; }

.kun-mobile-mode-nav button {
  display: flex;
  min-width: 0;
  min-height: 50px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  border: 0;
  border-radius: 12px;
  color: var(--ds-text-muted);
  background: transparent;
  font: inherit;
  font-size: 11.5px;
  font-weight: 500;
}
.kun-mobile-mode-nav button > span:last-child { text-transform: capitalize; }   /* bot → Bot，对中文无影响 */
/* 选中态：只在图标外面加一个胶囊背景（Material 3 风格），不再整块变灰 */
.kun-mobile-mode-nav button[aria-current='page'] { color: var(--ds-text); }
.kun-mobile-mode-nav button[aria-current='page'] .kun-mobile-mode-icon {
  background: var(--ds-surface-subtle);
}
.kun-mobile-mode-icon {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 28px;
  border-radius: 9999px;
  transition: background-color .15s ease;
}
.kun-mobile-mode-badge {
  position: absolute;
  top: -4px;
  left: calc(50% + 6px);            /* 以图标中心为基准，不依赖图标宽度 */
  min-width: 18px;
  height: 18px;
  padding-inline: 4px;
  border: 2px solid var(--ds-surface-elevated);
  border-radius: 9999px;
  box-sizing: border-box;
  color: var(--ds-bg-main);
  background: var(--ds-danger);     /* 需要处理的数量用红色，更醒目 */
  font-size: 10px;
  font-weight: 600;
  line-height: 14px;
  text-align: center;
}
@media (prefers-reduced-motion: reduce) { .kun-mobile-mode-icon { transition: none; } }
```

### U15 列表加载骨架屏

**现状**：项目列表和会话列表首次加载时只显示一行文字「加载中」。

**改动**：`MobileHome` 在 `loading && !threads.length` 时，渲染 6 行骨架（结构与 U7 的行一致）。

```css
.kun-mobile-skeleton-row {
  display: grid;
  gap: 8px;
  min-height: var(--kun-mobile-row-min);
  padding: 12px 0;
  border-top: 1px solid var(--ds-border-muted);
}
.kun-mobile-skeleton-row > span {
  display: block;
  height: 12px;
  border-radius: 6px;
  background: linear-gradient(90deg, var(--ds-surface-subtle) 0%, var(--ds-surface-hover) 50%, var(--ds-surface-subtle) 100%);
  background-size: 200% 100%;
  animation: kun-mobile-shimmer 1.2s linear infinite;
}
.kun-mobile-skeleton-row > span:first-child { width: 70%; height: 14px; }
.kun-mobile-skeleton-row > span:last-child { width: 45%; }
@keyframes kun-mobile-shimmer { to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .kun-mobile-skeleton-row > span { animation: none; } }
```

---

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

## 8. 验证方案

### 8.1 视口矩阵

| 视口 | 代表设备 | 必查页面 |
| --- | --- | --- |
| 320×568 | iPhone SE 1 代 | 全部 |
| 375×667 | iPhone SE 2/3 | 会话页、输入区 |
| 390×844 | iPhone 13/14 | 全部 |
| 430×932 | iPhone Pro Max | 列表、会话页 |
| 844×390 | 手机横屏 | 会话页（输入区、顶栏） |
| 768×1024 / 1024×768 | iPad 竖 / 横 | U13 切换缓冲 |

每个视口再分别检查：浅色 / 深色主题、`--ds-ui-scale` 为 0.85 / 1 / 1.25、键盘打开 / 关闭（用冒烟脚本里现成的 `resizeVisualViewport` 模拟）。

### 8.2 自动断言（扩展 `scripts/smoke-mobile-remote-code.mjs`）

在页面里执行下面的检查函数，每个视口都跑一遍：

```js
function mobileLayoutAudit() {
  const iw = innerWidth
  const overflow = [...document.querySelectorAll('.kun-mobile-app *')]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > iw + 1 })
    .map((el) => el.className?.toString().slice(0, 60))
  const smallTargets = [...document.querySelectorAll('.kun-mobile-app :is(button, [role=button], a, input, select, textarea)')]
    .filter((el) => el.offsetParent !== null)
    .map((el) => {
      const r = el.getBoundingClientRect()
      const after = getComputedStyle(el, '::after')
      const expanded = after.content !== 'none' && after.position === 'absolute'
      return { el, w: r.width, h: r.height, expanded }
    })
    .filter((t) => !t.expanded && (t.w < 44 || t.h < 44) && !(t.w >= 32 && t.h >= 32 && t.el.closest('[data-assistant-action-row]')))
    .map((t) => `${t.el.tagName}.${String(t.el.className).slice(0, 40)} ${Math.round(t.w)}x${Math.round(t.h)}`)
  const rawKeys = [...document.querySelectorAll('.kun-mobile-app *')]
    .filter((el) => el.childElementCount === 0 && /^[a-z]+[A-Z][A-Za-z]+$/.test(el.textContent?.trim() ?? ''))
    .map((el) => el.textContent.trim())
  return { overflow, smallTargets, rawKeys }
}
```

期望值：
- `overflow`、`smallTargets`、`rawKeys` 三个数组都为空；
- 会话页 390×844：`.kun-mobile-composer` 高度 ≤ 66px（不含安全区），`.kun-mobile-code-timeline` 高度 ≥ 视口高度的 85%；
- 会话列表：`.kun-mobile-thread-open` 高度 ≤ 64px；
- 设置路由：`document.body.innerText` 里不能长时间只有「加载中」（U1）。

### 8.3 真机检查（iPhone Safari + Android Chrome）

1. 长按 / 点按消息，能打开操作面板，复制、分叉、导出都能用（U2）；
2. 从 Work 页进入设置、断开运行时进入设置，都能正常返回（U1）；
3. 在最近会话里一次点击就进入会话（U8）；
4. 会话列表里运行中、等待输入的状态实时变化（U7）；
5. 往上翻看长会话后，「回到最新」按钮出现，有新输出时带小圆点（U12）；
6. iPad 横竖屏切换时不出现整页「加载中」（U13）；
7. 搜索框聚焦弹出键盘时，底部导航隐藏（U14）；
8. 桌面 Electron 回归：助手消息操作行仍然只在悬停时出现，子代理卡片的头像正常，设置页正常。

### 8.4 构建提醒

Remote 默认提供打包产物 `out/renderer`，iPhone Safari 只能用打包产物。改完需要 `npm run build`，或者重新打包安装后，手机上才能看到效果。
