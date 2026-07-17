# 浮动图片

## 1. sheet.list_float_images

#### 功能说明

查询工作表中的浮动图片列表。

适用于盘点当前工作表里的插图、附件图片或外链图片。



> 若要获取单张图片的完整详情，可进一步调用 `sheet.get_float_image`

#### 调用示例

查询工作表中的浮动图片：

```json
{
  "file_id": "string",
  "worksheet_id": 7
}
```


#### 参数说明

- `file_id` (string, 必填): 文件 ID
- `worksheet_id` (integer, 必填): 工作表 ID

#### 返回值说明

```json
{
  "float_images": [
    {
      "float_image_id": 101,
      "tag": "sheet_pic_type_url",
      "x_pos": 120,
      "y_pos": 80,
      "width": 240,
      "height": 120
    }
  ]
}

```

| 字段 | 类型 | 说明 |
|------|------|------|
| `float_images[].float_image_id` | integer | 浮动图片 ID |
| `float_images[].tag` | string | 图片类型 |
| `float_images[].x_pos` | integer | 左上角 X 坐标 |
| `float_images[].y_pos` | integer | 左上角 Y 坐标 |
| `float_images[].width` | integer | 图片宽度 |
| `float_images[].height` | integer | 图片高度 |


---

## 2. sheet.get_float_image

#### 功能说明

获取指定浮动图片的详情。

适用于在修改图片位置、尺寸或来源前读取当前信息。



> 更新前建议先获取图片详情，确认目标 ID 与当前位置

#### 调用示例

获取指定浮动图片详情：

```json
{
  "file_id": "string",
  "worksheet_id": 7,
  "float_image_id": 101
}
```


#### 参数说明

- `file_id` (string, 必填): 文件 ID
- `worksheet_id` (integer, 必填): 工作表 ID
- `float_image_id` (integer, 必填): 浮动图片 ID

#### 返回值说明

```json
{
  "float_image": {
    "float_image_id": 101,
    "tag": "sheet_pic_type_url",
    "x_pos": 120,
    "y_pos": 80,
    "width": 240,
    "height": 120
  }
}

```

| 字段 | 类型 | 说明 |
|------|------|------|
| `float_image.float_image_id` | integer | 浮动图片 ID |
| `float_image.tag` | string | 图片类型 |
| `float_image.x_pos` | integer | 左上角 X 坐标 |
| `float_image.y_pos` | integer | 左上角 Y 坐标 |
| `float_image.width` | integer | 图片宽度 |
| `float_image.height` | integer | 图片高度 |


---

## 3. sheet.create_float_images

#### 功能说明

在工作表中创建浮动图片。

支持通过附件、上传文件或外链 URL 的方式插入图片，并指定初始位置与尺寸。



**幂等性**：否 — 重复调用会插入多张图片，先确认是否已成功

> 创建后可使用 `sheet.get_float_image` 或 `sheet.list_float_images` 校验插入结果

#### 调用示例

通过 URL 插入浮动图片：

```json
{
  "file_id": "string",
  "worksheet_id": 7,
  "sheet_id": 7,
  "tag": "sheet_pic_type_url",
  "url": "https://example.com/image.png",
  "x_pos": 120,
  "y_pos": 80,
  "width": 240,
  "height": 120
}
```


#### 参数说明

- `file_id` (string, 必填): 文件 ID
- `worksheet_id` (integer, 必填): 工作表 ID
- `sheet_id` (integer, 必填): 工作表 ID，按官方接口要求传入
- `tag` (string, 必填): 图片类型，如 `sheet_pic_type_attachment` / `sheet_pic_type_url`
- `x_pos` (integer, 必填): X 坐标（像素）
- `y_pos` (integer, 必填): Y 坐标（像素）
- `attachment_id` (string, 可选): 附件图片 ID
- `upload_id` (string, 可选): 本地上传图片 ID
- `url` (string, 可选): 远程图片 URL
- `width` (integer, 可选): 图片宽度
- `height` (integer, 可选): 图片高度
- `frontend_lt` (object, 可选): 基于行列的左上角定位对象

- `tag=sheet_pic_type_url` 时通常配合 `url`
- `tag=sheet_pic_type_attachment` 时通常配合 `attachment_id` 或 `upload_id`
- `frontend_lt` 可用于按行列对齐图片左上角


#### 返回值说明

```json
{
  "float_image_id": 101
}

```

| 字段 | 类型 | 说明 |
|------|------|------|
| `float_image_id` | integer | 新建的浮动图片 ID |


---

## 4. sheet.update_float_images

#### 功能说明

修改浮动图片的位置或尺寸。

支持按像素坐标调整，也支持通过前端行列锚点重新定位。



**幂等性**：是

> 修改前建议先读取图片详情，确认当前坐标和尺寸

#### 调用示例

调整浮动图片尺寸和位置：

```json
{
  "file_id": "string",
  "worksheet_id": 7,
  "float_image_id": 101,
  "x_pos": 160,
  "y_pos": 120,
  "width": 320,
  "height": 180
}
```


#### 参数说明

- `file_id` (string, 必填): 文件 ID
- `worksheet_id` (integer, 必填): 工作表 ID
- `float_image_id` (integer, 必填): 浮动图片 ID
- `left` (integer, 可选): 矩形左边界 X 坐标
- `right` (integer, 可选): 矩形右边界 X 坐标
- `top` (integer, 可选): 矩形上边界 Y 坐标
- `bottom` (integer, 可选): 矩形下边界 Y 坐标
- `x_pos` (integer, 可选): 左上角 X 坐标
- `y_pos` (integer, 可选): 左上角 Y 坐标
- `width` (integer, 可选): 新宽度
- `height` (integer, 可选): 新高度
- `frontend_lt` (object, 可选): 左上角行列定位对象
- `frontend_rb` (object, 可选): 右下角行列定位对象

#### 返回值说明

```json
{}

```


---

## 5. sheet.delete_float_images

#### 功能说明

删除指定的浮动图片。

适用于清理工作表中的装饰图、附件图或误插入的图片。



#### 操作约束

- **前置检查**：`sheet.list_float_images` 或 `sheet.get_float_image` 确认目标浮动图片
- **用户确认**：删除浮动图片不可恢复，必须向用户确认

**幂等性**：是

#### 调用示例

删除指定浮动图片：

```json
{
  "file_id": "string",
  "worksheet_id": 7,
  "float_image_id": 101
}
```


#### 参数说明

- `file_id` (string, 必填): 文件 ID
- `worksheet_id` (integer, 必填): 工作表 ID
- `float_image_id` (integer, 必填): 浮动图片 ID

#### 返回值说明

```json
{}

```


---

