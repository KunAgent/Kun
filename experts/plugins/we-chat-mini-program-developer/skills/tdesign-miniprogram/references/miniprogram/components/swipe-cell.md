# SwipeCell 滑动操作

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-swipe-cell": "tdesign-miniprogram/swipe-cell/swipe-cell"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/hfDOjNmY8Z5S)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 组件类型

左滑单操作

**WXML** (`html`):
```html
<t-swipe-cell>
<t-cell title="左滑单操作" note="辅助信息" bordered="{{false}}" />
<view slot="right" class="btn delete-btn" bind:tap="onDelete">删除</view>
</t-swipe-cell>

<t-swipe-cell>
<t-cell
bordered="{{false}}"
title="左滑大列表"
description="一段很长很长的内容文字"
note="辅助信息"
image="https://tdesign.gtimg.com/mobile/demos/avatar1.png"
/>
<view slot="right" class="btn delete-btn" bind:tap="onDelete">删除</view>
</t-swipe-cell>

<t-swipe-cell right="{{right}}" bind:click="onActionClick">
<t-cell title="左滑双操作" note="辅助信息" bordered="{{false}}" />
</t-swipe-cell>

<t-swipe-cell>
<t-cell title="左滑多操作" note="辅助信息" bordered="{{false}}" />
<view slot="right" class="btn-wrapper">
<view class="btn favor-btn" bind:tap="onFavor">收藏</view>
<view class="btn edit-btn" bind:tap="onEdit">编辑</view>
<view class="btn delete-btn" bind:tap="onDelete">删除</view>
</view>
</t-swipe-cell>

```

**JS** (`javascript`):
```javascript
Component({
data: {
right: [
{
text: '编辑',
className: 'btn edit-btn',
},
{
text: '删除',
className: 'btn delete-btn',
},
],
},
methods: {
onActionClick({ detail }) {
wx.showToast({ title: `你点击了${detail.text}`, icon: 'none' });
},

onDelete() {
wx.showToast({ title: '你点击了删除', icon: 'none' });
},
onEdit() {
wx.showToast({ title: '你点击了编辑', icon: 'none' });
},
onFavor() {
wx.showToast({ title: '你点击了收藏', icon: 'none' });
},
onChoice() {
wx.showToast({ title: '你点击了选择', icon: 'none' });
},
},
});

```

**CSS** (`css`):
```css
.btn-wrapper {
height: 100%;
}

.btn {
display: inline-flex;
justify-content: center;
align-items: center;
width: 120rpx;
height: 100%;
color: white;
}

.delete-btn {
background-color: #e34d59;
}

.edit-btn {
background-color: #ed7b2f;
}

.favor-btn {
background-color: var(--td-brand-color, #0052d9);
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-swipe-cell": "tdesign-miniprogram/swipe-cell/swipe-cell",
"t-cell": "tdesign-miniprogram/cell/cell"
}
}

```

右滑单操作

**WXML** (`html`):
```html
<t-swipe-cell>
<t-cell title="右滑单操作" note="辅助信息" bordered="{{false}}" />
<view slot="left" class="btn favor-btn" bind:tap="onChoice">选择</view>
</t-swipe-cell>

```

**JS** (`javascript`):
```javascript
Component({
methods: {
onChoice() {
wx.showToast({ title: '你点击了选择', icon: 'none' });
},
},
});

```

**CSS** (`css`):
```css
.btn {
display: inline-flex;
justify-content: center;
align-items: center;
width: 120rpx;
height: 100%;
color: white;
}

.favor-btn {
background-color: var(--td-brand-color, #0052d9);
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-swipe-cell": "tdesign-miniprogram/swipe-cell/swipe-cell",
"t-cell": "tdesign-miniprogram/cell/cell"
}
}

```

左右滑操作

**WXML** (`html`):
```html
<t-swipe-cell right="{{right}}" left="{{left}}" bind:click="onActionClick">
<t-cell title="左右滑操作" note="辅助信息" bordered="{{false}}" />
</t-swipe-cell>

```

**JS** (`javascript`):
```javascript
Component({
data: {
right: [
{
text: '删除',
className: 'btn delete-btn',
},
],
left: [
{
text: '选择',
className: 'btn favor-btn',
},
],
},

methods: {
onActionClick({ detail }) {
wx.showToast({ title: `你点击了${detail.text}`, icon: 'none' });
},
},
});

```

**CSS** (`css`):
```css
.btn {
display: inline-flex;
justify-content: center;
align-items: center;
width: 120rpx;
height: 100%;
color: white;
}

.favor-btn {
background-color: var(--td-brand-color, #0052d9);
}

.delete-btn {
background-color: #e34d59;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-swipe-cell": "tdesign-miniprogram/swipe-cell/swipe-cell",
"t-cell": "tdesign-miniprogram/cell/cell"
}
}

```

带图标的滑动操作

**WXML** (`html`):
```html
<t-swipe-cell right="{{right}}" bind:click="onActionClick">
<t-cell title="左滑-带图标文本双操作" note="辅助信息" bordered="{{false}}" />
</t-swipe-cell>

<t-swipe-cell right="{{rightIcon}}">
<t-cell title="左滑-仅带图标双操作" note="辅助信息" bordered="{{false}}" />
</t-swipe-cell>

<t-swipe-cell>
<t-cell
bordered="{{false}}"
title="左滑大列表-仅带图标双操作"
description="一段很长很长的内容文字"
note="辅助信息"
image="https://tdesign.gtimg.com/mobile/demos/avatar1.png"
/>
<view slot="right" class="btn-wrapper">
<view class="btn edit-btn column" bind:tap="onEdit">
<t-icon class="padding-bottom" name="edit" size="32rpx"></t-icon>
编辑
</view>
<view class="btn delete-btn column" bind:tap="onDelete">
<t-icon class="padding-bottom" name="delete" size="32rpx"></t-icon>
删除
</view>
</view>
</t-swipe-cell>

```

**JS** (`javascript`):
```javascript
Component({
data: {
right: [
{
text: '编辑',
icon: {
name: 'edit',
size: 16,
},
className: 'btn edit-btn',
},
{
text: '删除',
icon: {
name: 'delete',
size: 16,
},
className: 'btn delete-btn',
},
],
rightIcon: [
{
icon: 'edit',
className: 'btn edit-btn',
},
{
icon: 'delete',
className: 'btn delete-btn',
},
],
},
methods: {
onActionClick({ detail }) {
wx.showToast({ title: `你点击了${detail.text}`, icon: 'none' });
},

onDelete() {
wx.showToast({ title: '你点击了删除', icon: 'none' });
},
onEdit() {
wx.showToast({ title: '你点击了编辑', icon: 'none' });
},
onFavor() {
wx.showToast({ title: '你点击了收藏', icon: 'none' });
},
onChoice() {
wx.showToast({ title: '你点击了选择', icon: 'none' });
},
},
});

```

**CSS** (`css`):
```css
.btn-wrapper {
height: 100%;
}

.btn {
display: inline-flex;
justify-content: center;
align-items: center;
width: 120rpx;
height: 100%;
color: white;
}

.delete-btn {
background-color: #e34d59;
}

.edit-btn {
background-color: #ed7b2f;
}

.favor-btn {
background-color: var(--td-brand-color, #0052d9);
}

.column {
flex-direction: column;
}

.padding-bottom {
padding-bottom: 8rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-swipe-cell": "tdesign-miniprogram/swipe-cell/swipe-cell",
"t-cell": "tdesign-miniprogram/cell/cell",
"t-icon": "tdesign-miniprogram/icon/icon"
}
}

```

## FAQ

### SwipeCell组件在真机上无法滑动？

移除全局配置项: "componentFramework": "glass-easel"，详情见： [issue 2524](https://github.com/Tencent/tdesign-miniprogram/issues/2524)。如需使用 `skyline render`，建议页面级粒度开启。

## API

### SwipeCellProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| disabled | Boolean | - | 是否禁用滑动 | N |
| left | Array | - | 左侧滑动操作项。所有行为同`right`。TS 类型：`Array<SwipeActionItem>` | N |
| opened | Boolean / Array | false | 操作项是否呈现为打开态，值为数组时表示分别控制左右滑动的展开和收起状态。TS 类型：`boolean \| Array<boolean>` | N |
| right | Array | - | 右侧滑动操作项。有两种定义方式，一种是使用数组，二种是使用插槽。`right.text`表示操作文本，`right.className`表示操作项类名，`right.style`表示操作项样式，`right.onClick`表示点击操作项后执行的回调函数。示例：`[{ text: '删除', icon: 'delete', style: 'background-color: red', onClick: () => {} }]`。TS 类型：`Array<SwipeActionItem>``interface SwipeActionItem {text?: string; icon?: string \| object, className?: string; style?: string; onClick?: () => void; [key: string]: any }`。详细类型定义 | N |

### SwipeCellEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| click | `(action: SwipeActionItem, source: SwipeSource)` | 操作项点击时触发（插槽写法组件不触发，业务侧自定义内容和事件）。详细类型定义。<br>`type SwipeSource = 'left' \| 'right'`<br> |
| dragend | - | 滑动结束事件 |
| dragstart | - | 滑动开始事件 |

### SwipeCellSlots

| 名称 | 描述 |
| --- | --- |
| - | 默认插槽，自定义内容区域内容 |
| left | 左侧滑动操作项 |
| right | 右侧滑动操作项 |