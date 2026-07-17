# Worklet 动画概览

## 双线程架构与动画问题

小程序采用双线程架构，渲染线程（UI 线程）和逻辑线程（JS 线程）分离。JS 线程不会影响 UI 线程的动画表现（如滚动效果），但引入了新问题：UI 线程的事件发生后，需跨线程传递到 JS 线程，进而触发开发者回调。当做交互动画（如拖动元素）时，这种异步性会带来较大的延迟和不稳定。

**Worklet 动画**正是为解决这类问题而诞生的，使小程序可以做到类原生动画般的体验。

### 前置条件

- 确保开发者工具右上角 > 详情 > 本地设置里的「将 JS 编译成 ES5」选项被勾选（代码包体积会少量增加）
- Worklet 动画相关接口仅在 **Skyline 渲染模式**下才能使用
- 基础库版本要求：2.29.2+

## 概念一：Worklet 函数

一种声明在开发者代码中，可运行在 JS 线程或 UI 线程的函数，函数体顶部有 `'worklet'` 指令声明。

### 定义 worklet 函数

```js
function someWorklet(greeting) {
  'worklet'
  console.log(greeting)
}

// 运行在 JS 线程
someWorklet('hello') // print: hello

// 运行在 UI 线程
wx.worklet.runOnUI(someWorklet)('hello') // print: [ui] hello
```

### worklet 函数间相互调用

```js
const name = 'skyline'

function anotherWorklet() {
  'worklet'
  return 'hello ' + name
}

// worklet 函数间可互相调用
function someWorklet() {
  'worklet'
  const greeting = anotherWorklet()
  console.log('another worklet says ', greeting)
}

wx.worklet.runOnUI(someWorklet)()
// print: [ui] another worklet says hello skyline
```

### 从 UI 线程调回 JS 线程

当需要在 worklet 函数中调用非 worklet 的普通函数时，必须使用 `runOnJS`：

```js
function someFunc(greeting) {
  console.log('hello', greeting)
}

function someWorklet() {
  'worklet'
  // 访问非 worklet 函数时，需使用 runOnJS
  runOnJS(someFunc)('skyline')
}

wx.worklet.runOnUI(someWorklet)() // print: hello skyline
```

## 概念二：共享变量（SharedValue）

在 JS 线程创建，可在两个线程间同步的变量。

```js
const { shared, runOnUI } = wx.worklet

const offset = shared(0)
function someWorklet() {
  'worklet'
  console.log(offset.value) // print: 1
  offset.value = 2          // 在 UI 线程修改
  console.log(offset.value) // print: 2
}
offset.value = 1            // 在 JS 线程修改

runOnUI(someWorklet)()
```

由 `shared` 函数创建的变量称为 SharedValue 共享变量。用法上类比 Vue3 中的 `ref`，读写都需要通过 `.value` 属性。

### 跨线程共享数据

worklet 函数捕获的外部变量会被**序列化后拷贝**到 UI 线程，后续修改无法同步：

```js
const obj = { name: 'skyline' }
function someWorklet() {
  'worklet'
  console.log(obj.name) // 输出仍是 skyline（序列化时的值）
}
obj.name = 'change name'
wx.worklet.runOnUI(someWorklet)()
```

使用 SharedValue 可在线程间同步状态变化：

```js
const { shared, runOnUI } = wx.worklet
const offset = shared(0)
function someWorklet() {
  'worklet'
  console.log(offset.value) // 输出新值 1
}
offset.value = 1
runOnUI(someWorklet)()
```

## 驱动动画：applyAnimatedStyle

通过 `applyAnimatedStyle` 将共享变量绑定到节点样式，实现动画驱动。该方法可通过页面/组件实例访问。

```html
<view id="moved-box"></view>
<view id="btn" bind:tap="tap">点击驱动小球移动</view>
```

```js
Page({
  onLoad() {
    const offset = wx.worklet.shared(0)
    this.applyAnimatedStyle('#moved-box', () => {
      'worklet'
      return {
        transform: `translateX(${offset.value}px)`
      }
    })
    this._offset = offset
  },
  tap() {
    this._offset.value = Math.random()
  }
})
```

`applyAnimatedStyle` 的第二个参数 `updater` 为 worklet 函数，捕获了共享变量 `offset`。当 `offset` 的值变化时，`updater` 重新执行，将返回的新 `styleObject` 应用到选中节点。

> 配套接口：`clearAnimatedStyle` 可清除已绑定的动画样式。

## 示例：手势 + 动画

当 worklet 动画和手势结合时，可实现真正流畅的交互动画：

```html
<pan-gesture-handler onGestureEvent="handlepan">
  <view class="circle"></view>
</pan-gesture-handler>
```

```js
Page({
  onLoad() {
    const offset = wx.worklet.shared(0)
    this.applyAnimatedStyle('.circle', () => {
      'worklet'
      return {
        transform: `translateX(${offset.value}px)`
      }
    })
    this._offset = offset
  },
  handlepan(evt) {
    'worklet'
    if (evt.state === GestureState.ACTIVE) {
      this._offset.value += evt.deltaX
    }
  }
})
```

手指在 `circle` 节点上移动时产生平滑拖动效果。`handlepan` 回调触发在 UI 线程，修改 `offset` 值直接在 UI 线程产生动画，无需绕回 JS 线程。

## 示例：自定义动画曲线

```js
const { shared, Easing, timing } = wx.worklet
Page({
  onLoad() {
    const offset = shared(0)
    this.applyAnimatedStyle('#moved-box', () => {
      'worklet'
      return {
        transform: `translateX(${offset.value}px)`
      }
    })
    this._offset = offset
  },
  tap() {
    this._offset.value = timing(300, {
      duration: 200,
      easing: Easing.ease
    })
  }
})
```

## 注意事项（重要）

### 1. worklet 函数内调用 wx API

页面/组件实例中定义的 worklet 类型回调函数，内部访问 `wx` 上的接口，必须通过 `runOnJS` 调回 JS 线程：

```js
const { runOnJS, timing } = wx.worklet
Page({
  handleTap() {
    'worklet'
    const showModal = this.showModal.bind(this)
    
    // 场景一：直接返回 JS 线程
    runOnJS(showModal)(msg)
    
    // 场景二：动画完成回调里返回 JS 线程
    const toValue = 100
    timing(toValue, { duration: 300 }, () => {
      'worklet'
      runOnJS(showModal)(msg)
    })
    
    // 场景三：调用其它 worklet 函数（同步调用，无需 runOnJS）
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

### 2. Object.freeze 冻结问题

worklet 函数引用的外部变量，对象类型将被 `Object.freeze` 冻结。使用时需**直接访问对象上具体的属性**，不要解构：

```js
handleTap() {
  'worklet'
  
  // ✅ Correct - 直接访问属性，不会冻结 this.data
  const msg = `hello ${this.data.msg}`
  
  // ❌ Incorrect - 解构 this.data 会导致 this.data 被 Object.freeze 冻结
  // const { msg } = this.data  // setData 将失效！
}
```

### 3. 页面方法访问

Page method 必须通过 `this.methodName.bind(this)` 访问：

```js
handleTap() {
  'worklet'
  // ✅ 必须 bind(this)
  const showModal = this.showModal.bind(this)
  runOnJS(showModal)('hello')
}
```

## 与 WXS 响应事件的对比

| 对比项 | WXS 响应事件 | Worklet 动画 |
|--------|-------------|-------------|
| 适用引擎 | WebView | Skyline |
| 线程模型 | WXS 在视图层执行 | worklet 在 UI 线程执行 |
| 动画能力 | 仅样式和类操作 | 完整动画系统（timing/spring/decay） |
| 手势支持 | 基础 touch 事件 | 完整手势系统（pan/tap/long-press 等） |
| 基础库要求 | 2.4.4+ | 2.29.2+ |

## 相关接口汇总

- **基础类型**：`shared`、`derived`、`cancelAnimation`
- **工具函数**：`runOnUI`、`runOnJS`
- **动画类型**：`timing`、`spring`、`decay`
- **组合动画**：`sequence`、`repeat`、`delay`
- **缓动函数**：`Easing`
- **页面实例方法**：`applyAnimatedStyle`、`clearAnimatedStyle`
