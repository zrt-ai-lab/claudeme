// Wiki 知识库 — 目录结构管理

import { mkdirSync, existsSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'

/** 默认 wiki 目录：~/.claude/wiki/ */
function getDefaultWikiDir(): string {
  return join(getClaudeConfigHomeDir(), 'wiki')
}

let wikiDir: string | null = null

export function setWikiDir(dir: string): void {
  wikiDir = resolve(dir)
}

export function getWikiDir(): string {
  return wikiDir ?? process.env.WIKI_DIR ?? getDefaultWikiDir()
}

export function getRawPath(): string {
  return join(getWikiDir(), 'raw')
}

export function getRawArticlesPath(): string {
  return join(getWikiDir(), 'raw', 'articles')
}

export function getPagesPath(): string {
  return join(getWikiDir(), 'pages')
}

export function getEntitiesPath(): string {
  return join(getWikiDir(), 'pages', 'entities')
}

export function getTopicsPath(): string {
  return join(getWikiDir(), 'pages', 'topics')
}

export function getSourcesPath(): string {
  return join(getWikiDir(), 'pages', 'sources')
}

export function getSynthesisPath(): string {
  return join(getWikiDir(), 'pages', 'synthesis')
}

export function getIndexPath(): string {
  return join(getWikiDir(), 'index.md')
}

export function getLogPath(): string {
  return join(getWikiDir(), 'log.md')
}

export function getSchemaPath(): string {
  return join(getWikiDir(), '.wiki-schema.md')
}

export function getScanProgressPath(): string {
  return join(getWikiDir(), '.scan-progress.json')
}

/** 幂等初始化所有 wiki 子目录 */
export function ensureWikiDirs(): void {
  const dirs = [
    getWikiDir(),
    getRawPath(),
    getRawArticlesPath(),
    join(getWikiDir(), 'raw', 'pdfs'),
    join(getWikiDir(), 'raw', 'notes'),
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
    writeFileSync(getIndexPath(), '# Wiki 知识库索引\n\n_暂无内容，使用 ingest 添加知识。_\n', 'utf-8')
  }

  // 初始化 log.md（如果不存在）
  if (!existsSync(getLogPath())) {
    writeFileSync(getLogPath(), '# Wiki 操作日志\n\n', 'utf-8')
  }
}
