/**
 * Adapter genérico para APIs OpenAI-compatible.
 * Usa formato multi-turn nativo — user/assistant/user/assistant
 * em vez de despejar tudo numa única mensagem.
 */
import OpenAI from 'openai';

export function createOpenAICompatibleAdapter(id, cfg, apiKey, baseURL) {
  const client = new OpenAI({ apiKey, baseURL });

  return {
    id,
    name: cfg.name,

    async call({ problem, previousResponses = [], privateContext = null, signal = null }) {
      const systemPrompt = buildSystemPrompt(cfg, privateContext);
      const messages     = buildMessages(problem, previousResponses, id);

      const response = await client.chat.completions.create(
        { model: cfg.model, max_tokens: cfg.maxTokens, temperature: cfg.temperature, messages: [{ role: 'system', content: systemPrompt }, ...messages] },
        { signal }
      );

      return {
        text:         response.choices[0].message.content,
        inputTokens:  response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      };
    },

    async stream({ problem, previousResponses = [], privateContext = null, modelOverride = null, signal = null, onToken }) {
      const systemPrompt = buildSystemPrompt(cfg, privateContext);
      const messages     = buildMessages(problem, previousResponses, id);
      const modelToUse   = modelOverride ?? cfg.model;
      let fullText = '', inputTokens = 0, outputTokens = 0;

      const stream = await client.chat.completions.create(
        {
          model:          modelToUse,
          max_tokens:     cfg.maxTokens,
          temperature:    cfg.temperature,
          stream:         true,
          stream_options: { include_usage: true }, // necessário para GPT retornar tokens no streaming
          messages:       [{ role: 'system', content: systemPrompt }, ...messages],
        },
        { signal }
      );

      for await (const chunk of stream) {
        const token = chunk.choices[0]?.delta?.content ?? '';
        if (token) { fullText += token; onToken?.(token); }
        if (chunk.usage) {
          inputTokens  = chunk.usage.prompt_tokens ?? 0;
          outputTokens = chunk.usage.completion_tokens ?? 0;
        }
      }

      return { text: fullText, inputTokens, outputTokens };
    },
  };
}

function buildSystemPrompt(cfg, privateContext) {
  if (!privateContext) return cfg.persona;
  return `${cfg.persona}\n\n${privateContext}`;
}

/**
 * Constrói o histórico como conversa multi-turn real.
 * Cada resposta de IA vira um turno assistant/user alternado.
 * GPT responde muito melhor assim do que com tudo numa única mensagem.
 */
function buildMessages(problem, previousResponses, selfId) {
  if (!previousResponses?.length) {
    return [{ role: 'user', content: `PROBLEM:\n${problem}\n\nProvide your initial technical analysis.` }];
  }

  // Agrupa por round para contexto estruturado
  const byRound = {};
  previousResponses.forEach(r => {
    const key = r.round ?? 0;
    if (!byRound[key]) byRound[key] = [];
    byRound[key].push(r);
  });

  const rounds       = Object.keys(byRound).sort((a, b) => Number(a) - Number(b));
  const currentRound = Math.max(...rounds.map(Number));
  const pastRounds   = rounds.filter(r => Number(r) < currentRound);
  const messages     = [];

  // Primeira mensagem — problema
  messages.push({ role: 'user', content: `PROBLEM:\n${problem}` });

  // Rounds anteriores — vira conversa alternada
  pastRounds.forEach(r => {
    const responses = byRound[r];
    const myResponse = responses.find(resp => resp.agentId === selfId);
    const otherResponses = responses.filter(resp => resp.agentId !== selfId && !resp.isHuman);
    const moderatorMsgs = responses.filter(resp => resp.isHuman);

    // O que os outros disseram — chega como user
    let othersText = `=== Round ${r} — other participants ===\n`;
    otherResponses.forEach(resp => { othersText += `[${resp.agentName}]: ${resp.text}\n\n`; });
    if (moderatorMsgs.length) { othersText += `[MODERATOR]: ${moderatorMsgs.map(m => m.text).join('\n')}\n`; }

    messages.push({ role: 'user', content: othersText });

    // O que você disse — chega como assistant
    if (myResponse) {
      messages.push({ role: 'assistant', content: myResponse.text });
    } else {
      // Se a IA não respondeu nesse round, placeholder
      messages.push({ role: 'assistant', content: '(no response in this round)' });
    }
  });

  // Round atual — o que os outros já disseram antes de você
  const currentResponses = byRound[currentRound] ?? [];
  const othersNow = currentResponses.filter(r => r.agentId !== selfId && !r.isHuman);
  const moderatorNow = currentResponses.filter(r => r.isHuman);

  let currentMsg = '';

  if (moderatorNow.length) {
    currentMsg += `=== MODERATOR INSTRUCTION (MANDATORY — follow this) ===\n`;
    currentMsg += moderatorNow.map(m => m.text).join('\n') + '\n\n';
  }

  if (othersNow.length) {
    currentMsg += `=== Current round — responses before yours ===\n`;
    othersNow.forEach(r => { currentMsg += `[${r.agentName}]: ${r.text}\n\n`; });
  }

  currentMsg += `=== YOUR RESPONSE ===\nMANDATORY:\n`;
  currentMsg += `1. Do NOT repeat arguments already made in previous rounds\n`;
  currentMsg += `2. Build on what others said — agree with new evidence or disagree with specific reasoning\n`;
  currentMsg += `3. Focus only on what is still UNRESOLVED\n`;
  currentMsg += `4. Be concise and direct`;

  messages.push({ role: 'user', content: currentMsg });

  return messages;
}
