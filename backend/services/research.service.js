/**
 * ─── RESEARCH SERVICE ────────────────────────────────────────────────────────
 * Fetch de URLs e armazenamento organizado por cenário organizacional.
 * Estrutura: storage/research/[scenarioId]/[domain]-[timestamp].txt
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs   from 'fs/promises';
import path from 'path';
import https from 'https';
import http  from 'http';

const RESEARCH_DIR    = './storage/research';
const MAX_CONTENT_CHARS = 12000;

await fs.mkdir(RESEARCH_DIR, { recursive: true });

// ── Fetch de URL ──────────────────────────────────────────────────────────────

export async function fetchUrl(url, scenarioId = 'custom') {
  const raw  = await downloadUrl(url);
  const text = extractText(raw).slice(0, MAX_CONTENT_CHARS);

  // Garante pasta do cenário
  const dir = path.join(RESEARCH_DIR, scenarioId);
  await fs.mkdir(dir, { recursive: true });

  const domain   = new URL(url).hostname.replace(/[^a-z0-9]/gi, '-');
  const filename = `${domain}-${Date.now()}.txt`;
  const filepath = path.join(dir, filename);

  await fs.writeFile(filepath, `URL: ${url}\nSCENARIO: ${scenarioId}\n${'─'.repeat(60)}\n${text}`, 'utf8');

  return {
    url, filename, scenarioId,
    content: text,
    chars:   text.length,
    savedAt: new Date().toISOString(),
  };
}

// ── Listar arquivos ───────────────────────────────────────────────────────────

/**
 * Lista arquivos de um cenário específico ou de todos os cenários.
 * @param {string|null} scenarioId — null = todos
 */
export async function listResearchFiles(scenarioId = null) {
  try {
    const dirs = scenarioId
      ? [scenarioId]
      : await fs.readdir(RESEARCH_DIR);

    const results = [];

    for (const dir of dirs) {
      const dirPath = path.join(RESEARCH_DIR, dir);
      const stat    = await fs.stat(dirPath).catch(() => null);
      if (!stat?.isDirectory()) continue;

      const files = await fs.readdir(dirPath).catch(() => []);

      for (const f of files.filter(f => f.endsWith('.txt'))) {
        try {
          const fullPath  = path.join(dirPath, f);
          const fileStat  = await fs.stat(fullPath);
          const firstLines = (await fs.readFile(fullPath, 'utf8')).split('\n');
          const url = firstLines[0].replace('URL: ', '');
          results.push({
            filename:   f,
            scenarioId: dir,
            url,
            size:    fileStat.size,
            savedAt: fileStat.mtime.toISOString(),
          });
        } catch { /* skip */ }
      }
    }

    return results.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
  } catch {
    return [];
  }
}

export async function loadResearchFile(filename, scenarioId = 'custom') {
  const content = await fs.readFile(path.join(RESEARCH_DIR, scenarioId, filename), 'utf8');
  return content.split('\n').slice(3).join('\n'); // remove cabeçalho URL/SCENARIO/divider
}

export async function deleteResearchFile(filename, scenarioId = 'custom') {
  await fs.unlink(path.join(RESEARCH_DIR, scenarioId, filename));
}

// ── Monta contexto unificado ──────────────────────────────────────────────────

export function buildResearchContext(sources) {
  if (!sources?.length) return null;
  const parts = sources.map((s, i) =>
    `=== FONTE ${i + 1}: ${s.url ?? s.filename} ===\n${s.content}`
  );
  return `${'='.repeat(60)}\nMATERIAL DE REFERÊNCIA\n${'='.repeat(60)}\n${parts.join('\n\n')}\n${'='.repeat(60)}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function downloadUrl(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.get(url, {
      headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; CouncilAI/1.0)',
        'Accept':     'text/html,text/plain',
      },
      timeout: 15000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadUrl(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; if (data.length > 500000) req.destroy(); });
      res.on('end',  () => resolve(data));
      res.on('error', reject);
    });
    req.on('error',   reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function extractText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<\/?(p|div|br|h[1-6]|li|tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
