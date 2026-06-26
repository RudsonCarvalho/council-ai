/**
 * ─── MONGODB SCHEMAS ─────────────────────────────────────────────────────────
 * Todos os modelos do sistema em um único arquivo.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { mongoose } from './connection.js';

const { Schema, model } = mongoose;

// ── Session ───────────────────────────────────────────────────────────────────
// Metadados e configuração de cada debate

const SessionSchema = new Schema({
  sessionId:       { type: String, required: true, unique: true, index: true },
  problem:         { type: String, required: true },
  agentIds:        [String],
  moderatorId:     String,
  modelOverrides:  { type: Map, of: String, default: {} },
  speed:           { type: Number, default: 0 },
  briefings:       { type: Map, of: String, default: {} },
  constitution:    { type: Schema.Types.Mixed, default: null },

  // Knowledge base
  theme:           { type: String, default: '' },
  tags:            { type: [String], default: [] },
  isKnowledgeBase: { type: Boolean, default: false },
  contextSessions: { type: [String], default: [] },
  contextMode:     {
    type: String,
    enum: ['continue', 'light', 'challenge', 'break', 'free'],
    default: 'continue',
  },

  // Lições aprendidas — feedback pós-execução
  lessons: { type: [String], default: [] },

  // Resultado
  consensusResult: { type: Schema.Types.Mixed, default: null },
  finalSummary:    { type: String, default: '' },  // resumo gerado pelo sintetizador
  synthesis:       { type: Schema.Types.Mixed, default: null }, // documento final

  // Objetivo do sintetizador
  synthesisObjective:  { type: String, default: '' },
  synthesizerId:       { type: String, default: 'claude' },

  // Custos
  totalCost:       { type: Number, default: 0 },
  tokenStats:      { type: Map, of: Schema.Types.Mixed, default: {} },

  // Status
  status:          { type: String, enum: ['running', 'paused', 'done', 'error'], default: 'running' },
  currentRound:    { type: Number, default: 0 },
  startedAt:       { type: Date, default: Date.now },
  endedAt:         { type: Date, default: null },
}, { timestamps: true });

// ── Message ───────────────────────────────────────────────────────────────────
// Cada mensagem do debate — texto COMPLETO, nunca truncado

const MessageSchema = new Schema({
  sessionId:   { type: String, required: true, index: true },
  agentId:     { type: String, required: true },
  agentName:   String,
  round:       { type: Number, default: 0 },
  text:        { type: String, required: true },  // COMPLETO — nunca truncar
  isHuman:     { type: Boolean, default: false },
  isJudge:     { type: Boolean, default: false },
  partial:     { type: Boolean, default: false }, // resposta interrompida
  whisper:     { type: Boolean, default: false },
  inputTokens:  { type: Number, default: 0 },
  outputTokens: { type: Number, default: 0 },
  model:       String,
  timestamp:   { type: Date, default: Date.now },
}, { timestamps: true });

// Index composto para buscar mensagens de uma sessão por ordem
MessageSchema.index({ sessionId: 1, round: 1, timestamp: 1 });

// ── SynthesisSection ──────────────────────────────────────────────────────────
// Cada seção do documento final gerada pelo sintetizador

const SynthesisSectionSchema = new Schema({
  sessionId:     { type: String, required: true, index: true },
  sectionIndex:  { type: Number, required: true },
  sectionTitle:  { type: String, required: true },
  content:       { type: String, required: true }, // texto completo da seção
  status:        { type: String, enum: ['pending', 'generating', 'done', 'error'], default: 'pending' },
  generatedAt:   { type: Date, default: null },
}, { timestamps: true });

SynthesisSectionSchema.index({ sessionId: 1, sectionIndex: 1 });

// ── Research ──────────────────────────────────────────────────────────────────
// URLs e conteúdo indexado por cenário organizacional

const ResearchSchema = new Schema({
  scenarioId:  { type: String, required: true, index: true },
  url:         { type: String, required: true },
  title:       { type: String, default: '' },
  content:     { type: String, required: true }, // texto completo extraído
  fetchedAt:   { type: Date, default: Date.now },
}, { timestamps: true });

ResearchSchema.index({ scenarioId: 1, url: 1 }, { unique: true });

// ── Exports ───────────────────────────────────────────────────────────────────

export const Session          = model('Session',          SessionSchema);
export const Message          = model('Message',          MessageSchema);
export const SynthesisSection = model('SynthesisSection', SynthesisSectionSchema);
export const Research         = model('Research',         ResearchSchema);
