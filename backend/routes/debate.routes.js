import express from 'express';
import { nanoid } from 'nanoid';
import {
  createSession, getSession, startDebateLoop, pauseSession, resumeSession,
  setSpeed, addHumanOpinion, addWhisper, kickAgent, unkickAgent,
  changeModerator, closeSession, addSseClient, removeSseClient,
} from '../services/orchestrator.service.js';
import { generateReport, generateMinutes } from '../utils/report-generator.js';
import { saveSession, saveSessionFile }    from '../services/storage.service.js';
import { synthesizeDebate, regenerateSection } from '../services/synthesizer.service.js';

const router = express.Router();

// ── POST /api/debate/start ────────────────────────────────────────────────────
router.post('/start', async (req, res) => {
  try {
    const {
      problem, agentIds, moderatorId, speed, briefings,
      modelOverrides, constitution, researcherId, researchContext,
      roundLimit, clarificationRound, contextSessions, contextMode,
      synthesisObjective, synthesizerId, adversaryId,
      factCheckerId, factCheckerModel,
    } = req.body;

    if (!problem?.trim())
      return res.status(400).json({ error: 'Problem is required' });
    if (!agentIds?.length || agentIds.length < 2)
      return res.status(400).json({ error: 'At least 2 agents required' });

    console.log(`[start] contextSessions=${JSON.stringify(contextSessions)} contextMode=${contextMode}`);

    const sessionId = nanoid(12);

    createSession({
      sessionId, problem,
      agentIds, moderatorId: moderatorId ?? 'claude',
      speed:              speed ?? 3000,
      briefings:          briefings ?? {},
      modelOverrides:     modelOverrides ?? {},
      constitution:       constitution ?? null,
      researcherId:       researcherId ?? null,
      researchContext:    researchContext ?? null,
      roundLimit:         roundLimit ?? null,
      clarificationRound: clarificationRound ?? true,
      contextSessions:    contextSessions ?? [],
      contextMode:        contextMode ?? 'continue',
      synthesisObjective: synthesisObjective ?? '',
      synthesizerId:      synthesizerId ?? 'claude',
      adversaryId:        adversaryId ?? null,
      factCheckerId:      factCheckerId ?? null,
      factCheckerModel:   factCheckerModel ?? null,
    });

    await saveSession(sessionId, {
      sessionId, problem, agentIds, moderatorId, speed,
      roundLimit, contextSessions, contextMode,
      synthesisObjective, synthesizerId,
      startedAt: new Date().toISOString(), status: 'running',
    });

    // Inicia o loop em background — não aguarda
    startDebateLoop(sessionId).catch(console.error);

    res.json({ sessionId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/debate/stream/:sessionId ─────────────────────────────────────────
router.get('/stream/:sessionId', (req, res) => {
  const { sessionId } = req.params;

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  addSseClient(sessionId, res);

  // Heartbeat a cada 20s para manter conexão viva
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); }
  }, 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    removeSseClient(sessionId, res);
  });
});

// ── POST /api/debate/:sessionId/pause ─────────────────────────────────────────
router.post('/:sessionId/pause', (req, res) => {
  pauseSession(req.params.sessionId);
  res.json({ ok: true });
});

// ── POST /api/debate/:sessionId/resume ───────────────────────────────────────
router.post('/:sessionId/resume', (req, res) => {
  resumeSession(req.params.sessionId);
  res.json({ ok: true });
});

// ── POST /api/debate/:sessionId/speed ────────────────────────────────────────
router.post('/:sessionId/speed', (req, res) => {
  const { speed } = req.body;
  setSpeed(req.params.sessionId, speed);
  res.json({ ok: true });
});

// ── POST /api/debate/:sessionId/force-synthesis ──────────────────────────────
// Injeta instrução de síntese forçada e retoma o debate por mais um round
router.post('/:sessionId/force-synthesis', (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const SYNTHESIS_INSTRUCTION = `[SÍNTESE FORÇADA] O debate chegou num ponto suficiente. Este é o round de síntese final.

Cada IA deve agora consolidar TUDO numa resposta executável. Não repita argumentos anteriores. Produza diretamente:

1. DECISÃO: qual é a recomendação final e por quê
2. IMPLEMENTAÇÃO: passos concretos para executar
3. RISCOS: os 2-3 riscos reais que ainda existem
4. PRÓXIMOS PASSOS: o que fazer nas próximas 48h

Seja direto e específico. Nada de teoria. Uma decisão que um engenheiro consegue executar amanhã.`;

  // Injeta silenciosamente no contexto
  session.allResponses.push({
    agentId: 'human', agentName: 'Moderador',
    round: session.currentRound,
    text: SYNTHESIS_INSTRUCTION,
    isHuman: true, partial: false, silent: true,
  });

  session.forcingSynthesis = true;

  // Retoma o debate
  resumeSession(session.sessionId);

  res.json({ ok: true });
});

// ── POST /api/debate/:sessionId/opinion ──────────────────────────────────────
router.post('/:sessionId/opinion', (req, res) => {
  const { opinion } = req.body;
  if (!opinion?.trim()) return res.status(400).json({ error: 'Opinion required' });
  addHumanOpinion(req.params.sessionId, opinion.trim());
  res.json({ ok: true });
});

// ── POST /api/debate/:sessionId/inject-context ───────────────────────────────
// Injeta texto no contexto das IAs sem criar bolha "Você" no chat
router.post('/:sessionId/inject-context', (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'text required' });
  const session = getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  // Adiciona ao allResponses como mensagem humana mas SEM emitir SSE
  session.allResponses.push({
    agentId: 'human', agentName: 'Moderador',
    round: session.currentRound, text: text.trim(),
    isHuman: true, partial: false, silent: true,
  });
  res.json({ ok: true });
});

// ── POST /api/debate/:sessionId/whisper ──────────────────────────────────────
router.post('/:sessionId/whisper', (req, res) => {
  const { agentId, message } = req.body;
  if (!agentId || !message?.trim()) return res.status(400).json({ error: 'agentId and message required' });
  addWhisper(req.params.sessionId, agentId, message.trim());
  res.json({ ok: true });
});

// ── POST /api/debate/:sessionId/kick ─────────────────────────────────────────
router.post('/:sessionId/kick', (req, res) => {
  kickAgent(req.params.sessionId, req.body.agentId);
  res.json({ ok: true });
});

// ── POST /api/debate/:sessionId/unkick ───────────────────────────────────────
router.post('/:sessionId/unkick', (req, res) => {
  unkickAgent(req.params.sessionId, req.body.agentId);
  res.json({ ok: true });
});

// ── POST /api/debate/:sessionId/moderator ────────────────────────────────────
router.post('/:sessionId/moderator', (req, res) => {
  changeModerator(req.params.sessionId, req.body.moderatorId);
  res.json({ ok: true });
});

// ── POST /api/debate/:sessionId/finish ───────────────────────────────────────
router.post('/:sessionId/finish', async (req, res) => {
  try {
    const { sessionId }               = req.params;
    const { consensusResult, scores, theme, tags, isKnowledgeBase } = req.body;
    const session                     = getSession(sessionId);

    if (session) {
      session.endedAt = new Date().toISOString();
      const report  = generateReport(session, consensusResult, scores ?? {});
      const minutes = generateMinutes(session, consensusResult);
      await saveSessionFile(sessionId, 'report.md',  report);
      await saveSessionFile(sessionId, 'minutes.md', minutes);
      await saveSession(sessionId, {
        ...session, status: 'done', endedAt: session.endedAt,
        theme:           theme ?? '',
        tags:            tags  ?? [],
        isKnowledgeBase: isKnowledgeBase ?? false,
        consensusResult,
        agentIds:     [...session.agentIds],
        kickedAgents: [...session.kickedAgents],
      });
      closeSession(sessionId);
      res.json({ ok: true, report, minutes });
    } else {
      res.status(404).json({ error: 'Session not found' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/debate/:sessionId/synthesize/section/:index ────────────────────
router.post('/:sessionId/synthesize/section/:index', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const sectionIndex  = parseInt(req.params.index);
    const { objective = 'decision', synthesizerId = 'claude' } = req.body;

    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');

    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    send({ event: 'regen_start', sectionIndex });

    await regenerateSection(sessionId, sectionIndex, {
      objective, synthesizerId,
      onSection: (data) => send({ event: 'section_done', ...data }),
    });

    send({ event: 'regen_done', sectionIndex });
    res.end();
  } catch (err) {
    console.error('[synthesize/section] Error:', err.message);
    res.write(`data: ${JSON.stringify({ event: 'error', message: err.message })}\n\n`);
    res.end();
  }
});
// Gera o documento final seção por seção via SSE
router.post('/:sessionId/synthesize', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { objective = 'decision', synthesizerId = 'claude', customObjective = '' } = req.body;



    // Streaming das seções via SSE
    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.flushHeaders();

    const send = (data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    send({ event: 'synthesize_start', objective, synthesizerId });

    await synthesizeDebate(sessionId, {
      objective,
      synthesizerId,
      customObjective,
      onSection: ({ index, title, content, total, error }) => {
        send({ event: 'section_done', index, title, content, total, error: error ?? false });
      },
    });

    send({ event: 'synthesize_done' });
    res.end();
  } catch (err) {
    console.error('Synthesize error:', err);
    res.write(`data: ${JSON.stringify({ event: 'synthesize_error', message: err.message })}\n\n`);
    res.end();
  }
});

export default router;
