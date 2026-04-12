// Wiki 知识库 — log.md 追加管理

import { readFileSync, existsSync, writeFileSync } from 'fs'
import type { WikiLogEntry } from './types.js'
import { getLogPath } from './paths.js'

const MAX_LOG_ENTRIES = 500

const OP_LABELS: Record<string, string> = {
  ingest: '导入',
  query: '查询',
  lint: '检查',
  update: '更新',
}

/** 追加一条操作日志 */
export function appendLog(entry: WikiLogEntry): void {
  const logPath = getLogPath()
  const timestamp = entry.timestamp || new Date().toISOString()
  const opLabel = OP_LABELS[entry.operation] ?? entry.operation
  const pagesStr = entry.pagesAffected.length > 0
    ? `，影响 ${entry.pagesAffected.length} 个页面`
    : ''

  const line = `[${timestamp}] ${opLabel}: ${entry.summary}${pagesStr}`

  let existing = ''
  if (existsSync(logPath)) {
    existing = readFileSync(logPath, 'utf-8')
  }

  // 截断旧条目
  const lines = existing.split('\n')
  const logLines = lines.filter(l => l.startsWith('['))

  const trimmedLogs = logLines.length >= MAX_LOG_ENTRIES
    ? logLines.slice(logLines.length - MAX_LOG_ENTRIES + 1)
    : logLines

  const content = [
    '# Wiki 操作日志',
    '',
    ...trimmedLogs,
    line,
    '',
  ].join('\n')

  writeFileSync(logPath, content, 'utf-8')
}
