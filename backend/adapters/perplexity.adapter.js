import { AGENTS_CONFIG } from '../../config/agents.config.js';
import { createOpenAICompatibleAdapter } from './openai-compatible.adapter.js';
export const perplexityAdapter = createOpenAICompatibleAdapter(
  'perplexity', AGENTS_CONFIG.perplexity,
  process.env.PERPLEXITY_API_KEY, 'https://api.perplexity.ai'
);
