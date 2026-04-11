/**
 * ClaudeMe 多模型配置管理
 *
 * 读取项目根目录 claudeme.json，提供模型列表、当前模型配置等功能。
 * 支持 OpenAI Compatible API 和原 Anthropic API 混配。
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { logError } from './log.js'

// ─── 类型定义 ───

export interface ModelCapabilities {
  readonly vision: boolean
  readonly tool_calling: boolean
}

export interface ModelConfig {
  readonly name: string
  readonly api_base?: string
  readonly api_key?: string
  readonly model: string
  readonly max_tokens: number
  readonly provider?: 'anthropic' | 'openai-compat'
  readonly capabilities: ModelCapabilities
}

export interface ClaudemeConfig {
  readonly default: string
  readonly models: Readonly<Record<string, ModelConfig>>
}

// ─── 模块状态（惰性加载，不可变） ───

let _config: ClaudemeConfig | null = null
let _configLoaded = false
let _currentModelKey: string | null = null

// ─── 配置加载 ───

/**
 * 解析 api_key 值：支持 $ENV_VAR 引用
 */
function resolveApiKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  if (raw.startsWith('$')) {
    const envName = raw.slice(1)
    return process.env[envName] || undefined
  }
  return raw
}

/**
 * 查找 claudeme.json 的路径（从 CWD 向上查找）
 */
function findConfigPath(): string | null {
  // 优先从项目根（process.cwd()）查找
  const candidates = [
    join(process.cwd(), 'claudeme.json'),
  ]

  // 如果 CLAUDEME_CONFIG 环境变量指定了路径，优先用
  if (process.env.CLAUDEME_CONFIG) {
    candidates.unshift(process.env.CLAUDEME_CONFIG)
  }

  for (const p of candidates) {
    try {
      readFileSync(p, 'utf8') // 仅测试可读
      return p
    } catch {
      // 继续尝试下一个
    }
  }
  return null
}

/**
 * 加载并解析 claudeme.json
 */
function loadConfig(): ClaudemeConfig | null {
  if (_configLoaded) return _config

  _configLoaded = true

  const configPath = findConfigPath()
  if (!configPath) {
    return null
  }

  try {
    const raw = readFileSync(configPath, 'utf8')
    const parsed = JSON.parse(raw) as ClaudemeConfig

    // 校验基本结构
    if (!parsed.default || !parsed.models || typeof parsed.models !== 'object') {
      logError(new Error('claudeme.json: missing "default" or "models" field'))
      return null
    }

    if (!parsed.models[parsed.default]) {
      logError(
        new Error(
          `claudeme.json: default model "${parsed.default}" not found in models`,
        ),
      )
      return null
    }

    // 解析每个模型的 api_key，推断 provider
    const resolvedModels: Record<string, ModelConfig> = {}
    for (const [key, model] of Object.entries(parsed.models)) {
      resolvedModels[key] = {
        ...model,
        api_key: resolveApiKey(model.api_key),
        provider: model.provider ?? (model.api_base ? 'openai-compat' : 'anthropic'),
      }
    }

    _config = {
      default: parsed.default,
      models: resolvedModels,
    }

    return _config
  } catch (err) {
    logError(err as Error)
    return null
  }
}

// ─── 公共 API ───

/**
 * 获取完整配置（可能为 null）
 */
export function getClaudemeConfig(): ClaudemeConfig | null {
  return loadConfig()
}

/**
 * 是否已加载有效配置
 */
export function hasClaudemeConfig(): boolean {
  return loadConfig() !== null
}

/**
 * 获取所有模型 key 列表
 */
export function getModelKeys(): string[] {
  const config = loadConfig()
  if (!config) return []
  return Object.keys(config.models)
}

/**
 * 获取所有模型配置列表（带 key）
 */
export function getModelList(): Array<{ key: string } & ModelConfig> {
  const config = loadConfig()
  if (!config) return []
  return Object.entries(config.models).map(([key, model]) => ({
    key,
    ...model,
  }))
}

/**
 * 获取指定 key 的模型配置
 */
export function getModelConfigByKey(key: string): ModelConfig | null {
  const config = loadConfig()
  if (!config) return null
  return config.models[key] ?? null
}

/**
 * 设置当前活跃模型（由 /model 命令调用）
 */
export function setCurrentModelKey(key: string): boolean {
  const config = loadConfig()
  if (!config || !config.models[key]) return false
  _currentModelKey = key
  return true
}

/**
 * 获取当前活跃模型的 key
 */
export function getCurrentModelKey(): string {
  if (_currentModelKey) return _currentModelKey
  const config = loadConfig()
  if (!config) return 'unknown'
  return config.default
}

/**
 * 获取当前活跃模型的完整配置
 */
export function getCurrentModelConfig(): ModelConfig | null {
  const key = getCurrentModelKey()
  return getModelConfigByKey(key)
}

/**
 * 获取当前模型发送给 API 的实际 model 字符串
 */
export function getCurrentModelString(): string {
  const config = getCurrentModelConfig()
  if (!config) return 'unknown'
  return config.model
}

/**
 * 获取当前模型的显示名称
 */
export function getCurrentModelDisplayName(): string {
  const config = getCurrentModelConfig()
  if (!config) return 'Unknown Model'
  return config.name
}

/**
 * 当前模型是否走 OpenAI Compatible 路径
 */
export function isOpenAICompatModel(key?: string): boolean {
  const modelKey = key ?? getCurrentModelKey()
  const config = getModelConfigByKey(modelKey)
  if (!config) return false
  return config.provider === 'openai-compat'
}

/**
 * 重置配置缓存（主要用于测试）
 */
export function resetClaudemeConfig(): void {
  _config = null
  _configLoaded = false
  _currentModelKey = null
}
