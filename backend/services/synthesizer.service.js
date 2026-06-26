/**
 * ─── SYNTHESIZER SERVICE ─────────────────────────────────────────────────────
 * Gera o documento final seção por seção.
 * 
 * Problemas resolvidos:
 * - max_tokens aumentado para 8192 por seção
 * - documentSoFar nunca cresce além de um resumo compacto
 * - Detecção de truncamento — avisa se a seção foi cortada
 * - Rota de regeneração: qualquer seção pode ser regerada isoladamente
 * ─────────────────────────────────────────────────────────────────────────────
 */

import Anthropic    from '@anthropic-ai/sdk';
import OpenAI       from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { AGENTS_CONFIG }      from '../../config/agents.config.js';
import { saveSynthesisSection, loadMessages, getSynthesisDocument, updateSession } from './storage.service.js';

// ── Planos de documento por objetivo ─────────────────────────────────────────
const DOCUMENT_PLANS = {
  decision: [
    { title: 'Recomendação Principal',       prompt: 'What is the single clearest recommendation from this debate? State it directly and completely.' },
    { title: 'O que foi descoberto',          prompt: 'What genuine insights emerged that were not obvious at the start? Be exhaustive.' },
    { title: 'O que foi descartado e por quê', prompt: 'What ideas were refuted or abandoned? Document ALL of them with the reasoning.' },
    { title: 'Riscos e Pontos Fracos',        prompt: 'What risks, weak premises, and vulnerabilities were identified? List all of them.' },
    { title: 'Perguntas sem Resposta',        prompt: 'What questions remained unanswered? What requires more data or human decision?' },
    { title: 'Divergências não Resolvidas',   prompt: 'Where did participants disagree without reaching consensus? Document both sides completely.' },
    { title: 'Próximos Passos',              prompt: 'What concrete actions should be taken now? Be specific and actionable.' },
  ],
  spec: [
    { title: 'Visão Geral',                  prompt: 'Summarize what system/solution is being specified and its purpose.' },
    { title: 'Requisitos Funcionais',         prompt: 'List ALL functional requirements agreed upon in the debate. Do not omit any.' },
    { title: 'Requisitos Não Funcionais',     prompt: 'List performance, security, scalability, and other non-functional requirements.' },
    { title: 'Arquitetura Proposta',          prompt: 'Describe the technical architecture and all key design decisions in detail.' },
    { title: 'Pontos de Atenção e Riscos',    prompt: 'What risks and edge cases must be addressed in implementation?' },
    { title: 'O que foi descartado',          prompt: 'What approaches were considered and rejected? Why?' },
    { title: 'Próximos Passos',              prompt: 'What are the implementation steps in order? Be specific.' },
  ],
  article: [
    { title: 'Introdução e Contexto',         prompt: 'Write a complete academic introduction presenting the problem and its relevance.' },
    { title: 'Estado da Arte',               prompt: 'Summarize all existing approaches and perspectives discussed.' },
    { title: 'Análise e Discussão',           prompt: 'Present all main arguments, evidence, and counterarguments from the debate.' },
    { title: 'Pontos de Convergência',        prompt: 'What did the debate participants agree on? What was validated?' },
    { title: 'Lacunas e Questões Abertas',    prompt: 'What gaps in knowledge were identified? What needs further research?' },
    { title: 'Conclusão',                    prompt: 'Write a complete formal conclusion synthesizing all debate findings.' },
  ],
  business: [
    { title: 'Sumário Executivo',             prompt: 'Write a complete executive summary of the debate conclusions.' },
    { title: 'Oportunidade ou Problema',      prompt: 'Describe the business opportunity or problem being addressed in full detail.' },
    { title: 'Solução Recomendada',           prompt: 'What solution did the debate converge on? Explain completely why.' },
    { title: 'Análise de Viabilidade',        prompt: 'What are the feasibility factors: market, technical, financial, operational?' },
    { title: 'Riscos do Negócio',             prompt: 'What business risks and mitigation strategies were identified? List all.' },
    { title: 'O que foi descartado',          prompt: 'What alternatives were considered and why they were rejected.' },
    { title: 'Próximos Passos',              prompt: 'What are the concrete next steps for this business initiative?' },
  ],
  research: [
    { title: 'Pergunta de Pesquisa',          prompt: 'State the research question and why it matters.' },
    { title: 'Perspectivas Levantadas',       prompt: 'What different perspectives and approaches were raised in the debate?' },
    { title: 'Evidências e Argumentos',       prompt: 'What evidence and arguments were presented by each side? Be exhaustive.' },
    { title: 'Síntese do Conhecimento',       prompt: 'What is the current state of knowledge based on this debate?' },
    { title: 'Lacunas Identificadas',         prompt: 'What is still unknown or contested? Where does research need to go?' },
    { title: 'Próximos Passos de Pesquisa',   prompt: 'What research actions are recommended?' },
  ],
  custom: [
    { title: 'Síntese Geral',                prompt: 'Provide a comprehensive synthesis of everything discussed. Do not omit anything important.' },
    { title: 'Principais Descobertas',        prompt: 'What are ALL the key findings from this debate?' },
    { title: 'Divergências e Acordos',        prompt: 'Document fully where participants agreed and disagreed.' },
    { title: 'O que foi descartado',          prompt: 'What ideas were rejected and why?' },
    { title: 'Questões em Aberto',            prompt: 'What remains unresolved or needs more investigation?' },
    { title: 'Próximos Passos',              prompt: 'What actions should follow from this debate?' },
  ],
};

export function getDocumentPlan(objective) {
  return DOCUMENT_PLANS[objective] ?? DOCUMENT_PLANS.custom;
}

// ── Monta contexto do debate — dividido em blocos para não estourar ───────────
function buildDebateContext(messages, maxChars = 40000) {
  const byRound = {};
  messages.forEach(m => {
    if (!byRound[m.round]) byRound[m.round] = [];
    byRound[m.round].push(m);
  });

  let ctx = '=== DEBATE TRANSCRIPT ===\n\n';
  const rounds = Object.entries(byRound).sort((a, b) => Number(a[0]) - Number(b[0]));

  for (const [round, msgs] of rounds) {
    ctx += `--- Round ${round} ---\n`;
    msgs.forEach(m => {
      if (m.isJudge || m.silent) return;
      const label = m.isHuman ? 'MODERATOR' : m.agentName;
      ctx += `[${label}]: ${m.text}\n\n`;
    });
    // Garante que não estoura — corta no meio se necessário
    if (ctx.length > maxChars) {
      ctx = ctx.slice(0, maxChars) + '\n\n[...debate truncated for length — earlier rounds omitted]\n';
      break;
    }
  }
  return ctx;
}

// ── Resumo compacto do que já foi escrito — nunca cresce muito ────────────────
function buildDocumentSummary(sectionsWritten) {
  if (sectionsWritten.length === 0) return '(this is the first section)';
  return sectionsWritten
    .map(s => `## ${s.title}\n${s.content.slice(0, 200)}${s.content.length > 200 ? '...' : ''}`)
    .join('\n\n');
}

// ── Detecta se a resposta foi truncada ────────────────────────────────────────
function detectTruncation(content, stopReason) {
  if (stopReason === 'max_tokens') return true;
  if (stopReason === 'length') return true;
  // Heurística: termina no meio de uma frase
  const last = content.trimEnd().slice(-30);
  if (!/[.!?:)\]"']$/.test(last)) return true;
  return false;
}

// ── Gera uma seção completa com retry se truncar ─────────────────────────────
async function generateSection(synthesizerId, systemPrompt, sectionPrompt, maxRetries = 2) {
  let attempt = 0;
  let content = '';
  let wasTruncated = false;

  while (attempt <= maxRetries) {
    const { text, stopReason } = await callSynthesizer(synthesizerId, systemPrompt, sectionPrompt + (content ? `\n\nCONTINUE FROM WHERE YOU STOPPED:\n${content.slice(-300)}` : ''));
    content += text;
    wasTruncated = detectTruncation(text, stopReason);

    if (!wasTruncated) break;

    console.log(`[synthesizer] Section truncated (attempt ${attempt + 1}) — continuing...`);
    attempt++;
  }

  if (wasTruncated) {
    console.warn(`[synthesizer] Section still truncated after ${maxRetries} retries`);
    content += '\n\n[⚠ Seção possivelmente incompleta — use "Regerar seção" para completar]';
  }

  return { content, wasTruncated };
}

// ── Síntese completa ──────────────────────────────────────────────────────────
export async function synthesizeDebate(sessionId, { objective = 'decision', synthesizerId = 'claude', customObjective = '', onSection }) {
  const messages = await loadMessages(sessionId);
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

Read the debate carefully and write each section based ONLY on what was actually discussed.
Do NOT invent information. If something was not discussed, say so.
Write in the same language as the debate (if Portuguese, write in Portuguese).
Be THOROUGH and COMPLETE — never truncate, never summarize excessively.
Each section must be substantive. Better to write more than to leave gaps.`;

  const sectionsWritten = [];

  for (let i = 0; i < plan.length; i++) {
    const section = plan[i];
    const summary = buildDocumentSummary(sectionsWritten);

    const sectionPrompt = `${debateContext}

---
SECTIONS ALREADY WRITTEN (summary):
${summary}

---
NOW WRITE SECTION: ${section.title}
INSTRUCTION: ${section.prompt}

Write this section completely and thoroughly. Do not truncate. Use all relevant information from the debate.`;

    try {
      const { content, wasTruncated } = await generateSection(synthesizerId, systemPrompt, sectionPrompt);

      await saveSynthesisSection(sessionId, i, section.title, content);
      sectionsWritten.push({ title: section.title, content });

      onSection?.({ index: i, title: section.title, content, total: plan.length, truncated: wasTruncated });

    } catch (err) {
      console.error(`[synthesizer] Section ${i} failed:`, err.message);
      const errorContent = `*Erro ao gerar esta seção: ${err.message}*\n\nUse "Regerar seção" para tentar novamente.`;
      await saveSynthesisSection(sessionId, i, section.title, errorContent);
      onSection?.({ index: i, title: section.title, content: errorContent, total: plan.length, error: true });
    }
  }

  const fullDocument = await getSynthesisDocument(sessionId);
  await updateSession(sessionId, { synthesis: { objective, document: fullDocument, generatedAt: new Date() } });
  return fullDocument;
}

// ── Regenera uma seção específica ─────────────────────────────────────────────
export async function regenerateSection(sessionId, sectionIndex, { objective = 'decision', synthesizerId = 'claude', onSection }) {
  const messages = await loadMessages(sessionId);
  const debateContext = buildDebateContext(messages);
  const plan = DOCUMENT_PLANS[objective] ?? DOCUMENT_PLANS.custom;
  const section = plan[sectionIndex];

  if (!section) throw new Error(`Section ${sectionIndex} not found in plan`);

  console.log(`[synthesizer] Regenerating section ${sectionIndex}: ${section.title}`);

  const systemPrompt = `You are synthesizing a multi-AI debate. Write in the same language as the debate.
Be THOROUGH and COMPLETE — never truncate. Write more rather than less.`;

  const sectionPrompt = `${debateContext}

---
WRITE SECTION: ${section.title}
INSTRUCTION: ${section.prompt}

Write this section completely and thoroughly. Do not truncate. Use all relevant information from the debate.`;

  const { content, wasTruncated } = await generateSection(synthesizerId, systemPrompt, sectionPrompt);

  await saveSynthesisSection(sessionId, sectionIndex, section.title, content);
  onSection?.({ index: sectionIndex, title: section.title, content, total: plan.length, truncated: wasTruncated });

  return content;
}

// ── Chamada ao modelo sintetizador ────────────────────────────────────────────
async function callSynthesizer(synthesizerId, systemPrompt, userPrompt) {
  if (synthesizerId === 'claude') {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await client.messages.create({
      model:      AGENTS_CONFIG.claude.model,
      max_tokens: 8192,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userPrompt }],
    });
    return { text: res.content[0].text, stopReason: res.stop_reason };
  }

  if (synthesizerId === 'gemini') {
    const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model  = client.getGenerativeModel({
      model:             AGENTS_CONFIG.gemini.model,
      systemInstruction: systemPrompt,
      generationConfig:  { maxOutputTokens: 8192 },
    });
    const result = await model.generateContent(userPrompt);
    const text   = result.response.text();
    return { text, stopReason: result.response.promptFeedback?.blockReason ? 'blocked' : 'stop' };
  }

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
    max_tokens: 8192,
    messages:   [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
  });
  return { text: res.choices[0].message.content, stopReason: res.choices[0].finish_reason };
}
