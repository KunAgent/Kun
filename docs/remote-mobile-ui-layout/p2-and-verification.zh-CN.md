# Remote 手机端 · UI 布局优化计划 — P2 条目与验证方案（U13–U15)

> 总览与通用规范见 [README](./README.zh-CN.md);P0 见 [p0.zh-CN.md](./p0.zh-CN.md);P1 见 [p1.zh-CN.md](./p1.zh-CN.md)。

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
