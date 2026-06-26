import express from 'express';
import { fetchUrl, listResearchFiles, loadResearchFile, deleteResearchFile } from '../services/research.service.js';

const router = express.Router();

// GET /api/research?scenarioId=financial — lista (filtrado ou todos)
router.get('/', async (req, res) => {
  const { scenarioId } = req.query;
  res.json(await listResearchFiles(scenarioId || null));
});

// POST /api/research/fetch
router.post('/fetch', async (req, res) => {
  const { url, scenarioId } = req.body;
  if (!url?.trim()) return res.status(400).json({ error: 'URL required' });
  try {
    res.json(await fetchUrl(url.trim(), scenarioId || 'custom'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/research/:scenarioId/:filename
router.get('/:scenarioId/:filename', async (req, res) => {
  try {
    const content = await loadResearchFile(req.params.filename, req.params.scenarioId);
    res.json({ content });
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

// DELETE /api/research/:scenarioId/:filename
router.delete('/:scenarioId/:filename', async (req, res) => {
  await deleteResearchFile(req.params.filename, req.params.scenarioId);
  res.json({ ok: true });
});

export default router;
