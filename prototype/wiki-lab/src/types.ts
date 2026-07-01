// Wiki Lab — 类型定义

// ─── Wiki 页面类型 ───

export const WIKI_PAGE_TYPES = ['entity', 'topic', 'source', 'synthesis'] as const
export type WikiPageType = (typeof WIKI_PAGE_TYPES)[number]

export const CONFIDENCE_LEVELS = ['verified', 'inferred', 'unverified'] as const
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number]

/** Wiki 页面 frontmatter */
export interface WikiPageMeta {
  readonly title: string
  readonly type: WikiPageType
  readonly confidence: ConfidenceLevel
  readonly sources: readonly string[]
  readonly created: string
  readonly updated: string
  readonly tags: readonly string[]
}

/** index.md 中的一个条目 */
export interface WikiIndexEntry {
  readonly path: string
  readonly title: string
  readonly type: WikiPageType
  readonly summary: string
}

/** log.md 中的一条操作记录 */
export interface WikiLogEntry {
  readonly timestamp: string
  readonly operation: 'ingest' | 'query' | 'lint' | 'update'
  readonly summary: string
  readonly pagesAffected: readonly string[]
}

/** 原始素材 */
export interface RawMaterial {
  readonly id: string
  readonly filename: string
  readonly sourceType: string
  readonly originalPath: string
  readonly ingestedAt: string
}

// ─── LLM 相关 ───

export interface LLMConfig {
  readonly apiBase: string
  readonly apiKey: string
  readonly model: string
  readonly maxTokens: number
}

export interface LLMMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool'
  readonly content: string
  readonly tool_call_id?: string
  readonly tool_calls?: readonly LLMToolCall[]
}

export interface LLMToolCall {
  readonly id: string
  readonly type: 'function'
  readonly function: {
    readonly name: string
    readonly arguments: string
  }
}

export interface LLMTool {
  readonly type: 'function'
  readonly function: {
    readonly name: string
    readonly description?: string
    readonly parameters?: Record<string, unknown>
  }
}

export interface LLMCallOptions {
  readonly system?: string
  readonly messages: readonly LLMMessage[]
  readonly tools?: readonly LLMTool[]
  readonly toolChoice?: 'auto' | 'required' | { type: 'function'; function: { name: string } }
  readonly temperature?: number
  readonly maxTokens?: number
}

export interface ChatCompletion {
  readonly id: string
  readonly choices: readonly {
    readonly index: number
    readonly message: {
      readonly role: string
      readonly content: string | null
      readonly tool_calls?: readonly LLMToolCall[]
    }
    readonly finish_reason: string
  }[]
  readonly usage?: {
    readonly prompt_tokens: number
    readonly completion_tokens: number
    readonly total_tokens: number
  }
}

// ─── Ingest 结果 ───

export interface IngestPlan {
  readonly source_summary: {
    readonly title: string
    readonly summary: string
    readonly tags: readonly string[]
  }
  readonly entities: readonly {
    readonly id: string
    readonly title: string
    readonly content: string
    readonly confidence: ConfidenceLevel
    readonly tags: readonly string[]
  }[]
  readonly topics: readonly {
    readonly id: string
    readonly title: string
    readonly content: string
    readonly confidence: ConfidenceLevel
    readonly tags: readonly string[]
  }[]
}

export type IngestStatus = 'ok' | 'duplicate' | 'error'

export interface IngestResult {
  readonly status: IngestStatus
  readonly pagesCreated?: number
  readonly pagesUpdated?: number
  readonly error?: string
}

// ─── Query 结果 ───

export interface QueryResult {
  readonly answer: string
  readonly pagesUsed: readonly string[]
}

// ─── Lint 结果 ───

export type LintIssueType = 'broken_link' | 'orphan' | 'index_stale' | 'index_missing' | 'stale'

export interface LintIssue {
  readonly type: LintIssueType
  readonly page?: string
  readonly link?: string
  readonly entry?: string
  readonly daysOld?: number
}

export interface LintResult {
  readonly issues: readonly LintIssue[]
  readonly summary: string
}
