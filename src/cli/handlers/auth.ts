/* eslint-disable custom-rules/no-process-exit -- CLI subcommand handler intentionally exits */

import {
  getAnthropicApiKeyWithSource,
  getAuthTokenSource,
  isUsing3PServices,
} from '../../utils/auth.js'
import { getAPIProvider } from '../../utils/model/providers.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import {
  buildAccountProperties,
  buildAPIProviderProperties,
} from '../../utils/status.js'
import { isRunningOnHomespace } from '../../utils/envUtils.js'

export async function authLogin(_opts: {
  email?: string
  sso?: boolean
  console?: boolean
  claudeai?: boolean
}): Promise<void> {
  process.stdout.write(
    'ClaudeMe uses API key authentication via claudeme.json. OAuth login is not supported.\n',
  )
  process.exit(0)
}

export async function authStatus(opts: {
  json?: boolean
  text?: boolean
}): Promise<void> {
  const { source: authTokenSource, hasToken } = getAuthTokenSource()
  const { source: apiKeySource } = getAnthropicApiKeyWithSource()
  const hasApiKeyEnvVar =
    !!process.env.ANTHROPIC_API_KEY && !isRunningOnHomespace()
  const using3P = isUsing3PServices()
  const loggedIn =
    hasToken || apiKeySource !== 'none' || hasApiKeyEnvVar || using3P

  // Determine auth method
  let authMethod: string = 'none'
  if (using3P) {
    authMethod = 'third_party'
  } else if (authTokenSource === 'apiKeyHelper') {
    authMethod = 'api_key_helper'
  } else if (apiKeySource === 'ANTHROPIC_API_KEY' || hasApiKeyEnvVar) {
    authMethod = 'api_key'
  } else if (authTokenSource !== 'none') {
    authMethod = 'api_key'
  }

  if (opts.text) {
    const properties = [
      ...buildAccountProperties(),
      ...buildAPIProviderProperties(),
    ]
    let hasAuthProperty = false
    for (const prop of properties) {
      const value =
        typeof prop.value === 'string'
          ? prop.value
          : Array.isArray(prop.value)
            ? prop.value.join(', ')
            : null
      if (value === null || value === 'none') {
        continue
      }
      hasAuthProperty = true
      if (prop.label) {
        process.stdout.write(`${prop.label}: ${value}\n`)
      } else {
        process.stdout.write(`${value}\n`)
      }
    }
    if (!hasAuthProperty && hasApiKeyEnvVar) {
      process.stdout.write('API key: ANTHROPIC_API_KEY\n')
    }
    if (!loggedIn) {
      process.stdout.write(
        'Not logged in. Configure your API key in claudeme.json to authenticate.\n',
      )
    }
  } else {
    const apiProvider = getAPIProvider()
    const resolvedApiKeySource =
      apiKeySource !== 'none'
        ? apiKeySource
        : hasApiKeyEnvVar
          ? 'ANTHROPIC_API_KEY'
          : null
    const output: Record<string, string | boolean | null> = {
      loggedIn,
      authMethod,
      apiProvider,
    }
    if (resolvedApiKeySource) {
      output.apiKeySource = resolvedApiKeySource
    }

    process.stdout.write(jsonStringify(output, null, 2) + '\n')
  }
  process.exit(loggedIn ? 0 : 1)
}

export async function authLogout(): Promise<void> {
  process.stdout.write(
    'ClaudeMe uses API key authentication. No OAuth session to log out.\n',
  )
  process.exit(0)
}

// Stub: OAuth removed in ClaudeMe. Kept as export for cli/print.ts compatibility.
export async function installOAuthTokens(_tokens: unknown): Promise<void> {
  // no-op
}
