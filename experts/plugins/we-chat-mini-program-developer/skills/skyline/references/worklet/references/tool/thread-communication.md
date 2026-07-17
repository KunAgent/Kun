# 线程通信：runOnUI 与 runOnJS

worklet 动画系统的核心机制是在 UI 线程执行动画逻辑。`runOnUI` 和 `runOnJS` 是在两个线程间切换执行上下文的关键工具。

## runOnUI — 在 UI 线程执行

### 签名

```
function worklet.runOnUI(function fn)
```

### 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| fn | function | worklet 类型函数 |

### 返回值

`function` — `runOnUI` 为高阶函数，返回一个函数，执行时运行在 UI 线程。

### 基本用法

```js
function someWorklet(greeting) {
  'worklet'
  console.log('hello', greeting) // print: [ui] hello Skyline
}

// runOnUI 返回新函数，调用时传参
wx.worklet.runOnUI(someWorklet)('Skyline')
```

### 使用场景

1. **从 JS 线程手动触发 UI 线程逻辑**

```js
const { shared, runOnUI } = wx.worklet

const offset = shared(0)

function startAnimation() {
  'worklet'
  offset.value = timing(100)
}

// 在某个时机触发
runOnUI(startAnimation)()
```

2. **传递参数到 UI 线程**

```js
function updatePosition(x, y) {
  'worklet'
  offsetX.value = x
  offsetY.value = y
}

// 传递多个参数
runOnUI(updatePosition)(100, 200)
```

> **注意**：手势回调（如 `onGestureEvent`）和 `applyAnimatedStyle` 的 updater 函数已自动在 UI 线程执行，无需额外使用 `runOnUI`。

---

## runOnJS — 回调 JS 线程

### 签名

```
function worklet.runOnJS(function fn)
```

### 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| fn | function | 未声明为 worklet 类型的**普通函数** |

### 返回值

`function` — `runOnJS` 为高阶函数，返回一个函数，执行时运行在 JS 线程。

### 为什么需要 runOnJS？

worklet 函数运行在 UI 线程时，捕获的外部函数可能为 worklet 类型或普通函数。为了明确区分：
- 调用其它 **worklet 函数**时是**同步调用**
- 在 UI 线程执行 **JS 线程的函数**只能是**异步**

开发者容易混淆，试图同步获取 JS 线程的返回值，因此强制要求使用 `runOnJS`。

### 基本用法

```js
function someFunc(greeting) {
  console.log('hello', greeting)
}

function someWorklet() {
  'worklet'
  runOnJS(someFunc)('Skyline')
}

wx.worklet.runOnUI(someWorklet)()
```

---

## 页面/组件中的三种调用场景

```js
const { runOnJS, timing } = wx.worklet

Page({
  data: { msg: 'Skyline' },

  handleTap() {
    'worklet'
    // ⚠️ 直接访问属性，不要解构 this.data
    const msg = `hello ${this.data.msg}`

    // ⚠️ 页面方法必须 bind(this)
    const showModal = this.showModal.bind(this)

    // 场景一：直接返回 JS 线程
    runOnJS(showModal)(msg)

    // 场景二：动画完成回调里返回 JS 线程
    const toValue = 100
    timing(toValue, { duration: 300 }, () => {
      'worklet'
      runOnJS(showModal)(msg)
    })

    // 场景三：调用其它 worklet 函数（同步，无需 runOnJS）
    this.doSomething()
  },

  doSomething() {
    'worklet'
  },

  showModal(msg) {
    wx.showModal({ title: msg })
  }
})
```

## 关键规则总结

| 规则 | 说明 |
|------|------|
| **MUST** bind(this) | 页面方法在 worklet 中使用时必须 `this.method.bind(this)` |
| **MUST** runOnJS | worklet 中调用普通函数必须用 `runOnJS` 包裹 |
| **NEVER** 解构 this.data | `const { msg } = this.data` 会触发 Object.freeze 冻结 |
| **NEVER** 直接调用 wx API | worklet 中不能直接调用 `wx.showModal` 等，需 runOnJS |
| worklet 间调用是同步的 | worklet 函数调用另一个 worklet 函数是同步的，不需要 runOnJS |
| runOnJS 调用是异步的 | 不能依赖 runOnJS 的返回值 |

## 数据流向图

```
JS 线程                          UI 线程
─────────                       ─────────
  │                                │
  │  runOnUI(workletFn)(args)      │
  │ ─────────────────────────────> │
  │                                │ workletFn 执行
  │                                │ 修改 SharedValue
  │                                │ 驱动 applyAnimatedStyle
  │                                │
  │  runOnJS(normalFn)(args)       │
  │ <───────────────────────────── │
  │                                │
  │ normalFn 执行（异步）            │
  │ 可调用 wx API                   │
```
