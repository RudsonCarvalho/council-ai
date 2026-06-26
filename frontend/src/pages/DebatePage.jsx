import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDebateStore } from '../store/debate.store.js';
import { connectSSE }     from '../services/sse.service.js';
import {
  pauseDebate, resumeDebate, setDebateSpeed, sendOpinion, sendWhisper,
  kickAgent, unkickAgent, changeModerator, finishDebate, uploadFile,
} from '../services/debate.service.js';
import { AGENTS_CONFIG } from '../../../config/agents.config.js';
import { UI_CONFIG }     from '../../../config/ui.config.js';
import { formatCost, formatTokens, downloadMarkdown, downloadText } from '../utils/format.js';
import styles from './DebatePage.module.css';

// Velocidades disponíveis em ms — 0 = sem delay
const SPEEDS = [
  { label: '⏩ Livre',   value: 0,    title: 'Sem delay — IAs respondem na velocidade delas' },
  { label: '1s',         value: 1000, title: '1 segundo de pausa entre cada resposta' },
  { label: '2s',         value: 2000, title: '2 segundos de pausa entre cada resposta' },
  { label: '3s',         value: 3000, title: '3 segundos de pausa — padrão, bom para leitura' },
  { label: '5s',         value: 5000, title: '5 segundos de pausa — mais tempo para ler' },
  { label: '⏸ Passo a passo', value: -1, title: 'Pausa após cada IA — você clica Continuar para a próxima responder' },
];

export default function DebatePage() {
  const navigate = useNavigate();
  const store    = useDebateStore();

  const [opinion,       setOpinion]       = useState('');
  const [whisperTarget, setWhisperTarget] = useState(null);
  const [whisperText,   setWhisperText]   = useState('');
  const [modDropdown,   setModDropdown]   = useState(false);
  const [autoScrolling, setAutoScrolling] = useState(true);
  const [report,        setReport]        = useState(null);
  const [minutes,       setMinutes]       = useState(null);
  const [finishing,     setFinishing]     = useState(false);
  const [forcingSynth,  setForcingSynth]  = useState(false);
  const [impasse,       setImpasse]       = useState(null);
  const [typingAgent,   setTypingAgent]   = useState(null);
  const [uploading,     setUploading]     = useState(false);
  const [currentSpeed,  setCurrentSpeed]  = useState(store.speed ?? 3000);
  const [judgeVerdict,  setJudgeVerdict]  = useState(null);
  const [isJudging,     setIsJudging]     = useState(false);
  const [clarificationQuestions, setClarificationQuestions] = useState([]);
  const [finishModal,   setFinishModal]   = useState(false);
  const [sessionTheme,  setSessionTheme]  = useState('');
  const [sessionTags,   setSessionTags]   = useState('');
  const [isKnowledgeBase, setIsKnowledgeBase] = useState(false);
  const [synthesizing,  setSynthesizing]  = useState(false);
  const [synthSections, setSynthSections] = useState([]);

  // Modelos ativos — lê do localStorage igual ao SetupPage
  const modelOverrides = (() => {
    try { return JSON.parse(localStorage.getItem('model_overrides') ?? '{}'); } catch { return {}; }
  })();

  const chatRef     = useRef(null);
  const sseRef      = useRef(null);
  const fileInputRef = useRef(null);
  const opinionRef  = useRef(null);

  // ── SSE ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!store.sessionId) { navigate('/'); return; }

    console.log('[debate] Connecting SSE for session:', store.sessionId);

    sseRef.current = connectSSE(store.sessionId, {
      token: ({ agentId, token, round, interrupted }) => {
        if (interrupted) store.markInterrupted(agentId, round);
        else             store.appendToken(agentId, token, round);
      },
      // Pesquisador
      researcher_start: ({ agentId }) => {
        store.addMessage({
          agentId:   'researcher',
          agentName: `🔍 Pesquisador (${store.agentConfigs[agentId]?.name ?? agentId})`,
          round:     0,
          text:      '',
          isHuman:   false,
          partial:   false,
          isResearcher: true,
        });
        setTypingAgent(agentId);
      },
      researcher_token: ({ token }) => {
        store.appendToken('researcher', token, 0);
      },
      researcher_done: () => {
        setTypingAgent(null);
      },
      researcher_error: ({ message }) => {
        setTypingAgent(null);
        store.addMessage({
          agentId: 'researcher', agentName: 'Pesquisador',
          round: 0, text: `⚠ Erro na pesquisa: ${message}`,
          isHuman: false, partial: true, isResearcher: true,
        });
      },

      loop_started: () => {
        console.log('[debate] Loop started');
        store.setStatus('running');
        const briefings = store.briefings ?? {};
        Object.entries(briefings).forEach(([agentId, text]) => {
          if (text?.trim()) {
            const cfg = store.agentConfigs[agentId] ?? AGENTS_CONFIG[agentId];
            store.addMessage({
              agentId:   'system', agentName: 'Sistema', round: 0,
              text:      `🔒 Briefing privado enviado para ${cfg?.name ?? agentId}`,
              isHuman:   false, partial: false, isJudge: true,
            });
          }
        });
      },
      agent_start:      ({ agentId }) => { setTypingAgent(agentId); },
      agent_done:       ()            => { },
      round_start:      ({ round })   => { console.log(`[debate] Round ${round} started`); store.setRound(round); store.setStatus('running'); },
      round_complete:   ({ round })   => { console.log(`[debate] Round ${round} complete`); setTypingAgent(null); },
      judge_start:      ({ round })   => { console.log(`[debate] Judge evaluating round ${round}...`); setIsJudging(true); },
      judge_done:       ({ round })   => { console.log(`[debate] Judge done round ${round}`); setIsJudging(false); },
      paused:           ()            => { console.log('[debate] Paused'); store.setStatus('paused'); setTypingAgent(null); },

      // Round 0 — clarification
      clarification_start: ({ agentId }) => {
        const cfg = AGENTS_CONFIG[agentId];
        store.addMessage({
          agentId: 'judge', agentName: '🔍 Análise de contexto',
          round: 0, text: `${cfg?.icon ?? '·'} ${cfg?.name ?? agentId} está avaliando se tem contexto suficiente para debater...`,
          isHuman: false, partial: false, isJudge: true,
        });
      },
      clarification_ok: () => {
        store.addMessage({
          agentId: 'judge', agentName: '✓ Contexto suficiente',
          round: 0, text: 'Contexto suficiente detectado. Iniciando debate...',
          isHuman: false, partial: false, isJudge: true,
        });
      },
      clarification_needed: ({ questions, reasoning }) => {
        store.setStatus('paused');
        setTypingAgent(null);
        setClarificationQuestions(questions);
        store.addMessage({
          agentId: 'judge', agentName: '⚠ Contexto insuficiente',
          round: 0,
          text: `**Antes de começar, precisamos de mais contexto:**\n\n${questions.map((q, i) => `${i+1}. ${q}`).join('\n')}\n\n*Responda no campo abaixo e clique Continuar.*`,
          isHuman: false, partial: false, isJudge: true,
        });
      },

      // Adversário
      adversary_start: ({ agentId, round, phase }) => {
        console.log(`[debate] Adversary ${agentId} starting round ${round} — phase: ${phase ?? 'challenger'}`);
        setTypingAgent(`${agentId}:adversary`);
      },
      adversary_done: ({ round, text }) => {
        setTypingAgent(null);
      },

      synthesis_round_done: ({ round }) => {
        store.setStatus('paused');
        setTypingAgent(null);
        store.addMessage({
          agentId: 'judge', agentName: '⚡ Round de síntese concluído',
          round, text: 'Revise as respostas acima. Se estiver bom, clique Finalizar. Se quiser refinar, escreva no campo abaixo e clique Continuar.',
          isHuman: false, partial: false, isJudge: true,
        });
      },

      impasse_detected: ({ round, analysis }) => {
        store.setStatus('paused');
        setTypingAgent(null);
        setImpasse({ analysis, round });
        console.log(`[debate] Impasse detected at round ${round}`);
      },

      factcheck_start: ({ agentId, round, claims }) => {
        console.log(`[debate] Fact-check starting round ${round} — ${claims?.length} claims`);
        setTypingAgent(`${agentId}:factchecker`);
        store.addMessage({
          agentId: 'judge', agentName: '🔍 Verificando fatos...',
          round, text: `Verificando ${claims?.length ?? 0} claim(s) factual(is) com fonte externa:\n${(claims ?? []).map((c, i) => `${i+1}. ${c}`).join('\n')}`,
          isHuman: false, partial: false, isJudge: true,
        });
      },
      factcheck_done: ({ round }) => {
        setTypingAgent(null);
        console.log(`[debate] Fact-check done round ${round}`);
      },

      // Limitador de rounds
      round_limit_reached: ({ round, roundLimit, message }) => {
        store.setStatus('paused');
        setTypingAgent(null);
        store.addMessage({
          agentId: 'judge', agentName: '⏸ Pausa automática',
          round, text: `**${message}**\n\nResumo até agora: revise as respostas e continue quando quiser.`,
          isHuman: false, partial: false, isJudge: true,
        });
      },

      consensus_reached: ({ confidence, summary }) => {
        console.log(`[debate] Consensus reached: ${Math.round(confidence*100)}% — ${summary}`);
        store.setStatus('paused');
        setTypingAgent(null);
        setJudgeVerdict({ confidence, summary, round: store.currentRound, consensus: true });
      },
      scores_update: ({ scores, roundScores }) => { store.setScores(scores); store.setRoundScores(roundScores); },
      consensus: (data) => {
        console.log(`[debate] Consensus update: ${data.consensus ? '✓' : '✗'} confidence=${Math.round((data.confidence??0)*100)}%`, data.summary);
        store.setConsensus(data);
        setJudgeVerdict({
          confidence: data.confidence,
          summary:    data.summary,
          round:      data.round ?? store.currentRound,
          consensus:  data.consensus,
        });
      },
      moderator_pause: async ({ reason }) => {
        store.setStatus('paused');
        setTypingAgent(null);
        store.addMessage({
          agentId: 'judge', agentName: '⚖ Moderador',
          round: store.currentRound,
          text: `**Intervenção do moderador:**\n${reason}`,
          isHuman: false, partial: false, isJudge: true,
        });
        // Injeta silenciosamente no contexto via whisper do sistema — sem criar bolha "Você"
        if (store.sessionId && reason) {
          try {
            await fetch(`http://localhost:3001/api/debate/${store.sessionId}/inject-context`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: `[MODERADOR]: ${reason}` }),
            });
          } catch {}
        }
      },
      speed_changed:    ({ speed })   => setCurrentSpeed(speed),
      agent_kicked:     ({ agentId }) => store.kickAgent(agentId),
      agent_rejoined:   ({ agentId }) => store.unkickAgent(agentId),
      moderator_changed: ({ moderatorId }) => store.setModerator(moderatorId, store.moderatorDebates),
      human_message:    ({ text, round }) => {
        store.addMessage({
          agentId: 'human', agentName: UI_CONFIG.labels.humanModerator,
          round, text, isHuman: true, partial: false,
        });
      },
      cost_update: ({ agentId, inputTokens, outputTokens }) => {
        if (agentId === 'judge') {
          // Custo do moderador — usa preço do Claude pois é sempre Claude que julga
          const cfg = AGENTS_CONFIG['claude'];
          if (cfg) store.updateTokenStats('judge', inputTokens, outputTokens, cfg.costPer1kTokens);
        } else {
          const cfg = AGENTS_CONFIG[agentId];
          if (cfg) store.updateTokenStats(agentId, inputTokens, outputTokens, cfg.costPer1kTokens);
        }
      },
      error: ({ agentId, message }) => {
        console.error(`[debate] Agent error — ${agentId ?? 'system'}:`, message);
        if (message && !message.includes('SSE')) {
          store.addMessage({
            agentId: agentId ?? 'system',
            agentName: store.agentConfigs[agentId]?.name ?? 'Sistema',
            round: store.currentRound, text: `⚠ ${message}`,
            isHuman: false, partial: true,
          });
        }
      },
      reconnected: () => console.warn('[debate] SSE reconnected'),
    });

    return () => sseRef.current?.close();
  }, []);

  // ── Auto scroll ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (autoScrolling && chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [store.messages, typingAgent, autoScrolling]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function handleForceSynthesis() {
    setForcingSynth(true);
    try {
      await fetch(`http://localhost:3001/api/debate/${store.sessionId}/force-synthesis`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
      });
      store.setStatus('running');
      store.addMessage({
        agentId: 'judge', agentName: '⚡ Síntese forçada',
        round: store.currentRound,
        text: 'Round de síntese iniciado. As IAs vão consolidar tudo numa resposta executável — decisão, implementação, riscos e próximos passos.',
        isHuman: false, partial: false, isJudge: true,
      });
    } catch (err) { console.error(err); }
    setForcingSynth(false);
  }

  async function handlePause() {
    await pauseDebate(store.sessionId);
    store.setStatus('paused');
  }

  async function handleResume() {
    store.setConsensus(null);
    await resumeDebate(store.sessionId);
    store.setStatus('running');
  }

  async function handleSpeedChange(speed) {
    setCurrentSpeed(speed);
    await setDebateSpeed(store.sessionId, speed);
    // Não retoma automaticamente ao trocar velocidade — usuário clica Continuar
  }

  // Abre o painel de finalização com tema e tags gerados automaticamente
  function handleFinish() {
    if (!finishModal) {
      // Gera tema e tags do consenso se ainda estiverem vazios
      if (!sessionTheme && store.consensusResult?.summary) {
        // Tema = primeiras palavras do resumo do consenso
        const autoTheme = store.problem?.slice(0, 60) ?? store.consensusResult.summary.slice(0, 60);
        setSessionTheme(autoTheme);
      }
      if (!sessionTags && store.consensusResult?.agreement_points?.length > 0) {
        // Tags = palavras-chave extraídas dos pontos de acordo
        const points   = store.consensusResult.agreement_points.join(' ');
        const words    = points.toLowerCase().match(/\b[a-záéíóúàâêôãõüç]{4,}\b/g) ?? [];
        const freq     = {};
        words.forEach(w => { freq[w] = (freq[w] ?? 0) + 1; });
        const topTags  = Object.entries(freq)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([w]) => w);
        setSessionTags(topTags.join(', '));
      }
      setFinishModal(true);
      return;
    }
    handleConfirmFinish();
  }

  async function handleConfirmFinish() {
    setFinishing(true);
    setFinishModal(false);
    try {
      const result = await finishDebate(store.sessionId, {
        consensusResult: store.consensusResult,
        scores:          store.scores,
        theme:           sessionTheme,
        tags:            sessionTags.split(',').map(t => t.trim()).filter(Boolean),
        isKnowledgeBase: isKnowledgeBase,
      });
      setReport(result.report);
      setMinutes(result.minutes);
      store.setStatus('done');

      // Dispara o sintetizador automaticamente se configurado
      const { objective, synthesizerId } = store.synthesisConfig ?? {};
      if (objective && synthesizerId) {
        handleSynthesize(objective, synthesizerId);
      }
    } catch (err) { console.error(err); }
    setFinishing(false);
  }

  async function handleSynthesize(objective, synthesizerId) {
    setSynthesizing(true);
    setSynthSections([]);
    try {
      const BASE = 'http://localhost:3001';
      const res = await fetch(`${BASE}/api/debate/${store.sessionId}/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objective, synthesizerId }),
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.event === 'section_done') {
              setSynthSections(prev => [...prev, data]);
            }
          } catch {}
        }
      }
    } catch (err) { console.error('Synthesize error:', err); }
    setSynthesizing(false);
  }

  async function handleRegenerateSection(sectionIndex, sectionTitle) {
    const { objective, synthesizerId } = store.synthesisConfig ?? { objective: 'decision', synthesizerId: 'claude' };
    setSynthSections(prev => prev.map((s, i) =>
      i === sectionIndex ? { ...s, content: '↺ Regenerando...', error: false } : s
    ));
    try {
      const BASE = 'http://localhost:3001';
      const res = await fetch(`${BASE}/api/debate/${store.sessionId}/synthesize/section/${sectionIndex}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objective, synthesizerId }),
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.event === 'section_done') {
              setSynthSections(prev => prev.map((s, i) =>
                i === sectionIndex ? { ...data, regenerated: true } : s
              ));
            }
          } catch {}
        }
      }
    } catch (err) {
      console.error('Regenerate section error:', err);
      setSynthSections(prev => prev.map((s, i) =>
        i === sectionIndex ? { ...s, content: `*Erro ao regenerar: ${err.message}*`, error: true } : s
      ));
    }
  }

  // Auto-pause quando o usuário começa a digitar
  const handleOpinionFocus = useCallback(async () => {
    if (store.status === 'running') {
      await pauseDebate(store.sessionId);
      store.setStatus('paused');
    }
  }, [store.status, store.sessionId]);

  async function handleOpinionSend() {
    if (!opinion.trim()) return;
    await sendOpinion(store.sessionId, opinion.trim());
    setOpinion('');
    setImpasse(null); // decisão tomada — fecha o painel
    if (store.status === 'paused') {
      await resumeDebate(store.sessionId);
      store.setStatus('running');
    }
  }

  async function handleWhisper() {
    if (!whisperText.trim() || !whisperTarget) return;
    await sendWhisper(store.sessionId, whisperTarget, whisperText.trim());
    setWhisperText('');
    setWhisperTarget(null);
  }

  async function handleKick(agentId) {
    await kickAgent(store.sessionId, agentId);
  }

  async function handleUnkick(agentId) {
    await unkickAgent(store.sessionId, agentId);
  }

  async function handleChangeModerator(id) {
    await changeModerator(store.sessionId, id);
    store.setModerator(id, store.moderatorDebates);
    setModDropdown(false);
  }

  async function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const result = await uploadFile(file);
      await sendOpinion(store.sessionId, `📎 Arquivo: **${result.filename}** (${(result.size/1024).toFixed(1)}KB)`);
    } catch (err) { console.error(err); }
    finally { setUploading(false); e.target.value = ''; }
  }

  // ── Computed ──────────────────────────────────────────────────────────────
  const totalCost    = Object.values(store.tokenStats).reduce((s, t) => s + (t.cost ?? 0), 0);
  const rankedAgents = Object.entries(store.scores).sort((a, b) => (b[1].average ?? 0) - (a[1].average ?? 0));
  const modCfg       = AGENTS_CONFIG[store.moderatorId];
  const isDone       = store.status === 'done';
  const isPaused     = store.status === 'paused';
  const isRunning    = store.status === 'running';
  const consensusReached = store.consensusResult?.consensus && isPaused;

  return (
    <div className={styles.page}>

      {/* ── Topbar ────────────────────────────────────────────────────────── */}
      <div className={styles.topbar}>
        <div className={styles.topLeft}>
          <span className={styles.roundBadge}>Round {store.currentRound}</span>
          <span className={`${styles.statusBadge} ${styles[store.status]}`}>
            {isRunning ? '🟢 Debatendo' : isPaused ? '⏸ Pausado' : isDone ? '✓ Concluído' : '—'}
          </span>
          {consensusReached && (
            <span className={styles.consensusBadge}>Consenso atingido</span>
          )}
        </div>
        <div className={styles.topRight}>
          {/* Moderator selector */}
          <div className={styles.modSelector}>
            <button className={styles.modBtn} onClick={() => setModDropdown(d => !d)}>
              <span>{modCfg?.icon}</span>
              <span>{modCfg?.name}</span>
              <span className={styles.modLabel}>⚖</span>
              <span>▾</span>
            </button>
            {modDropdown && (
              <div className={styles.modDropdown}>
                {Object.entries(store.agentConfigs).map(([id, cfg]) => (
                  <button key={id} className={styles.modOption} onClick={() => handleChangeModerator(id)}>
                    <span style={{ color: cfg.color }}>{cfg.icon}</span> {cfg.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {!isDone && (
            <>
              {isRunning
                ? <button className={styles.ctrlBtn} onClick={handlePause}>⏸ Pausar</button>
                : <button className={`${styles.ctrlBtn} ${styles.resumeBtn}`} onClick={handleResume}>▶ Continuar</button>
              }
              <button
                className={`${styles.ctrlBtn} ${styles.synthForceBtn}`}
                onClick={handleForceSynthesis}
                disabled={forcingSynth || isDone}
                title="Força um round de síntese — as IAs consolidam tudo numa resposta executável"
              >
                {forcingSynth ? '...' : '⚡ Sintetizar'}
              </button>
              <button className={styles.finishBtn} onClick={handleFinish} disabled={finishing}>
                {finishing ? '...' : '✓ Finalizar'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Layout ────────────────────────────────────────────────────────── */}
      <div className={styles.layout}>

        {/* ── Chat column ─────────────────────────────────────────────────── */}
        <div className={styles.chatCol}>

          <div className={styles.problemBanner}>
            <span>💡</span>
            <span>{store.problem}</span>
          </div>

          <div
            className={styles.chat}
            ref={chatRef}
            onScroll={e => {
              const el = e.currentTarget;
              setAutoScrolling(el.scrollTop + el.clientHeight >= el.scrollHeight - 50);
            }}
          >
            {store.messages.map(msg => (
              <MessageBubble
                key={msg.id}
                msg={msg}
                agentConfigs={store.agentConfigs}
                kickedAgents={store.kickedAgents}
                modelOverrides={modelOverrides}
                onWhisper={id => setWhisperTarget(id)}
                onKick={handleKick}
                onUnkick={handleUnkick}
              />
            ))}

            {typingAgent && (
              <TypingIndicator
                agentId={typingAgent}
                agentConfigs={store.agentConfigs}
                round={store.currentRound}
                model={modelOverrides[typingAgent] ?? AGENTS_CONFIG[typingAgent]?.model}
              />
            )}

            {/* Indicador do juiz avaliando */}
            {isJudging && (
              <div className={styles.judgeEvaluating}>
                <span className={styles.judgeEvalIcon}>⚖</span>
                <span>Juiz avaliando o debate...</span>
                <div className={styles.typingDots} style={{ marginLeft: 4 }}>
                  <span style={{ background: '#EC4899' }} />
                  <span style={{ background: '#EC4899' }} />
                  <span style={{ background: '#EC4899' }} />
                </div>
              </div>
            )}
            {judgeVerdict && !isDone && (
              <div className={`${styles.judgeBar} ${judgeVerdict.consensus ? styles.judgeBarConsensus : styles.judgeBarPending}`}>
                <div className={styles.judgeBarLeft}>
                  <span className={styles.judgeBarIcon}>{judgeVerdict.consensus ? '✓' : '⚖'}</span>
                  <div className={styles.judgeBarText}>
                    <span className={styles.judgeBarTitle}>
                      {judgeVerdict.consensus ? 'Consenso detectado' : 'Avaliação do juiz'} — Round {judgeVerdict.round}
                    </span>
                    <span className={styles.judgeBarSummary}>{judgeVerdict.summary}</span>
                  </div>
                </div>
                <div className={styles.judgeBarRight}>
                  <span className={styles.judgeBarConf}>{Math.round((judgeVerdict.confidence ?? 0) * 100)}%</span>
                  {judgeVerdict.consensus && !isDone && (
                    <button className={styles.judgeBarFinish} onClick={handleFinish} disabled={finishing}>
                      {finishing ? '...' : '✓ Finalizar'}
                    </button>
                  )}
                  <button className={styles.judgeBarDismiss} onClick={() => setJudgeVerdict(null)}>✕</button>
                </div>
              </div>
            )}

            {isPaused && !isDone && (
              <div className={styles.pauseSeparator}>
                {consensusReached
                  ? `──── ✓ Consenso atingido (${Math.round((store.consensusResult?.confidence ?? 0) * 100)}%) · continuar ou finalizar? ────`
                  : '──── Pausado · digite sua opinião ou clique Continuar ────'
                }
              </div>
            )}

            {isDone && store.consensusResult && (
              <ConsensusCard result={store.consensusResult} />
            )}
          </div>

          {/* Speed control bar — sempre visível */}
          {!isDone && (
            <div className={styles.speedBar}>
              <span className={styles.speedLabel}>Velocidade:</span>
              {SPEEDS.map(s => (
                <button
                  key={s.value}
                  className={`${styles.speedBtn} ${currentSpeed === s.value ? styles.speedActive : ''}`}
                  onClick={() => handleSpeedChange(s.value)}
                  title={s.title}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}

          {/* Whisper bar */}
          {whisperTarget && (
            <div className={styles.whisperBar}>
              <span className={styles.whisperLabel}>
                🔒 Privado para {store.agentConfigs[whisperTarget]?.name}
              </span>
              <input
                className={styles.whisperInput}
                value={whisperText}
                onChange={e => setWhisperText(e.target.value)}
                placeholder="Instrução privada..."
                onKeyDown={e => e.key === 'Enter' && handleWhisper()}
                autoFocus
              />
              <button className={styles.whisperSend} onClick={handleWhisper}>Enviar</button>
              <button className={styles.whisperClose} onClick={() => setWhisperTarget(null)}>✕</button>
            </div>
          )}

          {/* ── Impasse — análise do moderador aguardando sua decisão ────── */}
          {impasse && (
            <div className={styles.impassePanel}>
              <div className={styles.impasseHeader}>
                <span className={styles.impasseIcon}>⚖</span>
                <span className={styles.impasseTitle}>Impasse detectado — Round {impasse.round}</span>
                <button className={styles.impasseClose} onClick={() => setImpasse(null)}>✕</button>
              </div>
              <pre className={styles.impasseAnalysis}>{impasse.analysis}</pre>
              <div className={styles.impasseHint}>
                Digite sua decisão no campo abaixo e clique Enviar — o debate retoma com sua escolha como premissa fechada.
              </div>
            </div>
          )}

          {/* Opinion input */}
          {!isDone && (
            <div className={styles.inputBar}>
              <input ref={fileInputRef} type="file" style={{ display: 'none' }}
                accept={UI_CONFIG.supportedFileTypes.join(',')} onChange={handleFileUpload} />
              <button className={styles.uploadBtn} onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                {uploading ? '...' : '📎'}
              </button>
              <textarea
                ref={opinionRef}
                className={styles.opinionInput}
                value={opinion}
                onChange={e => setOpinion(e.target.value)}
                onFocus={handleOpinionFocus}
                placeholder={isPaused
                  ? 'Digite sua opinião e pressione Enter para enviar e retomar o debate...'
                  : 'Digite para pausar e opinar... (Enter envia)'
                }
                rows={6}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleOpinionSend();
                  }
                }}
              />
              <button className={styles.sendBtn} onClick={handleOpinionSend} disabled={!opinion.trim()}>
                Enviar
              </button>
            </div>
          )}

          {isDone && (
            <div className={styles.reportBar}>
              <span className={styles.reportBarTitle}>✓ Sessão concluída</span>
              {report  && <button className={styles.reportBtn} onClick={() => downloadMarkdown(report, 'relatorio.md')}>⬇ Relatório</button>}
              {minutes && <button className={styles.reportBtn} onClick={() => downloadMarkdown(minutes, 'ata.md')}>⬇ Ata</button>}
              <button className={styles.reportBtn} onClick={() => navigate('/execution')}>Executar spec →</button>
              <button className={styles.reportBtnSecondary} onClick={() => { store.reset(); navigate('/'); }}>Novo debate</button>
            </div>
          )}

          {/* Sintetizador — seções geradas em tempo real */}
          {(synthesizing || synthSections.length > 0) && (
            <div className={styles.synthPanel}>
              <div className={styles.synthTitle}>
                📄 {synthesizing ? 'Gerando documento...' : 'Documento gerado'}
              </div>
              {synthSections.map((s, i) => (
                <div key={i} className={`${styles.synthSection} ${s.error ? styles.synthError : ''} ${s.truncated ? styles.synthTruncated : ''}`}>
                  <div className={styles.synthSectionTitle}>
                    <span>
                      {s.error ? '✕' : s.truncated ? '⚠' : '✓'} {s.title}
                      {s.truncated && <span className={styles.synthTruncatedBadge}> incompleta</span>}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className={styles.synthProgress}>{i + 1}/{s.total}</span>
                      {!synthesizing && (
                        <button
                          className={styles.synthRegenBtn}
                          title={s.truncated ? 'Regerar seção incompleta' : 'Regerar esta seção'}
                          onClick={() => handleRegenerateSection(i, s.title)}
                        >{s.truncated ? '↺ completar' : '↺'}</button>
                      )}
                    </div>
                  </div>
                  {s.truncated && (
                    <div className={styles.synthTruncatedHint}>
                      Esta seção pode estar incompleta. Clique ↺ completar para regerar.
                    </div>
                  )}
                  <div className={styles.synthSectionPreview}>
                    {s.content?.slice(0, 300)}{s.content?.length > 300 ? '...' : ''}
                  </div>
                </div>
              ))}
              {!synthesizing && synthSections.length > 0 && (
                <button className={styles.synthDownloadBtn} onClick={() => {
                  const full = synthSections.map(s => `## ${s.title}\n\n${s.content}`).join('\n\n---\n\n');
                  downloadMarkdown(full, 'documento-final.md');
                }}>
                  ⬇ Baixar documento completo
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Bottom sheet de finalização ──────────────────────────────── */}
        {finishModal && (
          <div className={styles.finishSheet}>
            <div className={styles.finishSheetHandle} />
            <div className={styles.finishSheetBody}>
              <div className={styles.finishSheetLeft}>
                <div className={styles.finishSheetTitle}>Finalizar sessão</div>
                <div className={styles.finishSheetFields}>
                  <div className={styles.finishFieldWrap}>
                    <label className={styles.finishFieldLabel}>Tema</label>
                    <input className={styles.finishInput}
                      placeholder="Ex: Autenticação JWT..."
                      value={sessionTheme}
                      onChange={e => setSessionTheme(e.target.value)} />
                  </div>
                  <div className={styles.finishFieldWrap}>
                    <label className={styles.finishFieldLabel}>Tags</label>
                    <input className={styles.finishInput}
                      placeholder="jwt, segurança, node"
                      value={sessionTags}
                      onChange={e => setSessionTags(e.target.value)} />
                  </div>
                  <label className={styles.finishKbLabel}>
                    <input type="checkbox" checked={isKnowledgeBase}
                      onChange={e => setIsKnowledgeBase(e.target.checked)}
                      style={{ accentColor: '#F59E0B' }} />
                    🧠 Salvar como Knowledge Base
                  </label>
                </div>
              </div>
              <div className={styles.finishSheetActions}>
                <button className={styles.finishCancelBtn} onClick={() => setFinishModal(false)}>
                  Cancelar
                </button>
                <button className={styles.finishConfirmBtn} onClick={handleConfirmFinish} disabled={finishing}>
                  {finishing ? '...' : '✓ Finalizar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <div className={styles.sidebar}>

          {/* Token summary */}
          <div className={styles.tokenSummary}>
            <div className={styles.tokenSummaryTitle}>Custo da sessão</div>
            <div className={styles.tokenSummaryTotal}>
              <span className={styles.tokenSummaryAmount}>{formatCost(totalCost)}</span>
              <span className={styles.tokenSummaryLabel}>Round {store.currentRound}</span>
            </div>
            {Object.entries(store.agentConfigs).map(([id, cfg]) => {
              const stats = store.tokenStats[id];
              if (!stats) return null;
              return (
                <div key={id} className={styles.tokenRow}>
                  <span style={{ color: cfg.color }}>{cfg.icon} {cfg.name}</span>
                  <div className={styles.tokenStats}>
                    <span>{formatTokens((stats.inputTokens ?? 0) + (stats.outputTokens ?? 0))} tok</span>
                    <span className={styles.tokenCost}>{formatCost(stats.cost ?? 0)}</span>
                  </div>
                </div>
              );
            })}
            {store.tokenStats['judge'] && (
              <div className={styles.tokenRow} style={{ borderTop: '1px solid #1E2433', marginTop: 4, paddingTop: 4 }}>
                <span style={{ color: '#EC4899' }}>⚖ Moderador</span>
                <div className={styles.tokenStats}>
                  <span>{formatTokens((store.tokenStats['judge'].inputTokens ?? 0) + (store.tokenStats['judge'].outputTokens ?? 0))} tok</span>
                  <span className={styles.tokenCost}>{formatCost(store.tokenStats['judge'].cost ?? 0)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Ranking — 3 métricas */}
          <div className={styles.sideCard}>
            <div className={styles.sideTitle}>Contribuição</div>
            {rankedAgents.length === 0
              ? <div className={styles.sideMuted}>Aguardando avaliação...</div>
              : rankedAgents.map(([id, data], i) => {
                  const cfg      = AGENTS_CONFIG[id];
                  const isKicked = store.kickedAgents.includes(id);
                  const metrics  = [
                    { key: 'novelty',      label: '💡 Novidade',     value: data.novelty,      title: 'Trouxe algo genuinamente novo?' },
                    { key: 'practicality', label: '⚙️ Praticidade',   value: data.practicality, title: 'É implementável / acionável?' },
                    { key: 'robustness',   label: '🛡 Solidez',       value: data.robustness,   title: 'Resistiu às críticas?' },
                  ];
                  return (
                    <div key={id} className={`${styles.rankRow} ${isKicked ? styles.kicked : ''}`}
                      style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className={styles.rankPos}>#{i + 1}</span>
                        <span className={styles.rankIcon} style={{ color: cfg?.color }}>{cfg?.icon}</span>
                        <span className={styles.rankName}>{cfg?.name ?? id}</span>
                        <span className={styles.rankScore} style={{ marginLeft: 'auto' }}>
                          {data.average ?? '—'}
                        </span>
                        {data.alertKick && !isKicked && <span className={styles.alertKick}>⚠</span>}
                        {!isKicked
                          ? <button className={styles.kickBtn} onClick={() => handleKick(id)}>✕</button>
                          : <button className={styles.unkickBtn} onClick={() => handleUnkick(id)}>↩</button>
                        }
                      </div>
                      {metrics.map(m => m.value != null && (
                        <div key={m.key} className={styles.metricRow} title={m.title}>
                          <span className={styles.metricLabel}>{m.label}</span>
                          <div className={styles.metricBarWrap}>
                            <div className={styles.metricBar}
                              style={{ width: `${(m.value / 10) * 100}%`, background: cfg?.color ?? '#64748B' }} />
                          </div>
                          <span className={styles.metricScore}>{m.value}</span>
                        </div>
                      ))}
                    </div>
                  );
                })
            }
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

// Remove markdown do texto — não renderiza no chat, só infla o conteúdo
function stripMarkdown(text) {
  return text
    .replace(/^#{1,6}\s+/gm, '')                    // ### headers
    .replace(/\*{1,3}([^*\n]+)\*{1,3}/g, '$1')      // **bold** *italic*
    .replace(/_{1,2}([^_\n]+)_{1,2}/g, '$1')        // __bold__ _italic_
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')        // [link](url) → link
    .replace(/^[-*+]\s+/gm, '')                     // - bullet → texto
    .replace(/^\d+\.\s+/gm, '')                     // 1. item → texto
    .replace(/^>\s+/gm, '')                         // > citação
    .replace(/^[-*]{3,}\s*$/gm, '')                 // --- separadores
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseBlocks(text) {
  const regex = /```(\w+)?\n?([\s\S]*?)```/g;
  const blocks = []; let lastIndex = 0; let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const raw = text.slice(lastIndex, match.index);
      blocks.push({ type: 'text', content: stripMarkdown(raw) });
    }
    blocks.push({ type: 'code', lang: match[1] ?? 'txt', content: match[2].trim() });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    blocks.push({ type: 'text', content: stripMarkdown(text.slice(lastIndex)) });
  }
  return blocks.length > 0 ? blocks : [{ type: 'text', content: stripMarkdown(text) }];
}

function MessageBubble({ msg, agentConfigs, kickedAgents, modelOverrides = {}, onWhisper, onKick, onUnkick }) {
  const baseId   = msg.agentId?.includes(':') ? msg.agentId.split(':')[0] : msg.agentId;
  const cfg      = AGENTS_CONFIG[baseId] ?? agentConfigs?.[baseId];
  const isAdv    = msg.isAdversary || msg.agentId?.includes(':adversary');
  const color    = msg.isHuman ? '#94A3B8' : msg.isJudge ? '#EC4899' : isAdv ? '#FF6B35' : (cfg?.color ?? '#64748B');
  const isKicked = kickedAgents.includes(msg.agentId);
  const blocks   = parseBlocks(msg.text ?? '');

  // Modelo ativo desta IA
  const activeModel = !msg.isHuman && !msg.isJudge
    ? (modelOverrides[msg.agentId] ?? cfg?.model ?? '')
    : null;
  const modelLabel = activeModel
    ? (cfg?.models?.find(m => m.id === activeModel)?.label ?? activeModel)
    : null;

  return (
    <div className={`${styles.bubble} ${msg.isHuman ? styles.humanBubble : ''} ${msg.whisper ? styles.whisperBubble : ''}`}>
      <div className={styles.bubbleHeader}>
        <span className={styles.bubbleAgent} style={{ color }}>
          {cfg?.icon ?? (msg.isHuman ? '✎' : '·')} {msg.agentName}
        </span>
        {modelLabel && (
          <span className={styles.bubbleModel} style={{ color: `${color}99` }}>{modelLabel}</span>
        )}
        <span className={styles.bubbleRound}>R{msg.round}</span>
        {!msg.isHuman && !msg.isJudge && (
          <div className={styles.bubbleActions}>
            <button className={styles.bubbleAction} onClick={() => onWhisper(msg.agentId)} title="Whisper">✉</button>
            {!isKicked
              ? <button className={styles.bubbleActionKick} onClick={() => onKick(msg.agentId)} title="Kick">✕</button>
              : <button className={styles.bubbleAction} onClick={() => onUnkick(msg.agentId)}>↩</button>
            }
          </div>
        )}
      </div>
      <div className={styles.bubbleBody}>
        {blocks.map((block, i) =>
          block.type === 'text' ? (
            <div key={i} className={styles.bubbleText}>{block.content}</div>
          ) : (
            <div key={i} className={styles.codeBlock}>
              <div className={styles.codeHeader}>
                <span className={styles.codeLang}>{block.lang}</span>
                <button className={styles.codeDownload}
                  onClick={() => downloadText(block.content, `${msg.agentId}-r${msg.round}-${i}.${block.lang}`)}>
                  ⬇ Download
                </button>
              </div>
              <pre className={styles.codePre}><code>{block.content}</code></pre>
            </div>
          )
        )}
      </div>
      {msg.partial && <div className={styles.interrupted}>{UI_CONFIG.labels.interrupted}</div>}
    </div>
  );
}

function TypingIndicator({ agentId, agentConfigs, round, model }) {
  const cfg   = AGENTS_CONFIG[agentId] ?? agentConfigs?.[agentId];
  const color = cfg?.color ?? '#64748B';
  const modelLabel = model
    ? (cfg?.models?.find(m => m.id === model)?.label ?? model)
    : null;

  return (
    <div className={styles.bubble} style={{ borderColor: `${color}44` }}>
      <div className={styles.bubbleHeader}>
        <span className={styles.bubbleAgent} style={{ color }}>{cfg?.icon ?? '·'} {cfg?.name ?? agentId}</span>
        {modelLabel && <span className={styles.bubbleModel} style={{ color: `${color}99` }}>{modelLabel}</span>}
        <span className={styles.bubbleRound}>R{round}</span>
      </div>
      <div className={styles.typingDots}>
        <span style={{ background: color }} /><span style={{ background: color }} /><span style={{ background: color }} />
      </div>
    </div>
  );
}

function ConsensusCard({ result }) {
  return (
    <div className={`${styles.consensusCard} ${result.consensus ? styles.consensusReached : styles.consensusPending}`}>
      <div className={styles.consensusHeader}>
        {result.consensus ? '✓ Consenso atingido' : '△ Divergências detectadas'}
        <span className={styles.consensusConf}>{Math.round(result.confidence * 100)}%</span>
      </div>
      <p className={styles.consensusSummary}>{result.summary}</p>
      {result.agreement_points?.length > 0 && (
        <div className={styles.consensusPoints}>
          {result.agreement_points.map((p, i) => <div key={i} className={styles.agreePoint}>✓ {p}</div>)}
        </div>
      )}
      {result.disagreement_points?.length > 0 && (
        <div className={styles.consensusPoints}>
          {result.disagreement_points.map((p, i) => <div key={i} className={styles.disagreePoint}>⚡ {p}</div>)}
        </div>
      )}
    </div>
  );
}
