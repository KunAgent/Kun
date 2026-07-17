# ActionSheet 动作面板

## 示例

该组件于 0.9.0 版本上线，请留意版本。
## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-action-sheet": "tdesign-miniprogram/action-sheet/action-sheet",
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/IQVKnNmp8i5e)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 组件类型

列表型动作面板

**WXML** (`html`):
```html
<t-action-sheet id="t-action-sheet" usingCustomNavbar bind:selected="handleSelected" />

<t-button size="large" variant="outline" bind:tap="handleAction" block theme="primary">常规列表型</t-button>

<t-button size="large" variant="outline" bind:tap="showDescAction" block theme="primary">带描述列表型</t-button>

<t-button size="large" variant="outline" bind:tap="showIconAction" block theme="primary">带图标列表型</t-button>

```

**JS** (`javascript`):
```javascript
import ActionSheet, { ActionSheetTheme } from 'tdesign-miniprogram/action-sheet';

Component({
methods: {
handleAction() {
ActionSheet.show({
theme: ActionSheetTheme.List,
selector: '#t-action-sheet',
context: this,
cancelText: 'cancel',
items: ['Move', 'Mark as important', 'Unsubscribe', 'Add to Tasks'],
});
},
showDescAction() {
ActionSheet.show({
theme: ActionSheetTheme.List,
selector: '#t-action-sheet',
context: this,
cancelText: 'cancel',
description: 'Email Settings',
items: ['Move', 'Mark as important', 'Unsubscribe', 'Add to Tasks'],
});
},
showIconAction() {
ActionSheet.show({
theme: ActionSheetTheme.List,
selector: '#t-action-sheet',
context: this,
cancelText: 'cancel',
items: [
{
label: 'Move',
icon: 'enter',
},
{
label: 'Mark as important',
icon: 'bookmark',
},
{
label: 'Unsubscribe',
icon: 'pin',
},
{
label: 'Add to Tasks',
icon: 'cloud-upload',
},
],
});
},
handleSelected(e) {
console.log(e.detail);
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
"t-action-sheet": "tdesign-miniprogram/action-sheet/action-sheet"
}
}

```

宫格型动作面板

**WXML** (`html`):
```html
<t-action-sheet id="t-action-sheet" usingCustomNavbar bind:selected="handleSelected" />

<t-button size="large" variant="outline" bind:tap="handleAction" block theme="primary">常规宫格型</t-button>

<t-button size="large" variant="outline" bind:tap="handleActionWithDesc" block theme="primary">常描述宫格型</t-button>

<t-button size="large" variant="outline" bind:tap="handleMultiAction" block theme="primary">带翻页宫格型</t-button>

```

**JS** (`javascript`):
```javascript
import ActionSheet, { ActionSheetTheme } from 'tdesign-miniprogram/action-sheet';

const firstGrid = [
{
label: '微信',
image: 'https://tdesign.gtimg.com/mobile/demos/wechat.png',
},
{
label: '朋友圈',
image: 'https://tdesign.gtimg.com/mobile/demos/times.png',
},
{
label: 'QQ',
image: 'https://tdesign.gtimg.com/mobile/demos/qq.png',
},
{
label: '企业微信',
image: 'https://tdesign.gtimg.com/mobile/demos/wecom.png',
},
{
label: '收藏',
icon: 'star',
},
{
label: '刷新',
icon: 'refresh',
},
{
label: '下载',
icon: 'download',
},
{
label: '复制',
icon: 'queue',
},
];

Component({
methods: {
handleAction() {
ActionSheet.show({
theme: ActionSheetTheme.Grid,
selector: '#t-action-sheet',
context: this,
items: firstGrid,
});
},
handleActionWithDesc() {
ActionSheet.show({
theme: ActionSheetTheme.Grid,
selector: '#t-action-sheet',
context: this,
items: firstGrid,
description: '动作面板描述文字',
});
},

handleMultiAction() {
ActionSheet.show({
theme: ActionSheetTheme.Grid,
selector: '#t-action-sheet',
context: this,
items: firstGrid.concat(
new Array(8).fill({
label: '标题文字',
icon: 'image',
}),
),
});
},
handleSelected(e) {
console.log(e.detail);
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
"t-action-sheet": "tdesign-miniprogram/action-sheet/action-sheet"
}
}

```

### 组件状态

宫格型动作面板

**WXML** (`html`):
```html
<t-action-sheet id="t-action-sheet" usingCustomNavbar bind:selected="handleSelected" />

<t-button size="large" variant="outline" bind:tap="handleAction" block theme="primary">列表型选项状态</t-button>

```

**JS** (`javascript`):
```javascript
import ActionSheet, { ActionSheetTheme } from 'tdesign-miniprogram/action-sheet';

Component({
methods: {
handleAction() {
ActionSheet.show({
theme: ActionSheetTheme.List,
selector: '#t-action-sheet',
context: this,
cancelText: 'cancel',
items: [
{
label: 'Move',
icon: 'enter',
},
{
label: 'Mark as important',
icon: 'bookmark',
color: '#0052D9',
},
{
label: 'Unsubscribe',
icon: 'pin',
color: '#E34D59',
},
{
label: 'Add to Tasks',
icon: 'cloud-upload',
disabled: true,
},
],
});
},
handleSelected(e) {
console.log(e.detail);
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
"t-action-sheet": "tdesign-miniprogram/action-sheet/action-sheet"
}
}

```

### 组件样式

列表型对齐方式

**WXML** (`html`):
```html
<t-action-sheet id="t-action-sheet" usingCustomNavbar bind:selected="handleSelected" />

<t-button size="large" variant="outline" custom-dataset="center" bind:tap="handleAction" block theme="primary"
>居中列表型</t-button
>

<t-button size="large" variant="outline" custom-dataset="left" bind:tap="handleAction" block theme="primary"
>左对齐列表型</t-button
>

```

**JS** (`javascript`):
```javascript
import ActionSheet, { ActionSheetTheme } from 'tdesign-miniprogram/action-sheet';

Component({
methods: {
handleAction(e) {
const align = e.detail.currentTarget.dataset.custom;

ActionSheet.show({
theme: ActionSheetTheme.List,
selector: '#t-action-sheet',
context: this,
cancelText: 'cancel',
align,
description: 'Email Settings',
items: [
{
label: 'Move',
icon: 'enter',
},
{
label: 'Mark as important',
icon: 'bookmark',
},
{
label: 'Unsubscribe',
icon: 'pin',
},
{
label: 'Add to Tasks',
icon: 'cloud-upload',
},
],
});
},
handleSelected(e) {
console.log(e.detail);
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
"t-action-sheet": "tdesign-miniprogram/action-sheet/action-sheet"
}
}

```

### 支持指令调用

```javascript
import ActionSheet, { ActionSheetTheme } from 'tdesign-miniprogram/action-sheet/index';

// 指令调用不同于组件引用不需要传入visible
const basicListOption: ActionSheetShowOption = {
theme: ActionSheetTheme.List,
selector: '#t-action-sheet',
items: [
{
label: '默认选项',
},
{
label: '失效选项',
disabled: true,
},
{
label: '警告选项',
color: '#e34d59',
},
],
};

const handler = ActionSheet.show(basicListOption);
```

指令调用的关闭如下

```javascript
handler.close();
```

## API

### ActionSheetProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| align | String | center | `0.29.0`。水平对齐方式。可选项：center/left | N |
| cancel-text | String | - | 设置取消按钮的文本 | N |
| count | Number | 8 | 设置每页展示菜单的数量，仅当 type=grid 时有效 | N |
| description | String | - | `0.29.0`。动作面板描述文字 | N |
| items | Array | - | 必需。菜单项。TS 类型：`Array<string \| ActionSheetItem>``interface ActionSheetItem { label: string; description?: string; color?: string; disabled?: boolean; icon?: string; suffixIcon?: string }`。详细类型定义 | Y |
| popup-props | Object | {} | 透传 Popup 组件全部属性。TS 类型：`PopupProps`，Popup API Documents。详细类型定义 | N |
| show-cancel | Boolean | true | 是否显示取消按钮 | N |
| show-overlay | Boolean | true | 是否显示遮罩层 | N |
| theme | String | list | 展示类型，列表和表格形式展示。可选项：list/grid | N |
| using-custom-navbar | Boolean | false | 是否使用了自定义导航栏 | N |
| visible | Boolean | false | 显示与隐藏 | N |
| default-visible | Boolean | undefined | 显示与隐藏。非受控属性 | N |

### ActionSheetEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| cancel | - | 点击取消按钮时触发 |
| close | `(trigger: ActionSheetTriggerSource)` | 关闭时触发。详细类型定义。<br>`type ActionSheetTriggerSource = 'overlay' \| 'command' \| 'select' `<br> |
| selected | `(selected: ActionSheetItem \| string, index: number)` | 选择菜单项时触发 |

### ActionSheetSlots

| 名称 | 描述 |
| --- | --- |
| - | 默认插槽，自定义内容区域内容 |

### ActionSheetExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |
| t-class-cancel | 取消样式类 |
| t-class-content | 内容样式类 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-action-sheet-border-color | @component-stroke | - |
| --td-action-sheet-border-radius | @radius-extraLarge | - |
| --td-action-sheet-cancel-color | @text-color-primary | - |
| --td-action-sheet-color | @text-color-primary | - |
| --td-action-sheet-description-color | @text-color-placeholder | - |
| --td-action-sheet-description-font | @font-body-medium | - |
| --td-action-sheet-disabled-color | @text-color-disabled | - |
| --td-action-sheet-dot-active-color | @brand-color | - |
| --td-action-sheet-dot-color | @text-color-disabled | - |
| --td-action-sheet-dot-size | 16rpx | - |
| --td-action-sheet-gap-color | @bg-color-page | - |