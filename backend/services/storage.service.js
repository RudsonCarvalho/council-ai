/**
 * ─── STORAGE SERVICE (MongoDB) ────────────────────────────────────────────────
 * ÚNICO ponto de acesso ao banco. Todos os outros serviços chamam este.
 * Nada é truncado — texto sempre completo.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Session, Message, SynthesisSection, Research } from '../db/models.js';

// ── Sessions ──────────────────────────────────────────────────────────────────

export async function saveSession(sessionId, data) {
  await Session.findOneAndUpdate(
    { sessionId },
    { ...data, sessionId },
    { upsert: true, new: true }
  );
}

export async function loadSession(sessionId) {
  const session = await Session.findOne({ sessionId }).lean();
  if (!session) throw new Error(`Session ${sessionId} not found`);
  return session;
}

export async function updateSession(sessionId, updates) {
  await Session.findOneAndUpdate({ sessionId }, updates);
}

export async function listSessions() {
  return Session.find({}).sort({ startedAt: -1 }).select('-__v').lean();
}

export async function deleteSession(sessionId) {
  await Promise.all([
    Session.deleteOne({ sessionId }),
    Message.deleteMany({ sessionId }),
    SynthesisSection.deleteMany({ sessionId }),
  ]);
}

// ── Messages ──────────────────────────────────────────────────────────────────

export async function saveMessage(sessionId, msg) {
  const doc = new Message({
    sessionId,
    agentId:      msg.agentId,
    agentName:    msg.agentName,
    round:        msg.round ?? 0,
    text:         msg.text,
    isHuman:      msg.isHuman  ?? false,
    isJudge:      msg.isJudge  ?? false,
    partial:      msg.partial  ?? false,
    whisper:      msg.whisper  ?? false,
    inputTokens:  msg.inputTokens  ?? 0,
    outputTokens: msg.outputTokens ?? 0,
    model:        msg.model ?? null,
  });
  return doc.save();
}

export async function loadMessages(sessionId) {
  return Message.find({ sessionId }).sort({ round: 1, timestamp: 1 }).lean();
}

export async function loadMessagesByRound(sessionId, round) {
  return Message.find({ sessionId, round }).sort({ timestamp: 1 }).lean();
}

// ── Synthesis sections ────────────────────────────────────────────────────────

export async function saveSynthesisSection(sessionId, sectionIndex, sectionTitle, content) {
  await SynthesisSection.findOneAndUpdate(
    { sessionId, sectionIndex },
    { sessionId, sectionIndex, sectionTitle, content, status: 'done', generatedAt: new Date() },
    { upsert: true, new: true }
  );
}

export async function loadSynthesisSections(sessionId) {
  return SynthesisSection.find({ sessionId }).sort({ sectionIndex: 1 }).lean();
}

export async function getSynthesisDocument(sessionId) {
  const sections = await loadSynthesisSections(sessionId);
  return sections.map(s => `## ${s.sectionTitle}\n\n${s.content}`).join('\n\n---\n\n');
}

// ── Research ──────────────────────────────────────────────────────────────────

export async function saveResearch(scenarioId, url, title, content) {
  await Research.findOneAndUpdate(
    { scenarioId, url },
    { scenarioId, url, title, content, fetchedAt: new Date() },
    { upsert: true, new: true }
  );
}

export async function loadResearch(scenarioId) {
  return Research.find({ scenarioId }).sort({ fetchedAt: -1 }).lean();
}

export async function deleteResearch(scenarioId, url) {
  await Research.deleteOne({ scenarioId, url });
}

// ── Knowledge base ────────────────────────────────────────────────────────────

export async function findKnowledgeSessions({ theme, tags, limit = 5 } = {}) {
  const query = { isKnowledgeBase: true, status: 'done' };
  if (theme) query.theme = { $regex: theme, $options: 'i' };
  if (tags?.length) query.tags = { $in: tags };
  return Session
    .find(query)
    .sort({ startedAt: -1 })
    .limit(limit)
    .select('sessionId theme tags finalSummary consensusResult startedAt problem')
    .lean();
}

export async function getSessionContext(sessionId, mode) {
  const session = await loadSession(sessionId);
  const modeInstructions = {
    continue:  'Build on this previous session. Continue and refine what was decided. Do NOT restart from zero.',
    light:     'Use this as background reference only. You are free to explore new directions.',
    challenge: 'You know what was decided before. Find flaws and propose better alternatives.',
    break:     'This is what was decided before. IGNORE this path and propose something completely different.',
    free:      null,
  };
  const instruction = modeInstructions[mode];
  if (!instruction) return null;
  const summary = session.finalSummary || session.consensusResult?.summary || '';
  return [
    `=== CONTEXTO DE SESSÃO ANTERIOR ===`,
    `Tema: ${session.theme || session.problem?.slice(0, 80)}`,
    `Data: ${new Date(session.startedAt).toLocaleDateString('pt-BR')}`,
    summary ? `Resumo: ${summary}` : null,
    session.consensusResult?.agreement_points?.length
      ? `Decisões: ${session.consensusResult.agreement_points.join('; ')}` : null,
    session.consensusResult?.disagreement_points?.length
      ? `Em aberto: ${session.consensusResult.disagreement_points.join('; ')}` : null,
    ``,
    `INSTRUÇÃO: ${instruction}`,
    `=== FIM DO CONTEXTO ===`,
  ].filter(Boolean).join('\n');
}

// ── Vault ─────────────────────────────────────────────────────────────────────

const vaultMemory = new Map();
export function storeCredentials(sessionId, executorId, credentials) {
  if (!vaultMemory.has(sessionId)) vaultMemory.set(sessionId, {});
  vaultMemory.get(sessionId)[executorId] = credentials;
}
export function getCredentials(sessionId, executorId) {
  return vaultMemory.get(sessionId)?.[executorId] ?? null;
}
export function clearCredentials(sessionId) {
  vaultMemory.delete(sessionId);
}

// ── Legacy compat ─────────────────────────────────────────────────────────────

export async function saveSessionFile(sessionId, filename, content) {
  const fieldMap = { 'report.md': 'reportMarkdown', 'minutes.md': 'minutesMarkdown' };
  const field = fieldMap[filename];
  if (field) await Session.findOneAndUpdate({ sessionId }, { [field]: content });
}

export async function loadSessionFile(sessionId, filename) {
  const session = await loadSession(sessionId);
  const fieldMap = { 'report.md': 'reportMarkdown', 'minutes.md': 'minutesMarkdown' };
  const field = fieldMap[filename];
  if (field && session[field]) return session[field];
  throw new Error(`File ${filename} not found for session ${sessionId}`);
}

export async function listTemplates() {
  return Session.find({ isTemplate: true }).sort({ createdAt: -1 }).lean();
}

export async function saveTemplate(name, data) {
  const t = new Session({ ...data, isTemplate: true, templateName: name, status: 'done' });
  await t.save();
  return t.sessionId;
}

export async function deleteTemplate(templateId) {
  await Session.deleteOne({ sessionId: templateId, isTemplate: true });
}
