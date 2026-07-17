# Sticky 吸顶容器

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-sticky": "tdesign-miniprogram/sticky/sticky"
}
```

## 代码演示

将内容包裹在 `Sticky` 组件内

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/YLDNkNmz8Q5S)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 基础吸顶

**WXML** (`html`):
```html
<t-sticky offset-top="{{navbarHeight}}">
<t-button size="large" theme="primary" t-class="external-class">基础吸顶</t-button>
</t-sticky>

```

**JS** (`javascript`):
```javascript
Component({
properties: {
navbarHeight: {
type: Number,
value: 0,
},
},
});

```

**CSS** (`css`):
```css
.external-class {
width: 208rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-sticky": "tdesign-miniprogram/sticky/sticky",
"t-button": "tdesign-miniprogram/button/button"
}
}

```

### 吸顶距离

**WXML** (`html`):
```html
<t-sticky offset-top="{{ 40 + navbarHeight }}">
<t-button size="large" theme="danger" t-class="external-class">吸顶距离</t-button>
</t-sticky>

```

**JS** (`javascript`):
```javascript
Component({
properties: {
navbarHeight: {
type: Number,
value: 0,
},
},
});

```

**CSS** (`css`):
```css
.external-class {
width: 208rpx;
margin-left: 272rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-sticky": "tdesign-miniprogram/sticky/sticky",
"t-button": "tdesign-miniprogram/button/button"
}
}

```

### 指定容器

**WXML** (`html`):
```html
<view class="wrapper">
<t-sticky container="{{ container }}" offset-top="{{navbarHeight}}">
<t-button size="large" t-class="external-class green-button" hover-class="hover-class ">指定容器</t-button>
</t-sticky>
</view>

```

**JS** (`javascript`):
```javascript
Component({
properties: {
navbarHeight: {
type: Number,
value: 0,
},
},

data: {
container: null,
},

lifetimes: {
ready: function () {
this.setData({
container: () => this.createSelectorQuery().select('.wrapper'),
});
},
},
});

```

**CSS** (`css`):
```css
.wrapper {
width: 100%;
height: 150px;
background-color: var(--bg-color-demo-secondary);
}

.external-class {
width: 208rpx;
margin-left: 512rpx;
}

.green-button {
z-index: 0 !important;
background-color: #008858 !important;
color: #fff !important;
}

.hover-class::after {
z-index: -1;
background-color: #006c45;
border-color: #006c45;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"styleIsolation": "shared",
"usingComponents": {
"t-sticky": "tdesign-miniprogram/sticky/sticky",
"t-button": "tdesign-miniprogram/button/button"
}
}

```

## API

### StickyProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| container | Function | - | 函数返回容器对应的 NodesRef 节点，将对应节点指定为组件的外部容器，滚动时组件会始终保持在容器范围内，当组件即将超出容器底部时，会返回原位置 | N |
| disabled | Boolean | false | 是否禁用组件 | N |
| offset-top | String / Number | 0 | 吸顶时与顶部的距离，单位`px` | N |
| z-index | Number | 99 | 吸顶时的 z-index | N |

### StickyEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| scroll | `(detail: { scrollTop: number, isFixed: boolean })` | 滚动时触发，scrollTop: 距离顶部位置，isFixed: 是否吸顶 |

### StickySlots

| 名称 | 描述 |
| --- | --- |
| - | 默认插槽，自定义内容区域内容 |

### StickyExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |
| t-class-content | 内容样式类 |