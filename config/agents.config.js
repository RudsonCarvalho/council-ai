/**
 * ─── AGENTS CONFIGURATION ────────────────────────────────────────────────────
 * Habilite/desabilite IAs e configure modelos, personas e custos aqui.
 * Nunca coloque estas configurações dentro de componentes ou serviços.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const NO_MARKDOWN = `\nIMPORTANT: Do NOT use markdown formatting. No headers (#), no bold (**), no bullet points (-), no code fences (\`\`\`), no italics. Write in plain text only. Use line breaks for structure.`;

export const AGENTS_CONFIG = {

  claude: {
    enabled:     true,
    name:        'Claude',
    company:     'Anthropic',
    model:       'claude-sonnet-4-5-20250929',
    models: [
      { id: 'claude-opus-4-6',              label: 'claude-opus-4-6',       note: 'mais capaz' },
      { id: 'claude-sonnet-4-5-20250929',   label: 'Claude Sonnet 4.5',     note: 'velocidade e inteligência' },
      { id: 'claude-sonnet-4-5',            label: 'Claude Sonnet 4.5',     note: 'rápido' },
      { id: 'claude-haiku-4-5',             label: 'Claude Haiku 4.5',      note: 'mais barato' },
    ],
    maxTokens:   1024,
    temperature: 0.7,
    color:       '#F59E0B',
    icon:        '◈',
    tagline:     'safety · correctness · maintainability',
    apiKeyEnv:   'ANTHROPIC_API_KEY',
    costPer1kTokens: { input: 0.015, output: 0.075 },
    persona: `You are Claude, made by Anthropic. When analyzing technical problems:
- Prioritize safety, correctness, and maintainability over cleverness
- Be explicit about trade-offs and risks
- Prefer well-established patterns over bleeding-edge approaches
- Flag potential security concerns proactively
- Be concise and precise — no filler, just substance
- Keep responses under 300 words` + NO_MARKDOWN,
  },

  gpt: {
    enabled:     true,
    name:        'GPT-4',
    company:     'OpenAI',
    model:       'gpt-4o',
    models: [
      { id: 'gpt-4o',       label: 'GPT-4o',        note: 'recomendado' },
      { id: 'gpt-4-turbo',  label: 'GPT-4 Turbo',   note: 'potente' },
      { id: 'gpt-4o-mini',  label: 'GPT-4o Mini',   note: 'mais barato' },
      { id: 'o1-preview',   label: 'o1 Preview',     note: 'raciocínio' },
    ],
    maxTokens:   1024,
    temperature: 0.7,
    color:       '#10B981',
    icon:        '◎',
    tagline:     'pragmatism · ecosystem · developer experience',
    apiKeyEnv:   'OPENAI_API_KEY',
    costPer1kTokens: { input: 0.005, output: 0.015 },
    persona: `You are GPT-4, made by OpenAI. When analyzing technical problems:
- Focus on pragmatism and ecosystem compatibility
- Favor widely-adopted solutions with strong community support
- Consider developer experience and onboarding friction
- Be opinionated — provide a clear recommendation, not just options
- Keep responses under 300 words` + NO_MARKDOWN,
  },

  gemini: {
    enabled:     true,
    name:        'Gemini',
    company:     'Google',
    model:       'gemini-3-flash-preview',
    models: [
      { id: 'gemini-3.1-pro-preview',          label: 'Gemini 3.1 Pro',       note: 'raciocínio melhor' },
      { id: 'gemini-3-flash-preview',        label: 'Gemini 3 Flash',     note: 'mais ricos e interatividade' },
      { id: 'gemini-3.1-flash-lite-preview',    label: 'Gemini 3.1 Flash Lite',     note: 'mais econômico' },
    ],
    maxTokens:   1024,
    temperature: 0.7,
    color:       '#3B82F6',
    icon:        '◇',
    tagline:     'scalability · cloud-native · data at scale',
    apiKeyEnv:   'GEMINI_API_KEY',
    costPer1kTokens: { input: 0.00125, output: 0.005 },
    persona: `You are Gemini, made by Google DeepMind. When analyzing technical problems:
- Think at scale — how does this solution behave under 10x, 100x load?
- Consider cloud-native approaches and managed services
- Highlight data consistency, latency, and observability concerns
- Challenge assumptions about scope
- Keep responses under 300 words` + NO_MARKDOWN,
  },

  perplexity: {
    enabled:     true,
    name:        'Perplexity',
    company:     'Perplexity AI',
    model:       'llama-3.1-sonar-large-128k-online',
    models: [
      { id: 'llama-3.1-sonar-large-128k-online', label: 'Sonar Large',  note: 'recomendado' },
      { id: 'llama-3.1-sonar-small-128k-online', label: 'Sonar Small',  note: 'mais barato' },
      { id: 'llama-3.1-sonar-huge-128k-online',  label: 'Sonar Huge',   note: 'mais capaz' },
    ],
    maxTokens:   1024,
    temperature: 0.7,
    color:       '#8B5CF6',
    icon:        '◉',
    tagline:     'trade-offs · industry patterns · real-time research',
    apiKeyEnv:   'PERPLEXITY_API_KEY',
    costPer1kTokens: { input: 0.001, output: 0.001 },
    persona: `You are Perplexity AI. When analyzing technical problems:
- Ground your analysis in current industry practices
- Cite specific trade-offs between competing approaches
- Surface less-obvious alternatives
- Be analytical and comparative
- Keep responses under 300 words` + NO_MARKDOWN,
  },

  deepseek: {
    enabled:     true,
    name:        'DeepSeek',
    company:     'DeepSeek',
    model:       'deepseek-chat',
    models: [
      { id: 'deepseek-chat',     label: 'DeepSeek Chat',     note: 'recomendado' },
      { id: 'deepseek-reasoner', label: 'DeepSeek R1',        note: 'raciocínio' },
    ],
    maxTokens:   1024,
    temperature: 0.7,
    color:       '#06B6D4',
    icon:        '⬡',
    tagline:     'efficiency · reasoning · cost-conscious engineering',
    apiKeyEnv:   'DEEPSEEK_API_KEY',
    costPer1kTokens: { input: 0.00014, output: 0.00028 },
    persona: `You are DeepSeek. When analyzing technical problems:
- Prioritize algorithmic efficiency and computational cost
- Think rigorously — break complex problems into clear logical steps
- Favor solutions that are elegant and minimal
- Consider resource constraints: memory, CPU, network, API costs
- Keep responses under 300 words` + NO_MARKDOWN,
  },

  grok: {
    enabled:     true,
    name:        'Grok',
    company:     'xAI',
    model:       'grok-2-latest',
    models: [
      { id: 'grok-2-latest', label: 'Grok 2',      note: 'recomendado' },
      { id: 'grok-2-mini',   label: 'Grok 2 Mini', note: 'mais barato' },
    ],
    maxTokens:   1024,
    temperature: 0.8,
    color:       '#F43F5E',
    icon:        '✦',
    tagline:     'contrarian · first principles · unconventional approaches',
    apiKeyEnv:   'GROK_API_KEY',
    costPer1kTokens: { input: 0.002, output: 0.01 },
    persona: `You are Grok, made by xAI. When analyzing technical problems:
- Think from first principles — question conventional wisdom
- Be direct and unafraid to propose unconventional solutions
- Point out when the "obvious" solution might be wrong
- Be intellectually honest about uncertainty
- Keep responses under 300 words` + NO_MARKDOWN,
  },

  mistral: {
    enabled:     true,
    name:        'Mistral',
    company:     'Mistral AI',
    model:       'mistral-large-latest',
    models: [
      { id: 'mistral-large-latest',  label: 'Mistral Large',  note: 'recomendado' },
      { id: 'mistral-medium-latest', label: 'Mistral Medium', note: 'balanceado' },
      { id: 'codestral-latest',      label: 'Codestral',      note: 'código' },
    ],
    maxTokens:   1024,
    temperature: 0.7,
    color:       '#F97316',
    icon:        '◭',
    tagline:     'open-source · pragmatic · vendor-neutral',
    apiKeyEnv:   'MISTRAL_API_KEY',
    costPer1kTokens: { input: 0.002, output: 0.006 },
    persona: `You are Mistral, made by Mistral AI. When analyzing technical problems:
- Favor open-source and vendor-neutral solutions
- Be practical and implementation-focused
- Consider interoperability and standards compliance
- Highlight where proprietary lock-in could become a liability
- Keep responses under 300 words` + NO_MARKDOWN,
  },

};

export function getEnabledAgents() {
  return Object.entries(AGENTS_CONFIG)
    .filter(([, cfg]) => cfg.enabled)
    .reduce((acc, [id, cfg]) => ({ ...acc, [id]: cfg }), {});
}
