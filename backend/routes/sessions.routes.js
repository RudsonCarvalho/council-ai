import express from 'express';
import {
  listSessions, loadSession, deleteSession, loadMessages,
  loadSessionFile, listTemplates, saveTemplate, deleteTemplate,
  findKnowledgeSessions, updateSession,
} from '../services/storage.service.js';
import { getSession } from '../services/orchestrator.service.js';

const router = express.Router();

// ── GET /api/sessions — lista todas as sessões ────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const sessions = await listSessions();
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/sessions/:id — detalhes de uma sessão ───────────────────────────
router.get('/:id', async (req, res) => {
  try {
    res.json(await loadSession(req.params.id));
  } catch {
    res.status(404).json({ error: 'Session not found' });
  }
});

// ── GET /api/sessions/:id/messages — histórico completo ──────────────────────
router.get('/:id/messages', async (req, res) => {
  try {
    const messages = await loadMessages(req.params.id);
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/sessions/:id ──────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    await deleteSession(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/sessions/:id — atualiza tema, tags, isKnowledgeBase ───────────
router.patch('/:id', async (req, res) => {
  try {
    const { theme, tags, isKnowledgeBase } = req.body;
    const updates = {};
    if (theme !== undefined)           updates.theme = theme;
    if (tags !== undefined)            updates.tags = tags;
    if (isKnowledgeBase !== undefined) updates.isKnowledgeBase = isKnowledgeBase;
    await updateSession(req.params.id, updates);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/sessions/:id/report ─────────────────────────────────────────────
router.get('/:id/report', async (req, res) => {
  try {
    const content = await loadSessionFile(req.params.id, 'report.md');
    res.setHeader('Content-Type', 'text/markdown');
    res.send(content);
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

// ── GET /api/sessions/:id/minutes ─────────────────────────────────────────────
router.get('/:id/minutes', async (req, res) => {
  try {
    const content = await loadSessionFile(req.params.id, 'minutes.md');
    res.setHeader('Content-Type', 'text/markdown');
    res.send(content);
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

// ── GET /api/sessions/knowledge — sessões marcadas como knowledge base ────────
router.get('/knowledge/search', async (req, res) => {
  try {
    const { theme, tags } = req.query;
    const results = await findKnowledgeSessions({
      theme,
      tags: tags ? tags.split(',') : [],
    });
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Templates ─────────────────────────────────────────────────────────────────
router.get('/templates/all', async (req, res) => {
  try {
    res.json(await listTemplates());
  } catch { res.json([]); }
});

router.post('/templates', async (req, res) => {
  try {
    const { name, ...config } = req.body;
    const id = await saveTemplate(name, config);
    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/templates/:id', async (req, res) => {
  try {
    await deleteTemplate(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
