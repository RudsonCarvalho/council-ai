import { GoogleGenerativeAI } from '@google/generative-ai';
import { AGENTS_CONFIG } from '../../config/agents.config.js';

const cfg    = AGENTS_CONFIG.gemini;
const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export const geminiAdapter = {
  id:   'gemini',
  name: cfg.name,

  async call({ problem, previousResponses = [], privateContext = null }) {
    const systemPrompt = privateContext
      ? `${cfg.persona}\n\n---\nINSTRUÇÃO PRIVADA DO MODERADOR (confidencial):\n${privateContext}`
      : cfg.persona;

    const model = client.getGenerativeModel({
      model:             cfg.model,
      systemInstruction: systemPrompt,
      generationConfig:  { maxOutputTokens: cfg.maxTokens, temperature: cfg.temperature },
    });

    const result = await model.generateContent(buildUserMessage(problem, previousResponses, this.id));
    const response = result.response;

    return {
      text:         response.text(),
      inputTokens:  response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
    };
  },

  async stream({ problem, previousResponses = [], privateContext = null, onToken }) {
    const systemPrompt = privateContext
      ? `${cfg.persona}\n\n---\nINSTRUÇÃO PRIVADA DO MODERADOR (confidencial):\n${privateContext}`
      : cfg.persona;

    const model = client.getGenerativeModel({
      model:             cfg.model,
      systemInstruction: systemPrompt,
      generationConfig:  { maxOutputTokens: cfg.maxTokens, temperature: cfg.temperature },
    });

    const result = await model.generateContentStream(buildUserMessage(problem, previousResponses, this.id));
    let fullText = '';

    for await (const chunk of result.stream) {
      const token = chunk.text();
      if (token) { fullText += token; onToken?.(token); }
    }

    const finalResponse = await result.response;
    return {
      text:         fullText,
      inputTokens:  finalResponse.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: finalResponse.usageMetadata?.candidatesTokenCount ?? 0,
    };
  },
};

function buildUserMessage(problem, previousResponses, selfId) {
  const byRound = {};
  previousResponses.forEach(r => {
    const key = r.round ?? 0;
    if (!byRound[key]) byRound[key] = [];
    byRound[key].push(r);
  });

  const rounds       = Object.keys(byRound).sort((a, b) => Number(a) - Number(b));
  const currentRound = rounds.length > 0 ? Math.max(...rounds.map(Number)) : 0;

  let msg = `=== PROBLEM ===\n${problem}\n`;

  const pastRounds = rounds.filter(r => Number(r) < currentRound);
  if (pastRounds.length > 0) {
    msg += `\n=== DEBATE HISTORY ===\n(DO NOT repeat arguments already made)\n\n`;
    pastRounds.forEach(r => {
      msg += `── Round ${r} ──\n`;
      byRound[r].forEach(resp => {
        if (resp.isHuman) {
          msg += `[MODERATOR]: ${resp.text}\n\n`;
        } else {
          msg += `[${resp.agentName}${resp.agentId === selfId ? ' — YOU' : ''}]: ${resp.text}\n\n`;
        }
      });
    });
  }

  const currentRoundResponses = byRound[currentRound] ?? [];
  const othersNow    = currentRoundResponses.filter(r => r.agentId !== selfId && !r.isHuman);
  const moderatorNow = currentRoundResponses.filter(r => r.isHuman);

  if (moderatorNow.length > 0) {
    msg += `\n=== MODERATOR INSTRUCTION (MANDATORY) ===\n`;
    moderatorNow.forEach(r => { msg += `${r.text}\n`; });
  }

  if (othersNow.length > 0) {
    msg += `\n=== CURRENT ROUND — responses before yours ===\n(do not repeat what was already said)\n\n`;
    othersNow.forEach(r => { msg += `[${r.agentName}]: ${r.text}\n\n`; });
  }

  if (previousResponses.length > 0) {
    msg += `\n=== YOUR RESPONSE ===\nMANDATORY:\n1. Do NOT repeat arguments already made\n2. If you agree, cite briefly and ADD something NEW\n3. If you disagree, cite the SPECIFIC premise you are questioning\n4. Focus on what is still UNRESOLVED\n5. Be direct — no long introductions\n`;
  } else {
    msg += `\n=== YOUR RESPONSE ===\nProvide your initial technical analysis.\n`;
  }

  return msg;
}
