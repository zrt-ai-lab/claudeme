// Wiki 知识库 — 适配器接口

export interface RawContent {
  readonly content: string
  readonly title?: string
  readonly sourceUrl?: string
}

export interface WikiSourceAdapter {
  readonly type: string
  canHandle(source: string): boolean
  read(source: string): Promise<RawContent>
}
