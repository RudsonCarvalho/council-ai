/**
 * ─── HTTP LOGGER ──────────────────────────────────────────────────────────────
 * Intercepta todas as chamadas HTTP de saída (fetch nativo do Node).
 * Loga: método, URL, status, latência, e primeiros bytes do body em erro.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const RESET  = '\x1b[0m';
const DIM    = '\x1b[2m';
const CYAN   = '\x1b[36m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';

// Mapa de prefixo de URL → nome legível
const API_NAMES = {
  'api.anthropic.com':              'Anthropic',
  'api.openai.com':                 'OpenAI',
  'generativelanguage.googleapis.com': 'Gemini',
  'api.perplexity.ai':              'Perplexity',
  'api.deepseek.com':               'DeepSeek',
  'api.x.ai':                       'Grok',
  'api.mistral.ai':                 'Mistral',
};

function apiName(url) {
  try {
    const host = new URL(url).hostname;
    for (const [key, name] of Object.entries(API_NAMES)) {
      if (host.includes(key)) return name;
    }
    return host;
  } catch { return url.slice(0, 40); }
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    return u.pathname;
  } catch { return url.slice(0, 60); }
}

export function installHttpLogger() {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async function loggedFetch(input, init = {}) {
    const url    = typeof input === 'string' ? input : input.url;
    const method = (init.method ?? 'GET').toUpperCase();

    // Ignora chamadas internas (localhost)
    if (url.includes('localhost') || url.includes('127.0.0.1')) {
      return originalFetch(input, init);
    }

    const name  = apiName(url);
    const path  = shortUrl(url);
    const start = Date.now();

    // Log da requisição
    const isStream = init.body && JSON.parse(init.body ?? '{}')?.stream;
    console.log(`  ${CYAN}▶ ${name}${RESET} ${DIM}${method} ${path}${isStream ? ' [stream]' : ''}${RESET}`);

    try {
      const response = await originalFetch(input, init);
      const ms       = Date.now() - start;
      const status   = response.status;
      const sColor   = status >= 400 ? RED : status >= 300 ? YELLOW : GREEN;

      console.log(`  ${sColor}◀ ${name}${RESET} ${sColor}${status}${RESET} ${DIM}${ms}ms${RESET}`);

      // Em caso de erro, loga o body para diagnóstico
      if (status >= 400) {
        try {
          const clone = response.clone();
          const body  = await clone.text();
          console.error(`    ${RED}Error body:${RESET} ${body.slice(0, 300)}`);
        } catch {}
      }

      return response;
    } catch (err) {
      const ms = Date.now() - start;
      console.error(`  ${RED}✕ ${name}${RESET} ${DIM}${ms}ms${RESET} ${RED}${err.message}${RESET}`);
      throw err;
    }
  };

  console.log('  ◈ HTTP logger instalado');
}
