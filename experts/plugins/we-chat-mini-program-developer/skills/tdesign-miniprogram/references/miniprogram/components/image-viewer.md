# ImageViewer 图片预览

## 示例

该组件于 0.10.0 版本上线，请留意版本。
## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-image-viewer": "tdesign-miniprogram/image-viewer/image-viewer",
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/0qyn8MmS8d52)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 类型

#### 基础图片预览

**WXML** (`html`):
```html
<t-button theme="primary" size="large" variant="outline" block bind:tap="onClick">基础图片预览</t-button>
<t-toast id="t-toast" />
<t-image-viewer
usingCustomNavbar
deleteBtn="{{deleteBtn}}"
closeBtn="{{closeBtn}}"
showIndex="{{showIndex}}"
visible="{{visible}}"
images="{{images}}"
bind:change="onChange"
bind:delete="onDelete"
bind:close="onClose"
></t-image-viewer>

```

**JS** (`javascript`):
```javascript
import Toast from 'tdesign-miniprogram/toast/index';

Component({
data: {
visible: false,
showIndex: false,
closeBtn: false,
deleteBtn: false,
images: [],
},
methods: {
onClick() {
this.setData({
images: [
'https://tdesign.gtimg.com/mobile/demos/swiper1.png',
'https://tdesign.gtimg.com/mobile/demos/swiper2.png',
],
showIndex: true,
visible: true,
});
},
onChange(e) {
const { index } = e.detail;

console.log('change', index);
},

onDelete(e) {
const { index } = e.detail;

Toast({
context: this,
selector: '#t-toast',
message: `删除第${index + 1}个`,
});
},

onClose(e) {
const { trigger } = e.detail;
console.log(trigger);
this.setData({
visible: false,
});
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
"t-button": "tdesign-miniprogram/button/button",
"t-toast": "tdesign-miniprogram/toast/toast",
"t-image-viewer": "tdesign-miniprogram/image-viewer/image-viewer"
}
}

```

#### 带操作图片预览

顶部区域可以配置关闭按钮、页码信息、删除按钮。

**WXML** (`html`):
```html
<t-button theme="primary" size="large" variant="outline" block bind:tap="onClick">带操作图片预览</t-button>

<t-action-sheet id="t-action-sheet" />

<t-image-viewer
usingCustomNavbar
deleteBtn="{{deleteBtn}}"
closeBtn="{{closeBtn}}"
showIndex="{{showIndex}}"
visible="{{visible}}"
images="{{images}}"
bind:change="onChange"
bind:delete="onDelete"
bind:close="onClose"
></t-image-viewer>

```

**JS** (`javascript`):
```javascript
import ActionSheet from 'tdesign-miniprogram/action-sheet/index';

Component({
data: {
visible: false,
showIndex: false,
closeBtn: false,
deleteBtn: false,
images: [],
},
methods: {
onClick() {
this.setData({
images: [
'https://tdesign.gtimg.com/mobile/demos/swiper1.png',
'https://tdesign.gtimg.com/mobile/demos/swiper2.png',
],
showIndex: true,
visible: true,
closeBtn: true,
deleteBtn: true,
});
},
onChange(e) {
const { index } = e.detail;

console.log(index);
},

onDelete(e) {
const { index } = e.detail;

console.log(index);

ActionSheet.show({
context: this,
selector: '#t-action-sheet',
description: '要删除这张照片吗？',
items: [
{
label: '删除',
color: '#d54941',
},
],
});
},

onClose(e) {
const { trigger } = e.detail;

console.log(trigger);
this.setData({
visible: false,
});
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
"t-button": "tdesign-miniprogram/button/button",
"t-action-sheet": "tdesign-miniprogram/action-sheet/action-sheet",
"t-image-viewer": "tdesign-miniprogram/image-viewer/image-viewer"
}
}

```

> 当使用自定义导航栏的时候，顶部的操作按钮会被遮挡，此时需要开启 `using-custom-navbar` 来解决

## API

### ImageViewerProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| background-color | String | - | 遮罩的背景颜色 | N |
| close-btn | String / Boolean / Object | false | 是否显示关闭操作，前提需要开启页码。值为字符串表示图标名称，值为`true`表示使用默认图标`close`，值为`Object`类型，表示透传至`icon`，不传表示不显示图标 | N |
| delete-btn | String / Boolean / Object | false | 是否显示删除操作，前提需要开启页码。值为字符串表示图标名称，值为`true`表示使用默认图标`delete`，值为`Object`类型，表示透传至`icon`，不传表示不显示图标 | N |
| image-props | Object | - | `1.12.0`。透传至 Image 组件。TS 类型：`ImageProps`，Image API Documents。详细类型定义 | N |
| images | Array | [] | 图片数组。TS 类型：`Array<string>` | N |
| initial-index | Number | 0 | 初始化页码。TS 类型：`Number` | N |
| lazy | Boolean | true | `1.9.4`。是否开启图片懒加载。开启后会预加载当前图片、相邻图片 | N |
| show-index | Boolean | false | 是否显示页码 | N |
| using-custom-navbar | Boolean | false | `v1.1.4`。是否使用了自定义导航栏 | N |
| visible | Boolean | false | 隐藏/显示预览 | N |
| default-visible | Boolean | undefined | 隐藏/显示预览。非受控属性 | N |

### ImageViewerEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| change | `(index: number)` | 翻页时回调 |
| close | `(trigger: 'overlay' \| 'button', visible: Boolean, index: Number)` | 点击操作按钮button或者overlay时触发 |
| delete | `(index: number)` | 点击删除操作按钮时触发 |

### ImageViewerSlots

| 名称 | 描述 |
| --- | --- |
| close-btn | 关闭操作 |
| delete-btn | 删除操作 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-image-viewer-close-margin-left | @spacer-1 | - |
| --td-image-viewer-delete-margin-right | @spacer-1 | - |
| --td-image-viewer-mask-bg-color | @mask-active | - |
| --td-image-viewer-nav-bg-color | #000 | - |
| --td-image-viewer-nav-color | @text-color-anti | - |
| --td-image-viewer-nav-height | 96rpx | - |
| --td-image-viewer-nav-index-font-size | @font-size-base | - |
| --td-image-viewer-top | @position-fixed-top | - |