import type { Command } from '../../types/command.js'

const wiki = {
  type: 'local-jsx',
  name: 'wiki',
  description: 'Wiki knowledge base: scan, ingest, query, lint, status',
  argumentHint: '<scan|ingest|query|lint|status> [args]',
  isEnabled: () => true,
  load: () => import('./wiki-command.js'),
} satisfies Command

export default wiki
