// Wiki Lab — Wiki 目录结构管理

import { mkdirSync, existsSync } from 'fs'
import { join, resolve } from 'path'

// 默认 wiki 目录（prototype 测试用）
const DEFAULT_WIKI_DIR = join(process.cwd(), 'test-wiki')

let wikiDir = process.env.WIKI_DIR ?? DEFAULT_WIKI_DIR

export function setWikiDir(dir: string): void {
  wikiDir = resolve(dir)
}

export function getWikiDir(): string {
  return wikiDir
}

export function getRawPath(): string {
  return join(wikiDir, 'raw')
}

export function getRawArticlesPath(): string {
  return join(wikiDir, 'raw', 'articles')
}

export function getPagesPath(): string {
  return join(wikiDir, 'pages')
}

export function getEntitiesPath(): string {
  return join(wikiDir, 'pages', 'entities')
}

export function getTopicsPath(): string {
  return join(wikiDir, 'pages', 'topics')
}

export function getSourcesPath(): string {
  return join(wikiDir, 'pages', 'sources')
}

export function getSynthesisPath(): string {
  return join(wikiDir, 'pages', 'synthesis')
}

export function getIndexPath(): string {
  return join(wikiDir, 'index.md')
}

export function getLogPath(): string {
  return join(wikiDir, 'log.md')
}

export function getSchemaPath(): string {
  return join(wikiDir, '.wiki-schema.md')
}

/** 幂等初始化所有 wiki 子目录 */
export function ensureWikiDirs(): void {
  const dirs = [
    wikiDir,
    getRawPath(),
    getRawArticlesPath(),
    join(wikiDir, 'raw', 'pdfs'),
    join(wikiDir, 'raw', 'notes'),
    getPagesPath(),
    getEntitiesPath(),
    getTopicsPath(),
    getSourcesPath(),
    getSynthesisPath(),
  ]

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  // 初始化 index.md（如果不存在）
  if (!existsSync(getIndexPath())) {
    Bun.write(getIndexPath(), '# Wiki 知识库索引\n\n_暂无内容，使用 ingest 添加知识。_\n')
  }

  // 初始化 log.md（如果不存在）
  if (!existsSync(getLogPath())) {
    Bun.write(getLogPath(), '# Wiki 操作日志\n\n')
  }
}
