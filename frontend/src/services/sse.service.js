/**
 * ─── SSE SERVICE ─────────────────────────────────────────────────────────────
 * Conexão Server-Sent Events com reconexão automática.
 * O EventSource nativo reconecta sozinho — só reporta erro após N falhas.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { API_CONFIG } from '../../../config/api.config.js';

export function connectSSE(sessionId, handlers) {
  const url = `${API_CONFIG.backendURL}${API_CONFIG.sseEndpoint}/${sessionId}`;

  let es             = null;
  let closed         = false;
  let errorCount     = 0;
  const seenIds      = new Set(); // deduplicação — evita processar evento duas vezes

  function connect() {
    if (closed) return;

    es = new EventSource(url);

    es.onopen = () => {
      errorCount = 0;
      handlers.reconnected?.();
    };

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);

        // Heartbeat — ignora
        if (data.event === 'heartbeat') return;

        // Deduplicação por msgId — evita duplicatas na reconexão automática
        if (data.msgId) {
          if (seenIds.has(data.msgId)) return;
          seenIds.add(data.msgId);
          // Mantém o Set pequeno — remove IDs antigos após 500 entradas
          if (seenIds.size > 500) {
            const first = seenIds.values().next().value;
            seenIds.delete(first);
          }
        }

        const handler = handlers[data.event];
        if (handler) handler(data);
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      errorCount++;
      if (errorCount >= 5) {
        handlers.error?.({ message: 'SSE connection lost — recarregue a página se necessário' });
      }
    };
  }

  connect();

  return {
    close: () => {
      closed = true;
      es?.close();
    },
  };
}
