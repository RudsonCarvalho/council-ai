/**
 * ─── DEBATE CONSTITUTION CONFIG ──────────────────────────────────────────────
 * Constituições, cenários e regras do debate.
 * Nunca coloque isso dentro de componentes ou serviços.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Cenários pré-definidos ────────────────────────────────────────────────────

export const PRESET_SCENARIOS = [
  {
    id:    'financial',
    icon:  '🏦',
    label: 'Empresa Financeira',
    text:  `Vocês fazem parte de uma instituição financeira regulada pelo Banco Central do Brasil.
Valores e restrições inegociáveis:
- Segurança e conformidade regulatória sempre acima de velocidade de entrega
- Toda solução deve considerar LGPD, SOX e normas do BACEN
- Risco operacional e reputacional são critérios de veto
- Custo é importante mas secundário à conformidade
- Mudanças em produção exigem janela de manutenção e rollback plan`,
  },
  {
    id:    'health',
    icon:  '🏥',
    label: 'Saúde e Medicina',
    text:  `Vocês fazem parte de uma organização de saúde que atende pacientes diretamente.
Valores e restrições inegociáveis:
- Segurança do paciente é absoluta — nenhuma solução que introduza risco clínico
- LGPD e regulações da ANVISA e CFM são inegociáveis
- Evidência científica e validação clínica precedem velocidade
- Interoperabilidade com sistemas hospitalares existentes é crítica
- Downtime pode ter consequências irreversíveis — resiliência é prioridade`,
  },
  {
    id:    'pharma',
    icon:  '💊',
    label: 'Farmacêutico / Regulatório',
    text:  `Vocês fazem parte de uma empresa farmacêutica ou de dispositivos médicos.
Valores e restrições inegociáveis:
- Conformidade com ANVISA, FDA e EMA é não-negociável
- Rastreabilidade total de dados e processos para auditoria regulatória
- Validação de sistemas (CSV/GAMP5) é obrigatória antes de go-live
- Integridade de dados é crítica — 21 CFR Part 11 onde aplicável
- Time-to-market importa, mas nunca sacrificando compliance`,
  },
  {
    id:    'startup',
    icon:  '🚀',
    label: 'Startup de Tecnologia',
    text:  `Vocês fazem parte de uma startup em fase de crescimento acelerado.
Valores e restrições:
- Velocidade de entrega e aprendizado superam perfeição técnica
- MVP primeiro, refatoração depois — mas sem dívida técnica que trave o futuro
- Custo de infraestrutura é crítico — soluções managed e serverless preferidas
- Time pequeno: soluções simples de manter e onboarding rápido
- Métrica principal: impacto no usuário e retenção`,
  },
  {
    id:    'industry',
    icon:  '🏭',
    label: 'Indústria / Manufatura',
    text:  `Vocês fazem parte de uma empresa industrial com operações físicas críticas.
Valores e restrições:
- Uptime e disponibilidade são críticos — paradas custam produção real
- Segurança operacional (NR-12, NR-35) é inegociável
- Integração com sistemas legados (ERP, SCADA, PLC) é frequente
- Latência de resposta em tempo real pode ser requisito
- Mudanças em sistemas de controle exigem validação em ambiente isolado`,
  },
  {
    id:    'ecommerce',
    icon:  '🛒',
    label: 'E-commerce / Varejo',
    text:  `Vocês fazem parte de uma operação de e-commerce ou varejo omnichannel.
Valores e restrições:
- Experiência do usuário e taxa de conversão são métricas primárias
- Performance de página e tempo de checkout são críticos
- Sazonalidade exige escalabilidade (Black Friday, datas comemorativas)
- Integração com meios de pagamento, logística e ERP
- A/B testing e dados de comportamento guiam decisões`,
  },
  {
    id:    'marketing',
    icon:  '📣',
    label: 'Marketing e Comunicação',
    text:  `Vocês fazem parte de um time de marketing ou agência de comunicação.
Valores e restrições:
- Impacto na audiência, engajamento e conversão são métricas centrais
- Velocidade de execução de campanhas é competitiva
- Consistência de marca e tom de voz são inegociáveis
- LGPD e regulações de publicidade (CONAR) devem ser respeitadas
- ROI e atribuição de resultado guiam priorização
- Criatividade e diferenciação são tão importantes quanto eficiência`,
  },
  {
    id:    'public',
    icon:  '🏛',
    label: 'Setor Público',
    text:  `Vocês fazem parte de uma organização do setor público brasileiro.
Valores e restrições:
- Transparência, prestação de contas e controle social são obrigatórios
- Lei de Licitações (14.133/2021) e LGPD são inegociáveis
- Impacto social e acessibilidade precedem custo
- Interoperabilidade com sistemas de governo (GOV.BR, SIAFI, etc)
- Decisões devem ser auditáveis e documentadas
- Sustentabilidade da solução no longo prazo — sem dependência de fornecedor único`,
  },
  {
    id:    'legal',
    icon:  '⚖️',
    label: 'Jurídico / Compliance',
    text:  `Vocês fazem parte de um escritório jurídico ou área de compliance corporativo.
Valores e restrições:
- Precisão e rigor técnico-jurídico são inegociáveis
- Confidencialidade e sigilo profissional são absolutos
- Toda solução deve ser auditável e rastreável
- Risco legal e reputacional são critérios de veto
- Prazos processuais são críticos — confiabilidade acima de velocidade
- Referências normativas e jurisprudência devem embasar argumentos`,
  },
  {
    id:    'education',
    icon:  '🎓',
    label: 'Educação',
    text:  `Vocês fazem parte de uma instituição educacional ou edtech.
Valores e restrições:
- Impacto pedagógico e aprendizado do aluno são a métrica central
- Acessibilidade e inclusão são inegociáveis
- LGPD com atenção especial a dados de menores
- Escalabilidade para diferentes perfis de aluno e professor
- Custo por aluno é crítico em instituições públicas
- Engajamento e retenção do aluno guiam decisões de produto`,
  },
  {
    id:    'custom',
    icon:  '✏️',
    label: 'Personalizado',
    text:  '',
  },
];

// ── Tons de debate ────────────────────────────────────────────────────────────

export const DEBATE_TONES = [
  {
    id:          'exploratory',
    label:       'Exploratório',
    icon:        '🔭',
    description: 'Construir, expandir, gerar opções',
    instruction: `O objetivo é explorar o problema em profundidade e gerar múltiplas opções viáveis.
Priorize: amplitude de perspectivas, criatividade, identificação de oportunidades.
Evite: convergência prematura, descarte sem justificativa, pessimismo sem alternativa.`,
  },
  {
    id:          'critical',
    label:       'Crítico',
    icon:        '🔍',
    description: 'Questionar premissas, achar falhas',
    instruction: `O objetivo é testar a robustez de propostas e identificar riscos, falhas e premissas frágeis.
Priorize: questionamento de premissas, identificação de riscos, análise de trade-offs.
Evite: concordância por educação, generalidades sem evidência, validação sem questionamento.`,
  },
  {
    id:          'decisive',
    label:       'Decisório',
    icon:        '🎯',
    description: 'Convergir, priorizar, escolher',
    instruction: `O objetivo é chegar em uma decisão clara e acionável.
Priorize: convergência, priorização, critérios objetivos de escolha, próximos passos concretos.
Evite: reabrir questões já resolvidas, introduzir novos problemas, respostas sem posição clara.`,
  },
];

// ── Regras disponíveis ────────────────────────────────────────────────────────

export const DEBATE_RULES = [
  {
    id:          'no_repetition',
    label:       'Sem repetição',
    description: 'Não repita argumentos que outro já apresentou',
    default:     true,
    instruction: 'Não repita argumentos ou pontos já apresentados por outros participantes. Se concordar com algo, cite-o brevemente e acrescente algo novo.',
  },
  {
    id:          'grounded_disagreement',
    label:       'Discordância fundamentada',
    description: 'Critique com premissa concreta, não feeling',
    default:     true,
    instruction: 'Toda discordância deve citar a premissa específica, evidência ou trade-off que está questionando. "Discordo" sem justificativa concreta não é válido.',
  },
  {
    id:          'word_limit',
    label:       'Limite de palavras',
    description: 'Respostas objetivas e diretas',
    default:     true,
    defaultValue: 150,
    instruction: (n) => `Máximo de ${n} palavras por resposta. Seja direto. Sem introduções, sem disclaimers, sem encerramento educado.`,
  },
  {
    id:          'structured_output',
    label:       'Formato estruturado',
    description: 'Tese · Argumentos · Crítica · Confiança',
    default:     false,
    instruction: `Estruture sua resposta obrigatoriamente assim:
TESE: [sua posição em 1 frase]
ARGUMENTOS: [2-3 pontos de suporte]
CRÍTICA: [1 ponto fraco de outra posição]
CONFIANÇA: [0.0 a 1.0]`,
  },
  {
    id:          'adversarial',
    label:       'Papel adversarial rotativo',
    description: 'Uma IA por round questiona a proposta dominante',
    default:     false,
    instruction: `Neste round você assume o papel de Red Team. Seu trabalho é encontrar falhas, premissas frágeis, riscos ignorados e inconsistências na proposta mais aceita até agora. Não invente fatos. Ataque a argumentação, não as pessoas.`,
  },
];

// ── Monta a constituição completa ─────────────────────────────────────────────

export function buildConstitution({ scenario, tone, rules, wordLimit, extendedVoiceAgent }) {
  const parts = [];

  // Cenário organizacional
  if (scenario?.trim()) {
    parts.push(`=== CONTEXTO ORGANIZACIONAL ===\n${scenario.trim()}`);
  }

  // Tom do debate
  const toneConfig = DEBATE_TONES.find(t => t.id === tone);
  if (toneConfig) {
    parts.push(`=== TOM DO DEBATE: ${toneConfig.label.toUpperCase()} ===\n${toneConfig.instruction}`);
  }

  // Regras ativas
  const activeRules = [];
  rules.forEach(ruleId => {
    const rule = DEBATE_RULES.find(r => r.id === ruleId);
    if (!rule) return;
    if (ruleId === 'word_limit') {
      activeRules.push(rule.instruction(wordLimit ?? 150));
    } else {
      activeRules.push(rule.instruction);
    }
  });

  if (activeRules.length > 0) {
    parts.push(`=== REGRAS DESTA SESSÃO ===\n${activeRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`);
  }

  // Voz estendida
  if (extendedVoiceAgent) {
    parts.push(`=== NOTA ===\nO participante "${extendedVoiceAgent}" tem permissão para respostas mais longas nesta sessão.`);
  }

  if (parts.length === 0) return null;

  return `\n\n${'='.repeat(60)}\nCONSTITUIÇÃO DO DEBATE\n${'='.repeat(60)}\n${parts.join('\n\n')}\n${'='.repeat(60)}`;
}
