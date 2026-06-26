import { create } from 'zustand';

export const useDebateStore = create((set, get) => ({
  // ── Setup ──────────────────────────────────────────────────────────────────
  problem:          '',
  agentIds:         [],
  moderatorId:      'claude',
  moderatorDebates: false,
  maxRounds:        3,
  speed:            3000,
  briefings:        {},

  // ── Constitution ───────────────────────────────────────────────────────────
  constitution: {
    scenarioId:         'custom',
    scenarioText:       '',
    tone:               'exploratory',
    rules:              ['no_repetition', 'grounded_disagreement', 'word_limit'],
    wordLimit:          150,
    extendedVoiceAgent: null,
  },
  setConstitution: (patch) => set(state => ({
    constitution: { ...state.constitution, ...patch }
  })),

  // ── Debate state ───────────────────────────────────────────────────────────
  sessionId:       null,
  status:          'idle', // idle | running | paused | done
  currentRound:    0,
  messages:        [],
  kickedAgents:    [],
  scores:          {},
  roundScores:     {},
  consensusResult: null,
  synthesisConfig: { objective: 'decision', synthesizerId: 'claude' },
  tokenStats:      {},

  // ── Agent configs (loaded from API) ───────────────────────────────────────
  agentConfigs:    {},
  setAgentConfigs: (configs) => set({ agentConfigs: configs }),

  // ── Setup actions ──────────────────────────────────────────────────────────
  setProblem:         (problem)     => set({ problem }),
  setAgentIds:        (agentIds)    => set({ agentIds }),
  setModerator:       (id, debates) => set({ moderatorId: id, moderatorDebates: debates }),
  setMaxRounds:       (n)           => set({ maxRounds: n }),
  setSynthesisConfig: (cfg)         => set({ synthesisConfig: cfg }),
  setSpeed:     (s)                => set({ speed: s }),
  setBriefing:  (agentId, text)    => set(state => ({
    briefings: { ...state.briefings, [agentId]: text }
  })),

  // ── Session actions ────────────────────────────────────────────────────────
  setSessionId: (id)     => set({ sessionId: id }),
  setStatus:    (status) => set({ status }),
  setRound:     (n)      => set({ currentRound: n }),

  // ── Message actions ────────────────────────────────────────────────────────
  addMessage: (msg) => set(state => ({
    messages: [...state.messages, { id: Date.now() + Math.random(), ...msg }]
  })),

  appendToken: (agentId, token, round) => set(state => {
    const messages = [...state.messages];
    const idx = messages.findLastIndex(
      m => m.agentId === agentId && m.round === round && !m.partial
    );
    if (idx >= 0) {
      messages[idx] = { ...messages[idx], text: messages[idx].text + token };
    } else {
      const cfg = state.agentConfigs?.[agentId] ?? {};
      messages.push({
        id:        `${agentId}-${round}-${Date.now()}`,
        agentId,   agentName: cfg.name ?? agentId,
        round,     text: token,
        isHuman:   false,
        partial:   false,
      });
    }
    return { messages };
  }),

  markInterrupted: (agentId, round) => set(state => {
    const messages = [...state.messages];
    const idx = messages.findLastIndex(
      m => m.agentId === agentId && m.round === round
    );
    if (idx >= 0) messages[idx] = { ...messages[idx], partial: true };
    return { messages };
  }),

  // ── Agent control ──────────────────────────────────────────────────────────
  kickAgent:   (agentId) => set(state => ({
    kickedAgents: [...state.kickedAgents, agentId]
  })),
  unkickAgent: (agentId) => set(state => ({
    kickedAgents: state.kickedAgents.filter(id => id !== agentId)
  })),

  // ── Scoring & consensus ────────────────────────────────────────────────────
  setScores:      (scores) => set({ scores }),
  setRoundScores: (rs)     => set({ roundScores: rs }),
  setConsensus:   (result) => set({ consensusResult: result }),

  // ── Token tracking ─────────────────────────────────────────────────────────
  updateTokenStats: (agentId, inputTokens, outputTokens, costPer1k) => set(state => {
    const prev = state.tokenStats[agentId] ?? { inputTokens: 0, outputTokens: 0, cost: 0 };
    const addedCost =
      ((inputTokens  / 1000) * costPer1k.input) +
      ((outputTokens / 1000) * costPer1k.output);
    return {
      tokenStats: {
        ...state.tokenStats,
        [agentId]: {
          inputTokens:  prev.inputTokens  + inputTokens,
          outputTokens: prev.outputTokens + outputTokens,
          cost:         prev.cost + addedCost,
        },
      },
    };
  }),

  // ── Reset ──────────────────────────────────────────────────────────────────
  reset: () => set({
    sessionId:       null,
    status:          'idle',
    currentRound:    0,
    messages:        [],
    kickedAgents:    [],
    scores:          {},
    roundScores:     {},
    consensusResult: null,
    tokenStats:      {},
    briefings:       {},
  }),
}));
