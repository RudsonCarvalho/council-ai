import { createOpenAICompatibleAdapter } from './openai-compatible.adapter.js';
import { AGENTS_CONFIG } from '../../config/agents.config.js';

export const gptAdapter = createOpenAICompatibleAdapter(
  'gpt',
  AGENTS_CONFIG.gpt,
  process.env.OPENAI_API_KEY,
  'https://api.openai.com/v1'
);
