---
name: skyline-worklet
description: Skyline Worklet 动画系统技能。使用 worklet 函数、共享变量（SharedValue）、动画类型（timing/spring/decay）、Easing 缓动函数、组合动画和线程通信（runOnUI/runOnJS）开发高性能交互动画时使用此技能。适用于拖拽、手势跟随、弹簧回弹等需要 UI 线程直接响应的动画场景。触发关键词：worklet、worklet 动画、SharedValue、共享变量、timing、spring、decay、Easing、runOnUI、runOnJS、applyAnimatedStyle、交互动画、手势动画、UI 线程动画。
---

# Worklet 动画系统

## 适用场景

- 实现手势跟随、拖拽等交互动画
- 使用 timing/spring/decay 创建动画效果
- 通过 SharedValue 驱动节点样式变化
- 组合多段动画（序列、重复、延迟）
- 在 UI 线程和 JS 线程间传递数据

## 核心概念

### 双线程架构与 Worklet 的意义

小程序双线程架构中，UI 事件需跨线程传递到 JS 线程再回传，**交互动画会有明显延迟**。Worklet 动画让动画逻辑直接运行在 UI 线程，实现类原生动画体验。

### 三大核心概念

| 概念 | 说明 | 关键 API |
|------|------|----------|
| **worklet 函数** | 可运行在 JS 或 UI 线程的函数，顶部声明 `'worklet'` 指令 | `runOnUI()`, `runOnJS()` |
| **共享变量** | 跨线程同步的变量，通过 `.value` 读写 | `shared()`, `derived()` |
| **动画驱动** | 将 SharedValue 绑定到节点样式 | `applyAnimatedStyle()` |

### 基本流程

```js
const { shared, timing } = wx.worklet

// 1. 创建共享变量
const offset = shared(0)

// 2. 绑定到节点样式（updater 为 worklet 函数）
this.applyAnimatedStyle('#box', () => {
  'worklet'
  return { transform: `translateX(${offset.value}px)` }
})

// 3. 修改值驱动动画
offset.value = timing(300, { duration: 200 })
```

## 文档索引

根据需求快速定位（路径相对于 `references/`）：

| 我想要... | 查阅文档 |
|-----------|----------|
| 了解 worklet 架构和完整概念 | `core/worklet-overview.md` |
| 使用 SharedValue 和 DerivedValue | `base/shared-derived.md` |
| 在 worklet 中操作 scroll-view | `base/scroll-view-context.md` |
| 使用 timing/spring/decay 动画 | `animation/timing-spring-decay.md` |
| 查看 Easing 缓动函数 | `animation/easing.md` |
| 使用序列/重复/延迟组合动画 | `animation/combine-animation.md` |
| 了解 runOnUI/runOnJS 线程通信 | `tool/thread-communication.md` |

## 强制规则

### MUST: worklet 函数必须声明 `'worklet'` 指令

```js
// ✅ Correct
function handleGesture(evt) {
  'worklet'
  offset.value += evt.deltaX
}

// ❌ Incorrect - 缺少 'worklet' 指令，无法在 UI 线程执行
function handleGesture(evt) {
  offset.value += evt.deltaX
}
```

### MUST: SharedValue 必须通过 `.value` 读写

```js
// ✅ Correct
const offset = shared(0)
offset.value = 100

// ❌ Incorrect - 直接赋值会替换整个 SharedValue 对象
const offset = shared(0)
offset = 100
```

### MUST: 访问非 worklet 函数必须使用 `runOnJS`

```js
// ✅ Correct
function showModal(msg) {
  wx.showModal({ title: msg })
}
function handleTap() {
  'worklet'
  const fn = this.showModal.bind(this)
  runOnJS(fn)('hello')
}

// ❌ Incorrect - worklet 中直接调用普通函数
function handleTap() {
  'worklet'
  this.showModal('hello')
}
```

### MUST: 页面方法必须通过 `this.methodName.bind(this)` 访问

```js
// ✅ Correct
handleTap() {
  'worklet'
  const showModal = this.showModal.bind(this)
  runOnJS(showModal)(msg)
}

// ❌ Incorrect - 未 bind(this)，this 指向丢失
handleTap() {
  'worklet'
  runOnJS(this.showModal)(msg)
}
```

### MUST: Worklet 动画仅在 Skyline 渲染模式下可用
   - 确保 app.json 配置 `"renderer": "skyline"`
   - 确保开发者工具勾选「将 JS 编译成 ES5」

### NEVER: 在 worklet 函数中直接调用 `wx` API

必须通过 `runOnJS` 回到 JS 线程。

### NEVER: 通过解构 `this.data` 访问属性

会导致 `Object.freeze` 冻结 `this.data`，`setData` 将失效。

```js
// ✅ Correct
handleTap() {
  'worklet'
  const msg = this.data.msg
}

// ❌ Incorrect - 解构会冻结整个 this.data
handleTap() {
  'worklet'
  const { msg } = this.data
}
```

## Quick Reference

### API 速查表

| 分类 | API | 说明 |
|------|-----|------|
| 基础 | `shared(initialValue)` | 创建 SharedValue |
| 基础 | `derived(updaterWorklet)` | 创建衍生值（类比 computed） |
| 基础 | `cancelAnimation(sharedValue)` | 取消动画 |
| 动画 | `timing(toValue, options?, callback?)` | 时间曲线动画（默认 300ms） |
| 动画 | `spring(toValue, options?, callback?)` | 弹簧物理动画 |
| 动画 | `decay(options?, callback?)` | 滚动衰减动画 |
| 组合 | `sequence(anim1, anim2, ...)` | 依次执行 |
| 组合 | `repeat(anim, reps, reverse?, callback?)` | 重复（负值=无限） |
| 组合 | `delay(ms, anim)` | 延迟执行 |
| 工具 | `runOnUI(workletFn)` | 在 UI 线程执行 |
| 工具 | `runOnJS(normalFn)` | 回调 JS 线程 |

### 场景 → 方案映射

| 场景 | 推荐方案 |
|------|----------|
| 点击后平滑移动 | `timing` + `Easing` |
| 手势松开回弹 | `spring` |
| 手势松开惯性滑动 | `decay` + `velocity` |
| 先移动再弹回 | `sequence(timing, spring)` |
| 循环脉动效果 | `repeat(timing, -1, true)` |
| 延迟后开始动画 | `delay(ms, timing/spring)` |

## 相关技能

| 场景 | 推荐技能 | 说明 |
|------|----------|------|
| 手势组件 | `skyline-components` | pan/tap/long-press 手势处理 |
| 渲染引擎概览 | `skyline-overview` | Skyline 配置和迁移 |
| 样式开发 | `skyline-wxss` | WXSS 支持与差异 |
| 路由转场 | `skyline-route` | 自定义路由动画 |

## References 目录结构

```
references/
├── core/
│   └── worklet-overview.md       # Worklet 概念、架构、完整示例
├── base/
│   ├── shared-derived.md         # SharedValue、DerivedValue、cancelAnimation
│   └── scroll-view-context.md    # worklet 内操作 scroll-view
├── animation/
│   ├── timing-spring-decay.md    # 三种基础动画类型
│   ├── easing.md                 # Easing 缓动函数完整参考
│   └── combine-animation.md      # sequence/repeat/delay 组合动画
└── tool/
    └── thread-communication.md   # runOnUI/runOnJS 线程通信
```
