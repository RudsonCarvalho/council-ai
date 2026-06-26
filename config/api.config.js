/**
 * ─── API CONFIGURATION ───────────────────────────────────────────────────────
 * Endpoints, timeouts e URLs base de todas as APIs externas.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const API_CONFIG = {

  // Backend local
  backendURL:   'http://localhost:3001',
  frontendPort: 3000,
  backendPort:  3001,

  // SSE endpoint
  sseEndpoint:  '/api/debate/stream',

  // Timeouts
  requestTimeout:   60000,  // 60s — modelos podem ser lentos
  sseReconnectMs:   3000,

  // Endpoints das IAs
  providers: {
    anthropic:   'https://api.anthropic.com',
    openai:      'https://api.openai.com/v1',
    gemini:      'https://generativelanguage.googleapis.com',
    perplexity:  'https://api.perplexity.ai',
    deepseek:    'https://api.deepseek.com',
    grok:        'https://api.x.ai/v1',
    mistral:     'https://api.mistral.ai/v1',
  },

};
