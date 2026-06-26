import express from 'express';
import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { EXECUTORS_CONFIG } from '../../config/executors.config.js';
import { storeCredentials }  from '../services/storage.service.js';

const router = express.Router();

router.get('/', (req, res) => {
  const executors = Object.entries(EXECUTORS_CONFIG)
    .filter(([, cfg]) => cfg.enabled)
    .map(([id, cfg]) => ({ id, name: cfg.name, icon: cfg.icon, color: cfg.color,
                            type: cfg.type, description: cfg.description, status: 'online' }));
  res.json(executors);
});

router.post('/:id/credentials', (req, res) => {
  const { sessionId, credentials } = req.body;
  storeCredentials(sessionId, req.params.id, credentials);
  res.json({ ok: true });
});

router.post('/:id/execute', async (req, res) => {
  const { spec, workDir = process.cwd() } = req.body;
  const cfg = EXECUTORS_CONFIG[req.params.id];
  if (!cfg) return res.status(404).json({ error: 'Executor not found' });

  const tmpFile = join(tmpdir(), `spec-${Date.now()}.md`);
  await writeFile(tmpFile, spec, 'utf8');

  const command = `${cfg.command} ${cfg.args.join(' ')} "$(cat ${tmpFile})"`;

  const proc = spawn('sh', ['-c', command], { cwd: workDir, stdio: ['ignore','pipe','pipe'] });
  let stdout = '', stderr = '';
  proc.stdout.on('data', d => { stdout += d.toString(); });
  proc.stderr.on('data', d => { stderr += d.toString(); });
  proc.on('close', async (code) => {
    await unlink(tmpFile).catch(() => {});
    res.json({ success: code === 0, exitCode: code, stdout, stderr });
  });
  proc.on('error', async (err) => {
    await unlink(tmpFile).catch(() => {});
    res.status(500).json({ error: err.message });
  });
});

export default router;
