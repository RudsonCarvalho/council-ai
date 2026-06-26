/**
 * ─── CONSENSUS SERVICE — MEMÓRIA DE TRABALHO ACUMULATIVA ─────────────────────
 *
 * O juiz nunca vê o histórico completo. A cada round:
 *   1. Recebe o ESTADO anterior (compacto) + só as respostas do round atual
 *   2. Avalia e atualiza o ESTADO para o próximo round
 *
 * O ESTADO nunca cresce — tamanho fixo, independente de quantos rounds houve.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import Anthropic from '@anthropic-ai/sdk';
import { AGENTS_CONFIG } from '../../config/agents.config.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Sistema do juiz ───────────────────────────────────────────────────────────

const JUDGE_SYSTEM = `You are a strict technical debate moderator.

You receive:
- WORKING MEMORY: what has been established in previous rounds (may be empty on round 1)
- CURRENT ROUND: the latest responses from each AI

Your job:
1. Update the working memory based on what happened this round
2. Decide if consensus was reached or if you need to intervene

INTERVENTION: If agents repeat the same arguments without progress, set should_pause=true and write a DIRECT COMMAND in pause_reason — tell them exactly what new angle to address.

CONSENSUS: Set consensus=true when confidence >= 0.75. After round 4+, accept 0.60+ if remaining disagreements are minor.

Respond ONLY with valid JSON. Start immediately with {, no markdown, no text before or after:
{
  "working_memory": {
    "round": <current round number>,
    "decided": ["things already agreed upon"],
    "disputed": ["things still being debated"],
    "positions": {"AgentName": "their current stance in 1 sentence"},
    "progress": "advancing | stalled | converging"
  },
  "consensus": true or false,
  "confidence": 0.0 to 1.0,
  "agreement_points": ["..."],
  "disagreement_points": ["..."],
  "summary": "one sentence in the same language as the debate",
  "spec": null,
  "reasoning": "brief",
  "should_pause": true or false,
  "pause_reason": "DIRECT COMMAND to agents or null"
}`;

// ── Memória de trabalho em memória — por sessão ───────────────────────────────
// Chave: sessionId — Valor: working_memory do último round
const sessionMemory = new Map();

export function clearSessionMemory(sessionId) {
  sessionMemory.delete(sessionId);
}

// ── Trunca resposta mantendo início e fim (mais relevantes) ──────────────────
function smartTruncate(text, maxChars = 400) {
  if (text.length <= maxChars) return text;
  const half = Math.floor(maxChars / 2);
  return text.slice(0, half) + '\n...[middle omitted]...\n' + text.slice(-half);
}

// ── Entrada pública ───────────────────────────────────────────────────────────
export async function judgeConsensus(problem, allResponses, moderatorId = 'claude', sessionId = null) {

  // Pega só as respostas do round atual (último round com respostas de IAs)
  const aiResponses = allResponses.filter(r => !r.isHuman && !r.isJudge && r.text?.trim());
  if (aiResponses.length === 0) return buildFallback(0, 'No responses to evaluate');

  const currentRound = Math.max(...aiResponses.map(r => r.round ?? 0));
  const roundResponses = aiResponses.filter(r => r.round === currentRound);

  // Memória de trabalho do round anterior (vazia no round 1)
  const prevMemory = sessionId ? (sessionMemory.get(sessionId) ?? null) : null;

  // Monta o contexto — pequeno e controlado
  let context = `PROBLEM: ${problem}\n\n`;

  if (prevMemory) {
    context += `=== WORKING MEMORY (from previous rounds) ===\n`;
    context += `Round reached: ${prevMemory.round}\n`;
    if (prevMemory.decided?.length)   context += `Already decided: ${prevMemory.decided.join('; ')}\n`;
    if (prevMemory.disputed?.length)  context += `Still disputed: ${prevMemory.disputed.join('; ')}\n`;
    if (prevMemory.positions) {
      context += `Current positions:\n`;
      Object.entries(prevMemory.positions).forEach(([name, pos]) => {
        context += `  [${name}]: ${pos}\n`;
      });
    }
    if (prevMemory.progress) context += `Progress so far: ${prevMemory.progress}\n`;
    context += `\n`;
  } else {
    context += `=== WORKING MEMORY: empty (this is round 1) ===\n\n`;
  }

  context += `=== CURRENT ROUND ${currentRound} RESPONSES ===\n`;
  roundResponses.forEach(r => {
    context += `\n[${r.agentName}]:\n${smartTruncate(r.text)}\n`;
  });

  console.log(`[judge] Round ${currentRound} — context: ${context.length} chars (prev memory: ${prevMemory ? 'yes' : 'none'})`);

  // Tentativa 1 — avaliação completa
  try {
    const result = await callJudge(context, 1000);

    // Salva a memória de trabalho atualizada para o próximo round
    if (result.working_memory && sessionId) {
      sessionMemory.set(sessionId, result.working_memory);
    }

    console.log(`[judge] ✓ Round ${currentRound} — consensus=${result.consensus} confidence=${Math.round((result.confidence??0)*100)}% progress=${result.working_memory?.progress ?? '?'}`);
    return result;

  } catch (err) {
    console.warn(`[judge] Attempt 1 failed: ${err.message} — trying reduced context...`);
  }

  // Tentativa 2 — contexto ainda menor (só posições, sem memória detalhada)
  try {
    let reduced = `PROBLEM: ${problem}\n\nROUND ${currentRound}:\n`;
    roundResponses.forEach(r => {
      reduced += `[${r.agentName}]: ${r.text.slice(0, 200)}...\n`;
    });
    if (prevMemory?.decided?.length) {
      reduced += `\nPreviously decided: ${prevMemory.decided.slice(0,3).join('; ')}`;
    }

    const result = await callJudge(reduced, 600);
    console.log(`[judge] ✓ Reduced context worked — consensus=${result.consensus}`);
    return result;

  } catch (err) {
    console.warn(`[judge] Attempt 2 failed: ${err.message} — returning safe pause`);
  }

  // Fallback final — pausa com instrução ao usuário
  return buildFallback(currentRound,
    `O juiz pausou para processar o debate. Revise as respostas e clique Continuar, ou adicione uma instrução para direcionar as IAs.`
  );
}

// ── Chama o juiz e parseia o JSON ─────────────────────────────────────────────
async function callJudge(context, maxTokens) {
  const res = await client.messages.create({
    model:      AGENTS_CONFIG.claude.model,
    max_tokens: maxTokens,
    system:     JUDGE_SYSTEM,
    messages:   [{ role: 'user', content: context }],
  });

  const raw   = res.content[0].text.trim();
  const clean = raw.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  const start = clean.indexOf('{');
  const end   = clean.lastIndexOf('}');

  if (start === -1 || end === -1) throw new Error('No JSON object in response');

  const parsed = JSON.parse(clean.slice(start, end + 1));
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid JSON structure');
  return parsed;
}

// ── Resultado seguro quando tudo falha ───────────────────────────────────────
function buildFallback(round, message) {
  return {
    consensus:           false,
    confidence:          0,
    agreement_points:    [],
    disagreement_points: [],
    summary:             `Round ${round}: ${message}`,
    spec:                null,
    reasoning:           'Judge fallback',
    should_pause:        true,
    pause_reason:        message,
    working_memory:      null,
  };
}
