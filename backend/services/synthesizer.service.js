/**
 * ─── SYNTHESIZER SERVICE ─────────────────────────────────────────────────────
 * Gera o documento final seção por seção.
 * Cada seção é salva no MongoDB imediatamente — sem perda se falhar no meio.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import Anthropic    from '@anthropic-ai/sdk';
import OpenAI       from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { AGENTS_CONFIG }      from '../../config/agents.config.js';
import { saveSynthesisSection, loadMessages, getSynthesisDocument, updateSession } from './storage.service.js';

// Estrutura de seções por objetivo
const DOCUMENT_PLANS = {
  decision: [
    { title: 'Recomendação Principal',     prompt: 'What is the single clearest recommendation from this debate? State it directly.' },
    { title: 'O que foi descoberto',       prompt: 'What genuine insights emerged that were not obvious at the start?' },
    { title: 'O que foi descartado e por quê', prompt: 'What ideas were refuted or abandoned? Document them with the reasoning.' },
    { title: 'Riscos e Pontos Fracos',     prompt: 'What risks, weak premises, and vulnerabilities were identified?' },
    { title: 'Perguntas sem Resposta',     prompt: 'What questions remained unanswered? What requires more data or human decision?' },
    { title: 'Divergências não Resolvidas', prompt: 'Where did participants disagree without reaching consensus? Document both sides.' },
    { title: 'Próximos Passos',            prompt: 'What concrete actions should be taken now based on this debate?' },
  ],
  spec: [
    { title: 'Visão Geral',               prompt: 'Summarize what system/solution is being specified and its purpose.' },
    { title: 'Requisitos Funcionais',      prompt: 'List all functional requirements agreed upon in the debate.' },
    { title: 'Requisitos Não Funcionais',  prompt: 'List performance, security, scalability, and other non-functional requirements.' },
    { title: 'Arquitetura Proposta',       prompt: 'Describe the technical architecture and key design decisions.' },
    { title: 'Pontos de Atenção e Riscos', prompt: 'What risks and edge cases must be addressed in implementation?' },
    { title: 'O que foi descartado',       prompt: 'What approaches were considered and rejected? Why?' },
    { title: 'Próximos Passos',            prompt: 'What are the implementation steps in order?' },
  ],
  article: [
    { title: 'Introdução e Contexto',      prompt: 'Write an academic introduction presenting the problem and its relevance.' },
    { title: 'Estado da Arte',             prompt: 'Summarize existing approaches and perspectives discussed.' },
    { title: 'Análise e Discussão',        prompt: 'Present the main arguments, evidence, and counterarguments from the debate.' },
    { title: 'Pontos de Convergência',     prompt: 'What did the debate participants agree on? What was validated?' },
    { title: 'Lacunas e Questões Abertas', prompt: 'What gaps in knowledge were identified? What needs further research?' },
    { title: 'Conclusão',                  prompt: 'Write a formal conclusion synthesizing the debate findings.' },
  ],
  business: [
    { title: 'Sumário Executivo',          prompt: 'Write a 1-paragraph executive summary of the debate conclusions.' },
    { title: 'Oportunidade ou Problema',   prompt: 'Describe the business opportunity or problem being addressed.' },
    { title: 'Solução Recomendada',        prompt: 'What solution did the debate converge on? Why?' },
    { title: 'Análise de Viabilidade',     prompt: 'What are the feasibility factors: market, technical, financial, operational?' },
    { title: 'Riscos do Negócio',          prompt: 'What business risks and mitigation strategies were identified?' },
    { title: 'O que foi descartado',       prompt: 'What alternatives were considered and why they were rejected.' },
    { title: 'Próximos Passos',            prompt: 'What are the concrete next steps for this business initiative?' },
  ],
  research: [
    { title: 'Pergunta de Pesquisa',       prompt: 'State the research question and why it matters.' },
    { title: 'Perspectivas Levantadas',    prompt: 'What different perspectives and approaches were raised in the debate?' },
    { title: 'Evidências e Argumentos',    prompt: 'What evidence and arguments were presented by each side?' },
    { title: 'Síntese do Conhecimento',    prompt: 'What is the current state of knowledge based on this debate?' },
    { title: 'Lacunas Identificadas',      prompt: 'What is still unknown or contested? Where does research need to go?' },
    { title: 'Próximos Passos de Pesquisa', prompt: 'What research actions are recommended?' },
  ],
  custom: [
    { title: 'Síntese Geral',             prompt: 'Provide a comprehensive synthesis of everything discussed.' },
    { title: 'Principais Descobertas',    prompt: 'What are the key findings from this debate?' },
    { title: 'Divergências e Acordos',    prompt: 'Document where participants agreed and disagreed.' },
    { title: 'O que foi descartado',      prompt: 'What ideas were rejected and why?' },
    { title: 'Questões em Aberto',        prompt: 'What remains unresolved or needs more investigation?' },
    { title: 'Próximos Passos',           prompt: 'What actions should follow from this debate?' },
  ],
};

export async function synthesizeDebate(sessionId, { objective = 'decision', synthesizerId = 'claude', customObjective = '', onSection }) {
  const messages = await loadMessages(sessionId);

  // Monta o debate completo como contexto
  const debateContext = buildDebateContext(messages);

  const plan = DOCUMENT_PLANS[objective] ?? DOCUMENT_PLANS.custom;

  const objectiveLabels = {
    decision: 'a clear decision with risks and next steps',
    spec:     'a complete technical specification',
    article:  'an academic article',
    business: 'a business plan',
    research: 'a research analysis',
    custom:   'a comprehensive synthesis',
  };
  const objectiveDescription = customObjective || objectiveLabels[objective] || 'a synthesis';

  const systemPrompt = `You are synthesizing a multi-AI debate into ${objectiveDescription}.

Read the full debate carefully and write each section based ONLY on what was actually discussed.
Do NOT invent information. If something was not discussed, say so.
Write in the same language as the debate (if the debate is in Portuguese, write in Portuguese).
Be thorough — do not truncate or summarize excessively. Each section should be substantive.`;

  // Gera seção por seção
  let documentSoFar = '';

  for (let i = 0; i < plan.length; i++) {
    const section = plan[i];

    const sectionPrompt = `${debateContext}

---
DOCUMENT SO FAR:
${documentSoFar || '(this is the first section)'}

---
NOW WRITE: ${section.title}
INSTRUCTION: ${section.prompt}

Write this section completely. Be thorough and specific. Use information from the debate only.`;

    try {
      const content = await callSynthesizer(synthesizerId, systemPrompt, sectionPrompt);

      // Salva imediatamente — nunca perde se falhar depois
      await saveSynthesisSection(sessionId, i, section.title, content);

      documentSoFar += `\n\n## ${section.title}\n\n${content}`;

      // Notifica frontend em tempo real
      onSection?.({ index: i, title: section.title, content, total: plan.length });

    } catch (err) {
      const errorContent = `*Erro ao gerar esta seção: ${err.message}*`;
      await saveSynthesisSection(sessionId, i, section.title, errorContent);
      onSection?.({ index: i, title: section.title, content: errorContent, total: plan.length, error: true });
    }
  }

  // Salva o documento completo na sessão
  const fullDocument = await getSynthesisDocument(sessionId);
  await updateSession(sessionId, { synthesis: { objective, document: fullDocument, generatedAt: new Date() } });

  return fullDocument;
}

function buildDebateContext(messages) {
  const byRound = {};
  messages.forEach(m => {
    if (!byRound[m.round]) byRound[m.round] = [];
    byRound[m.round].push(m);
  });

  let ctx = '=== FULL DEBATE TRANSCRIPT ===\n\n';
  Object.entries(byRound).sort((a, b) => Number(a[0]) - Number(b[0])).forEach(([round, msgs]) => {
    ctx += `--- Round ${round} ---\n`;
    msgs.forEach(m => {
      const label = m.isHuman ? 'MODERATOR' : m.agentName;
      ctx += `[${label}]: ${m.text}\n\n`;
    });
  });
  return ctx;
}

async function callSynthesizer(synthesizerId, systemPrompt, userPrompt) {
  if (synthesizerId === 'claude') {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await client.messages.create({
      model:      AGENTS_CONFIG.claude.model,
      max_tokens: 4096,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userPrompt }],
    });
    return res.content[0].text;
  }

  if (synthesizerId === 'gemini') {
    const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model  = client.getGenerativeModel({
      model:             AGENTS_CONFIG.gemini.model,
      systemInstruction: systemPrompt,
      generationConfig:  { maxOutputTokens: 4096 },
    });
    const result = await model.generateContent(userPrompt);
    return result.response.text();
  }

  // OpenAI-compatible: gpt, deepseek, grok, mistral, perplexity
  const baseURLs = {
    gpt:        'https://api.openai.com/v1',
    perplexity: 'https://api.perplexity.ai',
    deepseek:   'https://api.deepseek.com/v1',
    grok:       'https://api.x.ai/v1',
    mistral:    'https://api.mistral.ai/v1',
  };
  const apiKeys = {
    gpt:        process.env.OPENAI_API_KEY,
    perplexity: process.env.PERPLEXITY_API_KEY,
    deepseek:   process.env.DEEPSEEK_API_KEY,
    grok:       process.env.GROK_API_KEY,
    mistral:    process.env.MISTRAL_API_KEY,
  };

  const client = new OpenAI({ apiKey: apiKeys[synthesizerId], baseURL: baseURLs[synthesizerId] });
  const res = await client.chat.completions.create({
    model:      AGENTS_CONFIG[synthesizerId]?.model ?? 'gpt-4o',
    max_tokens: 4096,
    messages:   [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
  });
  return res.choices[0].message.content;
}
