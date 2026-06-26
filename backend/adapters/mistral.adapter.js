import { AGENTS_CONFIG } from '../../config/agents.config.js';
import { createOpenAICompatibleAdapter } from './openai-compatible.adapter.js';
export const mistralAdapter = createOpenAICompatibleAdapter(
  'mistral', AGENTS_CONFIG.mistral,
  process.env.MISTRAL_API_KEY, 'https://api.mistral.ai/v1'
);
