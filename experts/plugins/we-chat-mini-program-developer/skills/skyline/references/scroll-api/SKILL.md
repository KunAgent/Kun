---
name: skyline-scroll-api
description: Skyline 滚动控制 API 技能。涵盖 ScrollViewContext（程序化下拉刷新、下拉二级、滚动定位）、DraggableSheetContext（半屏面板程序化滚动）、worklet.scrollViewContext（UI 线程直接控制滚动）。适用于程序化触发刷新/二级、控制 DraggableSheet 位置、在 worklet 中操作滚动。触发关键词：ScrollViewContext、DraggableSheetContext、scrollTo、triggerRefresh、triggerTwoLevel、下拉刷新API、下拉二级API、滚动API、worklet scrollViewContext。
---

# Skyline 滚动控制 API

## 适用场景

- 程序化触发 scroll-view 下拉刷新或关闭刷新
- 程序化触发/关闭下拉二级（"二楼"页面）
- 通过 ScrollViewContext 控制滚动位置和行为
- 控制 DraggableSheet 半屏面板滚动到指定位置
- 在 worklet 函数中（UI 线程）直接控制 scroll-view 滚动

## 核心概念

### 三大 API 族群

| API 族群 | 获取方式 | 线程 | 最低基础库 |
|----------|----------|------|-----------|
| ScrollViewContext | `NodesRef.node()` + `enhanced` 属性 | 逻辑线程 | 2.14.4 |
| DraggableSheetContext | `NodesRef.node()` | 逻辑线程 | 3.2.0 |
| worklet.scrollViewContext | `NodesRef.ref()` + SharedValue | UI 线程 | 3.3.0 |

### 获取实例

```js
// ScrollViewContext（需开启 enhanced）
wx.createSelectorQuery().select('#scrollview').node()
  .exec(res => { const ctx = res[0].node })

// DraggableSheetContext
wx.createSelectorQuery().select('.sheet').node()
  .exec(res => { const ctx = res[0].node })

// worklet.scrollViewContext（通过 ref）
this.scrollRef = wx.worklet.shared()
this.createSelectorQuery().select('.scrollable')
  .ref(res => { this.scrollRef.value = res.ref }).exec()
```

## 文档索引

根据需求快速定位（路径相对于 `references/`）：

| 我想要... | 查阅文档 |
|-----------|----------|
| 查看 ScrollViewContext 全部方法和属性 | `api/scroll-view-context.md` |
| 了解 DraggableSheetContext.scrollTo 参数 | `api/draggable-sheet-context.md` |
| 在 worklet 中控制滚动 | `api/worklet-scroll-context.md` |
| 查看完整代码模式（刷新、二级、Sheet 控制） | `patterns.md` |

## 强制规则

### MUST（必须遵守）

1. **scroll-view 必须开启 `enhanced` 属性才能获取 ScrollViewContext**：

   ```html
   <!-- ❌ 错误：未开启 enhanced，node() 返回的不是 ScrollViewContext -->
   <scroll-view type="list" scroll-y>

   <!-- ✅ 正确 -->
   <scroll-view type="list" scroll-y enhanced>
   ```

2. **DraggableSheetContext.scrollTo 中 size 和 pixels 同时传入时，仅 size 生效**：

   ```js
   // ❌ 错误：同时传入 size 和 pixels，pixels 被忽略
   sheetContext.scrollTo({ size: 0.7, pixels: 200 })

   // ✅ 正确：二选一
   sheetContext.scrollTo({ size: 0.7 })   // 相对位置
   sheetContext.scrollTo({ pixels: 200 }) // 绝对位置
   ```

3. **worklet.scrollViewContext 必须通过 `NodesRef.ref` 获取引用并存入 SharedValue**：

   ```js
   // ❌ 错误：使用 node() 而非 ref()
   this.createSelectorQuery().select('.scroll').node()
     .exec(res => { /* 这是 ScrollViewContext，不是 worklet 引用 */ })

   // ✅ 正确：使用 ref() + shared()
   this.scrollRef = wx.worklet.shared()
   this.createSelectorQuery().select('.scroll')
     .ref(res => { this.scrollRef.value = res.ref }).exec()
   ```

4. **调用 worklet.scrollViewContext.scrollTo 的函数必须声明 `'worklet'` 指令**：

   ```js
   // ❌ 错误：缺少 worklet 指令
   onTap() {
     scrollViewContext.scrollTo(this.scrollRef.value, { top: 200 })
   }

   // ✅ 正确
   onTap() {
     'worklet'
     scrollViewContext.scrollTo(this.scrollRef.value, { top: 200 })
   }
   ```

### NEVER（禁止行为）

1. **NEVER** 在逻辑线程中调用 `worklet.scrollViewContext.scrollTo`——该 API 仅在 UI 线程（worklet 函数内）可用
2. **NEVER** 在小程序插件中使用 `worklet.scrollViewContext.scrollTo`——该 API 不支持小程序插件

## Quick Reference

### ScrollViewContext 方法速查

| 方法 | 说明 | 最低基础库 |
|------|------|-----------|
| `scrollTo({ top, left, velocity, duration, animated })` | 滚动至指定位置 | 2.14.4 |
| `scrollIntoView(selector, options?)` | 滚动至指定元素 | 2.14.4 |
| `triggerRefresh({ duration?, easingFunction? })` | 触发下拉刷新 | 3.0.0 |
| `closeRefresh()` | 关闭下拉刷新 | 3.0.0 |
| `triggerTwoLevel({ duration?, easingFunction? })` | 触发下拉二级 | 3.0.0 |
| `closeTwoLevel({ duration?, easingFunction? })` | 关闭下拉二级 | 3.0.0 |

### ScrollViewContext 属性速查

| 属性 | 类型 | 说明 |
|------|------|------|
| scrollEnabled | boolean | 滚动开关 |
| bounces | boolean | 边界弹性（仅 iOS） |
| showScrollbar | boolean | 显示滚动条 |
| pagingEnabled | boolean | 分页滑动 |
| fastDeceleration | boolean | 快速减速（仅 iOS） |
| decelerationDisabled | boolean | 取消滚动惯性（仅 iOS） |

### 场景决策表

| 场景 | 推荐 API |
|------|----------|
| 程序化触发下拉刷新 | `ScrollViewContext.triggerRefresh()` |
| 数据加载完成后关闭刷新 | `ScrollViewContext.closeRefresh()` |
| 打开/关闭下拉二级 | `triggerTwoLevel()` / `closeTwoLevel()` |
| 滚动到指定偏移量 | `ScrollViewContext.scrollTo({ top })` |
| 滚动到指定元素 | `ScrollViewContext.scrollIntoView(selector)` |
| 控制 DraggableSheet 位置 | `DraggableSheetContext.scrollTo({ size })` |
| UI 线程中控制滚动（配合手势） | `worklet.scrollViewContext.scrollTo()` |

### 程序化刷新最小示例

```js
// 获取 ScrollViewContext
wx.createSelectorQuery().select('#sv').node().exec(res => {
  const ctx = res[0].node
  ctx.triggerRefresh({ duration: 300 })
  // 数据加载完成后
  setTimeout(() => ctx.closeRefresh(), 2000)
})
```

## 相关技能

| 场景 | 推荐技能 | 说明 |
|------|----------|------|
| scroll-view 组件属性和事件 | `skyline-components` | scroll-view/draggable-sheet 组件详解 |
| Worklet 动画系统 | `skyline-worklet` | SharedValue、timing/spring、worklet 基础 |
| 页面转场路由 | `skyline-route` | 自定义路由、预设路由 |
| Skyline 概览与迁移 | `skyline-overview` | 渲染引擎概览、兼容性 |

## References 目录结构

```
references/
├── api/
│   ├── scroll-view-context.md     # ScrollViewContext 完整 API（属性+方法+参数）
│   ├── draggable-sheet-context.md  # DraggableSheetContext.scrollTo 详细参数
│   └── worklet-scroll-context.md   # worklet.scrollViewContext 详细参数与用法
└── patterns.md                     # 滚动 API 代码模式（刷新、二级、Sheet、worklet）
```
