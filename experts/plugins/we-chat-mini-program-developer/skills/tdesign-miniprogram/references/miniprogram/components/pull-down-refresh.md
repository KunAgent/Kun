# PullDownRefresh 下拉刷新

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-pull-down-refresh": "tdesign-miniprogram/pull-down-refresh/pull-down-refresh"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/5Uzn4Mml855j)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 顶部下拉刷新

由于组件内无法监听页面滚动，需要由页面获取组件实例，并将页面滚动事件传递到组件。

**WXML** (`html`):
```html
<t-pull-down-refresh
value="{{enable}}"
loadingTexts="{{['下拉刷新', '松手刷新', '正在刷新', '刷新完成']}}"
usingCustomNavbar
bind:refresh="onRefresh"
bind:scroll="onScroll"
>
<!-- 包裹页面全部内容 -->
<view class="demo">
<t-demo-header
title="PullDownRefresh 下拉刷新"
desc="用于快速刷新页面信息，刷新可以是整页刷新也可以是页面的局部刷新。"
notice="渲染框架支持情况：WebView"
/>
<view class="pulldown-refresh__content">
<t-skeleton rowCol="{{rowCol1}}" loading></t-skeleton>
<view class="row">
<t-skeleton rowCol="{{rowCol2}}" loading></t-skeleton>
<t-skeleton rowCol="{{rowCol2}}" loading></t-skeleton>
</view>
<view class="row">
<t-skeleton rowCol="{{rowCol2}}" loading></t-skeleton>
<t-skeleton rowCol="{{rowCol2}}" loading></t-skeleton>
</view>
<view class="row">
<t-skeleton rowCol="{{rowCol2}}" loading></t-skeleton>
<t-skeleton rowCol="{{rowCol2}}" loading></t-skeleton>
</view>
<view class="text">拖拽该区域演示 顶部下拉刷新</view>
</view>
<t-back-top text="顶部" scroll-top="{{scrollTop}}" visibility-height="{{100}}" />
</view>
</t-pull-down-refresh>

```

**JS** (`javascript`):
```javascript
Component({
data: {
enable: false,
rowCol1: [{ width: '100%', height: '342rpx', borderRadius: '24rpx' }],
rowCol2: [[{ width: '327rpx' }], [{ width: '200rpx' }], [{ size: '327rpx', borderRadius: '24rpx' }]],
scrollTop: 0,
},

ready() {
this.setData({ enable: true });
setTimeout(() => {
this.setData({ enable: false });
}, 1000);
},

methods: {
onRefresh() {
this.setData({ enable: true });
setTimeout(() => {
this.setData({ enable: false });
}, 1500);
},
onScroll(e) {
const { scrollTop } = e.detail;
this.setData({ scrollTop });
},
},
});

```

**CSS** (`css`):
```css
.demo {
padding-bottom: 56rpx;
overflow: hidden;
}

.demo-title {
font-size: 48rpx;
font-weight: 700;
line-height: 64rpx;
margin: 48rpx 32rpx 0;
color: var(--td-text-color-primary);
}

.demo-desc {
font-size: 28rpx;
color: var(--td-text-color-secondary);
margin: 16rpx 32rpx 0;
line-height: 44rpx;
}

.pulldown-refresh__content {
margin: 64rpx 32rpx 0;
position: relative;
}

.row {
display: flex;
justify-content: space-between;
margin-top: 32rpx;
}

.text {
position: absolute;
top: 152rpx;
left: 50%;
transform: translateX(-50%);
text-align: center;
font-size: 32rpx;
color: var(--td-text-color-disabled);
width: 686rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-pull-down-refresh": "tdesign-miniprogram/pull-down-refresh/pull-down-refresh",
"t-skeleton": "tdesign-miniprogram/skeleton/skeleton",
"t-back-top": "tdesign-miniprogram/back-top/back-top"
}
}

```

> 在使用 pull-down-refresh 组件的页面，建议开启 `disableScroll: true`

## API

### PullDownRefreshProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| disabled | Boolean | false | 是否禁用下拉刷新 | N |
| enable-back-to-top | Boolean | true | `1.1.5`。iOS点击顶部状态栏、安卓双击标题栏时，滚动条返回顶部，只支持竖向。自 2.27.3 版本开始，若非显式设置为 false，则在显示尺寸大于屏幕 90% 时自动开启 | N |
| enable-passive | Boolean | false | `1.1.5`。开启 passive 特性，能优化一定的滚动性能 | N |
| loading-bar-height | String / Number | 50 | 加载中下拉高度，如果值为数字则单位是：'px' | N |
| loading-props | Object | - | 加载loading样式。TS 类型：`LoadingProps`，Loading API Documents。详细类型定义 | N |
| loading-texts | Array | [] | 提示语，组件内部默认值为 ['下拉刷新', '松手刷新', '正在刷新', '刷新完成']。TS 类型：`string[]` | N |
| lower-threshold | String / Number | 50 | `1.1.5`。距底部/右边多远时，触发 scrolltolower 事件 | N |
| max-bar-height | String / Number | 80 | 最大下拉高度，如果值为数字则单位是：'px' | N |
| refresh-timeout | Number | 3000 | 刷新超时时间 | N |
| scroll-into-view | String | - | `1.1.5`。值应为某子元素id（id不能以数字开头）。设置哪个方向可滚动，则在哪个方向滚动到该元素 | N |
| show-scrollbar | Boolean | true | 滚动条显隐控制 (同时开启 enhanced 属性后生效) | N |
| success-duration | String / Number | 500 | 刷新成功提示展示时长，单位 'ms' | N |
| upper-threshold | String / Number | 50 | `1.1.5`。距顶部/左边多远时，触发 scrolltoupper 事件 | N |
| using-custom-navbar | Boolean | false | 是否使用了自定义导航栏 | N |
| value | Boolean | false | 组件状态，值为`true`表示下拉状态，值为`false`表示收起状态 | N |
| default-value | Boolean | undefined | 组件状态，值为`true`表示下拉状态，值为`false`表示收起状态。非受控属性 | N |

### PullDownRefreshEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| change | `(value: boolean)` | 下拉或收起时触发，用户手势往下滑动触发下拉状态，手势松开触发收起状态 |
| dragend | `(scrollTop: number, scrollLeft: number)` | `1.2.10`。滑动结束事件 |
| dragging | `(scrollTop: number, scrollLeft: number)` | `1.2.10`。滑动事件 |
| dragstart | `(scrollTop: number, scrollLeft: number)` | `1.2.10`。滑动开始事件 |
| refresh | - | 结束下拉时触发 |
| scrolltolower | - | 滚动到页面底部时触发 |
| timeout | - | 刷新超时触发 |

### PullDownRefreshSlots

| 名称 | 描述 |
| --- | --- |
| - | 默认插槽，自定义内容区域内容 |
| header | `1.2.10`。头部 |

### PullDownRefreshExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |
| t-class-indicator | 指示样式类 |
| t-class-loading | 加载样式类 |
| t-class-text | 文本样式类 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-pull-down-refresh-color | @text-color-placeholder | - |