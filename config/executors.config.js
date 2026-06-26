/**
 * ─── EXECUTORS CONFIGURATION ─────────────────────────────────────────────────
 * Agentes executores que recebem a spec ao final do debate.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const EXECUTORS_CONFIG = {

  claudeCode: {
    id:          'claude-code',
    name:        'Claude Code',
    icon:        '◈',
    color:       '#F59E0B',
    type:        'cli',         // 'cli' | 'api'
    command:     'claude',
    args:        ['--print'],
    enabled:     true,
    description: 'Agente de código da Anthropic — roda localmente via CLI',
  },

  aider: {
    id:          'aider',
    name:        'Aider',
    icon:        '⚡',
    color:       '#10B981',
    type:        'cli',
    command:     'aider',
    args:        ['--message'],
    enabled:     true,
    description: 'Agente open-source que edita código diretamente no repositório',
  },

  devin: {
    id:          'devin',
    name:        'Devin',
    icon:        '✦',
    color:       '#8B5CF6',
    type:        'api',
    baseURL:     'https://api.devin.ai',
    apiKeyEnv:   'DEVIN_API_KEY',
    enabled:     false,
    description: 'Agente autônomo da Cognition AI',
  },

  codex: {
    id:          'codex',
    name:        'Codex (OpenAI)',
    icon:        '◎',
    color:       '#10B981',
    type:        'api',
    baseURL:     'https://api.openai.com/v1',
    apiKeyEnv:   'OPENAI_API_KEY',
    enabled:     false,
    description: 'Agente de código da OpenAI via Assistants API',
  },

  cursor: {
    id:          'cursor',
    name:        'Cursor',
    icon:        '▸',
    color:       '#64748B',
    type:        'cli',
    command:     'cursor',
    args:        ['--new-window'],
    enabled:     false,
    description: 'Abre a spec no Cursor IDE',
  },

};

export function getEnabledExecutors() {
  return Object.entries(EXECUTORS_CONFIG)
    .filter(([, cfg]) => cfg.enabled)
    .reduce((acc, [id, cfg]) => ({ ...acc, [id]: cfg }), {});
}
