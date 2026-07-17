# Fab 悬浮按钮

## 示例

该组件于 0.7.2 版本上线，请留意版本。
## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-fab": "tdesign-miniprogram/fab/fab"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/8ovNaMml8w5n)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 基础使用

**WXML** (`html`):
```html
<t-fab icon="add" bind:click="handleClick" aria-label="增加"></t-fab>

```

**JS** (`javascript`):
```javascript
Component({
methods: {
handleClick(e) {
console.log(e);
},
},
});

```

**CSS** (`css`):
```css

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-fab": "tdesign-miniprogram/fab/fab"
}
}

```

### 进阶使用

**WXML** (`html`):
```html
<t-fab icon="add" button-props="{{fabButton}}" bind:click="handleClick" text="分享给朋友" />

```

**JS** (`javascript`):
```javascript
Component({
data: {
fabButton: {
icon: 'share',
openType: 'share',
},
},
methods: {
handleClick(e) {
console.log(e);
},
},
});

```

**CSS** (`css`):
```css

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-fab": "tdesign-miniprogram/fab/fab"
}
}

```

### 可移动悬浮按钮

**WXML** (`html`):
```html
<t-fab
icon="gesture-press"
text="拖我"
aria-label="增加"
usingCustomNavbar
draggable
y-bounds="{{[0, 32]}}"
bind:click="handleClick"
bind:dragstart="handleDragStart"
bind:dragend="handleDragEnd"
></t-fab>

```

**JS** (`javascript`):
```javascript
Component({
methods: {
handleClick(e) {
console.log('handleClick: ', e);
},

handleDragStart(e) {
console.log('handleDragStart: ', e);
},

handleDragEnd(e) {
console.log('handleDragEnd: ', e);
},
},
});

```

**CSS** (`css`):
```css

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-fab": "tdesign-miniprogram/fab/fab"
}
}

```

### 带自动收缩功能

**WXML** (`html`):
```html
<t-fab
customStyle="{{scrolling ? 'right: 0;bottom:64px;' : 'right:16px;bottom:24px'}}"
bind:click="handleClick"
bind:dragstart="handleDragStart"
bind:dragend="handleDragEnd"
>
<view wx:if="{{!scrolling}}" class="wrap">
<view class="item">
<t-icon name="add-circle" size="20" />
<view class="text">添加</view>
</view>
<view class="item">
<t-icon name="star" size="20" />
<view class="text">收藏</view>
</view>
<view class="item">
<t-icon name="jump" size="20" />
<view class="text">分享</view>
</view>
</view>
<view wx:else class="symbol">
<t-icon name="chevron-left" size="20" />
</view>
</t-fab>

```

**JS** (`javascript`):
```javascript
import pageScrollMixin from 'tdesign-miniprogram/mixins/page-scroll';

Component({
behaviors: [pageScrollMixin()],
data: {
scrolling: false,
timer: null,
},
methods: {
handleClick(e) {
console.log('handleClick: ', e);
},
handleDragStart(e) {
console.log('handleDragStart: ', e);
},
handleDragEnd(e) {
console.log('handleDragEnd: ', e);
},
onScroll() {
clearTimeout(this.timer);
this.setData({
scrolling: true,
});
this.timer = setTimeout(() => {
this.setData({
scrolling: false,
});
}, 100);
},
},
});

```

**CSS** (`css`):
```css
.wrap {
border: 1px solid #dcdcdc;
display: flex;
flex-direction: column;
align-items: center;
justify-content: space-around;
padding: 8px 0;
border-radius: 22px;
box-shadow: 0px 5px 5px -3px rgba(0, 0, 0, 0.1), 0px 8px 10px 1px rgba(0, 0, 0, 0.06),
0px 3px 14px 2px rgba(0, 0, 0, 0.05);
background: rgba(255, 255, 255, 1);
width: 44px;
height: 156px;
box-sizing: border-box;
}

.item {
width: 100%;
height: 44px;
display: flex;
flex-direction: column;
align-items: center;
justify-content: flex-end;
font-size: 12px;
color: rgba(0, 0, 0, 0.9);
cursor: pointer;
}

.item:not(:last-child) {
margin-bottom: 4px;
}

.text {
height: 20px;
line-height: 20px;
}

.symbol {
width: 32px;
height: 32px;
display: flex;
align-items: center;
justify-content: center;
border-radius: 16px 0 0 16px;
background: #fff;

border: 1px solid #dcdcdc;
border-right: 0;
box-shadow: 0px 5px 5px -3px #0000001a, 0px 8px 10px 1px #0000000f, 0px 3px 14px 2px #0000000d;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-fab": "tdesign-miniprogram/fab/fab",
"t-icon": "tdesign-miniprogram/icon/icon"
}
}

```

## FAQ

### 为什么通过style/customStyle设置top/left调整初试定位后，会使页面内容无法点击以及拖拽异常？

由于 `position: fixed;` 会使得元素脱离文档流，它将悬浮于页面上方。同时，元素没有设置宽高，当同时使用 `top`、`right`、`bottom` 和 `left` 属性时，浏览器会根据给定的 `top`、`right`、`bottom` 和 `left` 创建一个矩形框来容纳元素及其内容，所以会出现元素覆盖页面内容及拖拽异常等问题。

Fab 组件默认定位 `right: 16px; bottom: 32px;`，且拖拽功能也是通过调整 `right` 与 `bottom` 属性值实现，因此在使用 `Fab` 组件时，仅支持通过 `style/customStyle` 属性设置 `right/bottom` 来调整初试位置， 避免使用 `top/left`。

### 开启Skyline渲染引擎后，组件所在页面崩溃？

因为 Skyline 还不支持多层阴影，要等微信官方处理。当下可参考 [#2865](https://github.com/Tencent/tdesign-miniprogram/issues/2865) 进行规避处理

## API

### FabProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| button-props | Object | - | 透传至 Button 组件。TS 类型：`ButtonProps`，Button API Documents。详细类型定义 | N |
| draggable | String / Boolean | false | 是否可拖拽。`true`/`'all'`可拖动<br>`'vertical'`可垂直拖动<br>`'horizontal'`可水平拖动<br>`false`禁止拖动。TS 类型：`boolean \| FabDirectionEnum ``type FabDirectionEnum = 'all' \| 'vertical' \| 'horizontal'`。详细类型定义 | N |
| icon | String | - | 图标 | N |
| text | String | - | 文本内容 | N |
| using-custom-navbar | Boolean | false | 是否使用了自定义导航栏 | N |
| y-bounds | Array | - | 设置垂直方向边界限制，示例：[48, 48] 或 ['96px', 80]。TS 类型：`Array<string \| number>` | N |

### FabEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| click | `(detail: {e: Event})` | 悬浮按钮点击事件 |
| drag-end | `(detail: { e: TouchEvent })` | 结束拖拽时触发 |
| drag-start | `(detail: { e: TouchEvent })` | 开始拖拽时触发 |

### FabSlots

| 名称 | 描述 |
| --- | --- |
| - | 默认插槽，按钮内容 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-fab-shadow | @shadow-2 | - |