/**
 * ─── UI CONFIGURATION ────────────────────────────────────────────────────────
 * Constantes de interface — delays, limites, textos fixos.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const UI_CONFIG = {

  speeds: [
    { label: '0s', value: 0,    description: 'Velocidade natural das IAs' },
    { label: '1s', value: 1000, description: '1 segundo entre rounds' },
    { label: '2s', value: 2000, description: '2 segundos entre rounds' },
    { label: '3s', value: 3000, description: '3 segundos entre rounds' },
  ],

  defaultSpeed:       0,
  defaultMaxRounds:   3,
  defaultModerator:   'claude',

  autoPauseAfterRound: true,

  // Score abaixo deste valor por N rounds consecutivos → alerta de kick
  scoreAlertThreshold: 4.0,
  scoreAlertRounds:    2,

  // Upload
  maxFileSizeBytes:    10 * 1024 * 1024, // 10MB
  supportedFileTypes:  ['.pdf', '.png', '.jpg', '.jpeg', '.md', '.json', '.csv', '.js', '.ts', '.py', '.txt'],

  // Chat
  maxMessagesVisible:  200,
  scrollBehavior:      'smooth',

  // Animações
  tokenStreamDelay:    0,   // ms entre tokens no frontend (0 = imediato)

  // Textos — centralizados para fácil tradução futura
  labels: {
    autopaused:          'Round completo · aguardando você',
    moderatorPaused:     'Moderador pausou o debate',
    interrupted:         '✂ resposta interrompida',
    whisperLabel:        '🔒 Mensagem privada',
    credentialsLabel:    '🔑 Instrução privada',
    you:                 'Você',
    moderator:           'Moderador',
    humanModerator:      'Você (moderador)',
    kicked:              'removida',
  },

};
