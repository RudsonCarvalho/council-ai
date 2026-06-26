/**
 * ─── REPORT GENERATOR ────────────────────────────────────────────────────────
 * Gera relatório técnico (.md) e ata de sessão (.md).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { AGENTS_CONFIG } from '../../config/agents.config.js';

export function generateReport(session, consensusResult, scores) {
  const totalCost   = calculateTotalCost(session.allResponses);
  const duration    = getDuration(session.startedAt);
  const participants = session.agentIds.filter(id => !session.kickedAgents?.has(id));

  let md = `# Relatório de Sessão — ${generateTitle(session.problem)}\n`;
  md += `**Data:** ${formatDate(session.startedAt)}  \n`;
  md += `**Início:** ${formatTime(session.startedAt)}  `;
  md += `**Duração:** ${duration}  \n`;
  md += `**Custo total:** $${totalCost.toFixed(4)}\n\n`;
  md += `---\n\n`;

  md += `## Problema\n${session.problem}\n\n`;

  md += `## Participantes\n`;
  md += `| IA | Score final | Tokens | Custo |\n`;
  md += `|---|---|---|---|\n`;
  participants.forEach(id => {
    const cfg   = AGENTS_CONFIG[id];
    const score = scores[id]?.average ?? '—';
    const tokens = countTokensForAgent(session.allResponses, id);
    const cost   = calculateCostForAgent(session.allResponses, id);
    md += `| ${cfg?.icon ?? ''} ${cfg?.name ?? id} (${cfg?.company ?? ''}) | ${score} | ${tokens} | $${cost.toFixed(4)} |\n`;
  });
  md += `\n**Moderador:** ${AGENTS_CONFIG[session.moderatorId]?.name ?? session.moderatorId}\n\n`;

  md += `## Histórico completo do debate\n\n`;
  const rounds = groupByRound(session.allResponses);
  Object.entries(rounds).forEach(([round, responses]) => {
    md += `### Round ${round}\n\n`;
    responses.forEach(r => {
      const label = r.isHuman ? `**Você (moderador)**` : `**${r.agentName}**`;
      md += `${label}:\n${r.text}\n`;
      if (r.partial) md += `*✂ resposta interrompida*\n`;
      md += `\n`;
    });
  });

  if (consensusResult) {
    md += `## Resultado\n`;
    md += `**Consenso:** ${consensusResult.consensus ? `Atingido (confiança: ${Math.round(consensusResult.confidence * 100)}%)` : 'Não atingido'}\n\n`;
    md += `**Resumo:** ${consensusResult.summary}\n\n`;

    if (consensusResult.agreement_points?.length > 0) {
      md += `**Pontos de acordo:**\n`;
      consensusResult.agreement_points.forEach(p => { md += `- ${p}\n`; });
      md += `\n`;
    }

    if (consensusResult.spec) {
      md += `## Especificação técnica gerada\n\n${consensusResult.spec}\n\n`;
    }
  }

  return md;
}

export function generateMinutes(session, consensusResult) {
  const participants  = session.agentIds.filter(id => !session.kickedAgents?.has(id));
  const humanMessages = session.allResponses.filter(r => r.isHuman);
  const rounds        = groupByRound(session.allResponses.filter(r => !r.isHuman));

  let md = `# Ata de Sessão — ${generateTitle(session.problem)}\n`;
  md += `**Data:** ${formatDate(session.startedAt)}  \n`;
  md += `**Horário:** ${formatTime(session.startedAt)}`;
  if (session.endedAt) md += ` – ${formatTime(session.endedAt)}`;
  md += `  **Duração:** ${getDuration(session.startedAt)}\n\n---\n\n`;

  md += `## Presentes\n`;
  participants.forEach(id => {
    const cfg = AGENTS_CONFIG[id];
    const model = session.modelOverrides?.[id] ?? cfg?.model ?? '';
    md += `- ${cfg?.icon ?? ''} **${cfg?.name ?? id}** (${cfg?.company ?? ''})${model ? ` — ${model}` : ''}\n`;
  });
  md += `- **Você** — moderador humano\n`;
  md += `- **${AGENTS_CONFIG[session.moderatorId]?.name ?? session.moderatorId}** — juiz moderador\n\n`;

  md += `## Problema discutido\n\n${session.problem}\n\n`;

  md += `## O que foi discutido — por round\n\n`;
  Object.entries(rounds).sort((a, b) => Number(a[0]) - Number(b[0])).forEach(([round, responses]) => {
    md += `### Round ${round}\n\n`;

    // Intervenção do moderador humano neste round
    const humanInRound = humanMessages.filter(m => m.round === Number(round));
    if (humanInRound.length > 0) {
      humanInRound.forEach(m => {
        md += `> 🧑 **Moderador:** ${m.text}\n\n`;
      });
    }

    // O que cada IA disse — resumido nas primeiras 200 chars + indicador
    responses.forEach(r => {
      const cfg     = AGENTS_CONFIG[r.agentId];
      const preview = r.text?.length > 300
        ? r.text.slice(0, 300).replace(/\n/g, ' ').trim() + '...'
        : r.text?.replace(/\n/g, ' ').trim();
      md += `**${cfg?.icon ?? ''} ${r.agentName}:**\n${preview}\n`;
      if (r.partial) md += `*✂ interrompido*\n`;
      md += `\n`;
    });
  });

  if (consensusResult?.agreement_points?.length > 0) {
    md += `## Pontos de acordo\n`;
    consensusResult.agreement_points.forEach(p => { md += `- ${p}\n`; });
    md += `\n`;
  }

  if (consensusResult?.disagreement_points?.length > 0) {
    md += `## Divergências identificadas\n`;
    consensusResult.disagreement_points.forEach(p => { md += `- ${p}\n`; });
    md += `\n`;
  }

  if (consensusResult) {
    md += `## Resultado\n`;
    md += consensusResult.consensus
      ? `✓ Consenso atingido no round ${session.currentRound} com confiança de ${Math.round(consensusResult.confidence * 100)}%\n\n`
      : `— Debate encerrado sem consenso após ${session.currentRound} round(s)\n\n`;
    if (consensusResult.summary) {
      md += `**Síntese:** ${consensusResult.summary}\n\n`;
    }
    if (consensusResult.spec) {
      md += `## Especificação gerada\n\n${consensusResult.spec}\n\n`;
    }
  }

  if (humanMessages.length > 0) {
    md += `## Intervenções do moderador\n`;
    humanMessages.forEach(m => {
      md += `- Round ${m.round}: "${m.text}"\n`;
    });
    md += `\n`;
  }

  return md;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateTitle(problem) {
  return problem.slice(0, 60).replace(/[^\w\s]/g, '').trim() + (problem.length > 60 ? '...' : '');
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('pt-BR');
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function getDuration(startedAt) {
  const ms = Date.now() - new Date(startedAt).getTime();
  const mins = Math.floor(ms / 60000);
  return mins < 1 ? 'menos de 1 minuto' : `${mins} minuto${mins > 1 ? 's' : ''}`;
}

function groupByRound(responses) {
  return responses.reduce((acc, r) => {
    if (!acc[r.round]) acc[r.round] = [];
    acc[r.round].push(r);
    return acc;
  }, {});
}

function countTokensForAgent(responses, agentId) {
  return responses
    .filter(r => r.agentId === agentId)
    .reduce((sum, r) => sum + (r.inputTokens ?? 0) + (r.outputTokens ?? 0), 0);
}

function calculateCostForAgent(responses, agentId) {
  const cfg = AGENTS_CONFIG[agentId];
  if (!cfg) return 0;
  return responses
    .filter(r => r.agentId === agentId)
    .reduce((sum, r) => {
      const inputCost  = ((r.inputTokens  ?? 0) / 1000) * cfg.costPer1kTokens.input;
      const outputCost = ((r.outputTokens ?? 0) / 1000) * cfg.costPer1kTokens.output;
      return sum + inputCost + outputCost;
    }, 0);
}

function calculateTotalCost(responses) {
  return responses.reduce((sum, r) => {
    const cfg = AGENTS_CONFIG[r.agentId];
    if (!cfg) return sum;
    const inputCost  = ((r.inputTokens  ?? 0) / 1000) * cfg.costPer1kTokens.input;
    const outputCost = ((r.outputTokens ?? 0) / 1000) * cfg.costPer1kTokens.output;
    return sum + inputCost + outputCost;
  }, 0);
}
