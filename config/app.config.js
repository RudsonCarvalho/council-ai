/**
 * ─── APP CONFIGURATION ───────────────────────────────────────────────────────
 * Configurações gerais da aplicação.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const APP_CONFIG = {

  name:    'AI Debate Platform',
  version: '1.0.0',

  // Armazenamento local
  // IMPORTANTE: Apenas storage.service.js acessa o disco diretamente.
  // Todos os outros serviços chamam storage.service.js.
  // Isso garante que trocar o storage (ex: S3) seja mudança em um único arquivo.
  storagePath: './storage',
  paths: {
    sessions:  './storage/sessions',
    templates: './storage/templates',
    vault:     './storage/vault',
  },

  // Relatórios
  reportFormats: ['md'],   // extensível para 'pdf', 'html' no futuro

  // Debate
  minAgentsForDebate: 2,
  maxRoundsLimit:     10,

  // Ambiente
  isDev: process.env.NODE_ENV !== 'production',

};
