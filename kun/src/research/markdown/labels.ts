import type {
  ResearchConfidence,
  ResearchPriority,
  ResearchSourceType,
  ResearchTaskStatus
} from '../core/types.js'
import type { SourceReliability, SourceStatus } from '../evidence/types.js'

export function priorityLabel(priority: ResearchPriority): string {
  return {
    high: '高',
    medium: '中',
    low: '低'
  }[priority]
}

export function confidenceLabel(confidence: ResearchConfidence): string {
  return {
    high: '高',
    medium: '中',
    low: '低'
  }[confidence]
}

export function sourceTypeLabel(sourceType: ResearchSourceType): string {
  return {
    web: '网页',
    local_file: '本地文件',
    pdf: 'PDF',
    lark_doc: '飞书文档',
    paper: '论文'
  }[sourceType]
}

export function sourceReliabilityLabel(reliability: SourceReliability): string {
  return {
    high: '高',
    medium: '中',
    low: '低',
    unknown: '未知'
  }[reliability]
}

export function sourceStatusLabel(status: SourceStatus): string {
  return {
    fetched: '已获取',
    failed: '失败',
    blocked: '受阻',
    stale: '可能过期'
  }[status]
}

export function taskStatusLabel(status: ResearchTaskStatus): string {
  return {
    pending: '待开始',
    running: '运行中',
    done: '已完成',
    blocked: '受阻',
    failed: '失败',
    cancelled: '已取消'
  }[status]
}
