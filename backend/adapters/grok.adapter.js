import { AGENTS_CONFIG } from '../../config/agents.config.js';
import { createOpenAICompatibleAdapter } from './openai-compatible.adapter.js';
export const grokAdapter = createOpenAICompatibleAdapter(
  'grok', AGENTS_CONFIG.grok,
  process.env.GROK_API_KEY, 'https://api.x.ai/v1'
);
