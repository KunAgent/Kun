# 主题（字体与配色）

## 1. wpp.set_font_presentation

#### 功能说明

将**整份**演示文稿应用指定主题字体方案。

**适用于**：WPP 演示全文换字体。



**幂等性**：是

#### 调用示例

全文换为简约中等线体：

```json
{
  "file_id": "string",
  "font_theme": "简约中等线体"
}
```


#### 参数说明

- `file_id` (string, 必填): 演示文稿文件 ID
- `font_theme` (string, 可选): 预设字体主题名；未传或不在列表内则默认经典黑体

#### 返回值说明

```json
{
  "result": "ok",
  "detail": {
    "res": [
      {
        "cmdName": "modifyPresentation",
        "code": 0,
        "errName": "S_OK",
        "msg": "execute result"
      }
    ]
  }
}

```


---

## 2. wpp.set_font_slide

#### 功能说明

将**指定页**应用主题字体方案。

**适用于**：单页换字体。



**幂等性**：是

#### 调用示例

第 2 页换为简约中等线体：

```json
{
  "file_id": "string",
  "slide_idx": 1,
  "font_theme": "简约中等线体"
}
```


#### 参数说明

- `file_id` (string, 必填): 演示文稿文件 ID
- `slide_idx` (integer, 必填): 目标幻灯片序号，从 0 开始
- `font_theme` (string, 可选): 预设字体主题名；未传或不在列表内则默认经典黑体

#### 返回值说明

```json
{
  "result": "ok",
  "detail": {
    "res": [
      {
        "cmdName": "modifySlideProps",
        "code": 0,
        "errName": "S_OK",
        "msg": "execute result"
      }
    ]
  }
}

```


---

## 3. wpp.set_color_presentation

#### 功能说明

将**整份**演示文稿应用指定主题配色方案。

**适用于**：WPP 全文换配色。



**幂等性**：是

#### 调用示例

全文换为琥珀黄配色：

```json
{
  "file_id": "string",
  "color_theme": "琥珀黄"
}
```


#### 参数说明

- `file_id` (string, 必填): 演示文稿文件 ID
- `color_theme` (string, 可选): 预设配色主题名；未传或未命中则默认配色

#### 返回值说明

```json
{
  "result": "ok",
  "detail": {
    "res": [
      {
        "cmdName": "modifyPresentation",
        "code": 0,
        "errName": "S_OK",
        "msg": "execute result"
      }
    ]
  }
}

```


---

## 4. wpp.set_color_slide

#### 功能说明

将**指定页**应用主题配色方案。



**幂等性**：是

#### 调用示例

单页换为嫩芽绿配色：

```json
{
  "file_id": "string",
  "slide_idx": 1,
  "color_theme": "嫩芽绿",
  "theme_color_mode": 1,
  "color_scheme_id": "19d485c844c"
}
```


#### 参数说明

- `file_id` (string, 必填): 演示文稿文件 ID
- `slide_idx` (integer, 必填): 目标幻灯片序号，从 0 开始
- `color_theme` (string, 可选): 预设配色主题名；未传或未命中则默认配色
- `theme_color_mode` (integer, 必填): 主题颜色模式，值必须与 `color_theme` 对应。`0` 恢复默认配色；`1` 浅色系配色（落日红、蜜橘橙、琥珀黄、嫩芽绿、湖水青、晴空蓝、丁香紫）；`3` 深色系配色（朱砂赤、南瓜橙、深麦黄、深松绿、深墨青、深海蓝、葡萄紫、胭脂红）。具体映射见附录「配色主题详表」
- `color_scheme_id` (string, 必填): 配色方案标识，格式参考 `19d485c844c`，为随机生成的唯一 ID，不与特定 `color_theme` 一一对应

#### 返回值说明

```json
{
  "result": "ok",
  "detail": {
    "res": [
      {
        "cmdName": "modifySlideProps",
        "code": 0,
        "errName": "S_OK",
        "msg": "execute result"
      }
    ]
  }
}

```


---

