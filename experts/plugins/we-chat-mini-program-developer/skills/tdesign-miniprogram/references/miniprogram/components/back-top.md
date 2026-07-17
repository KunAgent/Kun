# BackTop 返回顶部

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-back-top": "tdesign-miniprogram/back-top/back-top",
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/miU0GNmy8X5O)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 基础返回顶部

**WXML** (`html`):
```html
<t-back-top
theme="{{backTopTheme}}"
text="{{backTopText}}"
scroll-top="{{scrollTop}}"
bind:to-top="onToTop"
></t-back-top>

```

**JS** (`javascript`):
```javascript
Component({
properties: {
scrollTop: { type: Number, value: 0 },
},
data: {
backTopTheme: 'round',
backTopText: '顶部',
},
methods: {
onToTop(e) {
this.triggerEvent('to-top', e);
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
"t-back-top": "tdesign-miniprogram/back-top/back-top"
}
}

```

## API

### BackTopProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| fixed | Boolean | true | 是否绝对定位固定到屏幕右下方 | N |
| icon | String / Boolean / Object | true | 图标。值为`false`表示不显示图标。不传表示使用默认图标`'backtop'` | N |
| scroll-top | Number | 0 | 页面滚动距离 | N |
| text | String | '' | 文案 | N |
| theme | String | round | 预设的样式类型。可选项：round/half-round/round-dark/half-round-dark | N |
| visibility-height | Number | 200 | 滚动高度达到此参数值才出现 | N |

### BackTopEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| to-top | - | 点击触发 |

### BackTopSlots

| 名称 | 描述 |
| --- | --- |
| - | 默认插槽，自定义内容区域内容 |
| icon | 自定义图标内容 |

### BackTopExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |
| t-class-icon | 图标样式类 |
| t-class-text | 文本样式类 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-back-top-half-round-border-radius | @radius-round | - |
| --td-back-top-round-bg-color | @bg-color-container | - |
| --td-back-top-round-border-color | @component-border | - |
| --td-back-top-round-border-radius | @radius-circle | - |
| --td-back-top-round-color | @text-color-primary | - |
| --td-back-top-round-dark-bg-color | @gray-color-13 | - |
| --td-back-top-round-dark-color | @text-color-anti | - |