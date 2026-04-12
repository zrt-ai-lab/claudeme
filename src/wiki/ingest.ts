// Wiki 知识库 — Ingest 引擎

import { createHash } from 'crypto'
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { readSource } from './adapters/registry.js'
import { llmStructuredCall, llmTextCall } from './llm.js'
import {
  getRawArticlesPath,
  getEntitiesPath,
  getTopicsPath,
  getSourcesPath,
  ensureWikiDirs,
} from './paths.js'
import { upsertEntry } from './index-manager.js'
import { appendLog } from './log-manager.js'
import type { IngestPlan, IngestResult, WikiPageType } from './types.js'

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function slugify(text: string | undefined | null): string {
  if (!text || typeof text !== 'string') return `page-${Date.now()}`
  return (
    text
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fff]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || `page-${Date.now()}`
  )
}

function rawExists(hash: string): boolean {
  const rawDir = getRawArticlesPath()
  if (!existsSync(rawDir)) return false
  const files = readdirSync(rawDir)
  return files.some(f => f.startsWith(hash.slice(0, 16)))
}

async function saveRaw(source: string, content: string, hash: string): Promise<string> {
  const date = new Date().toISOString().slice(0, 10)
  const shortHash = hash.slice(0, 16)
  const filename = `${shortHash}-${date}.md`
  const filePath = join(getRawArticlesPath(), filename)

  const frontmatter = [
    '---',
    `source: ${source}`,
    `hash: ${hash}`,
    `ingested_at: ${new Date().toISOString()}`,
    '---',
    '',
    content,
  ].join('\n')

  writeFileSync(filePath, frontmatter, 'utf-8')
  return filename
}

function buildFrontmatter(
  title: string,
  type: WikiPageType,
  confidence: string,
  tags: readonly string[],
  sources: readonly string[],
): string {
  return [
    '---',
    `title: "${title}"`,
    `type: ${type}`,
    `confidence: ${confidence}`,
    `sources: [${sources.map(s => `"${s}"`).join(', ')}]`,
    `created: "${new Date().toISOString()}"`,
    `updated: "${new Date().toISOString()}"`,
    `tags: [${tags.map(t => `"${t}"`).join(', ')}]`,
    '---',
    '',
  ].join('\n')
}

async function createOrUpdatePage(
  subdir: WikiPageType,
  dirPath: string,
  pageData: {
    id: string
    title: string
    content: string
    confidence: string
    tags: readonly string[]
  },
  rawFilename: string,
): Promise<'created' | 'updated'> {
  const slug = slugify(pageData.id || pageData.title)
  const filePath = join(dirPath, `${slug}.md`)

  if (existsSync(filePath)) {
    // 合并：读旧内容，让 LLM 合并
    const oldContent = readFileSync(filePath, 'utf-8')

    const merged = await llmTextCall(
      `你是知识库编辑。将两段关于同一主题的内容合并为一篇连贯的 wiki 页面。
保留所有不重复的信息，去除重复。使用 [[双向链接]] 引用相关概念。
只输出合并后的正文内容（不含 frontmatter），使用 markdown 格式。`,
      `旧内容：\n${oldContent}\n\n新增内容：\n${pageData.content}`,
    )

    const frontmatter = buildFrontmatter(
      pageData.title,
      subdir,
      pageData.confidence,
      pageData.tags,
      [rawFilename],
    )

    writeFileSync(filePath, frontmatter + merged, 'utf-8')
    return 'updated'
  }

  // 新建页面
  const frontmatter = buildFrontmatter(
    pageData.title,
    subdir,
    pageData.confidence,
    pageData.tags,
    [rawFilename],
  )

  writeFileSync(filePath, frontmatter + pageData.content, 'utf-8')
  return 'created'
}

// ─── Ingest LLM Schema ───

const INGEST_SYSTEM_PROMPT = `你是知识库管理员。阅读用户提供的素材，提取关键信息，生成结构化的知识页面。

规则：
1. 提取所有关键实体（人物、工具、技术概念、组织），每个实体一个条目
2. 识别主题（技术方向、领域、趋势），每个主题一个条目
3. 为每个实体/主题生成 markdown 正文内容（不含 frontmatter）
4. 在正文中使用 [[双向链接]] 引用其他相关实体和主题
5. 标注置信度：verified（素材明确说了）/ inferred（你推断的）/ unverified（需要验证）
6. 生成一份素材摘要（source_summary）

保持精炼，每个实体/主题的内容控制在 200-500 字。宁缺毋滥，只提取确实有价值的信息。
id 字段使用英文 slug（小写、连字符），如 "karpathy"、"llm-wiki"、"react"。
用中文撰写内容。`

const INGEST_SCHEMA = {
  name: 'ingest_plan',
  description: '素材处理计划：提取实体、主题和摘要',
  parameters: {
    type: 'object',
    properties: {
      source_summary: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '素材标题' },
          summary: { type: 'string', description: '一句话摘要（50字以内）' },
          tags: { type: 'array', items: { type: 'string' }, description: '标签' },
        },
        required: ['title', 'summary', 'tags'],
      },
      entities: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '英文 slug，如 karpathy、react' },
            title: { type: 'string', description: '实体名称' },
            content: { type: 'string', description: 'markdown 正文（使用 [[双向链接]]）' },
            confidence: { type: 'string', enum: ['verified', 'inferred', 'unverified'] },
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['id', 'title', 'content', 'confidence', 'tags'],
        },
      },
      topics: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '英文 slug，如 llm-wiki、rag-vs-wiki' },
            title: { type: 'string', description: '主题名称' },
            content: { type: 'string', description: 'markdown 正文（使用 [[双向链接]]）' },
            confidence: { type: 'string', enum: ['verified', 'inferred', 'unverified'] },
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['id', 'title', 'content', 'confidence', 'tags'],
        },
      },
    },
    required: ['source_summary', 'entities', 'topics'],
  },
}

// ─── 主入口 ───

export async function ingest(source: string): Promise<IngestResult> {
  ensureWikiDirs()

  // 1. 读取素材
  const rawContent = await readSource(source)

  // 2. SHA256 去重
  const hash = sha256(rawContent.content)
  if (rawExists(hash)) {
    return { status: 'duplicate' }
  }

  // 3. 保存原始素材
  const rawFilename = await saveRaw(source, rawContent.content, hash)

  // 4. LLM 提取
  const truncatedContent =
    rawContent.content.length > 15000
      ? rawContent.content.slice(0, 15000) + '\n\n[...内容已截断...]'
      : rawContent.content

  const rawPlan = await llmStructuredCall<IngestPlan>(
    INGEST_SYSTEM_PROMPT,
    `素材标题: ${rawContent.title}\n来源: ${source}\n\n内容:\n${truncatedContent}`,
    INGEST_SCHEMA,
  )

  // 校验 LLM 输出合理性
  const entities = Array.isArray(rawPlan.entities)
    ? rawPlan.entities
        .filter(
          e =>
            e &&
            typeof e.id === 'string' &&
            typeof e.title === 'string' &&
            typeof e.content === 'string',
        )
        .slice(0, 20)
    : []
  const topics = Array.isArray(rawPlan.topics)
    ? rawPlan.topics
        .filter(
          t =>
            t &&
            typeof t.id === 'string' &&
            typeof t.title === 'string' &&
            typeof t.content === 'string',
        )
        .slice(0, 10)
    : []
  const sourceSummary =
    rawPlan.source_summary && typeof rawPlan.source_summary.title === 'string'
      ? rawPlan.source_summary
      : { title: rawContent.title ?? '未知素材', summary: '无摘要', tags: [] as string[] }

  const plan: IngestPlan = { source_summary: sourceSummary, entities, topics }

  // 5. 生成/更新页面
  let pagesCreated = 0
  let pagesUpdated = 0
  const affectedPages: string[] = []

  // 实体页
  for (const entity of plan.entities) {
    const result = await createOrUpdatePage('entity', getEntitiesPath(), entity, rawFilename)
    const slug = slugify(entity.id || entity.title)
    const pagePath = `pages/entities/${slug}.md`
    affectedPages.push(pagePath)

    if (result === 'created') {
      pagesCreated++
    } else {
      pagesUpdated++
    }
    upsertEntry({
      path: pagePath,
      title: entity.title,
      type: 'entity',
      summary: entity.content.slice(0, 80),
    })
  }

  // 主题页
  for (const topic of plan.topics) {
    const result = await createOrUpdatePage('topic', getTopicsPath(), topic, rawFilename)
    const slug = slugify(topic.id || topic.title)
    const pagePath = `pages/topics/${slug}.md`
    affectedPages.push(pagePath)

    if (result === 'created') {
      pagesCreated++
    } else {
      pagesUpdated++
    }
    upsertEntry({
      path: pagePath,
      title: topic.title,
      type: 'topic',
      summary: topic.content.slice(0, 80),
    })
  }

  // 素材摘要页
  {
    const slug = slugify(plan.source_summary.title)
    const pagePath = `pages/sources/${slug}.md`
    const frontmatter = buildFrontmatter(
      plan.source_summary.title,
      'source',
      'verified',
      plan.source_summary.tags,
      [rawFilename],
    )
    const content = `# ${plan.source_summary.title}\n\n${plan.source_summary.summary}\n\n**来源**: ${source}\n`

    writeFileSync(join(getSourcesPath(), `${slug}.md`), frontmatter + content, 'utf-8')
    affectedPages.push(pagePath)
    pagesCreated++

    upsertEntry({
      path: pagePath,
      title: plan.source_summary.title,
      type: 'source',
      summary: plan.source_summary.summary,
    })
  }

  // 6. 追加日志
  appendLog({
    timestamp: new Date().toISOString(),
    operation: 'ingest',
    summary: `处理"${plan.source_summary.title}"`,
    pagesAffected: affectedPages,
  })

  return { status: 'ok', pagesCreated, pagesUpdated }
}
