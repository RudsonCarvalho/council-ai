import Anthropic from '@anthropic-ai/sdk';
import { AGENTS_CONFIG } from '../../config/agents.config.js';

const cfg    = AGENTS_CONFIG.claude;
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const claudeAdapter = {
  id:   'claude',
  name: cfg.name,

  async call({ problem, previousResponses = [], privateContext = null, signal = null }) {
    const systemPrompt = buildSystemPrompt(cfg, privateContext);
    const userMessage  = buildUserMessage(problem, previousResponses, 'claude');

    const response = await client.messages.create(
      {
        model:      cfg.model,
        max_tokens: cfg.maxTokens,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userMessage }],
      },
      { signal }
    );

    return {
      text:         response.content[0].text,
      inputTokens:  response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  },

  async stream({ problem, previousResponses = [], privateContext = null, modelOverride = null, signal = null, onToken }) {
    const systemPrompt = buildSystemPrompt(cfg, privateContext);
    const userMessage  = buildUserMessage(problem, previousResponses, 'claude');
    const modelToUse   = modelOverride ?? cfg.model;

    let fullText = '', inputTokens = 0, outputTokens = 0;

    const stream = await client.messages.stream(
      {
        model:      modelToUse,
        max_tokens: cfg.maxTokens,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userMessage }],
      },
      { signal }
    );

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        fullText += event.delta.text;
        onToken?.(event.delta.text);
      }
      if (event.type === 'message_delta') outputTokens = event.usage?.output_tokens ?? 0;
      if (event.type === 'message_start') inputTokens  = event.message?.usage?.input_tokens ?? 0;
    }

    return { text: fullText, inputTokens, outputTokens };
  },
};

function buildSystemPrompt(cfg, privateContext) {
  if (!privateContext) return cfg.persona;
  return `${cfg.persona}\n\n${privateContext}`;
}

export function buildUserMessage(problem, previousResponses, selfId) {
  // Agrupa por round para mostrar a evolução do debate
  const byRound = {};
  previousResponses.forEach(r => {
    const key = r.round ?? 0;
    if (!byRound[key]) byRound[key] = [];
    byRound[key].push(r);
  });

  const rounds       = Object.keys(byRound).sort((a, b) => Number(a) - Number(b));
  const currentRound = rounds.length > 0 ? Math.max(...rounds.map(Number)) : 0;

  let msg = `=== PROBLEMA ===\n${problem}\n`;

  // Histórico de rounds anteriores
  const pastRounds = rounds.filter(r => Number(r) < currentRound);
  if (pastRounds.length > 0) {
    msg += `\n=== HISTÓRICO DO DEBATE ===\n`;
    msg += `(NÃO REPITA argumentos já apresentados abaixo — construa em cima deles ou discorde com fundamento)\n\n`;

    pastRounds.forEach(r => {
      const responses = byRound[r];
      msg += `── Round ${r} ──\n`;
      responses.forEach(resp => {
        if (resp.isHuman) {
          msg += `[MODERADOR]: ${resp.text}\n\n`;
        } else {
          const isSelf = resp.agentId === selfId;
          msg += `[${resp.agentName}${isSelf ? ' — VOCÊ' : ''}]: ${resp.text}\n\n`;
        }
      });
    });
  }

  // Round atual — o que as outras IAs já disseram neste round
  const currentRoundResponses = byRound[currentRound] ?? [];
  const othersThisRound = currentRoundResponses.filter(r => r.agentId !== selfId && !r.isHuman);
  const moderatorNow    = currentRoundResponses.filter(r => r.isHuman);

  if (moderatorNow.length > 0) {
    msg += `\n=== INSTRUÇÃO DO MODERADOR (SIGA OBRIGATORIAMENTE) ===\n`;
    moderatorNow.forEach(r => { msg += `${r.text}\n`; });
    msg += '\n';
  }

  if (othersThisRound.length > 0) {
    msg += `\n=== ROUND ATUAL — respostas anteriores a você ===\n`;
    msg += `(leia antes de responder — não repita o que já foi dito)\n\n`;
    othersThisRound.forEach(r => {
      msg += `[${r.agentName}]: ${r.text}\n\n`;
    });
  }

  // Instrução final
  if (previousResponses.length > 0) {
    msg += `\n=== SUA RESPOSTA ===\n`;
    msg += `Regras OBRIGATÓRIAS:\n`;
    msg += `1. NÃO repita argumentos já apresentados por você ou por outros\n`;
    msg += `2. Se concordar com algo, cite brevemente e ACRESCENTE algo NOVO\n`;
    msg += `3. Se discordar, cite a premissa ESPECÍFICA que está questionando\n`;
    msg += `4. Foque no que AINDA NÃO FOI RESOLVIDO no debate\n`;
    msg += `5. Seja direto e objetivo — sem introduções longas\n`;
  } else {
    msg += `\n=== SUA RESPOSTA ===\nForneça sua análise técnica inicial sobre o problema.\n`;
  }

  return msg;
}
