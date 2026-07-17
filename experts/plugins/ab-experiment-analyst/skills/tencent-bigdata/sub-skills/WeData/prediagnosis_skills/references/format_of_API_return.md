# SQL解析与校验&元数据查询接口的返回结果格式

格式为列表，列表元素为字典，每个字典代表一条SQL以及它们的详细信息，如下所示。
```json
[
    {
        "sql": SQL,  
        "business_requirement": 业务需求,
        "compilation": [
            列出编译报错信息片段，若没有的话则为空
        ],
        "table": 表详情，具体内容见下文,
        "udf": [
            列出涉及到的UDF函数名，若没有的话则为空
        ],
        "operators": [
            列出复杂度比较高的算子
        ]
    },
    ...
]
```

其中表详情的格式为列表，列表元素为字典，字段包括表名、表描述、列信息、分区信息、表规模、分区规模和与上下游表的关联关系等。
```json
[
    {
        "tableName": 表名,
        "description": 表描述,
        "columns": [
            {
                "index": xxx, 
                "name": xxx,
                "type": xxx,
                "comment": xxx,
                "parition": True or False
            },   
            ...
            {
            }
        ],
        "partitionColumns": [
            {
                "index": xxx, 
                "name": xxx,
                "type": xxx,
                "comment": xxx,
                "parition": True or False
            },   
            ...
            {
            }
        ],
        "totalRows": xxx, 
        "totalSize": xxx, // 单位为byte
        "partitionSize": xxx, 
        "partitionRows": xxx,
        "partitionNum": xxx, 
        "tempTable": True or False,
        "relationships": 与上下游表的关联关系
    },
    ...
]
```
