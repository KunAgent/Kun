# Skyline 更新日志

Skyline 渲染引擎的版本号可通过 `wx.getSkylineInfo()` 获取。

## 1.4.15 (2026-01-09)

### 新增
- image 组件的 preload 属性，用于图片预加载

### 优化
- 当页面被遮挡时自动停止动画，减少资源消耗

### 修复
- iOS 上某个导致崩溃的问题
- 鸿蒙平台无障碍功能导致的闪退
- fixed 定位元素移动后未重新计算层级的问题
- box-shadow 在 CSS 动画中不生效及导致的闪退问题
- gif/apng 动图帧率错误的问题
- swiper 组件在某些情况下未触发 change 事件的问题
- 在 font 和 animation 简写属性中无法使用 CSS 变量的问题
- 安卓平台无障碍功能导致的闪退
- 图片预加载配置项不生效的问题
- scroll-view 组件在首次加载时出现跳动的问题

## 1.4.14 (2025-12-18)

### 新增
- text 组件支持行内显示
- image 组件支持 loadstart 事件

### 优化
- scroll-view 的滚动锚定行为，提升内容变化时的稳定性
- HTTP 客户端，移除并发限制以提升网络请求性能

### 修复
- image 组件在特定模式下图片不显示的问题
- 组件事件回调中潜在的崩溃问题
- iOS 上 JavaScript 回调导致的崩溃
- 文本节点更新时可能引发的死锁问题
- 键盘高度变化事件输出错误值的问题
- IntersectionObserver 在未设置 thresholds 时无法触发回调的问题
- 移除子组件操作时可能发生的崩溃
- 布局节点访问父节点时可能导致的崩溃
- 无障碍功能在鸿蒙系统上的崩溃问题
- swiper 组件应始终触发 change 事件
- scroll-view 滑动时首次加载内容跳动的问题

## 1.4.13 (2025-11-25)

### 新增
- 支持 CSS :host 选择器

### 优化
- scroll-view 滚动性能，提升渲染效率

### 修复
- gap 属性与 CSS 变量结合时失效的问题
- flex 布局中使用 gap 导致元素展示不全的问题
- snapshot 组件 pointer-events 属性不生效的问题
- 图片在尺寸为零时渲染错误的问题
- em 单位计算中基准 fontSize 错误的问题
- Intersection Observer 在某些情况下崩溃的问题
- svg 图片加载时可能出现的死循环问题
- 使用 mask-image 展示 svg 图片时出现灰色边框的问题
- open-container 组件纵向测量不准确的问题
- 图片闪烁问题
- 动图设置目标尺寸后显示异常的问题
- 伪元素节点连接问题导致交互失效

## 1.4.12 (2025-10-31)

### 新增
- layout paragraph 支持无障碍功能

### 优化
- 文本空白字符处理流程

### 修复
- grid-view 布局异常
- IntersectionObserver attached 时机失效
- scroll-view 下拉刷新动画异常
- iOS 平台原生视图异常消失
- 横向手势返回操作异常
- IntersectionObserver target 节点异常时的崩溃

## 1.4.11 (2025-09-15)

### 修复
- 文本末行换行符溢出仍出省略号
- input 取消 composite 后草稿字符丢失
- scroll-view scroll-anchoring 偶现意外跳动
- swiper 开启循环显示后 animateTo 动画错误
- scroll-view 自动撑高问题
- 自定义路由 barrierDismissible 两次返回
- 伪元素节点消失仍在播放 css animation
- 文本中 span 意外换行
- scroll-view 不足一屏时不触发 lower/upper 事件
- input/textarea maxlength 输入 emoji 闪退

## 1.4.10 (2025-08-28)

### 新增
- text 增加 trailing-spaces 属性支持多行文本末行末尾预留空间
- IntersectionObserver 支持多次监听
- open-container 支持通过接口方式触发打开

### 优化
- css animation 在节点不可见时停止动画
- scroll-view scroll-anchoring 支持度优化
- open-container 手势返回时支持上下拖动页面

### 修复
- swiper 开启自动播放后，隐藏 & 显示会失效
- image gif 动画修改 src 后动画速度异常
- word-break: break-all 需要断开数字、英文、符号
- grid-view 增加子节点后白屏
- swiper 更新高度后动画失效
- scroll-view 嵌套 swiper 时可能导致切换无动画
- 图片渲染变形
- open-container 手势返回动画消失
- 键盘上推后无法恢复

## 1.4.9 (2025-08-06)

### 新增
- large-image 支持大图渲染

### 优化
- css animation 无限循环动画自动开启 repaint boundary 避免大面积重绘
- text 绘制性能
- image 对 svg 格式的判断
- 渲染树结构优化

### 修复
- span 丢失问题
- sticky-header 动态增加内容崩溃
- gif 动画消失
- swiper animation 被打断时 bind:change 和 bind:animationfinished 没有回调
- grid-view 删除并交换元素后布局错位
- css 文本 baseline shortcut 问题
- line-height 无法更新回 normal 值
- swiper current 更新问题
- picker-view indicator-style 闪退
- iOS input 失焦的同时无法 focus
- 某些白屏及 crash 问题

## 1.4.6 (2025-04-08)

### 新增
- HarmonyOS 支持

### 优化
- 自定义字体隔离
- 开发者工具内核升级

### 修复
- 两个 sticky-section 滚动速度不一致
- 调整文字选区的默认背景色
- 若干 IntersectionListener 相关接口表现异常及 crash
- picker-view 设置非法值出现滚动
- swiper animationfinish 返回 current 参数不正确
- input 字体样式错误
- picker-view-column 无子项时崩溃
- 循环动画时无法触发 scroll-into-view
- swiper 更新高度后动画失效

## 1.4.1 (2024-10-16)

### 新增
- flex 布局支持 gap
- worklet 中 scroll-view scrollTo 支持传递 velocity 参数

### 优化
- jsbinding 调用耗时
- swiper 内嵌 scroll-view 滚动切换体验问题

### 修复
- css transition delay 动画闪烁问题
- swiper 设置 next margin/snap-to-edge 后隐藏再显示时会消失
- swiper 开启自动播放后隐藏再显示会失效
- picker-view 样式设置失败
- 键盘上推无法恢复
- 若干其他问题

## 1.4.0 (2024-09-06)

### 新增
- sticky-header 支持吸顶与否的状态回调
- scroll-view 支持 scroll-anchoring
- list-view/*-builder 支持设置 background-color
- swiper 支持 snap-to-edge

### 优化
- 图片布局尺寸变化时使用布局尺寸渲染
- 弱网下图片加载优化
- 内存释放优化
- 布局节点内存大小、缓存性能优化
- 布局精度

## 1.3.0 (2024-04-19)

### 新增
- 支持一般兄弟节点选择器（a ~ b {}）
- 支持紧邻兄弟节点选择器（a + b {}）
- 支持 css :not() 伪类
- 支持 css :only-child() 伪类
- 支持 css :empty() 伪类
- 支持 css inline-flex 布局
- 开发者工具支持 DarkMode 调试

### 优化
- position 布局增加 cache
- wxss 解析耗时
- transform paint 耗时
- transition/animation 事件派发机制
- 字体模块预热
- 内存占用

## 1.2.0 (2024-01-08)

### 新增
- 开发者工具支持真机调试
- CSS 支持 flex order
- CSS 支持 will-change: contents
- 支持全局跨页面组件
- 支持 apng 动图
- scroll-view 组件支持 builder 模式
- picker-view 组件支持 indicator-style 属性
- input 键盘动画提供 worklet 回调
- textarea 组件支持 linechange 事件
- worklet 增加 ref 机制
- worklet 支持 scrollTo 接口

## 1.1.0 (2023-11-06)

### 新增
- CSS 支持 position fixed
- span/text 组件里的布局节点支持 display inline-block
- draggable-sheet 滚动容器组件
- swiper 组件支持新的交互动画类型
- scroll-view 组件支持 type="nested"
- input 组件支持 cursor-color 属性
- input 组件支持 composition 事件
- input 组件支持 selectionchange 事件
- 自定义路由增加 fullscreenDrag 配置项
- 支持页面级别配置 rendererOptions

## 1.0.0 (2023-05-11)

### 新增
- CSS 支持 calc 函数
- CSS 支持伪元素 before 和 after
- CSS 支持 var 函数
- CSS 支持 mask-image 属性
- 支持 picker-view 组件
- scroll-view 组件支持 clip 属性
- scroll-view/grid-view/list-view/sticky-header/sticky-section 组件支持 padding 属性
- scroll-view 组件直接子节点支持 CSS margin
- scroll-view 组件支持 min-drag-distance 属性
- text/span 组件支持内联 view 等普通节点
- 支持新版本组件框架 glass-easel

---

更多历史版本请查看官方文档。
