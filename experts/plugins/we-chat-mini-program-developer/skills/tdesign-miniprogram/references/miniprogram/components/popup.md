# Popup 弹出层

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-popup": "tdesign-miniprogram/popup/popup"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/oDyr8Mmf8W57)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 组件类型

基础弹出层

**WXML** (`html`):
```html
<t-popup
visible="{{visible}}"
usingCustomNavbar
bind:visible-change="onVisibleChange"
placement="{{cur.value || 'top'}}"
>
<view class="block block--{{cur.value}}">{{cur.text}}</view>
</t-popup>

<t-button
wx:for="{{position}}"
wx:key="index"
block
size="large"
variant="outline"
theme="primary"
bind:tap="handlePopup"
data-item="{{item}}"
t-class="wrapper"
>
{{item.text}}
</t-button>

```

**JS** (`javascript`):
```javascript
Component({
data: {
cur: {},
position: [
{ value: 'top', text: '顶部弹出' },
{ value: 'left', text: '左侧弹出' },
{ value: 'center', text: '中间弹出' },
{ value: 'bottom', text: '底部弹出' },
{ value: 'right', text: '右侧弹出' },
],
},
methods: {
handlePopup(e) {
const { item } = e.currentTarget.dataset;

this.setData(
{
cur: item,
},
() => {
this.setData({ visible: true });
},
);
},
onVisibleChange(e) {
this.setData({
visible: e.detail.visible,
});
},
},
});

```

**CSS** (`css`):
```css
.block {
color: var(--td-text-color-secondary);
display: flex;
align-items: center;
justify-content: center;
}

.block--top,
.block--bottom {
width: 100vw;
height: 240px;
}

.block--left,
.block--right {
width: 280px;
height: 100%;
}

.block--center {
width: 240px;
height: 240px;
}

.wrapper {
margin-bottom: 32rpx;
}

.wrapper:last-child {
margin-bottom: 0;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-popup": "tdesign-miniprogram/popup/popup",
"t-button": "tdesign-miniprogram/button/button"
}
}

```

### 组件示例

应用示例

**WXML** (`html`):
```html
<t-popup visible="{{visible}}" bind:visible-change="onVisibleChange" placement="bottom">
<view class="block">
<view class="header">
<view class="btn btn--cancel" aria-role="button">取消</view>
<view class="title">标题文字</view>
<view class="btn btn--confirm" aria-role="button">确定</view>
</view>
</view>
</t-popup>

<t-button block size="large" variant="outline" theme="primary" bind:tap="handlePopup">底部弹出层-带标题及操作</t-button>

```

**JS** (`javascript`):
```javascript
Component({
data: {
cur: {},
position: [
{ value: 'top', text: '顶部弹出' },
{ value: 'left', text: '左侧弹出' },
{ value: 'center', text: '中间弹出' },
{ value: 'bottom', text: '底部弹出' },
{ value: 'right', text: '右侧弹出' },
],
},
methods: {
handlePopup(e) {
const { item } = e.currentTarget.dataset;

this.setData(
{
cur: item,
},
() => {
this.setData({ visible: true });
},
);
},
onVisibleChange(e) {
this.setData({
visible: e.detail.visible,
});
},
},
});

```

**CSS** (`css`):
```css
.block {
width: 100vw;
height: 240px;
background: var(--td-bg-color-container);
border-top-left-radius: 16rpx;
border-top-right-radius: 16rpx;
}

.header {
display: flex;
align-items: center;
height: 116rpx;
}

.title {
flex: 1;
text-align: center;
font-weight: 600;
font-size: 36rpx;
color: var(--td-text-color-primary);
}

.btn {
font-size: 32rpx;
padding: 32rpx;
}

.btn--cancel {
color: var(--td-text-color-secondary);
}

.btn--confirm {
color: #0052d9;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-popup": "tdesign-miniprogram/popup/popup",
"t-button": "tdesign-miniprogram/button/button"
}
}

```

**WXML** (`html`):
```html
<t-popup visible="{{visible}}" bind:visible-change="onVisibleChange" placement="center">
<view class="block">
<t-icon t-class="close-btn" name="close-circle" size="64rpx" color="#fff" bind:tap="onClose" />
</view>
</t-popup>

<t-button block size="large" variant="outline" theme="primary" bind:tap="handlePopup">
居中弹出层-带自定义关闭按钮
</t-button>

```

**JS** (`javascript`):
```javascript
Component({
data: {
cur: {},
position: [
{ value: 'top', text: '顶部弹出' },
{ value: 'left', text: '左侧弹出' },
{ value: 'center', text: '中间弹出' },
{ value: 'bottom', text: '底部弹出' },
{ value: 'right', text: '右侧弹出' },
],
},
methods: {
handlePopup(e) {
const { item } = e.currentTarget.dataset;

this.setData(
{
cur: item,
},
() => {
this.setData({ visible: true });
},
);
},
onVisibleChange(e) {
this.setData({
visible: e.detail.visible,
});
},
onClose() {
this.setData({
visible: false,
});
},
},
});

```

**CSS** (`css`):
```css
.block {
position: relative;
width: 240px;
height: 240px;
background: var(--td-bg-color-container);
border-radius: 16rpx;
}

.close-btn {
position: absolute;
left: 50%;
margin-left: -32rpx;
bottom: calc(-1 * (48rpx + 64rpx));
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-popup": "tdesign-miniprogram/popup/popup",
"t-icon": "tdesign-miniprogram/icon/icon",
"t-button": "tdesign-miniprogram/button/button"
}
}

```

## API

### PopupProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| close-btn | Boolean | - | 关闭按钮，值类型为 Boolean 时表示是否显示关闭按钮。也可以自定义关闭按钮 | N |
| close-on-overlay-click | Boolean | true | 点击遮罩层是否关闭 | N |
| content | String | - | 浮层里面的内容 | N |
| duration | Number | 240 | 动画过渡时间 | N |
| overlay-props | Object | {} | 遮罩层的属性，透传至 overlay。TS 类型：`OverlayProps`，Overlay API Documents。详细类型定义 | N |
| placement | String | top | 浮层出现位置。可选项：top/left/right/bottom/center | N |
| prevent-scroll-through | Boolean | true | 是否阻止背景滚动 | N |
| show-overlay | Boolean | true | 是否显示遮罩层 | N |
| using-custom-navbar | Boolean | false | 是否使用了自定义导航栏 | N |
| visible | Boolean | - | 是否显示浮层。TS 类型：`boolean` | N |
| default-visible | Boolean | undefined | 是否显示浮层。非受控属性。TS 类型：`boolean` | N |
| z-index | Number | 11500 | 组件层级，Web 侧样式默认为 5500，移动端样式默认为 1500，小程序样式默认为11500 | N |

### PopupEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| visible-change | `(visible: boolean, trigger: PopupSource) ` | 当浮层隐藏或显示时触发。详细类型定义。<br>`type PopupSource = 'close-btn' \| 'overlay'`<br> |

### PopupSlots

| 名称 | 描述 |
| --- | --- |
| - | 默认插槽，作用同`content`插槽 |
| close-btn | 自定义`close-btn`显示内容 |
| content | 自定义`content`显示内容 |

### PopupExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |
| t-class-content | 内容样式类 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-popup-bg-color | @bg-color-container | - |
| --td-popup-border-radius | @radius-extraLarge | - |
| --td-popup-close-btn-color | @text-color-primary | - |
| --td-popup-distance-top | 0 | - |
| --td-popup-transition | all 300ms ease | - |