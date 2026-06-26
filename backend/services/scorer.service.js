/**
 * ─── SCORER SERVICE ──────────────────────────────────────────────────────────
 * Avalia cada IA em 3 métricas por round:
 *   - Novidade:     trouxe algo genuinamente novo?
 *   - Praticidade:  é implementável / acionável?
 *   - Solidez:      resistiu às críticas / argumentação robusta?
 * ─────────────────────────────────────────────────────────────────────────────
 */

import Anthropic from '@anthropic-ai/sdk';
import { JUDGE_MODEL } from '../../config/agents.config.js';
import { UI_CONFIG }   from '../../config/ui.config.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SCORER_SYSTEM = `Score each AI contribution on 3 dimensions (0-10 each).
Respond ONLY with JSON starting with {, no markdown:

{
  "scores": {
    "agentId": {
      "novelty":       7,
      "practicality":  8,
      "robustness":    6
    }
  }
}

Definitions:
- novelty (0-10):       Did this response bring genuinely new information, perspective or argument not said before?
- practicality (0-10):  Is the proposal concrete and implementable? Can an engineer act on it tomorrow?
- robustness (0-10):    Did the argument hold up to criticism? Is the reasoning solid and well-supported?

Be strict. 10 = exceptional. 5 = average. 0 = nothing useful.`;

export async function scoreRound(problem, roundResponses, adversaryResponses = []) {
  if (!roundResponses?.length) return {};

  const aiResponses = roundResponses.filter(r => !r.isHuman && !r.partial && !r.isAdversary);
  if (!aiResponses.length) return {};

  // Trunca para não inflar o contexto do scorer
  let context = `PROBLEM: ${problem.slice(0, 150)}\n\nROUND RESPONSES:\n\n`;
  aiResponses.forEach(r => {
    context += `[${r.agentName} (id: ${r.agentId})]:\n${r.text.slice(0, 300)}\n\n`;
  });

  // Inclui críticas do adversário se houver — para avaliar solidez
  if (adversaryResponses.length > 0) {
    context += `ADVERSARY CHALLENGES:\n`;
    adversaryResponses.forEach(r => {
      context += `${r.text.slice(0, 200)}\n`;
    });
  }

  try {
    const response = await client.messages.create({
      model:      JUDGE_MODEL,
      max_tokens: 400,
      system:     SCORER_SYSTEM,
      messages:   [{ role: 'user', content: context }],
    });

    const raw    = response.content[0].text.trim();
    const clean  = raw.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    const start  = clean.indexOf('{');
    const end    = clean.lastIndexOf('}');
    const parsed = JSON.parse(clean.slice(start, end + 1));
    return parsed.scores ?? {};

  } catch {
    return aiResponses.reduce((acc, r) => ({
      ...acc,
      [r.agentId]: { novelty: 5, practicality: 5, robustness: 5 },
    }), {});
  }
}

export function calculateCumulativeScores(allRoundScores) {
  const agentData = {};

  allRoundScores.forEach(roundScores => {
    Object.entries(roundScores).forEach(([agentId, data]) => {
      if (!agentData[agentId]) agentData[agentId] = { novelty: [], practicality: [], robustness: [] };
      if (data.novelty      != null) agentData[agentId].novelty.push(data.novelty);
      if (data.practicality != null) agentData[agentId].practicality.push(data.practicality);
      if (data.robustness   != null) agentData[agentId].robustness.push(data.robustness);
    });
  });

  const avg = arr => arr.length ? parseFloat((arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(1)) : null;

  return Object.entries(agentData).reduce((acc, [agentId, d]) => {
    const n = avg(d.novelty);
    const p = avg(d.practicality);
    const r = avg(d.robustness);
    const overall = (n != null && p != null && r != null)
      ? parseFloat(((n + p + r) / 3).toFixed(1))
      : null;
    return {
      ...acc,
      [agentId]: {
        novelty:      n,
        practicality: p,
        robustness:   r,
        average:      overall,
        roundCount:   d.novelty.length,
        alertKick:    overall != null && overall < UI_CONFIG.scoreAlertThreshold,
      },
    };
  }, {});
}
