// Wiki 知识库 — [[双向链接]] 解析

import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { getPagesPath } from './paths.js'

/** 从 markdown 文本中提取所有 [[xxx]] 链接 */
export function extractLinks(markdown: string): string[] {
  const regex = /\[\[([^\]]+)\]\]/g
  const links: string[] = []
  let match: RegExpExecArray | null

  while ((match = regex.exec(markdown)) !== null) {
    links.push(match[1])
  }

  return links
}

/** 解析链接文本为文件路径（在 pages/ 下查找） */
export function resolveLink(linkText: string): string | null {
  const pagesPath = getPagesPath()
  const slug = linkText.toLowerCase().replace(/\s+/g, '-')

  const subdirs = ['entities', 'topics', 'sources', 'synthesis']

  for (const subdir of subdirs) {
    const candidate = join(pagesPath, subdir, `${slug}.md`)
    if (existsSync(candidate)) return candidate
  }

  return null
}

/** 查找所有指向某页面的入链 */
export function findBacklinks(targetSlug: string): string[] {
  const pagesPath = getPagesPath()
  const backlinks: string[] = []
  const subdirs = ['entities', 'topics', 'sources', 'synthesis']

  for (const subdir of subdirs) {
    const dirPath = join(pagesPath, subdir)
    if (!existsSync(dirPath)) continue

    const files = readdirSync(dirPath).filter(f => f.endsWith('.md'))

    for (const file of files) {
      const filePath = join(dirPath, file)
      const content = readFileSync(filePath, 'utf-8')
      const links = extractLinks(content)

      if (links.some(l => l.toLowerCase().replace(/\s+/g, '-') === targetSlug)) {
        backlinks.push(`${subdir}/${file}`)
      }
    }
  }

  return backlinks
}

/** 扫描所有 pages 下的 .md 文件 */
export function scanAllPages(): string[] {
  const pagesPath = getPagesPath()
  const allPages: string[] = []
  const subdirs = ['entities', 'topics', 'sources', 'synthesis']

  for (const subdir of subdirs) {
    const dirPath = join(pagesPath, subdir)
    if (!existsSync(dirPath)) continue

    const files = readdirSync(dirPath).filter(f => f.endsWith('.md'))
    for (const file of files) {
      allPages.push(`pages/${subdir}/${file}`)
    }
  }

  return allPages
}
