/**
 * ─── COMPRESSOR SERVICE ──────────────────────────────────────────────────────
 * Comprime o histórico de uma sessão para caber no limite de tokens de cada IA.
 * Preserva TODA a informação — remove só palavras desnecessárias.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import Anthropic from '@anthropic-ai/sdk';
import { AGENTS_CONFIG } from '../../config/agents.config.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Limites de contexto por modelo (em tokens)
export const MODEL_CONTEXT_LIMITS = {
  'claude-opus-4-5':            200000,
  'claude-sonnet-4-5':          200000,
  'claude-3-5-sonnet-20241022': 200000,
  'claude-haiku-4-5':           200000,
  'gpt-4o':                     128000,
  'gpt-4-turbo':                128000,
  'gpt-4o-mini':                128000,
  'o1-preview':                 128000,
  'gemini-1.5-pro':            1000000,
  'gemini-1.5-flash':          1000000,
  'gemini-2.0-flash-exp':      1000000,
  'llama-3.1-sonar-large-128k-online': 127000,
  'llama-3.1-sonar-small-128k-online': 127000,
  'llama-3.1-sonar-huge-128k-online':  127000,
  'deepseek-chat':              128000,
  'deepseek-reasoner':           64000,
  'grok-4-1-fast-reasoning':    128000,
  'grok-4-1-fast-non-reasoning': 128000,
  'mistral-large-latest':       128000,
  'mistral-medium-latest':      128000,
  'codestral-latest':           128000,
};

// Estimativa grosseira: 1 token ≈ 4 chars
export function estimateTokens(text) {
  return Math.ceil((text ?? '').length / 4);
}

/**
 * Analisa se o histórico cabe nos modelos das IAs da sessão.
 * Retorna informação de capacidade por IA.
 */
export function analyzeCapacity(session) {
  const historyText = session.allResponses
    ?.map(r => `[${r.agentName}]: ${r.text}`)
    .join('\n') ?? '';

  const historyTokens = estimateTokens(historyText);

  const agentCapacity = (session.agentIds ?? []).map(agentId => {
    const cfg        = AGENTS_CONFIG[agentId];
    const modelId    = session.modelOverrides?.[agentId] ?? cfg?.model ?? '';
    const limit      = MODEL_CONTEXT_LIMITS[modelId] ?? 128000;
    const usagePct   = Math.round((historyTokens / limit) * 100);
    return {
      agentId,
      name:         cfg?.name ?? agentId,
      icon:         cfg?.icon ?? '·',
      color:        cfg?.color ?? '#64748B',
      model:        modelId,
      limit,
      historyTokens,
      usagePct,
      fits:         historyTokens < limit * 0.85, // 85% — margem de segurança
    };
  });

  return {
    historyTokens,
    agentCapacity,
    allFit:      agentCapacity.every(a => a.fits),
    worstCase:   agentCapacity.reduce((min, a) => a.limit < min.limit ? a : min, agentCapacity[0] ?? {}),
  };
}

/**
 * Comprime o histórico para caber no limite alvo (em tokens).
 * Mantém os últimos N rounds completos, comprime os anteriores.
 * Preserva toda a informação — remove só redundância e verbosidade.
 */
export async function compressHistory(allResponses, targetTokens, keepRecentRounds = 2) {
  if (!allResponses?.length) return { compressed: '', kept: [] };

  const maxRound     = Math.max(...allResponses.map(r => r.round));
  const recentRounds = keepRecentRounds;
  const cutoffRound  = maxRound - recentRounds;

  // Separa rounds antigos (serão comprimidos) dos recentes (ficam completos)
  const oldResponses    = allResponses.filter(r => r.round <= cutoffRound);
  const recentResponses = allResponses.filter(r => r.round > cutoffRound);

  const recentText = recentResponses
    .map(r => `[Round ${r.round} — ${r.agentName}]:\n${r.text}`)
    .join('\n\n');

  const recentTokens = estimateTokens(recentText);
  const budgetForOld = targetTokens - recentTokens - 500; // 500 de margem

  if (oldResponses.length === 0 || budgetForOld <= 0) {
    return { compressed: recentText, kept: recentResponses };
  }

  const oldText = oldResponses
    .map(r => `[Round ${r.round} — ${r.agentName}]: ${r.text}`)
    .join('\n\n');

  // Pede ao Claude para comprimir preservando toda a informação
  const prompt = `Você vai compactar o histórico de um debate técnico para caber em aproximadamente ${budgetForOld * 4} caracteres.

REGRAS ABSOLUTAS:
- Preserve TODOS os argumentos e posições de cada participante
- Preserve os pontos de tensão e discordância entre as IAs
- Preserve decisões, consensos parciais e conclusões atingidas
- Preserve opiniões do moderador humano
- Elimine APENAS: repetições, frases introdutórias genéricas, disclaimers, conclusões óbvias
- O resultado deve permitir que qualquer especialista entenda exatamente onde o debate estava

HISTÓRICO A COMPACTAR:
${oldText}

Responda apenas com o histórico compactado, sem comentários.`;

  try {
    const response = await client.messages.create({
      model:      AGENTS_CONFIG.claude.model,
      max_tokens: Math.min(budgetForOld, 4096),
      messages:   [{ role: 'user', content: prompt }],
    });

    const compressedOld = response.content[0].text;
    const finalText = `=== RESUMO DO DEBATE (Rounds 1-${cutoffRound}) ===\n${compressedOld}\n\n=== ROUNDS RECENTES (completos) ===\n${recentText}`;

    return {
      compressed:       finalText,
      kept:             recentResponses,
      wasCompressed:    true,
      originalTokens:   estimateTokens(oldText + recentText),
      compressedTokens: estimateTokens(finalText),
    };
  } catch (err) {
    // Fallback: retorna só os rounds recentes se compressão falhar
    return {
      compressed:    recentText,
      kept:          recentResponses,
      wasCompressed: false,
      fallback:      true,
      error:         err.message,
    };
  }
}
