// Wiki 知识库 — Lint 引擎

import { readFileSync, existsSync, statSync } from 'fs'
import { join } from 'path'
import { readIndex } from './index-manager.js'
import { extractLinks, scanAllPages, resolveLink } from './links.js'
import { appendLog } from './log-manager.js'
import { getWikiDir, ensureWikiDirs } from './paths.js'
import type { LintIssue, LintResult } from './types.js'

const STALE_DAYS = 30
const MS_PER_DAY = 86400000

export async function lint(): Promise<LintResult> {
  ensureWikiDirs()

  const wikiDir = getWikiDir()
  const index = readIndex()
  const allPages = scanAllPages()
  const issues: LintIssue[] = []

  // 1. 断链检测
  for (const page of allPages) {
    const fullPath = join(wikiDir, page)
    if (!existsSync(fullPath)) continue

    const content = readFileSync(fullPath, 'utf-8')
    const links = extractLinks(content)

    for (const link of links) {
      const resolved = resolveLink(link)
      if (!resolved) {
        issues.push({ type: 'broken_link', page, link })
      }
    }
  }

  // 2. 孤立页检测（没有任何入链 + 不在 index 中）
  const allLinkedSlugs = new Set<string>()
  for (const page of allPages) {
    const fullPath = join(wikiDir, page)
    if (!existsSync(fullPath)) continue
    const content = readFileSync(fullPath, 'utf-8')
    const links = extractLinks(content)
    for (const link of links) {
      allLinkedSlugs.add(link.toLowerCase().replace(/\s+/g, '-'))
    }
  }

  const indexedPaths = new Set(index.map(e => e.path))
  for (const page of allPages) {
    const slug = page.split('/').pop()?.replace('.md', '') ?? ''
    if (!allLinkedSlugs.has(slug) && !indexedPaths.has(page)) {
      issues.push({ type: 'orphan', page })
    }
  }

  // 3. Index 一致性
  for (const entry of index) {
    const fullPath = join(wikiDir, entry.path)
    if (!existsSync(fullPath)) {
      issues.push({ type: 'index_stale', entry: entry.path })
    }
  }
  for (const page of allPages) {
    if (!indexedPaths.has(page)) {
      issues.push({ type: 'index_missing', page })
    }
  }

  // 4. 过时检测
  const now = Date.now()
  for (const page of allPages) {
    const fullPath = join(wikiDir, page)
    if (!existsSync(fullPath)) continue

    const stat = statSync(fullPath)
    const daysOld = Math.floor((now - stat.mtimeMs) / MS_PER_DAY)
    if (daysOld > STALE_DAYS) {
      issues.push({ type: 'stale', page, daysOld })
    }
  }

  // 生成摘要
  const summary = formatSummary(allPages.length, index.length, issues)

  // 记录日志
  appendLog({
    timestamp: new Date().toISOString(),
    operation: 'lint',
    summary: `检查完成，发现 ${issues.length} 个问题`,
    pagesAffected: [],
  })

  return { issues, summary }
}

function formatSummary(
  totalPages: number,
  indexEntries: number,
  issues: readonly LintIssue[],
): string {
  const lines: string[] = [
    `Wiki 健康报告 (${new Date().toISOString().slice(0, 10)})`,
    '──────────────────────',
    `页面总数: ${totalPages}`,
    `索引条目: ${indexEntries}`,
  ]

  const brokenLinks = issues.filter(i => i.type === 'broken_link')
  const orphans = issues.filter(i => i.type === 'orphan')
  const staleIndex = issues.filter(i => i.type === 'index_stale')
  const missingIndex = issues.filter(i => i.type === 'index_missing')
  const stalePages = issues.filter(i => i.type === 'stale')

  if (brokenLinks.length > 0) {
    lines.push(`断链: ${brokenLinks.length} 个`)
    for (const issue of brokenLinks.slice(0, 5)) {
      lines.push(`   - ${issue.page} -> [[${issue.link}]] (不存在)`)
    }
    if (brokenLinks.length > 5) {
      lines.push(`   ... 还有 ${brokenLinks.length - 5} 个`)
    }
  }

  if (orphans.length > 0) {
    lines.push(`孤立页: ${orphans.length} 个`)
    for (const issue of orphans.slice(0, 5)) {
      lines.push(`   - ${issue.page} (无入链)`)
    }
  }

  if (staleIndex.length > 0) {
    lines.push(`索引过期: ${staleIndex.length} 个`)
    for (const issue of staleIndex) {
      lines.push(`   - ${issue.entry} (文件已删除)`)
    }
  }

  if (missingIndex.length > 0) {
    lines.push(`未索引: ${missingIndex.length} 个`)
    for (const issue of missingIndex) {
      lines.push(`   - ${issue.page} (不在 index.md 中)`)
    }
  }

  if (stalePages.length > 0) {
    lines.push(`可能过时: ${stalePages.length} 个`)
    for (const issue of stalePages.slice(0, 5)) {
      lines.push(`   - ${issue.page} (${issue.daysOld} 天未更新)`)
    }
  }

  if (issues.length === 0) {
    lines.push('一切正常！')
  }

  return lines.join('\n')
}
