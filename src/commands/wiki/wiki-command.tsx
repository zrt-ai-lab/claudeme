// Wiki 知识库 — /wiki 命令
// 子命令：scan, stop, ingest, query, lint, status

import * as React from 'react'
import { Text } from 'ink'
import type { LocalJSXCommandCall } from '../../types/command.js'

// ─── scan：后台启动，立即返回 ───

async function handleScan(): Promise<string> {
  const { scanBackground, isScanRunning, readScanProgress } = await import('../../wiki/scan.js')

  if (isScanRunning()) {
    const progress = readScanProgress()
    if (progress) {
      return `扫描已在运行中: [${progress.current}/${progress.total}] ${progress.lastFile.split('/').slice(-2).join('/')}\n使用 /wiki stop 停止，或 /wiki status 查看进度。`
    }
    return '扫描已在运行中。使用 /wiki stop 停止，或 /wiki status 查看进度。'
  }

  try {
    scanBackground({ concurrency: 15, batchSize: 100 })
    return 'Wiki 扫描已在后台启动（并发 15，本批最多 100 个文件）。\n使用 /wiki status 查看进度，/wiki stop 停止扫描。'
  } catch (err) {
    return `扫描启动失败: ${err instanceof Error ? err.message : String(err)}`
  }
}

// ─── stop：停止后台扫描 ───

async function handleStop(): Promise<string> {
  const { stopScan, isScanRunning } = await import('../../wiki/scan.js')

  if (!isScanRunning()) {
    return '当前没有在运行的扫描任务。'
  }

  const stopped = stopScan()
  return stopped ? 'Wiki 扫描已停止。已处理的文件不受影响。' : '停止失败，可能扫描已完成。'
}

// ─── ingest ───

async function handleIngest(args: string): Promise<string> {
  const source = args.trim()
  if (!source) {
    return '请提供素材来源。用法：/wiki ingest <url|文件路径>'
  }

  const { ingest } = await import('../../wiki/ingest.js')
  const { ensureWikiDirs } = await import('../../wiki/paths.js')
  ensureWikiDirs()

  try {
    const result = await ingest(source)
    if (result.status === 'duplicate') {
      return '该素材已导入过（SHA256 去重检测），跳过。'
    }
    if (result.status === 'ok') {
      return `Wiki 导入完成：创建 ${result.pagesCreated} 个页面，更新 ${result.pagesUpdated} 个页面。`
    }
    return `导入失败: ${result.error ?? '未知错误'}`
  } catch (err) {
    return `导入失败: ${err instanceof Error ? err.message : String(err)}`
  }
}

// ─── query ───

async function handleQuery(args: string): Promise<string> {
  const question = args.trim()
  if (!question) {
    return '请提供查询问题。用法：/wiki query <问题>'
  }

  const { query } = await import('../../wiki/query.js')

  try {
    const result = await query(question)
    const parts = [result.answer]
    if (result.pagesUsed.length > 0) {
      parts.push('\n引用页面:')
      for (const page of result.pagesUsed) {
        parts.push(`  - ${page}`)
      }
    }
    return parts.join('\n')
  } catch (err) {
    return `查询失败: ${err instanceof Error ? err.message : String(err)}`
  }
}

// ─── lint ───

async function handleLint(): Promise<string> {
  const { lint } = await import('../../wiki/lint.js')
  const { ensureWikiDirs } = await import('../../wiki/paths.js')
  ensureWikiDirs()

  try {
    const result = await lint()
    return result.summary
  } catch (err) {
    return `检查失败: ${err instanceof Error ? err.message : String(err)}`
  }
}

// ─── status（含扫描进度） ───

async function handleStatus(): Promise<string> {
  const { readIndex } = await import('../../wiki/index-manager.js')
  const { getWikiDir, getRawArticlesPath, ensureWikiDirs } = await import('../../wiki/paths.js')
  const { readScanProgress, isScanRunning } = await import('../../wiki/scan.js')
  const { existsSync, readdirSync, readFileSync } = await import('fs')
  const { join } = await import('path')

  ensureWikiDirs()
  const wikiDir = getWikiDir()
  const index = readIndex()

  const entityCount = index.filter(e => e.type === 'entity').length
  const topicCount = index.filter(e => e.type === 'topic').length
  const sourceCount = index.filter(e => e.type === 'source').length
  const synthesisCount = index.filter(e => e.type === 'synthesis').length

  const lines = [
    'Wiki 知识库状态',
    '───────────────',
    `目录: ${wikiDir}`,
    `索引条目: ${index.length}`,
    `  实体: ${entityCount}`,
    `  主题: ${topicCount}`,
    `  素材摘要: ${sourceCount}`,
    `  综合分析: ${synthesisCount}`,
  ]

  // 扫描进度
  const scanProgress = readScanProgress()
  if (scanProgress) {
    lines.push('')
    if (scanProgress.status === 'running' || isScanRunning()) {
      const pct = scanProgress.total > 0 ? Math.round((scanProgress.current / scanProgress.total) * 100) : 0
      const shortFile = scanProgress.lastFile ? scanProgress.lastFile.split('/').slice(-2).join('/') : ''
      lines.push(`扫描状态: 运行中 ${pct}% (${scanProgress.current}/${scanProgress.total})`)
      if (shortFile) {
        lines.push(`当前文件: ${shortFile}`)
      }
      lines.push('使用 /wiki stop 停止扫描')
    } else if (scanProgress.status === 'done') {
      lines.push(`上次扫描: 完成 — ${scanProgress.summary ?? ''}`)
      lines.push(`完成时间: ${scanProgress.updatedAt}`)
    } else if (scanProgress.status === 'error') {
      lines.push(`上次扫描: 失败 — ${scanProgress.error ?? '未知错误'}`)
    }
  }

  // 模型配置
  try {
    const configPath = join(process.cwd(), 'claudeme.json')
    if (existsSync(configPath)) {
      const parsed = JSON.parse(readFileSync(configPath, 'utf-8'))
      if (parsed.wiki?.model) {
        lines.push(`Wiki 模型: ${parsed.wiki.model}`)
      } else {
        lines.push('Wiki 模型: (跟随当前模型)')
      }
      if (parsed.wiki?.sources) {
        lines.push(`知识源: ${parsed.wiki.sources.join(', ')}`)
      }
    }
  } catch {
    // 忽略
  }

  const rawDir = getRawArticlesPath()
  if (existsSync(rawDir)) {
    const rawCount = readdirSync(rawDir).filter((f: string) => f.endsWith('.md')).length
    lines.push(`原始素材: ${rawCount}`)
  }

  if (index.length > 0) {
    lines.push('', '最近条目:')
    for (const entry of index.slice(-5)) {
      lines.push(`  [${entry.type}] ${entry.title} — ${entry.summary.slice(0, 50)}`)
    }
  }

  return lines.join('\n')
}

// ─── 用法说明 ───

const USAGE = `Wiki 知识库命令。用法：
  /wiki scan                   — 后台扫描知识源目录（每批 100 个）
  /wiki stop                   — 停止正在进行的扫描
  /wiki status                 — 查看知识库状态和扫描进度
  /wiki ingest <url|文件路径>  — 手动导入单个素材
  /wiki query <问题>           — 查询知识库
  /wiki lint                   — 检查知识库健康度

在 claudeme.json 中配置知识源目录：
  { "wiki": { "sources": ["/path/to/kbase"] } }`

// ─── 命令入口 ───

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const trimmed = (args ?? '').trim()
  const spaceIdx = trimmed.indexOf(' ')
  const subcommand = spaceIdx >= 0 ? trimmed.slice(0, spaceIdx) : trimmed
  const subArgs = spaceIdx >= 0 ? trimmed.slice(spaceIdx + 1) : ''

  let result: string

  switch (subcommand) {
    case 'scan':
      result = await handleScan()
      break
    case 'stop':
      result = await handleStop()
      break
    case 'ingest':
      result = await handleIngest(subArgs)
      break
    case 'query':
      result = await handleQuery(subArgs)
      break
    case 'lint':
      result = await handleLint()
      break
    case 'status':
      result = await handleStatus()
      break
    default:
      result = USAGE
      break
  }

  onDone(result, { display: 'system', shouldQuery: subcommand === 'query' })
  return <Text dimColor>{result}</Text>
}
