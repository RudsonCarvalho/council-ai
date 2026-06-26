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

export function createSession({ sessionId, problem, agentIds, moderatorId, speed, briefings = {}, modelOverrides = {}, constitution = null, researcherId = null, researchContext = null, roundLimit = null, clarificationRound = true, contextSessions = [], contextMode = 'continue', synthesisObjective = '', synthesizerId = 'claude', adversaryId = null, factCheckerId = null, factCheckerModel = null }) {

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
    roundLimit,
    roundsThisCycle: 0,
    clarificationRound,
    contextSessions,
    contextMode,
    synthesisObjective,
    synthesizerId,
    adversaryId,
    factCheckerId,
    factCheckerModel,           // IA que atua como adversário (null = desativado)
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
        session.contextSessions.map(sid => getSessionContext(sid, session.contextMode).catch(err => {
          console.warn(`[knowledge] Failed to load context for session ${sid}:`, err.message);
          return null;
        }))
      );
      session.knowledgeContext = blocks.filter(Boolean).join('\n\n') || null;
      if (session.knowledgeContext) {
        console.log(`[knowledge] Loaded ${blocks.filter(Boolean).length} session(s) as context — mode=${session.contextMode} — ${session.knowledgeContext.length} chars`);
      } else {
        console.warn(`[knowledge] Context sessions selected but no content found`);
      }
    } catch (err) {
      console.error(`[knowledge] Error loading context:`, err.message);
      session.knowledgeContext = null;
    }
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

    // ── Síntese forçada — pausa após o round de síntese ──────────────────
    if (session.forcingSynthesis) {
      session.forcingSynthesis = false;
      session.status = 'paused';
      emit(session, 'synthesis_round_done', { round });
      console.log(`[debate] Synthesis round complete — pausing for review`);
      break;
    }

    if (session.status !== 'running') break;

    // ── Adversário — questiona as respostas do round (só vê os outros) ────
    if (session.adversaryId && round > 0) {
      const adversaryResponse = await runAdversary(session, round, roundResponses);
      if (adversaryResponse) {
        session.allResponses.push(adversaryResponse);
        saveMessage(session.sessionId, adversaryResponse).catch(() => {});
        emit(session, 'adversary_done', { round, text: adversaryResponse.text });
      }
    }

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

    // ── Verificador de fatos — detecta contradições e verifica externamente ─
    if (session.factCheckerId && round > 1) {
      await runFactChecker(session, round, roundResponses);
    }

    // ── Score + consenso ──────────────────────────────────────────────────
    // Frequência de avaliação inteligente:
    //   Round 1     → pula (IAs explorando, consenso impossível)
    //   advancing   → avalia a cada 2 rounds (economiza ~40% das chamadas)
    //   converging  → avalia todo round (decisão iminente)
    //   stalled     → avalia todo round (precisa intervir)
    const progress    = session.consensusResult?.working_memory?.progress ?? 'advancing';
    const skipEval    = round === 1 || (progress === 'advancing' && round % 2 !== 0);

    if (skipEval) {
      console.log(`  ⏭ [judge] round=${round} skipping eval (progress=${progress})`);
    } else {
    try {
      emit(session, 'judge_start', { round });

      const { scoreRound: sr, calculateCumulativeScores: ccs } = await import('./scorer.service.js');
      const roundScores = await sr(session.problem, roundResponses);
      session.allRoundScores.push(roundScores);
      const cumulative = ccs(session.allRoundScores);
      emit(session, 'scores_update', { scores: cumulative, roundScores });

      const consensus = await judgeConsensus(session.problem, session.allResponses, session.moderatorId, session.sessionId);
      session.consensusResult = consensus;

      if (consensus._judgeUsage) {
        emit(session, 'cost_update', {
          agentId:      'judge',
          inputTokens:  consensus._judgeUsage.inputTokens,
          outputTokens: consensus._judgeUsage.outputTokens,
          round,
        });
        delete consensus._judgeUsage;
      }

      emit(session, 'judge_done', { round });
      emit(session, 'consensus', { ...consensus, round });

      // ── Impasse detectado — apresenta análise para o humano decidir ──────
      if (consensus.impasse && consensus.impasseAnalysis) {
        session.status = 'paused';
        emit(session, 'impasse_detected', {
          round,
          analysis: consensus.impasseAnalysis,
        });
        break;
      }

      if (consensus.should_pause) {
        session.status = 'paused';
        emit(session, 'moderator_pause', { reason: consensus.pause_reason });
        break;
      }

      if (consensus.consensus) {
        session.status = 'paused';
        emit(session, 'consensus_reached', { confidence: consensus.confidence, summary: consensus.summary });
        break;
      }
    } catch (err) {
      console.error(`[orchestrator] Judge/score error round ${round}:`, err.message);
    }
    } // end skipEval else

  }

  if (session.status !== 'done') {
    session.status = 'paused';
    emit(session, 'paused', { round: session.currentRound });
  }
  session._loopRunning = false;
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
  if (round === 1 && knowledgeBlock) {
    console.log(`  📚 [${agentId}] injecting knowledge context — ${knowledgeBlock.length} chars`);
  }

  const privateContext = [
    constitution,
    knowledgeBlock,
    researchBlock,
    briefing,
    whisper,
    // Quando o adversário está ativo, as IAs precisam saber como responder às críticas
    session.adversaryId
      ? `NOTA SOBRE O ADVERSÁRIO: Este debate tem um agente adversário que vai apontar falhas e classificá-las por probabilidade e impacto. Quando ele levantar uma crítica, responda avaliando se o risco é aceitável, precisa de mitigação ou bloqueia o design — não tente eliminar toda possibilidade de falha, isso é impossível. O objetivo é identificar quais falhas são aceitáveis, quais precisam de mitigação e quais são inaceitáveis.`
      : null,
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
 * Adversário — roda APÓS todas as IAs responderem no round.
 * Recebe só as respostas das outras IAs (nunca as próprias) e questiona.
 * A crítica entra no contexto do próximo round para todas as IAs.
 */
/**
 * Verificador de fatos — detecta claims factuais contraditórios no round
 * e verifica com fonte externa antes do próximo round começar.
 * Injeta o resultado como contexto autoritativo [GROUNDING].
 */
async function runFactChecker(session, round, roundResponses) {
  const factCheckerId = session.factCheckerId;
  const adapter       = ADAPTER_REGISTRY[factCheckerId];
  if (!adapter) return;

  // Passo 1 — detecta se há claims factuais que merecem verificação
  const DETECTOR_PROMPT = `Analyze these debate responses for factual claims that need external verification.
Look for: specific numbers, prices, dates, versions, statistics, or direct contradictions between participants about facts (not opinions).

Respond with JSON only:
{
  "hasFactualClaims": true or false,
  "claims": ["claim 1 to verify", "claim 2 to verify"]
}

If no specific verifiable facts exist, return hasFactualClaims: false, claims: [].
Maximum 3 claims. Only include claims where being wrong would affect the debate conclusion.`;

  const roundText = roundResponses
    .filter(r => !r.isHuman && !r.isJudge)
    .map(r => `[${r.agentName}]: ${r.text.slice(0, 300)}`)
    .join('\n\n');

  let claimsToVerify = [];

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const { JUDGE_MODEL } = await import('../../config/agents.config.js');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await client.messages.create({
      model:      JUDGE_MODEL,
      max_tokens: 200,
      system:     DETECTOR_PROMPT,
      messages:   [{ role: 'user', content: `PROBLEM: ${session.problem}\n\nROUND ${round}:\n${roundText}` }],
    });
    const raw  = res.content[0].text.trim();
    const clean = raw.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(clean.slice(clean.indexOf('{'), clean.lastIndexOf('}') + 1));
    if (!parsed.hasFactualClaims || !parsed.claims?.length) {
      console.log(`  🔍 [fact-checker] round=${round} — no factual claims detected`);
      return;
    }
    claimsToVerify = parsed.claims.slice(0, 3);
    console.log(`  🔍 [fact-checker] round=${round} — verifying ${claimsToVerify.length} claims: ${claimsToVerify.join(' | ')}`);
  } catch (err) {
    console.warn(`  🔍 [fact-checker] detection failed:`, err.message);
    return;
  }

  // Passo 2 — verifica os claims com o agente selecionado
  emit(session, 'factcheck_start', { agentId: factCheckerId, round, claims: claimsToVerify });

  const modelOverride = session.factCheckerModel ?? null;
  const hasWebAccess  = factCheckerId === 'perplexity';

  const verifyPrompt = `You are a fact-checker. Verify these specific claims that emerged in a debate.
${hasWebAccess ? 'Search the web for current, accurate information.' : 'Use your training knowledge to verify these claims.'}

For each claim, state clearly:
- CONFIRMED / CONTRADICTED / INCONCLUSIVE
- Evidence or reasoning
- Source (URL if available, or "training knowledge")
${hasWebAccess ? '\nInclude real URLs when possible.' : ''}

Claims to verify:
${claimsToVerify.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Context: ${session.problem}

Format each result as:
CLAIM [n]: [claim text]
STATUS: CONFIRMED / CONTRADICTED / INCONCLUSIVE
EVIDENCE: [your finding]
SOURCE: [URL or source]`;

  let verificationText = '';

  try {
    const controller = new AbortController();
    session.abortControllers.set('factchecker', controller);

    await adapter.stream({
      problem:           verifyPrompt,
      previousResponses: [],
      privateContext:    null,
      modelOverride,
      signal:            controller.signal,
      onToken: (token) => {
        verificationText += token;
        emit(session, 'token', { agentId: `${factCheckerId}:factchecker`, token, round });
      },
    });

    session.abortControllers.delete('factchecker');

    if (!verificationText.trim()) return;

    // Formata e injeta como contexto autoritativo
    const groundingMessage = `[GROUNDING EXTERNO — verificado por ${AGENTS_CONFIG[factCheckerId]?.name}]\n\n${stripMarkdown(verificationText)}\n\nNota: estes fatos foram verificados externamente. Usem como premissa — não debatam a fonte.`;

    const groundingResponse = {
      agentId:     `${factCheckerId}:factchecker`,
      agentName:   `🔍 Verificador (${AGENTS_CONFIG[factCheckerId]?.name})`,
      round,
      text:        groundingMessage,
      isHuman:     false,
      isFactCheck: true,
      partial:     false,
    };

    session.allResponses.push(groundingResponse);
    saveMessage(session.sessionId, groundingResponse).catch(() => {});
    emit(session, 'factcheck_done', { round, text: groundingMessage });
    console.log(`  🔍 [fact-checker] done — grounding injected`);

  } catch (err) {
    session.abortControllers.delete('factchecker');
    if (err.name !== 'AbortError') console.error(`  🔍 [fact-checker] error:`, err.message);
  }
}

async function runAdversary(session, round, roundResponses) {
  const adversaryId = session.adversaryId;
  const adapter     = ADAPTER_REGISTRY[adversaryId];
  if (!adapter) return null;

  const othersResponses = roundResponses.filter(r => r.agentId !== adversaryId);
  if (othersResponses.length === 0) return null;

  const cfg = AGENTS_CONFIG[adversaryId];

  // ── Fase do debate determina o papel do adversário ────────────────────────
  const confidence = session.consensusResult?.confidence ?? 0;
  const progress   = session.consensusResult?.working_memory?.progress ?? 'advancing';
  const isConverging = confidence >= 0.65 || progress === 'converging';

  const adversaryPersona = isConverging
    ? `You are a calibrated risk reviewer. A solution is emerging (${Math.round(confidence * 100)}% confidence).

Your role: identify ONLY implementation risks not yet addressed. For each risk you raise, you MUST classify it:

Probability: high / medium / low
Impact if it occurs: high / medium / low
Your call: blocks the design / needs mitigation / acceptable with monitoring

IMPORTANT: Risks rated low probability + low impact do NOT block the design. Mention them briefly and move on. Do not insist if the team proposes reasonable mitigation.

The goal is NOT a zero-failure system — that does not exist. The goal is identifying which failures are acceptable, which need mitigation, and which are unacceptable.

Be concise. Maximum 150 words. Plain text, no markdown.`

    : `You are a calibrated adversary in a multi-AI debate. Your role is to challenge weak arguments — not to find infinite edge cases.

For every flaw you raise, you MUST classify it:

Probability: high / medium / low
Impact if it occurs: high / medium / low
Your call: blocks the design / needs mitigation / acceptable with monitoring

Rules:
- Low probability + low impact = mention once, do NOT repeat if mitigated
- Only high impact OR high probability flaws deserve sustained pressure
- If you already raised a point and the team addressed it, move on — do not rehash
- The goal is NOT zero risk. The goal is: which risks are acceptable?

Be specific — name which agent said what and why it is insufficient. Plain text, no markdown. Maximum 150 words.`;

  const phase = isConverging ? 'risk-reviewer' : 'challenger';
  console.log(`  ⚔ [adversary:${adversaryId}] round=${round} phase=${phase} confidence=${Math.round(confidence*100)}%`);

  const roundSummary = othersResponses.map(r => `[${r.agentName}]: ${r.text.slice(0, 400)}`).join(`\n\n`);
  const prompt = isConverging
    ? `PROBLEM: ${session.problem}\n\nEMERGING SOLUTION (round ${round}):\n\n${roundSummary}\n\nWhat implementation risks or gaps still need to be addressed?`
    : `PROBLEM: ${session.problem}\n\nROUND ${round} RESPONSES:\n\n${roundSummary}\n\nChallenge these. What is weak, repeated, or unsubstantiated?`;

  emit(session, `adversary_start`, { agentId: adversaryId, round, phase });

  const controller = new AbortController();
  session.abortControllers.set(`adversary`, controller);
  let text = ``, inputTokens = 0, outputTokens = 0;

  try {
    const result = await adapter.stream({
      problem:           prompt,
      previousResponses: [],
      privateContext:    adversaryPersona,
      modelOverride:     session.modelOverrides?.[adversaryId] ?? null,
      signal:            controller.signal,
      onToken: (token) => {
        text += token;
        emit(session, `token`, { agentId: `${adversaryId}:adversary`, token, round });
      },
    });
    inputTokens  = result.inputTokens;
    outputTokens = result.outputTokens;
    emit(session, `cost_update`, { agentId: `${adversaryId}:adversary`, inputTokens, outputTokens, round });
    console.log(`  ⚔ [adversary:${adversaryId}] done — ${inputTokens}in/${outputTokens}out`);
  } catch (err) {
    if (err.name !== `AbortError`) console.error(`  ⚔ [adversary] error:`, err.message);
  }

  session.abortControllers.delete(`adversary`);
  if (!text) return null;

  // Nome muda conforme a fase — deixa claro para o usuário o que está acontecendo
  const agentName = isConverging
    ? `${cfg?.name ?? adversaryId} 🛡 revisor`
    : `${cfg?.name ?? adversaryId} ⚔`;

  return {
    agentId:     `${adversaryId}:adversary`,
    agentName,
    round, text: stripMarkdown(text),
    isHuman: false, isAdversary: true, partial: false,
    phase, inputTokens, outputTokens,
  };
}

/**
 * Round 0 — Clarification.
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
