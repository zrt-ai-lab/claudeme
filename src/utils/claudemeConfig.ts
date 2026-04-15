/**
 * ClaudeMe 多模型配置管理
 *
 * 读取项目根目录 claudeme.json，按厂商(provider)分组管理模型。
 * 每个厂商配置一次 api_base/api_key，其下模型自动继承。
 * 支持 OpenAI Compatible API 和原 Anthropic API 混配。
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { logError } from './log.js'

// ─── 类型定义 ───

export interface ModelCapabilities {
  readonly vision: boolean
  readonly tool_calling: boolean
}

/** 厂商下的模型条目 */
export interface ProviderModelEntry {
  readonly name: string
  readonly model: string
  readonly max_tokens: number
  readonly capabilities: ModelCapabilities
  readonly api_base?: string // 可选覆盖厂商默认
  readonly api_key?: string // 可选覆盖厂商默认
  readonly provider?: 'anthropic' | 'openai-compat'
}

/** 厂商配置 */
export interface ProviderConfig {
  readonly name: string
  readonly api_base: string
  readonly api_key: string // 支持 $ENV_VAR
  readonly models: Readonly<Record<string, ProviderModelEntry>>
}

/** JSON 文件结构 */
export interface ClaudemeConfigFile {
  readonly default: string
  readonly providers: Readonly<Record<string, ProviderConfig>>
}

/** 展开后的单模型配置（内部使用，下游消费） */
export interface ModelConfig {
  readonly name: string
  readonly api_base?: string
  readonly api_key?: string
  readonly model: string
  readonly max_tokens: number
  readonly provider?: 'anthropic' | 'openai-compat'
  readonly capabilities: ModelCapabilities
  readonly providerKey: string // 如 "example-provider"
  readonly providerName: string // 如 "Example Provider"
}

/** 内部运行时配置 */
export interface ClaudemeConfig {
  readonly default: string
  readonly models: Readonly<Record<string, ModelConfig>>
  readonly providers: Readonly<Record<string, { name: string }>>
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
 * 查找 claudeme.json 的路径
 * 优先级: CLAUDEME_CONFIG 环境变量 > CWD > 项目根目录（bin/claudeme 所在项目）
 */
function findConfigPath(): string | null {
  // 项目根目录：从当前文件位置向上推导
  const projectRoot = join(dirname(new URL(import.meta.url).pathname), '..', '..')
  const candidates = [
    join(process.cwd(), 'claudeme.json'),    // CWD（兼容 bun run dev）
    join(projectRoot, 'claudeme.json'),       // 项目根目录（全局命令时）
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
 * 将 providers 格式展开为 Record<compositeKey, ModelConfig>
 */
function normalizeProviders(
  providers: Record<string, ProviderConfig>,
): { models: Record<string, ModelConfig>; providerMeta: Record<string, { name: string }> } {
  const models: Record<string, ModelConfig> = {}
  const providerMeta: Record<string, { name: string }> = {}

  for (const [providerKey, providerCfg] of Object.entries(providers)) {
    // provider key 不能含 /
    if (providerKey.includes('/')) {
      logError(new Error(`claudeme.json: provider key "${providerKey}" must not contain '/'`))
      continue
    }

    providerMeta[providerKey] = { name: providerCfg.name }
    const providerApiBase = providerCfg.api_base
    const providerApiKey = resolveApiKey(providerCfg.api_key)

    for (const [modelKey, entry] of Object.entries(providerCfg.models)) {
      // model key 不能含 /
      if (modelKey.includes('/')) {
        logError(
          new Error(`claudeme.json: model key "${modelKey}" in "${providerKey}" must not contain '/'`),
        )
        continue
      }

      const compositeKey = `${providerKey}/${modelKey}`

      // 模型级覆盖优先于厂商级
      const effectiveApiBase = entry.api_base ?? providerApiBase
      const effectiveApiKey = entry.api_key ? resolveApiKey(entry.api_key) : providerApiKey

      models[compositeKey] = {
        name: entry.name,
        api_base: effectiveApiBase,
        api_key: effectiveApiKey,
        model: entry.model,
        max_tokens: entry.max_tokens,
        provider: entry.provider ?? (effectiveApiBase ? 'openai-compat' : 'anthropic'),
        capabilities: entry.capabilities,
        providerKey,
        providerName: providerCfg.name,
      }
    }
  }

  return { models, providerMeta }
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
    const parsed = JSON.parse(raw)

    // 校验基本结构
    if (!parsed.default || !parsed.providers || typeof parsed.providers !== 'object') {
      logError(new Error('claudeme.json: missing "default" or "providers" field'))
      return null
    }

    const { models, providerMeta } = normalizeProviders(parsed.providers)

    // 校验 default 指向有效模型
    if (!models[parsed.default]) {
      logError(
        new Error(`claudeme.json: default model "${parsed.default}" not found in providers`),
      )
      return null
    }

    _config = {
      default: parsed.default,
      models,
      providers: providerMeta,
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
 * 获取所有厂商信息
 */
export function getProviders(): Readonly<Record<string, { name: string }>> {
  const config = loadConfig()
  if (!config) return {}
  return config.providers
}

/**
 * 获取指定厂商下的模型列表
 */
export function getModelsByProvider(providerKey: string): Array<{ key: string } & ModelConfig> {
  const config = loadConfig()
  if (!config) return []
  return Object.entries(config.models)
    .filter(([, model]) => model.providerKey === providerKey)
    .map(([key, model]) => ({ key, ...model }))
}

/**
 * 重置配置缓存（主要用于测试）
 */
export function resetClaudemeConfig(): void {
  _config = null
  _configLoaded = false
  _currentModelKey = null
}
