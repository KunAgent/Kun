# 样式覆盖

基于微信小程序的设计，TDesign 提供了 4 种方式用于样式覆盖

## 1使用Style

> TDesign 全部组件均支持 `custom-style` 和 `style` 属性。可传入 CSS 字符串，将会应用于组件的根元素。

### 开启virtualHost

从 `1.0.0-rc` 版本开始，在基础库版本高于 2.19.2 的情况下，TDesign 会默认开启 `virtualHost` 属性。

此时 `custom-style` 和 `style` 的效果是一致的，任选其一即可：

```html
<t-button style="color: red">填充按钮</t-button>

<t-button custom-style="color: red">填充按钮</t-button>
```

渲染的结果如下：

```html
<button class="t-button" style="color: red">填充按钮</t-button>
```

### 关闭virtualHost

但在没有开启 `virtualHost` 的情况下，小程序使用的是 Shadow DOM 的渲染机制，自定义组件本身那个节点也会渲染成一个普通节点。

使用 `style` 赋予的样式，将会被自定义组件本身那个节点劫持，导致无法正确传入组件内部，此时只能使用 `custom-style`：

```html
<t-button custom-style="color: red">填充按钮</t-button>
```

渲染的结果如下：

```html
<t-button>
<button class="t-button" style="color: red">填充按钮</t-button>
<t-button>
```

## 2解除样式隔离

样式隔离相关文档：[微信官网文档](https://developers.weixin.qq.com/miniprogram/dev/framework/custom-component/wxml-wxss.html#%E7%BB%84%E4%BB%B6%E6%A0%B7%E5%BC%8F%E9%9A%94%E7%A6%BB)

TDesign 全体组件均开启了 `addGlobalClass`，可以接受外部传入的样式。

### 在页面中使用TDesign

```html
<t-button theme="primary" >填充按钮</t-button>
```

```css
.t-button--primary {
background-color: navy;
}
```

### 在自定义组件中使用TDesign

> 需要在自定义组件的 options 中开启： `styleIsolation: 'shared'`

```html
<t-button theme="primary" >填充按钮</t-button>
```

对应的自定义组件：

```js
Component({
options: {
styleIsolation: 'shared'
}
})
```

```css
.t-button--primary {
background-color: navy;
}
```

## 3使用外部样式类

外部样式类相关文档：[微信官网文档](https://developers.weixin.qq.com/miniprogram/dev/framework/custom-component/wxml-wxss.html#%E5%A4%96%E9%83%A8%E6%A0%B7%E5%BC%8F%E7%B1%BB)

TDesign 在每个组件的内部都预置了许多外部样式类供开发者使用。

**注意：在同一个节点上使用普通样式类和外部样式类时，两个类的优先级是未定义的，所以最好加上 !important**

```html
<t-button t-class-loading="red-loading">填充按钮</t-button>
```

```css
.red-loading {
color: red !important;
}
```

## 4使用CSS变量

TDesign 为所有组件预置了许多 CSS 变量，具体可以查看每个组件的 WXSS 文件。

使用 CSS 变量的好处在于可以多页面复用，不需要重复修改。具体可以参考 [自定义主题](./custom-theme)