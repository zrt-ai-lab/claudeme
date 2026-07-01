// Wiki 知识库 — 自动扫描器
// 扫描配置的 sources 目录，自动 ingest 新增/修改的文件

import { createHash } from 'crypto'
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync, unlinkSync } from 'fs'
import { join, extname, relative } from 'path'
import { getRawArticlesPath, getWikiDir, ensureWikiDirs, getScanProgressPath } from './paths.js'
import { ingest } from './ingest.js'
import type { IngestResult } from './types.js'
import { appendLog } from './log-manager.js'

// ─── 配置读取 ───

interface WikiConfig {
  readonly sources: readonly string[]
  readonly exclude?: readonly string[]
}

/** 默认排除的目录/文件模式 */
const DEFAULT_EXCLUDES = [
  'node_modules',
  '.git',
  '.venv',
  '.opencode',
  '.myccm',
  '__pycache__',
  'dist',
  'build',
  '.next',
  'temp',
  'tmp',
]

/** 默认排除的文件名 */
const EXCLUDED_FILENAMES = new Set([
  'README.md',
  'README_en.md',
  'CHANGELOG.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'LICENSE.md',
])

/** 支持的文件后缀 */
const SUPPORTED_EXTENSIONS = new Set(['.md', '.txt'])

/** 从 claudeme.json 读取 wiki 配置 */
export function loadWikiConfig(): WikiConfig | null {
  // 查找 claudeme.json
  const candidatePaths = [
    process.env.CLAUDEME_CONFIG,
    join(process.cwd(), 'claudeme.json'),
  ].filter((p): p is string => !!p)

  for (const configPath of candidatePaths) {
    if (!existsSync(configPath)) continue
    try {
      const raw = readFileSync(configPath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (parsed.wiki?.sources && Array.isArray(parsed.wiki.sources)) {
        return {
          sources: parsed.wiki.sources,
          exclude: parsed.wiki.exclude,
        }
      }
    } catch {
      // 忽略解析错误
    }
  }

  return null
}

// ─── 文件发现 ───

function shouldExcludeDir(dirName: string, customExcludes: readonly string[]): boolean {
  if (dirName.startsWith('.') && dirName !== '.learnings') return true
  if (DEFAULT_EXCLUDES.includes(dirName)) return true
  if (customExcludes.includes(dirName)) return true
  return false
}

function shouldExcludeFile(filename: string): boolean {
  if (EXCLUDED_FILENAMES.has(filename)) return true
  if (!SUPPORTED_EXTENSIONS.has(extname(filename).toLowerCase())) return true
  return false
}

/** 递归扫描目录，返回所有有效的文件路径 */
function discoverFiles(
  dir: string,
  customExcludes: readonly string[],
): string[] {
  const files: string[] = []

  if (!existsSync(dir)) return files

  const entries = readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!shouldExcludeDir(entry.name, customExcludes)) {
        files.push(...discoverFiles(join(dir, entry.name), customExcludes))
      }
    } else if (entry.isFile()) {
      if (!shouldExcludeFile(entry.name)) {
        const filePath = join(dir, entry.name)
        // 跳过过小的文件（<50 字符可能是空模板）
        try {
          const stat = statSync(filePath)
          if (stat.size >= 50) {
            files.push(filePath)
          }
        } catch {
          // 跳过无法 stat 的文件
        }
      }
    }
  }

  return files
}

// ─── 已处理文件的 hash 记录 ───

function getProcessedHashes(): Set<string> {
  const rawDir = getRawArticlesPath()
  if (!existsSync(rawDir)) return new Set()

  const files = readdirSync(rawDir)
  // raw 文件名格式: {hash16}-{date}.md
  return new Set(files.map(f => f.split('-')[0]).filter(h => h && h.length === 16))
}

function fileContentHash(filePath: string): string {
  const content = readFileSync(filePath, 'utf-8')
  return createHash('sha256').update(content).digest('hex')
}

// ─── 并发控制 ───

/** 并发池：限制同时执行的 Promise 数量，支持 abort */
async function pooledMap<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      if (signal?.aborted) return
      const idx = nextIndex++
      results[idx] = await fn(items[idx], idx)
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  )
  await Promise.all(workers)
  return results
}

// ─── 进度回调 ───

export interface ScanProgress {
  readonly current: number
  readonly total: number
  readonly file: string
  readonly status: 'ok' | 'duplicate' | 'error'
}

export type ScanProgressCallback = (progress: ScanProgress) => void

// ─── 主入口 ───

/** 默认并发数 */
const DEFAULT_CONCURRENCY = 15

export interface ScanResult {
  readonly sourceDirs: readonly string[]
  readonly filesFound: number
  readonly filesNew: number
  readonly filesProcessed: number
  readonly filesFailed: number
  /** 本次实际处理的文件数（含失败） */
  readonly filesAttempted: number
  /** 剩余未处理文件数（因批次上限或取消） */
  readonly filesRemaining: number
  /** 是否被取消 */
  readonly cancelled: boolean
  readonly results: readonly {
    readonly file: string
    readonly status: 'ok' | 'duplicate' | 'error'
    readonly pagesCreated?: number
    readonly pagesUpdated?: number
    readonly error?: string
  }[]
}

export interface ScanOptions {
  /** 并发数，默认 15 */
  readonly concurrency?: number
  /** 单次最多处理文件数（0 = 不限），默认 100 */
  readonly batchSize?: number
  /** 取消信号 */
  readonly signal?: AbortSignal
  /** 进度回调 */
  readonly onProgress?: ScanProgressCallback
  /** 文件发现后回调，可用于拿到整次扫描总数 */
  readonly onDiscovered?: (info: { readonly filesFound: number; readonly filesNew: number }) => void
}

export async function scan(options?: ScanOptions): Promise<ScanResult> {
  const wikiConfig = loadWikiConfig()

  if (!wikiConfig || wikiConfig.sources.length === 0) {
    throw new Error(
      '未配置知识源目录。请在 claudeme.json 中添加：\n' +
        '{\n  "wiki": {\n    "sources": ["/path/to/your/kbase"]\n  }\n}',
    )
  }

  ensureWikiDirs()

  const signal = options?.signal
  const batchSize = options?.batchSize ?? 100
  const onDiscovered = options?.onDiscovered

  // 获取已处理的文件 hash 前缀
  const processedHashes = getProcessedHashes()

  // 发现所有文件
  const customExcludes = wikiConfig.exclude ?? []
  const allFiles: string[] = []

  for (const sourceDir of wikiConfig.sources) {
    const expandedDir = sourceDir.replace(/^~/, process.env.HOME ?? '')
    const files = discoverFiles(expandedDir, customExcludes)
    allFiles.push(...files)
  }

  // 筛选未处理的文件（SHA256 前 16 位不在 raw 目录中）
  const newFiles: string[] = []
  for (const filePath of allFiles) {
    try {
      const hash = fileContentHash(filePath)
      const shortHash = hash.slice(0, 16)
      if (!processedHashes.has(shortHash)) {
        newFiles.push(filePath)
      }
    } catch {
      // 跳过读取失败的文件
    }
  }

  onDiscovered?.({
    filesFound: allFiles.length,
    filesNew: newFiles.length,
  })

  // 截取本次批次
  const batch = batchSize > 0 ? newFiles.slice(0, batchSize) : newFiles
  const filesRemaining = newFiles.length - batch.length

  // 并发 ingest
  const concurrency = options?.concurrency ?? DEFAULT_CONCURRENCY
  const onProgress = options?.onProgress
  let filesProcessed = 0
  let filesFailed = 0
  let completed = 0

  const results = await pooledMap(
    batch,
    concurrency,
    async (filePath, _idx) => {
      // 检查取消
      if (signal?.aborted) {
        return { file: filePath, status: 'error' as const, error: '已取消' }
      }

      try {
        const result = await ingest(filePath)
        const status = result.status === 'ok' || result.status === 'duplicate'
          ? result.status
          : 'error' as const

        if (result.status === 'ok') {
          filesProcessed++
        }

        completed++
        onProgress?.({
          current: completed,
          total: batch.length,
          file: filePath,
          status,
        })

        return {
          file: filePath,
          status,
          pagesCreated: result.pagesCreated,
          pagesUpdated: result.pagesUpdated,
          error: result.error,
        }
      } catch (err) {
        filesFailed++
        completed++

        const errorMsg = err instanceof Error ? err.message : String(err)
        onProgress?.({
          current: completed,
          total: batch.length,
          file: filePath,
          status: 'error',
        })

        return {
          file: filePath,
          status: 'error' as const,
          error: errorMsg,
        }
      }
    },
    signal,
  )

  // 过滤掉取消产生的空结果
  const validResults = results.filter(r => r && r.file)
  const wasCancelled = signal?.aborted ?? false

  // 记录日志
  appendLog({
    timestamp: new Date().toISOString(),
    operation: 'ingest',
    summary: `批量扫描: ${allFiles.length} 文件, ${newFiles.length} 新增, ${filesProcessed} 成功, ${filesFailed} 失败${wasCancelled ? ' (已取消)' : ''}${filesRemaining > 0 ? `, 剩余 ${filesRemaining}` : ''}`,
    pagesAffected: [],
  })

  return {
    sourceDirs: wikiConfig.sources,
    filesFound: allFiles.length,
    filesNew: newFiles.length,
    filesProcessed,
    filesFailed,
    filesAttempted: completed,
    filesRemaining,
    cancelled: wasCancelled,
    results: validResults,
  }
}

// ─── 进度文件 ───

export interface ScanProgressFile {
  readonly status: 'running' | 'done' | 'error'
  readonly startedAt: string
  readonly updatedAt: string
  readonly current: number
  readonly total: number
  readonly processed: number
  readonly failed: number
  readonly lastFile: string
  readonly error?: string
  /** 完成后的摘要 */
  readonly summary?: string
}

function writeScanProgress(data: ScanProgressFile): void {
  try {
    writeFileSync(getScanProgressPath(), JSON.stringify(data, null, 2), 'utf-8')
  } catch {
    // 忽略写入失败
  }
}

/** 读取后台扫描进度（无进度文件时返回 null） */
export function readScanProgress(): ScanProgressFile | null {
  const path = getScanProgressPath()
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as ScanProgressFile
  } catch {
    return null
  }
}

/** 清理进度文件 */
export function clearScanProgress(): void {
  const path = getScanProgressPath()
  if (existsSync(path)) {
    try { unlinkSync(path) } catch { /* ignore */ }
  }
}

// ─── 全局 abort 控制器（用于 /wiki stop） ───

interface ActiveScanState {
  readonly abortController: AbortController
  readonly startedAt: string
  readonly totalFiles: number
}

let activeScanState: ActiveScanState | null = null

/** 获取当前是否有扫描在跑 */
export function isScanRunning(): boolean {
  return activeScanState !== null
}

/** 停止当前后台扫描 */
export function stopScan(): boolean {
  if (!activeScanState) {
    return false
  }

  const stoppedScan = activeScanState
  stoppedScan.abortController.abort()
  activeScanState = null

  const currentProgress = readScanProgress()
  writeScanProgress({
    status: 'done',
    startedAt: stoppedScan.startedAt,
    updatedAt: new Date().toISOString(),
    current: currentProgress?.current ?? 0,
    total: currentProgress?.total ?? currentProgress?.current ?? 0,
    processed: currentProgress?.processed ?? 0,
    failed: currentProgress?.failed ?? 0,
    lastFile: currentProgress?.lastFile ?? '',
    summary: buildScanSummary({
      filesFound: currentProgress?.total ?? currentProgress?.current ?? 0,
      filesNew: currentProgress?.total ?? currentProgress?.current ?? 0,
      filesAttempted: currentProgress?.current ?? 0,
      filesProcessed: currentProgress?.processed ?? 0,
      filesFailed: currentProgress?.failed ?? 0,
      filesRemaining: Math.max((currentProgress?.total ?? 0) - (currentProgress?.current ?? 0), 0),
      cancelled: true,
    }),
  })

  return true
}

/** 后台启动扫描（不阻塞，进度写文件） */
function buildScanSummary(result: {
  readonly filesFound: number
  readonly filesNew: number
  readonly filesAttempted: number
  readonly filesProcessed: number
  readonly filesFailed: number
  readonly filesRemaining: number
  readonly cancelled: boolean
}): string {
  return `发现 ${result.filesFound} 文件, 新增 ${result.filesNew}, 本批处理 ${result.filesAttempted}, 成功 ${result.filesProcessed}, 失败 ${result.filesFailed}${result.filesRemaining > 0 ? `, 剩余 ${result.filesRemaining}` : ''}${result.cancelled ? ' (已取消)' : ''}`
}

function writeRunningScanProgress(params: {
  readonly startedAt: string
  readonly current: number
  readonly total: number
  readonly processed: number
  readonly failed: number
  readonly lastFile: string
}): void {
  if (activeScanState?.startedAt !== params.startedAt) {
    return
  }

  writeScanProgress({
    status: 'running',
    startedAt: params.startedAt,
    updatedAt: new Date().toISOString(),
    current: params.current,
    total: params.total,
    processed: params.processed,
    failed: params.failed,
    lastFile: params.lastFile,
  })
}

export function scanBackground(options?: Omit<ScanOptions, 'signal' | 'onProgress'>): void {
  if (activeScanState) {
    throw new Error('已有扫描任务在运行中。使用 /wiki stop 停止当前扫描。')
  }

  const abortController = new AbortController()
  const startedAt = new Date().toISOString()
  const batchSize = options?.batchSize ?? 100
  let completedBeforeCurrentBatch = 0
  let totalFiles = 0

  activeScanState = { abortController, startedAt, totalFiles: 0 }

  const runScanLoop = async (): Promise<void> => {
    while (true) {
      const result = await scan({
        ...options,
        signal: abortController.signal,
        onDiscovered: (info) => {
          if (totalFiles === 0) {
            totalFiles = info.filesNew
            activeScanState = { abortController, startedAt, totalFiles }
          }
        },
        onProgress: (progress) => {
          writeRunningScanProgress({
            startedAt,
            current: completedBeforeCurrentBatch + progress.current,
            total: totalFiles > 0 ? totalFiles : progress.total,
            processed: completedBeforeCurrentBatch,
            failed: 0,
            lastFile: progress.file,
          })
        },
      })

      completedBeforeCurrentBatch += result.filesAttempted

      if (abortController.signal.aborted || result.cancelled || result.filesRemaining <= 0 || batchSize === 0) {
        if (activeScanState?.startedAt === startedAt) {
          writeScanProgress({
            status: 'done',
            startedAt,
            updatedAt: new Date().toISOString(),
            current: completedBeforeCurrentBatch,
            total: totalFiles > 0 ? totalFiles : completedBeforeCurrentBatch,
            processed: result.filesProcessed,
            failed: result.filesFailed,
            lastFile: '',
            summary: buildScanSummary({
              filesFound: result.filesFound,
              filesNew: totalFiles,
              filesAttempted: completedBeforeCurrentBatch,
              filesProcessed: result.filesProcessed,
              filesFailed: result.filesFailed,
              filesRemaining: result.filesRemaining,
              cancelled: abortController.signal.aborted || result.cancelled,
            }),
          })
        }
        return
      }
    }
  }

  runScanLoop()
    .catch((err) => {
      if (activeScanState?.startedAt === startedAt) {
        writeScanProgress({
          status: 'error',
          startedAt,
          updatedAt: new Date().toISOString(),
          current: 0,
          total: 0,
          processed: 0,
          failed: 0,
          lastFile: '',
          error: err instanceof Error ? err.message : String(err),
        })
      }
    })
    .finally(() => {
      if (activeScanState?.startedAt === startedAt) {
        activeScanState = null
      }
    })
}
