import 'dotenv/config';
import express   from 'express';
import cors      from 'cors';
import multer    from 'multer';
import { join }  from 'path';
import { API_CONFIG } from '../config/api.config.js';
import { connectDB }  from './db/connection.js';
import { installHttpLogger } from './utils/http-logger.js';
import debateRoutes    from './routes/debate.routes.js';
import sessionRoutes   from './routes/sessions.routes.js';
import agentRoutes     from './routes/agents.routes.js';
import executorRoutes  from './routes/executors.routes.js';
import researchRoutes  from './routes/research.routes.js';

// HTTP logger — intercepta todas as chamadas para APIs externas
installHttpLogger();

// Conecta ao MongoDB antes de aceitar requisições
await connectDB();

const app  = express();
const PORT = process.env.PORT ?? API_CONFIG.backendPort;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: `http://localhost:${API_CONFIG.frontendPort}` }));
app.use(express.json({ limit: '20mb' }));

// ── Logger ────────────────────────────────────────────────────────────────────
const COLORS = { GET: '\x1b[36m', POST: '\x1b[32m', PATCH: '\x1b[33m', DELETE: '\x1b[31m', PUT: '\x1b[35m' };
const RESET  = '\x1b[0m';
const DIM    = '\x1b[2m';

app.use((req, res, next) => {
  // Ignora SSE streaming e heartbeats — poluem demais o log
  if (req.path.includes('/stream')) return next();

  const start  = Date.now();
  const color  = COLORS[req.method] ?? '\x1b[37m';
  const method = `${color}${req.method.padEnd(6)}${RESET}`;

  res.on('finish', () => {
    const ms      = Date.now() - start;
    const status  = res.statusCode;
    const sCcolor = status >= 400 ? '\x1b[31m' : status >= 300 ? '\x1b[33m' : '\x1b[32m';
    const body    = req.body && Object.keys(req.body).length
      ? `${DIM} ${JSON.stringify(req.body).slice(0, 120)}${RESET}`
      : '';
    console.log(`  ${method} ${req.path} ${sCcolor}${status}${RESET} ${DIM}${ms}ms${RESET}${body}`);
  });

  next();
});

// ── File upload ───────────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 }, // 10MB
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const base64 = req.file.buffer.toString('base64');
  res.json({
    filename:  req.file.originalname,
    mimetype:  req.file.mimetype,
    size:      req.file.size,
    base64,
  });
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/debate',    debateRoutes);
app.use('/api/sessions',  sessionRoutes);
app.use('/api/agents',    agentRoutes);
app.use('/api/executors', executorRoutes);
app.use('/api/research',  researchRoutes);

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true, version: '1.0.0' }));

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  ◈ Council AI Backend`);
  console.log(`  Running at http://localhost:${PORT}\n`);
});
