import { AGENTS_CONFIG } from '../../config/agents.config.js';
import { createOpenAICompatibleAdapter } from './openai-compatible.adapter.js';
export const deepseekAdapter = createOpenAICompatibleAdapter(
  'deepseek', AGENTS_CONFIG.deepseek,
  process.env.DEEPSEEK_API_KEY, 'https://api.deepseek.com'
);
