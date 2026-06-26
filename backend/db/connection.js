/**
 * ─── MONGODB CONNECTION ───────────────────────────────────────────────────────
 * Singleton de conexão. Importar este módulo em qualquer serviço que precise
 * do banco — a conexão é estabelecida uma única vez.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/ai-debate-platform';

let connected = false;

export async function connectDB() {
  if (connected) return;
  try {
    await mongoose.connect(MONGO_URI);
    connected = true;
    console.log('  ◈ MongoDB conectado:', MONGO_URI);
  } catch (err) {
    console.error('  ✕ MongoDB erro de conexão:', err.message);
    console.error('    Verifique se o MongoDB está rodando: mongosh --eval "db.runCommand({ connectionStatus: 1 })"');
    process.exit(1);
  }
}

export { mongoose };
