// Wiki 知识库 — index.md 读写管理

import { readFileSync, existsSync, writeFileSync } from 'fs'
import type { WikiIndexEntry, WikiPageType } from './types.js'
import { getIndexPath } from './paths.js'

const TYPE_LABELS: Record<WikiPageType, string> = {
  entity: '实体',
  topic: '主题',
  source: '素材摘要',
  synthesis: '综合分析',
}

const TYPE_ORDER: readonly WikiPageType[] = ['entity', 'topic', 'source', 'synthesis']

/** 解析 index.md 为结构化条目 */
export function readIndex(): WikiIndexEntry[] {
  const indexPath = getIndexPath()
  if (!existsSync(indexPath)) return []

  const content = readFileSync(indexPath, 'utf-8')
  const entries: WikiIndexEntry[] = []

  let currentType: WikiPageType | null = null

  for (const line of content.split('\n')) {
    const trimmed = line.trim()

    // 检测 ## 标题行，判断当前 type
    if (trimmed.startsWith('## ')) {
      const heading = trimmed.slice(3).trim()
      const typeEntry = Object.entries(TYPE_LABELS).find(([, label]) => label === heading)
      currentType = typeEntry ? (typeEntry[0] as WikiPageType) : null
      continue
    }

    // 解析 - [title](path) — summary 格式
    const match = trimmed.match(/^- \[(.+?)\]\((.+?)\)\s*(?:—\s*(.*))?$/)
    if (match && currentType) {
      entries.push({
        title: match[1],
        path: match[2],
        type: currentType,
        summary: match[3]?.trim() ?? '',
      })
    }
  }

  return entries
}

/** 将条目写入 index.md */
export function writeIndex(entries: readonly WikiIndexEntry[]): void {
  const grouped = new Map<WikiPageType, WikiIndexEntry[]>()

  for (const type of TYPE_ORDER) {
    grouped.set(type, [])
  }

  for (const entry of entries) {
    const group = grouped.get(entry.type)
    if (group) {
      group.push(entry)
    }
  }

  const lines: string[] = ['# Wiki 知识库索引', '']

  for (const type of TYPE_ORDER) {
    const group = grouped.get(type) ?? []
    if (group.length === 0) continue

    lines.push(`## ${TYPE_LABELS[type]}`, '')
    for (const entry of group) {
      const summaryPart = entry.summary ? ` — ${entry.summary}` : ''
      lines.push(`- [${entry.title}](${entry.path})${summaryPart}`)
    }
    lines.push('')
  }

  if (entries.length === 0) {
    lines.push('_暂无内容，使用 ingest 添加知识。_', '')
  }

  writeFileSync(getIndexPath(), lines.join('\n'), 'utf-8')
}

/** 添加或更新一条索引条目（按 path 去重） */
export function upsertEntry(entry: WikiIndexEntry): void {
  const entries = readIndex()
  const existing = entries.findIndex(e => e.path === entry.path)

  const updated = existing >= 0
    ? entries.map((e, i) => (i === existing ? entry : e))
    : [...entries, entry]

  writeIndex(updated)
}

/** 删除一条索引条目 */
export function removeEntry(path: string): void {
  const entries = readIndex()
  const filtered = entries.filter(e => e.path !== path)
  writeIndex(filtered)
}

/** 格式化索引为纯文本（给 LLM 用） */
export function formatIndexForLLM(): string {
  const entries = readIndex()
  if (entries.length === 0) return '（知识库为空）'

  return entries
    .map(e => `- [${e.type}] ${e.title}: ${e.summary} (${e.path})`)
    .join('\n')
}
