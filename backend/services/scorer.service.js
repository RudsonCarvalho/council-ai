/**
 * ─── SCORER SERVICE ──────────────────────────────────────────────────────────
 * Avalia a contribuição de cada IA por round (0–10).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import Anthropic from '@anthropic-ai/sdk';
import { AGENTS_CONFIG } from '../../config/agents.config.js';
import { UI_CONFIG } from '../../config/ui.config.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SCORER_SYSTEM = `You are evaluating the quality of contributions from different AI models in a technical debate.

Score each AI response from 0 to 10 based on:
- Relevance to the problem (0-3 points)
- Originality and unique perspective (0-3 points)  
- Technical quality and accuracy (0-2 points)
- Quality of agreement/disagreement reasoning (0-2 points)

Respond ONLY with valid JSON — no markdown, no backticks:
{
  "scores": {
    "agentId": { "score": 8.5, "reason": "brief reason" }
  }
}`;

export async function scoreRound(problem, roundResponses) {
  if (!roundResponses || roundResponses.length === 0) return {};

  const aiResponses = roundResponses.filter(r => !r.isHuman && !r.partial);
  if (aiResponses.length === 0) return {};

  const context = `PROBLEM: ${problem}\n\nROUND RESPONSES:\n\n` +
    aiResponses.map(r => `[${r.agentName} (id: ${r.agentId})]:\n${r.text}`).join('\n\n---\n\n');

  try {
    const response = await client.messages.create({
      model:      AGENTS_CONFIG.claude.model,
      max_tokens: 1024,
      system:     SCORER_SYSTEM,
      messages:   [{ role: 'user', content: context }],
    });

    const raw = response.content[0].text.trim();
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    return parsed.scores ?? {};

  } catch {
    // Se falhar, retorna scores neutros
    return aiResponses.reduce((acc, r) => ({
      ...acc,
      [r.agentId]: { score: 5.0, reason: 'Score unavailable' },
    }), {});
  }
}

export function calculateCumulativeScores(allRoundScores) {
  const agentScores = {};

  allRoundScores.forEach(roundScores => {
    Object.entries(roundScores).forEach(([agentId, data]) => {
      if (!agentScores[agentId]) agentScores[agentId] = { total: 0, count: 0 };
      agentScores[agentId].total += data.score;
      agentScores[agentId].count += 1;
    });
  });

  return Object.entries(agentScores).reduce((acc, [agentId, data]) => ({
    ...acc,
    [agentId]: {
      average:         parseFloat((data.total / data.count).toFixed(1)),
      roundCount:      data.count,
      alertKick:       (data.total / data.count) < UI_CONFIG.scoreAlertThreshold,
    },
  }), {});
}
