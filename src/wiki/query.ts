// Wiki 知识库 — Query 引擎

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { llmStructuredCall, llmTextCall } from './llm.js'
import { readIndex, formatIndexForLLM } from './index-manager.js'
import { appendLog } from './log-manager.js'
import { getWikiDir } from './paths.js'
import type { QueryResult } from './types.js'

const SELECT_PAGES_PROMPT = `你是知识库检索助手。根据用户问题和知识库索引，选择最相关的页面（最多 5 个）。

规则：
1. 只选择与问题直接相关的页面
2. 优先选择实体页和主题页（信息密度高）
3. 如果没有相关页面，返回空列表
4. 返回页面的 path 字段`

const SELECT_PAGES_SCHEMA = {
  name: 'select_pages',
  description: '选择与问题相关的 wiki 页面',
  parameters: {
    type: 'object',
    properties: {
      pages: {
        type: 'array',
        items: { type: 'string' },
        description: '选中页面的 path 列表（最多 5 个）',
      },
      reasoning: {
        type: 'string',
        description: '选择理由（简短）',
      },
    },
    required: ['pages', 'reasoning'],
  },
}

const ANSWER_PROMPT = `你是知识库问答助手。根据提供的知识页面内容，综合回答用户问题。

规则：
1. 只基于提供的知识页面回答，不要编造
2. 引用具体页面作为来源
3. 如果知识不足以回答，明确说明
4. 用中文回答，保持简洁准确`

export async function query(question: string): Promise<QueryResult> {
  const index = readIndex()

  if (index.length === 0) {
    return {
      answer: '知识库为空，请先使用 /wiki ingest 添加知识。',
      pagesUsed: [],
    }
  }

  const indexText = formatIndexForLLM()

  // 1. LLM 选择相关页面
  const selection = await llmStructuredCall<{ pages: string[]; reasoning: string }>(
    SELECT_PAGES_PROMPT,
    `问题: ${question}\n\n知识库索引:\n${indexText}`,
    SELECT_PAGES_SCHEMA,
  )

  if (!selection.pages || selection.pages.length === 0) {
    return {
      answer: '知识库中没有找到与问题相关的内容。',
      pagesUsed: [],
    }
  }

  // 2. 读取选中页面
  const wikiDir = getWikiDir()
  const pageContents: string[] = []
  const validPages: string[] = []

  for (const pagePath of selection.pages) {
    const fullPath = join(wikiDir, pagePath)
    if (existsSync(fullPath)) {
      const content = readFileSync(fullPath, 'utf-8')
      pageContents.push(`=== ${pagePath} ===\n${content}`)
      validPages.push(pagePath)
    }
  }

  if (pageContents.length === 0) {
    return {
      answer: '选中的页面都无法读取，可能已被删除。',
      pagesUsed: [],
    }
  }

  // 3. LLM 综合回答
  const answer = await llmTextCall(
    ANSWER_PROMPT,
    `问题: ${question}\n\n相关知识页面:\n\n${pageContents.join('\n\n')}`,
  )

  // 4. 记录日志
  appendLog({
    timestamp: new Date().toISOString(),
    operation: 'query',
    summary: `查询"${question.slice(0, 50)}"`,
    pagesAffected: validPages,
  })

  return { answer, pagesUsed: validPages }
}
