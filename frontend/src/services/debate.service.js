/**
 * ─── DEBATE SERVICE (Frontend) ───────────────────────────────────────────────
 * Toda comunicação com o backend — nunca nos componentes diretamente.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { API_CONFIG } from '../../../config/api.config.js';

const BASE = API_CONFIG.backendURL;

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? 'Request failed');
  }
  return res.json();
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} failed`);
  return res.json();
}

// ── Setup ─────────────────────────────────────────────────────────────────────

export async function fetchAgents() {
  return get('/api/agents');
}

export async function fetchExecutors() {
  return get('/api/executors');
}

// ── Session lifecycle ─────────────────────────────────────────────────────────

export async function startDebate({ problem, agentIds, moderatorId, speed, briefings, modelOverrides }) {
  return post('/api/debate/start', { problem, agentIds, moderatorId, speed, briefings, modelOverrides });
}

export async function pauseDebate(sessionId) {
  return post(`/api/debate/${sessionId}/pause`, {});
}

export async function resumeDebate(sessionId) {
  return post(`/api/debate/${sessionId}/resume`, {});
}

export async function setDebateSpeed(sessionId, speed) {
  return post(`/api/debate/${sessionId}/speed`, { speed });
}

export async function finishDebate(sessionId, { consensusResult, scores }) {
  return post(`/api/debate/${sessionId}/finish`, { consensusResult, scores });
}

// ── Moderation ────────────────────────────────────────────────────────────────

export async function sendOpinion(sessionId, opinion) {
  return post(`/api/debate/${sessionId}/opinion`, { opinion });
}

export async function sendWhisper(sessionId, agentId, message) {
  return post(`/api/debate/${sessionId}/whisper`, { agentId, message });
}

export async function kickAgent(sessionId, agentId) {
  return post(`/api/debate/${sessionId}/kick`, { agentId });
}

export async function unkickAgent(sessionId, agentId) {
  return post(`/api/debate/${sessionId}/unkick`, { agentId });
}

export async function changeModerator(sessionId, moderatorId) {
  return post(`/api/debate/${sessionId}/moderator`, { moderatorId });
}

// ── Executor ──────────────────────────────────────────────────────────────────

export async function executeSpec(executorId, { spec, workDir }) {
  return post(`/api/executors/${executorId}/execute`, { spec, workDir });
}

export async function storeExecutorCredentials(executorId, sessionId, credentials) {
  return post(`/api/executors/${executorId}/credentials`, { sessionId, credentials });
}

// ── File upload ───────────────────────────────────────────────────────────────

export async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${BASE}/api/upload`, { method: 'POST', body: formData });
  if (!res.ok) throw new Error('Upload failed');
  return res.json();
}

// ── Sessions & Templates ──────────────────────────────────────────────────────

export async function fetchSessions() {
  return get('/api/sessions');
}

export async function fetchSession(id) {
  return get(`/api/sessions/${id}`);
}

export async function deleteSession(id) {
  const res = await fetch(`${BASE}/api/sessions/${id}`, { method: 'DELETE' });
  return res.json();
}

export async function fetchTemplates() {
  return get('/api/sessions/templates/all');
}

export async function saveTemplate(name, config) {
  return post('/api/sessions/templates', { name, ...config });
}

export async function deleteTemplate(filename) {
  const res = await fetch(`${BASE}/api/sessions/templates/${filename}`, { method: 'DELETE' });
  return res.json();
}

// ── Research ──────────────────────────────────────────────────────────────────

export async function fetchResearchUrl(url, scenarioId = 'custom') {
  return post('/api/research/fetch', { url, scenarioId });
}

export async function listResearchFiles(scenarioId = null) {
  const qs = scenarioId ? `?scenarioId=${scenarioId}` : '';
  return get(`/api/research${qs}`);
}

export async function deleteResearchFile(filename, scenarioId = 'custom') {
  const res = await fetch(`${BASE}/api/research/${scenarioId}/${filename}`, { method: 'DELETE' });
  return res.json();
}

export async function loadResearchFileContent(filename, scenarioId = 'custom') {
  return get(`/api/research/${scenarioId}/${filename}`);
}

// ── Session resume ────────────────────────────────────────────────────────────

export async function getSessionCapacity(sessionId) {
  return get(`/api/sessions/${sessionId}/capacity`);
}

export async function continueSession(sessionId) {
  return post(`/api/sessions/${sessionId}/continue`, {});
}

export async function newSessionWithSummary(sessionId) {
  return post(`/api/sessions/${sessionId}/new-with-summary`, {});
}

// ── Agent connection test ─────────────────────────────────────────────────────

export async function testAgentConnections(modelOverrides = {}) {
  return post('/api/agents/test', { modelOverrides });
}
