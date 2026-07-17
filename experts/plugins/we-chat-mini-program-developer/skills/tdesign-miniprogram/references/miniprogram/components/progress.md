# Progress 进度条

## 示例

该组件于 0.7.3 版本上线，请留意版本。
## 引入

### 引入组件

在 `app.json` 或 `page.json` 中引入组件：

```json
"usingComponents": {
"t-progress": "tdesign-miniprogram/progress/progress"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/32zr7MmR8054)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 01组件类型

**WXML** (`html`):
```html
<view class="demo-desc">基础进度条</view>
<view class="demo-wrapper">
<t-progress percentage="80" />
</view>

<view class="demo-desc">百分比内显</view>
<view class="demo-wrapper">
<t-progress theme="plump" percentage="80" />
</view>

<view class="demo-desc">环形进度条</view>
<view class="demo-wrapper">
<t-progress theme="circle" percentage="30" />
</view>

<view class="demo-desc">微型环形进度条</view>
<view class="demo-wrapper">
<t-progress theme="circle" size="micro" percentage="30" label="{{false}}" />
</view>

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css
.demo-wrapper {
padding: 0 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"styleIsolation": "apply-shared",
"usingComponents": {
"t-progress": "tdesign-miniprogram/progress/progress"
}
}

```

### 02组件状态

线性进度条

**WXML** (`html`):
```html
<t-progress percentage="80" />
<t-progress percentage="80" status="warning" />
<t-progress percentage="80" status="error" />
<t-progress percentage="80" status="success" />
<t-progress percentage="80" color="{{ {  from: '#0052D9', to: '#00A870' } }}" status="active" />

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-progress": "tdesign-miniprogram/progress/progress"
}
}

```

百分比内显进度条

**WXML** (`html`):
```html
<t-progress theme="plump" percentage="80" />
<t-progress theme="plump" percentage="80" status="warning" />
<t-progress theme="plump" percentage="80" status="error" />
<t-progress theme="plump" percentage="80" status="success" />
<t-progress theme="plump" color="{{ {  from: '#0052D9', to: '#00A870' } }}" percentage="80" status="active" />

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-progress": "tdesign-miniprogram/progress/progress"
}
}

```

环形进度条

**WXML** (`html`):
```html
<t-demo desc="环形进度条" padding>
<t-progress theme="circle" percentage="30" />
<t-progress theme="circle" percentage="30" status="warning" />
<t-progress theme="circle" percentage="30" status="error" />
<t-progress theme="circle" percentage="100" status="success" />
</t-demo>

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-progress": "tdesign-miniprogram/progress/progress"
}
}

```

## API

### ProgressProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| color | String / Object / Array | '' | 进度条颜色。示例：'#ED7B2F' 或 'orange' 或`['#f00', '#0ff', '#f0f']`或`{ '0%': '#f00', '100%': '#0ff' }`或`{ from: '#000', to: '#000' }`等。TS 类型：`string \| Array<string> \| Record<string, string>` | N |
| label | String / Boolean | true | 进度百分比，可自定义 | N |
| percentage | Number | 0 | 进度条百分比 | N |
| size | String / Number | 'default' | 进度条尺寸，仅对环形进度条有效。可选值：default/micro。default 值为 112； micro 值为 24 | N |
| status | String | - | 进度条状态。可选项：success/error/warning/active。TS 类型：`ProgressStatus``type ProgressStatus = 'success' \| 'error' \| 'warning' \| 'active'`。详细类型定义 | N |
| stroke-width | String / Number | - | 进度条线宽，默认单位`px` | N |
| theme | String | line | 进度条风格。值为 line，标签（label）显示在进度条右侧；值为 plump，标签（label）显示在进度条里面；值为 circle，标签（label）显示在进度条正中间。可选项：line/plump/circle。TS 类型：`ProgressTheme``type ProgressTheme = 'line' \| 'plump' \| 'circle'`。详细类型定义 | N |
| track-color | String | '' | 进度条未完成部分颜色 | N |

### ProgressSlots

| 名称 | 描述 |
| --- | --- |
| label | 进度百分比 |

### ProgressExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |
| t-class-bar | 进度文字样式类 |
| t-class-label | 标签样式类 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-progress-info-dark-color | @text-color-primary | - |
| --td-progress-info-light-color | @text-color-anti | - |
| --td-progress-inner-bg-color-active | @bg-color-container | - |
| --td-progress-inner-bg-color-error | @error-color | - |
| --td-progress-inner-bg-color-success | @success-color | - |
| --td-progress-inner-bg-color-warning | @warning-color | - |
| --td-progress-circle-icon-size | 96rpx | - |
| --td-progress-circle-inner-bg-color | @bg-color-container | - |
| --td-progress-circle-label-font | @font-title-extraLarge | - |
| --td-progress-circle-width | 224rpx | - |
| --td-progress-inner-bg-color | @brand-color | - |
| --td-progress-line-stroke-width | 12rpx | - |
| --td-progress-stroke-circle-width | 12rpx | - |
| --td-progress-stroke-plump-width | 40rpx | - |
| --td-progress-track-bg-color | @bg-color-component | - |