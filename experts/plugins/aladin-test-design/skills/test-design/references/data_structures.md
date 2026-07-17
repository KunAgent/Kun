# 测试用例设计输出格式规范

本文档定义了测试设计技能生成的 JSON 数据结构规范，用于标准化新用例设计结果、存量用例召回结果和接口变更信息的输出格式。
# 数据结构及解释
```json
{
  "description": "测试设计输出数据结构规范",
  "type": "object",
  "required": ["metadata", "new_cases", "stock_cases", "stats"],
  "properties": {
    "metadata": {
      "type": "object",
      "description": "测试设计的元数据信息",
      "required": ["product", "time", "requirement_url", "requirement_name"],
      "properties": {
        "product": {
          "type": "string",
          "description": "被测试的产品名称"
        },
        "time": {
          "type": "string",
          "format": "date-time",
          "description": "生成时间，格式为 YYYY-MM-DD HH:MM:SS"
        },
        "requirment_url": {
          "type": "string",
          "format": "uri",
          "description": "用户输入的需求链接，tapd_url"
        },
        "requirement_name": {
          "type": "string",
          "description": "需求名称"
        }
      }
    },
    "new_cases": {
      "type": "array",
      "description": "新设计的测试用例列表",
      "items": {
        "type": "object",
        "required": ["id", "name", "priority", "module", "auto", "features", "pre", "steps", "expect"],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^\\[new\\]-[0-9]+$",
            "description": "新增用例唯一标识，格式如 [new]-001"
          },
          "name": {
            "type": "string",
            "description": "用例名称"
          },
          "priority": {
            "type": "string",
            "enum": ["P0", "P1", "P2"],
            "description": "用例优先级"
          },
          "module": {
            "type": "string",
            "description": "所属模块路径"
          },
          "auto": {
            "type": "string",
            "enum": ["已自动化", "未自动化", "待自动化"],
            "description": "自动化状态"
          },
          "features": {
            "type": "array",
            "description": "覆盖的功能点列表",
            "items": {
              "type": "string"
            }
          },
          "pre": {
            "type": "array",
            "description": "前置条件列表",
            "items": {
              "type": "string"
            }
          },
          "steps": {
            "type": "array",
            "description": "测试步骤列表， 每一个步骤需要与预期结果一一对应",
            "items": {
              "type": "string"
            }
          },
          "expect": {
            "type": "array",
            "description": "预期结果列表，每一个预期结果需要与测试步骤一一对应",
            "items": {
              "type": "string"
            }
          }
        }
      }
    },
    "stock_cases": {
      "type": "array",
      "description": "召回的存量测试用例列表",
      "items": {
        "type": "object",
        "required": ["id", "name", "module", "auto", "reused", "reason", "pre", "steps", "expect"],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^\\[stock\\]-[0-9]+$",
            "description": "存量用例唯一标识，格式如 [stock]-001"
          },
          "name": {
            "type": "string",
            "description": "用例名称"
          },
          "module": {
            "type": "string",
            "description": "所属模块路径"
          },
          "auto": {
            "type": "string",
            "description": "自动化状态"
          },
          "reused": {
            "type": "boolean",
            "description": "是否被复用标记"
          },
          "reason": {
            "type": "string",
            "description": "召回原因说明"
          },
          "pre": {
            "type": "array",
            "description": "前置条件列表",
            "items": {
              "type": "string"
            }
          },
          "steps": {
            "type": "array",
            "description": "测试步骤列表",
            "items": {
              "type": "string"
            }
          },
          "expect": {
            "type": "array",
            "description": "预期结果列表",
            "items": {
              "type": "string"
            }
          }
        }
      }
    },
    "api_changes": {
      "type": "array",
      "description": "接口变更列表，通过 mcp__aladin__get_api_list_by_tapd 获取的需求关联的API变更信息，仅用于展示，不影响归档",
      "items": {
        "type": "string",
        "description": "变更的API接口名称"
      }
    },
    "stats": {
      "type": "object",
      "description": "用例统计信息",
      "required": ["total", "new", "stock", "reused"],
      "properties": {
        "total": {
          "type": "integer",
          "minimum": 0,
          "description": "用例总数"
        },
        "new": {
          "type": "integer",
          "minimum": 0,
          "description": "新设计用例数量"
        },
        "stock": {
          "type": "integer",
          "minimum": 0,
          "description": "存量召回用例数量"
        },
        "reused": {
          "type": "integer",
          "minimum": 0,
          "description": "被复用的存量用例数量"
        }
      }
    }
  }
}
```

# 数据样例
```json
{
  "metadata": {
    "product": "MONITOR-云监控",
    "time": "2026-02-03 14:30:25",
    "requirment_url": "https://tapd.woa.com/tapd_fe/70108907/story/detail/1070108907120510065",
    "requirement_name": "【告警收敛】告警收敛通知内容+通知渠道"
  },
  "new_cases": [
    {
      "id": "[new]-001",
      "name": "验证钉钉渠道收敛通知格式规范性-无多余字符",
      "priority": "P0",
      "module": "功能测试/告警管理/收敛规则/告警收敛全链路/告警收敛通知内容+通知渠道",
      "auto": "未自动化",
      "features": [
        "检查收敛通知内容中不存在多余的反斜杠或换行符(如\\\\n)"
      ],
      "pre": [
        "已创建收敛规则,收敛字段为告警策略+资源维度",
        "已创建告警策略,关联钉钉机器人渠道的通知模板",
        "告警策略已触发告警收敛"
      ],
      "steps": [
        "触发告警收敛,等待收敛通知发送",
        "检查钉钉机器人渠道收到的收敛通知内容",
        "验证通知内容中不存在多余的反斜杠或换行符"
      ],
      "expect": [
        "收敛通知发送成功",
        "通知内容格式规范,不存在多余的反斜杠或换行符",
        "通知内容正确显示收敛信息"
      ]
    }
  ],
  "stock_cases": [
    {
      "id": "[stock]-001",
      "name": "[复用]检查告警渠道预设通知内容配置-钉钉机器人",
      "module": "功能测试/告警管理/通知内容模板/通知内容模板全链路/根据系统预设通知内容模板发送告警通知-告警渠道覆盖",
      "auto": "待自动化",
      "reused": true,
      "reason": "覆盖钉钉机器人渠道的通知内容配置和格式检查",
      "pre": [
        "新建2个通知模板,通知语言分别为中文和英文",
        "新建2个通知内容模板,通知语言分别为中文和英文,且钉钉机器人渠道通知内容不填(默认走db里的预设内容模板)"
      ],
      "steps": [
        "新建2个告警策略,分别关联中文和英文的通知模板,通知通知内容模板为系统预设通知内容模板(非用户自建的模板)",
        "构造2个告警策略的告警触发和恢复",
        "检查钉钉机器人渠道告警通知内容"
      ],
      "expect": [
        "新建成功",
        "确认2个策略均触发告警触发和告警恢复",
        "收到4条告警通知(1条中文触发和1条中文恢复,1条英文触发和1条英文恢复),且内容正确(内容格式同预设通知内容模板)"
      ]
    }
  ],
  "api_changes": [
    "DescribeAlarmPolicy",
    "ModifyAlarmPolicy"
  ],
  "stats": {
    "total": 2,
    "new": 1,
    "stock": 1,
    "reused": 1
  }
}

```
