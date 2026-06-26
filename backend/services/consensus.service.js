/**
 * ─── CONSENSUS SERVICE — DUAS CHAMADAS PEQUENAS ──────────────────────────────
 *
 * Chamada 1 (VEREDICTO) — pequena, rápida, nunca trunca:
 *   Só retorna: consensus, confidence, should_pause, pause_reason, summary
 *
 * Chamada 2 (MEMÓRIA) — roda em background, não bloqueia:
 *   Atualiza a memória de trabalho para o próximo round
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import Anthropic from '@anthropic-ai/sdk';
import { AGENTS_CONFIG, JUDGE_MODEL } from '../../config/agents.config.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Sistema do veredicto — MINIMALISTA ────────────────────────────────────────
const VERDICT_SYSTEM = `You are a debate moderator. Respond ONLY with a tiny JSON object.
Start with { immediately. No text before or after. No markdown.

{
  "consensus": false,
  "confidence": 0.0,
  "should_pause": false,
  "pause_reason": null,
  "summary": "one short sentence",
  "stalled_rounds": 0
}

Rules:
- consensus=true when confidence>=0.75 (round 4+: >=0.60)
- should_pause=true when agents repeat same points 2+ rounds without progress
- pause_reason: direct command to agents in THEIR language, max 120 chars, or null
- summary: one sentence in the debate language
- stalled_rounds: how many consecutive rounds with no new information (0 if advancing)`;

// ── Sistema de análise de impasse — para apresentar ao humano ─────────────────
const IMPASSE_SYSTEM = `You are a debate moderator presenting an impasse analysis to a human decision-maker.

The debate is stuck. Analyze both sides and present a structured breakdown.
Write in the SAME LANGUAGE as the debate (if Portuguese, write in Portuguese).
Plain text only, no markdown. Be concise — max 200 words total.

Format EXACTLY as:
IMPASSE: [one sentence describing what is stuck]

OPÇÃO A — [name/label]:
Pontos fortes: [2-3 points]
Riscos: [1-2 points]

OPÇÃO B — [name/label]:
Pontos fortes: [2-3 points]
Riscos: [1-2 points]

MINHA SUGESTÃO: [Option A or B] porque [one clear reason based on the problem context]

O QUE VOCÊ DECIDE?`;

// ── Sistema da memória — também minimalista ───────────────────────────────────
const MEMORY_SYSTEM = `Update the working memory for this debate round. Respond ONLY with JSON.
Start with { immediately. No text before or after.

{
  "round": 0,
  "decided": ["max 3 short items, 60 chars each"],
  "disputed": ["max 3 short items, 60 chars each"],
  "positions": {"AgentName": "one short sentence"},
  "progress": "advancing"
}

progress must be one of: advancing, stalled, converging`;

// ── Memória de trabalho por sessão ────────────────────────────────────────────
const sessionMemory = new Map();

export function clearSessionMemory(sessionId) {
  sessionMemory.delete(sessionId);
}

// ── Limites rígidos de tamanho ────────────────────────────────────────────────
const MAX_RESPONSE_CHARS  = 250;  // por resposta de IA no round atual
const MAX_MEMORY_ITEM     = 60;   // por item nas listas decided/disputed
const MAX_MEMORY_POSITION = 70;   // por posição de agente na memória
const MAX_CONTEXT_CHARS   = 1200; // contexto total nunca passa disso

// ── Trunca mantendo início e fim ──────────────────────────────────────────────
function smartTruncate(text, maxChars) {
  if (!text || text.length <= maxChars) return text ?? '';
  const half = Math.floor(maxChars / 2);
  return text.slice(0, half) + '…' + text.slice(-half);
}

// ── Comprime a memória de trabalho para tamanho fixo ─────────────────────────
function compressMemory(memory) {
  if (!memory) return null;
  return {
    round:    memory.round,
    progress: memory.progress ?? 'advancing',
    decided:  (memory.decided  ?? []).slice(0, 3).map(s => String(s).slice(0, MAX_MEMORY_ITEM)),
    disputed: (memory.disputed ?? []).slice(0, 3).map(s => String(s).slice(0, MAX_MEMORY_ITEM)),
    positions: Object.fromEntries(
      Object.entries(memory.positions ?? {}).slice(0, 4).map(([k, v]) => [k, String(v).slice(0, MAX_MEMORY_POSITION)])
    ),
  };
}

// ── Monta contexto com tamanho garantidamente fixo ────────────────────────────
function buildContext(problem, currentRound, roundResponses, prevMemory) {
  let ctx = `PROBLEM: ${problem.slice(0, 150)}\nROUND: ${currentRound}\n\n`;

  if (prevMemory) {
    const m = compressMemory(prevMemory);
    ctx += `MEMORY: progress=${m.progress}`;
    if (m.decided.length)  ctx += ` | decided: ${m.decided.join('; ')}`;
    if (m.disputed.length) ctx += ` | disputed: ${m.disputed.join('; ')}`;
    ctx += '\n';
    Object.entries(m.positions).forEach(([name, pos]) => {
      ctx += `[${name}]: ${pos}\n`;
    });
    ctx += '\n';
  }

  ctx += `RESPONSES:\n`;
  roundResponses.forEach(r => {
    ctx += `[${r.agentName}]: ${smartTruncate(r.text, MAX_RESPONSE_CHARS)}\n\n`;
  });

  // Garante que nunca passa do limite mesmo se algo escapar
  return ctx.slice(0, MAX_CONTEXT_CHARS);
}

// ── Parseia JSON de forma robusta ─────────────────────────────────────────────
function parseJSON(raw) {
  const clean = raw.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  const start = clean.indexOf('{');
  const end   = clean.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON found');
  return JSON.parse(clean.slice(start, end + 1));
}

// ── Chamada ao modelo ─────────────────────────────────────────────────────────
async function callModel(system, userContent, maxTokens) {
  const res = await client.messages.create({
    model:      JUDGE_MODEL,
    max_tokens: maxTokens,
    system,
    messages:   [{ role: 'user', content: userContent }],
  });
  return {
    text:         res.content[0].text.trim(),
    inputTokens:  res.usage?.input_tokens  ?? 0,
    outputTokens: res.usage?.output_tokens ?? 0,
  };
}

// ── Gera análise de impasse para o humano decidir ─────────────────────────────
async function generateImpasseAnalysis(problem, context) {
  try {
    const res = await callModel(IMPASSE_SYSTEM, context, 350);
    return res.text.trim();
  } catch (err) {
    console.warn(`[judge] Impasse analysis failed:`, err.message);
    return null;
  }
}

// ── Entrada pública ───────────────────────────────────────────────────────────
export async function judgeConsensus(problem, allResponses, moderatorId = 'claude', sessionId = null) {

  // Filtra só respostas de IAs do round atual
  const aiResponses = allResponses.filter(r => !r.isHuman && !r.isJudge && !r.isAdversary && r.text?.trim());
  if (aiResponses.length === 0) return buildFallback(0, 'No responses to evaluate');

  const currentRound   = Math.max(...aiResponses.map(r => r.round ?? 0));
  const roundResponses = aiResponses.filter(r => r.round === currentRound);
  const prevMemory     = sessionId ? (sessionMemory.get(sessionId) ?? null) : null;

  const context = buildContext(problem, currentRound, roundResponses, prevMemory);
  console.log(`[judge] Round ${currentRound} — context: ${context.length} chars (limit: ${MAX_CONTEXT_CHARS}) memory: ${prevMemory ? 'yes' : 'none'}`);

  // ── CHAMADA 1: Veredicto — pequena, rápida ────────────────────────────────
  let verdict = null;
  let inputTokens = 0, outputTokens = 0;

  try {
    const res = await callModel(VERDICT_SYSTEM, context, 250);
    verdict = parseJSON(res.text);
    inputTokens  = res.inputTokens;
    outputTokens = res.outputTokens;
    console.log(`[judge] ✓ verdict — consensus=${verdict.consensus} confidence=${Math.round((verdict.confidence??0)*100)}% pause=${verdict.should_pause}`);
  } catch (err) {
    console.warn(`[judge] Verdict failed: ${err.message} — trying minimal fallback...`);

    // Fallback extremo — contexto mínimo
    try {
      const minimal = `PROBLEM: ${problem}\nROUND: ${currentRound}\n` +
        roundResponses.map(r => `[${r.agentName}]: ${r.text.slice(0, 150)}`).join('\n');
      const res = await callModel(VERDICT_SYSTEM, minimal, 200);
      verdict = parseJSON(res.text);
      inputTokens  = res.inputTokens;
      outputTokens = res.outputTokens;
      console.log(`[judge] ✓ minimal fallback worked`);
    } catch (err2) {
      console.error(`[judge] All verdict attempts failed:`, err2.message);
      return buildFallback(currentRound,
        `O juiz pausou para processar o debate. Clique Continuar para retomar, ou adicione uma instrução.`
      );
    }
  }

  // ── CHAMADA 2: Memória — roda em background, não bloqueia ────────────────
  if (sessionId) {
    callModel(MEMORY_SYSTEM, context, 300)
      .then(res => {
        try {
          const memory = parseJSON(res.text);
          if (memory && typeof memory === 'object') {
            sessionMemory.set(sessionId, compressMemory({ ...memory, round: currentRound }));
            console.log(`[judge] memory updated — progress=${memory.progress}`);
          }
        } catch {}
      })
      .catch(err => console.warn(`[judge] Memory update failed (non-critical):`, err.message));
  }

  // ── IMPASSE: debate travado 2+ rounds → analisa e apresenta para humano ───
  const stalledRounds = verdict.stalled_rounds ?? 0;
  const isImpasse     = stalledRounds >= 2 && !verdict.consensus && verdict.should_pause;

  let impasseAnalysis = null;
  if (isImpasse) {
    console.log(`[judge] Impasse detected (${stalledRounds} stalled rounds) — generating analysis for human...`);
    impasseAnalysis = await generateImpasseAnalysis(problem, context);
    if (impasseAnalysis) {
      console.log(`[judge] Impasse analysis ready — presenting to human`);
    }
  }

  return {
    consensus:           verdict.consensus    ?? false,
    confidence:          verdict.confidence   ?? 0,
    agreement_points:    [],
    disagreement_points: [],
    summary:             verdict.summary      ?? '',
    spec:                null,
    reasoning:           '',
    should_pause:        verdict.should_pause ?? false,
    pause_reason:        verdict.pause_reason ?? null,
    impasse:             isImpasse,
    impasseAnalysis,
    _judgeUsage:         { inputTokens, outputTokens },
  };
}

// ── Resultado seguro quando tudo falha ───────────────────────────────────────
function buildFallback(round, message) {
  return {
    consensus: false, confidence: 0,
    agreement_points: [], disagreement_points: [],
    summary: `Round ${round}: ${message}`,
    spec: null, reasoning: 'Judge fallback',
    should_pause: true, pause_reason: message,
  };
}
