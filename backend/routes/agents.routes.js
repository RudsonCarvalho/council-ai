import express from 'express';
import { AGENTS_CONFIG, getEnabledAgents } from '../../config/agents.config.js';

const router = express.Router();

// GET /api/agents — lista agentes com modelos
router.get('/', (req, res) => {
  const agents = getEnabledAgents ? getEnabledAgents() : AGENTS_CONFIG;
  const safe = Object.entries(agents).reduce((acc, [id, cfg]) => ({
    ...acc,
    [id]: {
      id,
      name:    cfg.name,
      company: cfg.company,
      color:   cfg.color,
      icon:    cfg.icon,
      tagline: cfg.tagline,
      enabled: cfg.enabled,
      model:   cfg.model,
      models:  cfg.models ?? [{ id: cfg.model, label: cfg.model, note: 'padrão' }],
    },
  }), {});
  res.json(safe);
});

// POST /api/agents/test — testa conexão de cada IA com o modelo selecionado
router.post('/test', async (req, res) => {
  const { modelOverrides = {} } = req.body;
  const results = {};

  console.log('\n  🔌 Testando conexões...');

  const testPromises = Object.entries(AGENTS_CONFIG)
    .filter(([, cfg]) => cfg.enabled)
    .map(async ([agentId, cfg]) => {
      const modelId = modelOverrides[agentId] ?? cfg.model;
      const start   = Date.now();

      console.log(`  → [${agentId}] ${cfg.name} · model=${modelId}`);

      try {
        const text = await callAgent(agentId, cfg, modelId);
        const ms   = Date.now() - start;
        console.log(`  ✓ [${agentId}] OK ${ms}ms · resposta: "${text?.slice(0, 50)}"`);
        results[agentId] = {
          ok:      true,
          model:   modelId,
          latency: ms,
          preview: text?.slice(0, 60) ?? '',
        };
      } catch (err) {
        const ms = Date.now() - start;
        console.error(`  ✕ [${agentId}] ERRO ${ms}ms · ${err.message}`);
        results[agentId] = {
          ok:      false,
          model:   modelId,
          latency: ms,
          error:   friendlyError(err.message),
          rawError: err.message,
        };
      }
    });

  await Promise.allSettled(testPromises);

  const ok  = Object.values(results).filter(r => r.ok).length;
  const fail = Object.values(results).filter(r => !r.ok).length;
  console.log(`  🔌 Resultado: ${ok} OK · ${fail} falhas\n`);

  res.json(results);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function callAgent(agentId, cfg, modelId) {
  const prompt = 'Responda apenas: OK';

  if (agentId === 'claude') {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await client.messages.create({
      model: modelId, max_tokens: 10,
      messages: [{ role: 'user', content: prompt }],
    });
    return res.content[0].text;
  }

  if (agentId === 'gemini') {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model  = client.getGenerativeModel({ model: modelId });
    const res    = await model.generateContent(prompt);
    return res.response.text();
  }

  // OpenAI-compatible: GPT, Perplexity, DeepSeek, Grok, Mistral
  const baseURLs = {
    gpt:        'https://api.openai.com/v1',
    perplexity: 'https://api.perplexity.ai',
    deepseek:   'https://api.deepseek.com/v1',
    grok:       'https://api.x.ai/v1',
    mistral:    'https://api.mistral.ai/v1',
  };
  const apiKeys = {
    gpt:        process.env.OPENAI_API_KEY,
    perplexity: process.env.PERPLEXITY_API_KEY,
    deepseek:   process.env.DEEPSEEK_API_KEY,
    grok:       process.env.GROK_API_KEY,
    mistral:    process.env.MISTRAL_API_KEY,
  };

  const baseURL = baseURLs[agentId];
  const apiKey  = apiKeys[agentId];

  if (!apiKey) throw new Error('API key não configurada no .env');

  const OpenAI   = (await import('openai')).default;
  const client   = new OpenAI({ apiKey, baseURL });
  const res = await client.chat.completions.create({
    model: modelId, max_tokens: 10,
    messages: [{ role: 'user', content: prompt }],
  });
  return res.choices[0].message.content;
}

function friendlyError(msg) {
  if (!msg) return 'Erro desconhecido';
  if (msg.includes('API key') || msg.includes('401') || msg.includes('Unauthorized'))
    return 'API key inválida ou não configurada';
  if (msg.includes('404') || msg.includes('model'))
    return 'Modelo não encontrado — verifique o nome';
  if (msg.includes('429') || msg.includes('rate'))
    return 'Limite de requisições atingido';
  if (msg.includes('insufficient') || msg.includes('credit') || msg.includes('balance'))
    return 'Saldo insuficiente na conta';
  if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('network'))
    return 'Sem conexão com a API';
  return msg.slice(0, 80);
}

export default router;
