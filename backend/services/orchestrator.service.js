/**
 * ─── ORCHESTRATOR SERVICE ────────────────────────────────────────────────────
 * Loop autônomo: roda rounds continuamente até consenso ou pause manual.
 * O frontend não precisa chamar /round — só inicia e observa via SSE.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { claudeAdapter }     from '../adapters/claude.adapter.js';
import { gptAdapter }        from '../adapters/gpt.adapter.js';
import { geminiAdapter }     from '../adapters/gemini.adapter.js';
import { perplexityAdapter } from '../adapters/perplexity.adapter.js';
import { deepseekAdapter }   from '../adapters/deepseek.adapter.js';
import { grokAdapter }       from '../adapters/grok.adapter.js';
import { mistralAdapter }    from '../adapters/mistral.adapter.js';
import { AGENTS_CONFIG }     from '../../config/agents.config.js';
import { judgeConsensus, clearSessionMemory } from './consensus.service.js';
import { buildConstitution } from '../../config/debate-constitution.config.js';
import { scoreRound, calculateCumulativeScores } from './scorer.service.js';
import { saveMessage, updateSession } from './storage.service.js';

const ADAPTER_REGISTRY = {
  claude: claudeAdapter, gpt: gptAdapter, gemini: geminiAdapter,
  perplexity: perplexityAdapter, deepseek: deepseekAdapter,
  grok: grokAdapter, mistral: mistralAdapter,
};

const activeSessions = new Map();

/**
 * Remove markdown da resposta das IAs.
 * Não renderiza no chat — só aumenta o contexto do juiz desnecessariamente.
 */
function stripMarkdown(text) {
  return text
    // Remove blocos de código com linguagem: ```js ... ```
    .replace(/```[\w]*\n([\s\S]*?)```/g, (_, code) => code.trim())
    // Remove ``` sem linguagem
    .replace(/```/g, '')
    // Remove headers: ### Título → Título
    .replace(/^#{1,6}\s+/gm, '')
    // Remove negrito/itálico: **texto** → texto, *texto* → texto, __texto__ → texto
    .replace(/\*{1,3}([^*\n]+)\*{1,3}/g, '$1')
    .replace(/_{1,2}([^_\n]+)_{1,2}/g, '$1')
    // Remove links: [texto](url) → texto
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove separadores horizontais: --- ou *** sozinhos na linha
    .replace(/^[-*]{3,}\s*$/gm, '')
    // Remove bullet points: - item ou * item → item (mantém o texto)
    .replace(/^[\s]*[-*+]\s+/gm, '')
    // Remove numeração: 1. item → item
    .replace(/^[\s]*\d+\.\s+/gm, '')
    // Remove > citações
    .replace(/^>\s+/gm, '')
    // Colapsa múltiplas linhas em branco em uma
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Session lifecycle ─────────────────────────────────────────────────────────

export function createSession({ sessionId, problem, agentIds, moderatorId, speed, briefings = {}, modelOverrides = {}, constitution = null, researcherId = null, researchContext = null, roundLimit = null, clarificationRound = true, contextSessions = [], contextMode = 'continue', synthesisObjective = '', synthesizerId = 'claude' }) {

  // Monta a constituição corrigindo o nome do campo scenarioText → scenario
  let constitutionText = null;
  if (constitution) {
    constitutionText = buildConstitution({
      scenario:           constitution.scenarioText ?? constitution.scenario ?? '',
      tone:               constitution.tone         ?? 'exploratory',
      rules:              constitution.rules         ?? [],
      wordLimit:          constitution.wordLimit     ?? 150,
      extendedVoiceAgent: constitution.extendedVoiceAgent ?? null,
    });
  }

  const session = {
    sessionId, problem, agentIds, moderatorId,
    speed,
    briefings,
    modelOverrides,
    constitution,
    constitutionText,
    researcherId,
    researchContext,
    roundLimit,            // pausa automática a cada N rounds (null = sem limite)
    roundsThisCycle: 0,   // contador de rounds desde último pause por limite
    clarificationRound,    // Round 0 — IA pode pedir contexto antes de começar
    contextSessions,       // sessionIds de sessões anteriores para contexto
    contextMode,           // continue | light | challenge | break | free
    synthesisObjective,    // objetivo do sintetizador
    synthesizerId,         // IA que vai sintetizar
    whispers:         {},
    kickedAgents:     new Set(),
    currentRound:     0,
    allRoundScores:   [],
    allResponses:     [],
    abortControllers: new Map(),
    status:           'idle',
    sseClients:       new Set(),
    startedAt:        new Date().toISOString(),
    consensusResult:  null,
  };
  activeSessions.set(sessionId, session);
  return session;
}

export function getSession(sessionId) { return activeSessions.get(sessionId); }

export function addSseClient(sessionId, res) {
  const s = getSession(sessionId);
  if (s) s.sseClients.add(res);
}
export function removeSseClient(sessionId, res) {
  const s = getSession(sessionId);
  if (s) s.sseClients.delete(res);
}

function emit(session, event, data = {}) {
  const msgId   = `${event}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const payload = `data: ${JSON.stringify({ event, msgId, ...data })}\n\n`;
  session.sseClients.forEach(c => { try { c.write(payload); } catch {} });
}

// ── Main autonomous loop ──────────────────────────────────────────────────────

/**
 * Inicia o loop de debate. Roda rounds continuamente até:
 * - Consenso atingido (e nenhum humano retoma)
 * - Usuário pausar manualmente
 * - Sessão fechada
 */
export async function startDebateLoop(sessionId) {
  const session = getSession(sessionId);
  if (!session) return;
  if (session.status === 'running') return;
  if (session._loopRunning) return; // lock atômico — evita dupla chamada

  session._loopRunning = true;

  // Monta o contexto das sessões anteriores antes de começar
  if (session.contextSessions?.length > 0 && session.contextMode !== 'free') {
    try {
      const { getSessionContext } = await import('./storage.service.js');
      const blocks = await Promise.all(
        session.contextSessions.map(sid => getSessionContext(sid, session.contextMode).catch(() => null))
      );
      session.knowledgeContext = blocks.filter(Boolean).join('\n\n') || null;
    } catch { session.knowledgeContext = null; }
  } else {
    session.knowledgeContext = null;
  }

  session.status = 'running';
  emit(session, 'loop_started', {});

  // ── Fase de pesquisa — roda UMA VEZ antes do primeiro round ──────────────
  if (session.researcherId && session.currentRound === 0) {
    await runResearcherPhase(session);
  }

  // ── Round 0 — Clarification (opcional) ───────────────────────────────────
  if (session.clarificationRound && session.currentRound === 0) {
    await runClarificationRound(session);
    // Se pausou aguardando contexto do usuário, espera retomada
    while (session.status === 'paused') {
      await new Promise(r => setTimeout(r, 300));
    }
    if (session.status !== 'running') return;
  }

  while (true) {
    // Para se pausado ou encerrado
    if (session.status !== 'running') break;

    session.currentRound += 1;
    session.roundsThisCycle = (session.roundsThisCycle ?? 0) + 1;
    const round = session.currentRound;
    console.log(`\n[debate] ── Round ${round} ──────────────────────`);
    emit(session, 'round_start', { round });

    const participants = session.agentIds.filter(id => !session.kickedAgents.has(id));
    const prevContext  = [...session.allResponses];
    const roundResponses = [];

    // ── Sequencial: cada IA vê as anteriores deste round ─────────────────
    for (const agentId of participants) {
      if (session.status !== 'running') break;

      emit(session, 'agent_start', { agentId, round });

      const contextSoFar = [...prevContext, ...roundResponses];
      const response = await runAgent(session, agentId, round, contextSoFar);

      if (response) {
        roundResponses.push(response);
        session.allResponses.push(response);
        emit(session, 'agent_done', { agentId, round, partial: response.partial });

        // Salva imediatamente no MongoDB — texto completo, nunca truncado
        saveMessage(session.sessionId, {
          ...response,
          model: session.modelOverrides?.[agentId] ?? AGENTS_CONFIG[agentId]?.model,
        }).catch(err => console.error('saveMessage error:', err));
      }

      // Delay entre respostas para leitura
      if (session.status === 'running') {
        if (session.speed === -1) {
          session.status = 'paused';
          emit(session, 'paused', { round, waitingForNext: true });
          while (session.status === 'paused') {
            await new Promise(r => setTimeout(r, 200));
          }
        } else if (session.speed > 0) {
          await sleepInterruptible(session, session.speed);
        }
      }
    }

    emit(session, 'round_complete', {
      round,
      responses: roundResponses.map(r => ({
        agentId: r.agentId, agentName: r.agentName,
        text: r.text, partial: r.partial ?? false,
      })),
    });

    if (session.status !== 'running') break;

    // ── Limitador de rounds — pausa automática a cada N rounds ───────────
    if (session.roundLimit && session.roundsThisCycle >= session.roundLimit) {
      session.status = 'paused';
      session.roundsThisCycle = 0;
      emit(session, 'round_limit_reached', {
        round,
        roundLimit: session.roundLimit,
        message: `Pausa automática após ${session.roundLimit} round(s). Revise o debate e continue quando quiser.`,
      });
      break;
    }

    // ── Score + consenso ──────────────────────────────────────────────────
    try {
      emit(session, 'judge_start', { round }); // indicador visual no frontend

      const { scoreRound: sr, calculateCumulativeScores: ccs } = await import('./scorer.service.js');
      const roundScores = await sr(session.problem, roundResponses);
      session.allRoundScores.push(roundScores);
      const cumulative = ccs(session.allRoundScores);
      emit(session, 'scores_update', { scores: cumulative, roundScores });

      const consensus = await judgeConsensus(session.problem, session.allResponses, session.moderatorId, session.sessionId);
      session.consensusResult = consensus;

      emit(session, 'judge_done', { round }); // remove indicador visual
      emit(session, 'consensus', { ...consensus, round });

      if (consensus.should_pause) {
        session.status = 'paused';
        emit(session, 'moderator_pause', { reason: consensus.pause_reason });
        break;
      }

      if (consensus.consensus) {
        // Consenso atingido — pausa e espera o usuário decidir
        session.status = 'paused';
        emit(session, 'consensus_reached', { confidence: consensus.confidence, summary: consensus.summary });
        break;
      }
    } catch (err) {
      console.error(`[orchestrator] Judge/score error round ${round}:`, err.message);
    }
  }

  if (session.status !== 'done') {
    session.status = 'paused';
    emit(session, 'paused', { round: session.currentRound });
  }
  session._loopRunning = false; // libera o lock
}

// ── Controls ──────────────────────────────────────────────────────────────────

export function pauseSession(sessionId) {
  const session = getSession(sessionId);
  if (!session) return;
  session.status = 'paused';
  session.abortControllers.forEach(c => c.abort());
  session.abortControllers.clear();
  emit(session, 'paused', { round: session.currentRound });
}

export function resumeSession(sessionId) {
  const session = getSession(sessionId);
  if (!session || session.status === 'done') return;
  // Se o loop ainda está rodando (parado num while de espera), apenas muda o status
  // Se o loop terminou, inicia um novo
  if (session._loopRunning) {
    session.status = 'running';
    emit(session, 'loop_started', {});
  } else {
    startDebateLoop(sessionId);
  }
}

export function setSpeed(sessionId, speed) {
  const session = getSession(sessionId);
  if (!session) return;
  session.speed = speed;
  emit(session, 'speed_changed', { speed });
}

export function addHumanOpinion(sessionId, opinion) {
  const session = getSession(sessionId);
  if (!session) return;
  const r = {
    agentId: 'human', agentName: 'Você (moderador)',
    round: session.currentRound, text: opinion.trim(),
    isHuman: true, partial: false,
  };
  session.allResponses.push(r);
  emit(session, 'human_message', { text: opinion, round: session.currentRound });

  // Salva no MongoDB
  saveMessage(sessionId, r).catch(err => console.error('saveMessage human error:', err));
}

export function addWhisper(sessionId, agentId, message) {
  const session = getSession(sessionId);
  if (!session) return;
  session.whispers[agentId] = message;
  emit(session, 'whisper_sent', { agentId, round: session.currentRound });
}

export function kickAgent(sessionId, agentId) {
  const session = getSession(sessionId);
  if (!session) return;
  session.kickedAgents.add(agentId);
  session.abortControllers.get(agentId)?.abort();
  emit(session, 'agent_kicked', { agentId });
}

export function unkickAgent(sessionId, agentId) {
  const session = getSession(sessionId);
  if (!session) return;
  session.kickedAgents.delete(agentId);
  emit(session, 'agent_rejoined', { agentId });
}

export function changeModerator(sessionId, moderatorId) {
  const session = getSession(sessionId);
  if (!session) return;
  session.moderatorId = moderatorId;
  emit(session, 'moderator_changed', { moderatorId });
}

export function closeSession(sessionId) {
  const session = getSession(sessionId);
  if (!session) return;
  session.status = 'done';
  session.abortControllers.forEach(c => c.abort());
  session.abortControllers.clear();
  session.sseClients.forEach(c => { try { c.end(); } catch {} });
  activeSessions.delete(sessionId);
  clearSessionMemory(sessionId); // limpa memória do juiz
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function runAgent(session, agentId, round, contextSoFar) {
  const adapter = ADAPTER_REGISTRY[agentId];
  if (!adapter) return null;

  const controller = new AbortController();
  session.abortControllers.set(agentId, controller);

  const briefing       = round === 1 ? session.briefings[agentId] : null;
  const whisper        = session.whispers[agentId] ?? null;
  const constitution   = session.constitutionText ?? null;
  const isExtended     = session.constitution?.extendedVoiceAgent === agentId;

  // Contexto de pesquisa — URLs fornecidas + pesquisa do pesquisador
  const researchBlock = round === 1 && (session.researchContext || session.researchSummary)
    ? [
        session.researchContext ? `=== MATERIAL DE REFERÊNCIA (URLs fornecidas) ===\n${session.researchContext}` : null,
        session.researchSummary ? `=== PESQUISA COMPLEMENTAR (${AGENTS_CONFIG[session.researcherId]?.name ?? 'Pesquisador'}) ===\n${session.researchSummary}` : null,
      ].filter(Boolean).join('\n\n')
    : null;

  // Contexto de sessões anteriores — injetado apenas no round 1
  const knowledgeBlock = round === 1 && session.knowledgeContext ? session.knowledgeContext : null;

  const privateContext = [
    constitution,
    knowledgeBlock,
    researchBlock,
    briefing,
    whisper,
    isExtended ? `NOTA: Você tem permissão para respostas mais longas nesta sessão.` : null,
  ].filter(Boolean).join('\n\n') || null;
  const modelOverride  = session.modelOverrides?.[agentId] ?? null;

  delete session.whispers[agentId];

  let text = '', inputTokens = 0, outputTokens = 0, wasInterrupted = false;
  const model = modelOverride ?? AGENTS_CONFIG[agentId]?.model ?? agentId;
  console.log(`  → [${agentId}] round=${round} model=${model}`);

  try {
    const result = await adapter.stream({
      problem:           session.problem,
      previousResponses: contextSoFar,
      privateContext, modelOverride,
      signal:            controller.signal,
      onToken: (token) => {
        text += token;
        emit(session, 'token', { agentId, token, round });
      },
    });
    inputTokens  = result.inputTokens;
    outputTokens = result.outputTokens;
    console.log(`  ✓ [${agentId}] done — in=${inputTokens} out=${outputTokens} tokens`);
    emit(session, 'cost_update', { agentId, inputTokens, outputTokens, round });
  } catch (err) {
    if (err.name === 'AbortError') {
      console.log(`  ✂ [${agentId}] interrupted`);
      wasInterrupted = true;
      emit(session, 'token', { agentId, token: '', interrupted: true, round });
    } else {
      console.error(`  ✕ [${agentId}] error:`, err.message);
      emit(session, 'error', { agentId, message: err.message });
    }
  }

  session.abortControllers.delete(agentId);
  if (!text && !wasInterrupted) return null;

  // Remove markdown — não renderiza no chat e só infla o contexto do juiz
  const cleanText = wasInterrupted ? text : stripMarkdown(text);

  return {
    agentId, agentName: AGENTS_CONFIG[agentId]?.name ?? agentId,
    round, text: cleanText, partial: wasInterrupted, isHuman: false,
    inputTokens, outputTokens,
  };
}

/**
 * Round 0 — Clarification.
 * A primeira IA avalia se tem contexto suficiente para debater.
 * Se detectar lacunas, emite evento e pausa para o usuário responder.
 */
async function runClarificationRound(session) {
  const firstAgent = session.agentIds[0];
  const adapter    = ADAPTER_REGISTRY[firstAgent];
  if (!adapter) return;

  emit(session, 'clarification_start', { agentId: firstAgent });

  const clarificationPrompt = `Você vai participar de um debate sobre o seguinte problema:

"${session.problem}"

Antes de começar, avalie CRITICAMENTE se você tem contexto suficiente para contribuir com qualidade.

Responda APENAS em JSON válido, sem markdown:
{
  "hasEnoughContext": true | false,
  "questions": ["pergunta 1", "pergunta 2"],
  "reasoning": "breve explicação"
}

Se tiver contexto suficiente: hasEnoughContext=true, questions=[].
Se faltar informação crítica: hasEnoughContext=false, liste as perguntas específicas que precisam ser respondidas. Máximo 4 perguntas. Seja direto e objetivo.`;

  let responseText = '';

  try {
    const controller = new AbortController();
    session.abortControllers.set('clarification', controller);

    await adapter.stream({
      problem:           clarificationPrompt,
      previousResponses: [],
      privateContext:    null,
      modelOverride:     session.modelOverrides?.[firstAgent] ?? null,
      signal:            controller.signal,
      onToken: (token) => { responseText += token; },
    });

    session.abortControllers.delete('clarification');

    // Tenta parsear o JSON
    const clean = responseText.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);

    if (!result.hasEnoughContext && result.questions?.length > 0) {
      // Falta contexto — pausa e notifica o usuário
      session.status = 'paused';
      emit(session, 'clarification_needed', {
        agentId:   firstAgent,
        questions: result.questions,
        reasoning: result.reasoning,
      });
    } else {
      // Contexto suficiente — debate começa normalmente
      emit(session, 'clarification_ok', { agentId: firstAgent });
    }
  } catch {
    // Se falhar, segue o debate normalmente
    emit(session, 'clarification_ok', { agentId: firstAgent });
  }
}

/**
 * Fase de pesquisa — roda ANTES do debate.
 * O pesquisador busca na web complementando URLs já fornecidas.
 * Resultado fica em session.researchSummary e é injetado em todas as IAs.
 */
async function runResearcherPhase(session) {
  const adapter = ADAPTER_REGISTRY[session.researcherId];
  if (!adapter) return;

  emit(session, 'researcher_start', { agentId: session.researcherId });

  const urlContext = session.researchContext
    ? `MATERIAL JÁ FORNECIDO PELO USUÁRIO:\n${session.researchContext}\n\n`
    : '';

  const researchPrompt = `${urlContext}Com base no material acima e no problema abaixo, pesquise na web APENAS informações que complementem ou atualizem o que já está disponível. Não repita o que já consta. Foque em: evidências técnicas recentes, pesquisas relevantes, fontes confiáveis, perspectivas não cobertas. Apresente como briefing estruturado para especialistas que vão debater o tema. Cite as fontes.

PROBLEMA: ${session.problem}`;

  let researchText = '';

  try {
    const controller = new AbortController();
    session.abortControllers.set('researcher', controller);

    await adapter.stream({
      problem:           researchPrompt,
      previousResponses: [],
      privateContext:    null,
      modelOverride:     null,
      signal:            controller.signal,
      onToken: (token) => {
        researchText += token;
        emit(session, 'researcher_token', { token });
      },
    });

    session.abortControllers.delete('researcher');
    session.researchSummary = researchText;
    emit(session, 'researcher_done', { agentId: session.researcherId, summary: researchText });

  } catch (err) {
    if (err.name !== 'AbortError') {
      emit(session, 'researcher_error', { message: err.message });
    }
  }
}

/**
 * Sleep que pode ser interrompido quando a sessão pausa.
 */
async function sleepInterruptible(session, ms) {
  const steps = Math.ceil(ms / 200);
  for (let i = 0; i < steps; i++) {
    if (session.status !== 'running') return;
    await new Promise(r => setTimeout(r, Math.min(200, ms - i * 200)));
  }
}
