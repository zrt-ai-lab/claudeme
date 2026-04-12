// Wiki 知识库 — 主入口模块
// 提供系统提示注入 + wiki 状态查询

import { readFileSync, existsSync } from 'fs'
import { readIndex, formatIndexForLLM } from './index-manager.js'
import { getWikiDir, getLogPath, getIndexPath } from './paths.js'
import type { WikiPromptContext } from './types.js'

const MAX_INDEX_ENTRIES_IN_PROMPT = 50

/**
 * 生成 wiki 系统提示注入内容。
 * 类似 memdir 的 loadMemoryPrompt()。
 * wiki 为空或未初始化时返回 null。
 */
export async function loadWikiPrompt(): Promise<string | null> {
  if (!existsSync(getIndexPath())) return null

  const index = readIndex()
  if (index.length === 0) return null

  const wikiDir = getWikiDir()

  // 截断过长的 index
  const displayEntries = index.slice(0, MAX_INDEX_ENTRIES_IN_PROMPT)
  const indexText = displayEntries
    .map(e => `- [${e.type}] ${e.title} (${e.path})`)
    .join('\n')

  const truncateNote =
    index.length > MAX_INDEX_ENTRIES_IN_PROMPT
      ? `\n... 还有 ${index.length - MAX_INDEX_ENTRIES_IN_PROMPT} 个条目未显示`
      : ''

  const lines = [
    '# Wiki 知识库',
    '',
    `用户有一个结构化知识库（${wikiDir}），包含 ${index.length} 个页面。`,
    '可以使用 /wiki 命令操作知识库：',
    '- /wiki ingest <url|路径> — 导入新素材',
    '- /wiki query <问题> — 查询知识库',
    '- /wiki lint — 检查知识库健康度',
    '- /wiki status — 查看知识库状态',
    '',
    '## 知识库索引',
    indexText + truncateNote,
  ]

  return lines.join('\n')
}

/**
 * 获取 wiki 上下文摘要信息。
 */
export function getWikiPromptContext(): WikiPromptContext {
  const index = readIndex()
  const logPath = getLogPath()

  let lastIngestAt: string | null = null
  if (existsSync(logPath)) {
    const logContent = readFileSync(logPath, 'utf-8')
    const ingestLines = logContent.split('\n').filter(l => l.includes('导入'))
    const last = ingestLines[ingestLines.length - 1]
    const ts = last?.match(/\[(.+?)\]/)?.[1] ?? null
    lastIngestAt = ts
  }

  return {
    indexSummary: formatIndexForLLM(),
    pageCount: index.length,
    lastIngestAt,
  }
}
