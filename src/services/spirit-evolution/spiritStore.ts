/**
 * 镜像精灵 — 自进化存储层
 *
 * 管理 ~/.claude/spirit/ 目录下的知识文件：
 * - INSIGHTS.md  — 用户偏好（格式/风格/习惯）
 * - SKILLS.md    — 可复用操作模式
 * - PITFALLS.md  — 避坑指南（犯过的错）
 * - .usage.json  — 统计元数据
 *
 * 所有写操作返回新内容（不可变），由调用方决定是否写入。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { homedir } from 'node:os'

// ─── 路径 ───

const SPIRIT_DIR = path.join(homedir(), '.claude', 'spirit')

const FILES = {
  insights: path.join(SPIRIT_DIR, 'INSIGHTS.md'),
  skills: path.join(SPIRIT_DIR, 'SKILLS.md'),
  pitfalls: path.join(SPIRIT_DIR, 'PITFALLS.md'),
  usage: path.join(SPIRIT_DIR, '.usage.json'),
  curatorLog: path.join(SPIRIT_DIR, '.curator-log.json'),
} as const

export type SpiritFileKey = 'insights' | 'skills' | 'pitfalls'

// ─── 初始化 ───

function ensureDir(): void {
  if (!fs.existsSync(SPIRIT_DIR)) {
    fs.mkdirSync(SPIRIT_DIR, { recursive: true })
  }
}

const INITIAL_INSIGHTS = `# 用户偏好与风格

> 镜像精灵自动观察到的用户偏好，每次对话后更新。

<!-- 格式：每条以 - 开头，附带发现日期 -->
`

const INITIAL_SKILLS = `# 可复用操作模式

> 在对话中发现的可复用技巧和操作模式。

<!-- 格式：## 标题 + 描述 + 步骤 -->
`

const INITIAL_PITFALLS = `# 避坑指南

> 曾经犯过的错误和被用户纠正的事项，避免重蹈覆辙。

<!-- 格式：每条以 - 开头，说明错误和正确做法 -->
`

const INITIAL_CONTENT: Record<SpiritFileKey, string> = {
  insights: INITIAL_INSIGHTS,
  skills: INITIAL_SKILLS,
  pitfalls: INITIAL_PITFALLS,
}

/** 确保 spirit 目录和基础文件存在 */
export function initSpiritStore(): void {
  ensureDir()
  for (const key of ['insights', 'skills', 'pitfalls'] as const) {
    const filePath = FILES[key]
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, INITIAL_CONTENT[key], 'utf-8')
    }
  }
  if (!fs.existsSync(FILES.usage)) {
    writeUsage(createUsage())
  }
}

// ─── 读取 ───

export function readFile(key: SpiritFileKey): string {
  const filePath = FILES[key]
  if (!fs.existsSync(filePath)) return INITIAL_CONTENT[key]
  return fs.readFileSync(filePath, 'utf-8')
}

export function readAllFiles(): Record<SpiritFileKey, string> {
  return {
    insights: readFile('insights'),
    skills: readFile('skills'),
    pitfalls: readFile('pitfalls'),
  }
}

/** 读取所有文件并拼接为一个摘要字符串（供系统提示注入） */
export function readSnapshot(maxTokens: number = 2000): string {
  const all = readAllFiles()
  const combined = [
    all.insights.trim(),
    all.skills.trim(),
    all.pitfalls.trim(),
  ].filter(s => s.length > 0).join('\n\n---\n\n')

  // 粗略 token 估算：4 字节 ≈ 1 token
  const maxChars = maxTokens * 4
  if (combined.length <= maxChars) return combined
  return combined.slice(0, maxChars) + '\n\n<!-- 已截断 -->'
}

// ─── 写入 ───

export function writeFile(key: SpiritFileKey, content: string): void {
  ensureDir()
  fs.writeFileSync(FILES[key], content, 'utf-8')
}

/** 追加内容到指定文件末尾 */
export function appendToFile(key: SpiritFileKey, entry: string): void {
  ensureDir()
  const current = readFile(key)
  const newContent = current.trimEnd() + '\n\n' + entry.trim() + '\n'
  fs.writeFileSync(FILES[key], newContent, 'utf-8')
}

// ─── Usage 统计 ───

export interface SpiritUsage {
  readonly createdAt: string
  readonly lastReviewAt: string | null
  readonly lastCuratorAt: string | null
  readonly reviewCount: number
  readonly sessionCount: number
  readonly insightCount: number
  readonly skillCount: number
  readonly pitfallCount: number
}

function createUsage(): SpiritUsage {
  return {
    createdAt: new Date().toISOString(),
    lastReviewAt: null,
    lastCuratorAt: null,
    reviewCount: 0,
    sessionCount: 0,
    insightCount: 0,
    skillCount: 0,
    pitfallCount: 0,
  }
}

export function readUsage(): SpiritUsage {
  if (!fs.existsSync(FILES.usage)) return createUsage()
  try {
    const raw = fs.readFileSync(FILES.usage, 'utf-8')
    return { ...createUsage(), ...JSON.parse(raw) } as SpiritUsage
  } catch {
    return createUsage()
  }
}

export function writeUsage(usage: SpiritUsage): void {
  ensureDir()
  fs.writeFileSync(FILES.usage, JSON.stringify(usage, null, 2), 'utf-8')
}

/** 不可变更新 usage 字段 */
export function updateUsage(
  patch: Partial<Omit<SpiritUsage, 'createdAt'>>,
): SpiritUsage {
  const current = readUsage()
  const updated: SpiritUsage = { ...current, ...patch }
  writeUsage(updated)
  return updated
}

/** 记录一次 review 完成 */
export function recordReview(newInsights: number, newSkills: number, newPitfalls: number): SpiritUsage {
  const current = readUsage()
  return updateUsage({
    lastReviewAt: new Date().toISOString(),
    reviewCount: current.reviewCount + 1,
    insightCount: current.insightCount + newInsights,
    skillCount: current.skillCount + newSkills,
    pitfallCount: current.pitfallCount + newPitfalls,
  })
}

/** 记录一次会话 */
export function recordSession(): SpiritUsage {
  const current = readUsage()
  return updateUsage({
    sessionCount: current.sessionCount + 1,
  })
}

// ─── 导出路径常量 ───

export const SPIRIT_PATHS = FILES
export function getSpiritDir(): string {
  return SPIRIT_DIR
}
