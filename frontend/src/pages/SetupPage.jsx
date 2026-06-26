import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDebateStore } from '../store/debate.store.js';
import { fetchAgents, fetchTemplates, startDebate, saveTemplate, uploadFile, fetchResearchUrl, listResearchFiles, deleteResearchFile, loadResearchFileContent, testAgentConnections } from '../services/debate.service.js';
import { UI_CONFIG } from '../../../config/ui.config.js';
import { PRESET_SCENARIOS, DEBATE_TONES, DEBATE_RULES } from '../../../config/debate-constitution.config.js';
import styles from './SetupPage.module.css';

export default function SetupPage() {
  const navigate  = useNavigate();
  const store     = useDebateStore();

  const [agents,        setAgents]        = useState({});
  const [templates,     setTemplates]     = useState([]);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState(null);
  const [briefingsOpen, setBriefingsOpen] = useState(false);
  const [saveModal,     setSaveModal]     = useState(false);
  const [templateName,  setTemplateName]  = useState('');
  const [saving,        setSaving]        = useState(false);
  const [attachments,   setAttachments]   = useState([]); // arquivos anexados ao problema
  const [uploading,     setUploading]     = useState(false);

  // Modelo selecionado por IA — persiste no localStorage, mas valida contra modelos disponíveis
  const [modelOverrides, setModelOverrides] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('model_overrides') ?? '{}');
      return stored;
    } catch { return {}; }
  });

  function setModelForAgent(agentId, modelId) {
    const updated = { ...modelOverrides, [agentId]: modelId };
    setModelOverrides(updated);
    localStorage.setItem('model_overrides', JSON.stringify(updated));
  }

  const [constitutionOpen, setConstitutionOpen] = useState(false);
  const [savedScenarios,   setSavedScenarios]   = useState(() => {
    try { return JSON.parse(localStorage.getItem('saved_scenarios') ?? '[]'); } catch { return []; }
  });

  const [researchOpen,    setResearchOpen]    = useState(false);
  const [urlInput,        setUrlInput]        = useState('');
  const [fetchingUrl,     setFetchingUrl]     = useState(false);
  const [urlError,        setUrlError]        = useState(null);
  const [savedFiles,      setSavedFiles]      = useState([]);
  const [selectedFiles,   setSelectedFiles]   = useState([]); // filenames selecionados
  const [researcherId,    setResearcherId]    = useState(''); // '' = nenhum

  const [testResults,   setTestResults]   = useState(null);
  const [testing,       setTesting]       = useState(false);

  // ── Novos campos: knowledge base, limitador, clarification, sintetizador ────
  const [roundLimit,          setRoundLimit]          = useState(null);
  const [clarificationRound,  setClarificationRound]  = useState(true);
  const [contextSessions,     setContextSessions]     = useState([]);
  const [contextMode,         setContextMode]         = useState('continue');
  const [knowledgeSessions,   setKnowledgeSessions]   = useState([]);
  const [synthesisObjective,  setSynthesisObjective]  = useState('decision');
  const [synthesizerId,       setSynthesizerId]       = useState('claude');
  const [knowledgeOpen,       setKnowledgeOpen]       = useState(false);
  const [synthOpen,           setSynthOpen]           = useState(false);
  const [adversaryId,         setAdversaryId]         = useState(null);
  const [factCheckerId,       setFactCheckerId]       = useState(null);
  const [factCheckerModel,    setFactCheckerModel]    = useState(null);  // null = desativado

  const fileInputRef = useRef(null);

  useEffect(() => {
    fetchAgents().then(data => {
      setAgents(data);
      store.setAgentConfigs(data);
      if (store.agentIds.length === 0) {
        store.setAgentIds(Object.keys(data));
      }
      // Limpa modelos inválidos do localStorage — evita usar modelos descontinuados
      setModelOverrides(prev => {
        const cleaned = { ...prev };
        let changed = false;
        Object.entries(cleaned).forEach(([agentId, modelId]) => {
          const agent = data[agentId];
          const valid = agent?.models?.some(m => m.id === modelId);
          if (!valid) { delete cleaned[agentId]; changed = true; }
        });
        if (changed) localStorage.setItem('model_overrides', JSON.stringify(cleaned));
        return cleaned;
      });
    });
    fetchTemplates().then(setTemplates);
    // Carrega sessões marcadas como knowledge base
    fetch('http://localhost:3001/api/sessions/knowledge/search')
      .then(r => r.json()).then(setKnowledgeSessions).catch(() => {});
    // Carrega arquivos do cenário atual
    const scenarioId = store.constitution?.scenarioId ?? 'custom';
    listResearchFiles(scenarioId !== 'custom' ? scenarioId : null).then(setSavedFiles);
  }, []);

  function applyTemplate(tpl) {
    if (!tpl) return;
    store.setAgentIds(tpl.agentIds ?? []);
    store.setModerator(tpl.moderatorId ?? 'claude', tpl.moderatorDebates ?? false);
    store.setMaxRounds(tpl.maxRounds ?? 3);
    store.setSpeed(tpl.speed ?? 0);
    Object.entries(tpl.briefings ?? {}).forEach(([id, text]) => store.setBriefing(id, text));
  }

  function toggleAgent(id) {
    const current = store.agentIds;
    if (current.includes(id)) {
      if (current.length <= 2) return; // mínimo 2
      store.setAgentIds(current.filter(a => a !== id));
    } else {
      store.setAgentIds([...current, id]);
    }
  }

  async function handleSaveTemplate() {
    if (!templateName.trim()) return;
    setSaving(true);
    try {
      await saveTemplate(templateName.trim(), {
        agentIds:         store.agentIds,
        moderatorId:      store.moderatorId,
        moderatorDebates: store.moderatorDebates,
        maxRounds:        store.maxRounds,
        speed:            store.speed,
        briefings:        store.briefings,
      });
      setTemplates(await fetchTemplates());
      setSaveModal(false);
      setTemplateName('');
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleFileUpload(e) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setUploading(true);
    try {
      const results = await Promise.all(files.map(f => uploadFile(f)));

      // Para cada arquivo, decodifica o conteúdo e injeta direto no problema
      // Assim as IAs recebem o conteúdo como parte do contexto — sem lógica especial no backend
      const textParts = results.map(a => {
        const isText = a.mimetype?.startsWith('text/') ||
          /\.(md|json|csv|js|ts|py|txt|jsx|tsx|java|go|rs|sql|yaml|yml|xml|html|css)$/i.test(a.filename ?? '');
        const isPdf  = a.mimetype === 'application/pdf';
        const isImage = a.mimetype?.startsWith('image/');

        if (isText) {
          try {
            const content = atob(a.base64);
            return `\n\n--- Arquivo: ${a.filename} ---\n${content.slice(0, 6000)}${content.length > 6000 ? '\n[... arquivo truncado ...]' : ''}\n--- Fim: ${a.filename} ---`;
          } catch {
            return `\n\n📎 ${a.filename} (erro ao ler conteúdo)`;
          }
        }

        if (isPdf) {
          // PDF não pode ser decodificado como texto diretamente no browser sem lib
          // Registra como referência — as IAs que suportam documentos (Claude) podem receber via API
          return `\n\n📎 Contexto PDF: ${a.filename} (${(a.size/1024).toFixed(1)}KB) — conteúdo binário, descreva o contexto manualmente ou use um arquivo de texto`;
        }

        if (isImage) {
          return `\n\n📎 Imagem anexada: ${a.filename} (${(a.size/1024).toFixed(1)}KB)`;
        }

        return `\n\n📎 ${a.filename}`;
      });

      setAttachments(prev => [...prev, ...results]);
      const current = store.problem;
      store.setProblem((current + textParts.join('')).trim());

    } catch (err) {
      setError('Erro ao processar arquivo: ' + err.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  function removeAttachment(filename) {
    setAttachments(prev => prev.filter(a => a.filename !== filename));
    // Remove o bloco de conteúdo do arquivo do problema
    const problem = store.problem;
    const startMarker = `\n\n--- Arquivo: ${filename} ---`;
    const endMarker   = `--- Fim: ${filename} ---`;
    const start = problem.indexOf(startMarker);
    const end   = problem.indexOf(endMarker);
    if (start !== -1 && end !== -1) {
      store.setProblem((problem.slice(0, start) + problem.slice(end + endMarker.length)).trim());
    } else {
      // Fallback para referências simples
      store.setProblem(problem.replace(`\n\n📎 Contexto PDF: ${filename}`, '').replace(`\n\n📎 Imagem anexada: ${filename}`, '').replace(`\n\n📎 ${filename}`, '').trim());
    }
  }

  function handleScenarioSelect(id) {
    const preset = [...PRESET_SCENARIOS, ...savedScenarios].find(s => s.id === id);
    if (!preset) return;
    store.setConstitution({ scenarioId: id, scenarioText: preset.text });
    // Recarrega arquivos de pesquisa do novo cenário
    listResearchFiles(id !== 'custom' ? id : null).then(files => {
      setSavedFiles(files);
      setSelectedFiles([]); // limpa seleção ao trocar cenário
    });
  }

  function handleSaveScenario() {
    const name = prompt('Nome do cenário:');
    if (!name?.trim()) return;
    const scenario = {
      id:    `custom_${Date.now()}`,
      icon:  '✏️',
      label: name.trim(),
      text:  store.constitution.scenarioText,
    };
    const updated = [...savedScenarios, scenario];
    setSavedScenarios(updated);
    localStorage.setItem('saved_scenarios', JSON.stringify(updated));
    store.setConstitution({ scenarioId: scenario.id });
  }

  function handleDeleteScenario(id) {
    const updated = savedScenarios.filter(s => s.id !== id);
    setSavedScenarios(updated);
    localStorage.setItem('saved_scenarios', JSON.stringify(updated));
  }

  function toggleRule(ruleId) {
    const rules = store.constitution.rules;
    store.setConstitution({
      rules: rules.includes(ruleId)
        ? rules.filter(r => r !== ruleId)
        : [...rules, ruleId],
    });
  }

  async function handleFetchUrl() {
    if (!urlInput.trim()) return;
    setFetchingUrl(true);
    setUrlError(null);
    const scenarioId = store.constitution?.scenarioId ?? 'custom';
    try {
      const result = await fetchResearchUrl(urlInput.trim(), scenarioId);
      setSavedFiles(prev => [result, ...prev]);
      setSelectedFiles(prev => [...prev, result.filename]);
      setUrlInput('');
    } catch (err) {
      setUrlError(err.message);
    } finally {
      setFetchingUrl(false);
    }
  }

  async function handleDeleteResearchFile(filename, scenarioId) {
    await deleteResearchFile(filename, scenarioId);
    setSavedFiles(prev => prev.filter(f => f.filename !== filename));
    setSelectedFiles(prev => prev.filter(f => f !== filename));
  }

  function toggleResearchFile(filename) {
    setSelectedFiles(prev =>
      prev.includes(filename)
        ? prev.filter(f => f !== filename)
        : [...prev, filename]
    );
  }

  async function handleTestConnections() {
    setTesting(true);
    setTestResults(null);
    try {
      const results = await testAgentConnections(modelOverrides);
      setTestResults(results);
    } catch (err) {
      setError('Erro ao testar conexões: ' + err.message);
    } finally {
      setTesting(false);
    }
  }

  async function handleStart() {
    if (!store.problem.trim()) { setError('Descreva o problema antes de continuar.'); return; }
    if (store.agentIds.length < 2) { setError('Selecione pelo menos 2 IAs.'); return; }

    setLoading(true);
    setError(null);

    try {
      const effectiveAgents = store.moderatorDebates
        ? store.agentIds
        : store.agentIds.filter(id => id !== store.moderatorId);

      // Monta contexto das URLs selecionadas
      let researchContext = null;
      if (selectedFiles.length > 0) {
        const contents = await Promise.all(
          selectedFiles.map(async (filename) => {
            try {
              const file = savedFiles.find(f => f.filename === filename);
              const scenarioId = file?.scenarioId ?? 'custom';
              const data = await loadResearchFileContent(filename, scenarioId);
              return `=== ${file?.url ?? filename} ===\n${data.content}`;
            } catch { return null; }
          })
        );
        researchContext = contents.filter(Boolean).join('\n\n');
      }

      const { sessionId } = await startDebate({
        problem:            store.problem,
        agentIds:           effectiveAgents,
        moderatorId:        store.moderatorId,
        speed:              store.speed,
        briefings:          store.briefings,
        constitution:       store.constitution,
        researcherId:       researcherId || null,
        researchContext:    researchContext,
        modelOverrides:     modelOverrides,
        roundLimit:         roundLimit,
        clarificationRound: clarificationRound,
        contextSessions:    contextSessions,
        contextMode:        contextMode,
        synthesisObjective: synthesisObjective,
        synthesizerId:      synthesizerId,
        adversaryId:        adversaryId,
        factCheckerId:      factCheckerId,
        factCheckerModel:   factCheckerModel,
      });

      store.setSessionId(sessionId);
      store.setSynthesisConfig({ objective: synthesisObjective, synthesizerId });
      store.setStatus('running');
      navigate('/debate');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const participantAgents = store.moderatorDebates
    ? store.agentIds
    : store.agentIds.filter(id => id !== store.moderatorId);

  return (
    <div className={styles.page}>
      <div className={styles.container}>

        {/* Header */}
        <div className={styles.header}>
          <div className={styles.eyebrow}>Council AI</div>
          <h1 className={styles.title}>Monte sua sala de debate</h1>
        </div>

        {/* Template selector */}
        {templates.length > 0 && (
          <div className={styles.section}>
            <label className={styles.label}>Usar template</label>
            <select className={styles.select} onChange={e => applyTemplate(templates.find(t => t.filename === e.target.value))}>
              <option value="">Sem template</option>
              {templates.map(t => <option key={t.filename} value={t.filename}>{t.name}</option>)}
            </select>
          </div>
        )}

        {/* Problem */}
        <div className={styles.section}>
          <label className={styles.label}>Problema a debater</label>
          <div className={styles.problemWrap}>
            <textarea
              className={styles.textarea}
              placeholder="Descreva o problema técnico que as IAs vão debater..."
              value={store.problem}
              onChange={e => store.setProblem(e.target.value)}
              rows={4}
            />
            <div className={styles.problemActions}>
              <input
                ref={fileInputRef}
                type="file"
                style={{ display: 'none' }}
                accept={UI_CONFIG.supportedFileTypes.join(',')}
                multiple
                onChange={handleFileUpload}
              />
              <button
                className={styles.attachBtn}
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                title="Anexar arquivo como contexto (PDF, imagem, código...)"
              >
                {uploading ? '...' : '📎 Anexar contexto'}
              </button>
            </div>
          </div>

          {/* Attachments list */}
          {attachments.length > 0 && (
            <div className={styles.attachments}>
              {attachments.map(a => (
                <div key={a.filename} className={styles.attachmentItem}>
                  <span className={styles.attachmentIcon}>
                    {a.mimetype?.startsWith('image/') ? '🖼' :
                     a.mimetype === 'application/pdf' ? '📄' : '📎'}
                  </span>
                  <span className={styles.attachmentName}>{a.filename}</span>
                  <span className={styles.attachmentSize}>
                    {(a.size / 1024).toFixed(1)}KB
                  </span>
                  <button
                    className={styles.attachmentRemove}
                    onClick={() => removeAttachment(a.filename)}
                    title="Remover"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Agent selector */}
        <div className={styles.section}>
          <label className={styles.label}>Participantes</label>
          <div className={styles.agentGrid}>
            {Object.entries(agents).map(([id, cfg]) => {
              const selected      = store.agentIds.includes(id);
              const isMod         = id === store.moderatorId && !store.moderatorDebates;
              const activeModel   = modelOverrides[id] ?? cfg.model;
              const modelLabel    = cfg.models?.find(m => m.id === activeModel)?.label ?? activeModel;
              const modelNote     = cfg.models?.find(m => m.id === activeModel)?.note ?? '';

              return (
                <div
                  key={id}
                  className={`${styles.agentCardWrap} ${selected ? styles.agentCardWrapSelected : ''} ${isMod ? styles.agentCardWrapMod : ''}`}
                  style={{ '--agent-color': cfg.color }}
                >
                  {/* Card principal — toggle seleção */}
                  <button
                    className={styles.agentCard}
                    onClick={() => !isMod && toggleAgent(id)}
                    title={isMod ? 'Atuando como moderador' : ''}
                  >
                    <span className={styles.agentIcon}>{cfg.icon}</span>
                    <span className={styles.agentName}>{cfg.name}</span>
                    <span className={styles.agentCompany}>{cfg.company}</span>
                    {isMod && <span className={styles.modBadge}>⚖ mod</span>}
                  </button>

                  {/* Model selector — abaixo do card */}
                  {cfg.models?.length > 0 && (
                    <select
                      className={styles.modelSelect}
                      value={activeModel}
                      onChange={e => { e.stopPropagation(); setModelForAgent(id, e.target.value); }}
                      title={`Modelo ativo: ${modelLabel}${modelNote ? ` — ${modelNote}` : ''}`}
                    >
                      {cfg.models.map(m => (
                        <option key={m.id} value={m.id}>
                          {m.label}{m.note ? ` — ${m.note}` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              );
            })}
          </div>
          {participantAgents.length < 2 && (
            <p className={styles.hint}>Selecione pelo menos 2 IAs para debater.</p>
          )}
        </div>

        {/* Moderator */}
        <div className={styles.section}>
          <label className={styles.label}>Moderador</label>
          <select
            className={styles.select}
            value={store.moderatorId}
            onChange={e => store.setModerator(e.target.value, store.moderatorDebates)}
          >
            {Object.entries(agents).map(([id, cfg]) => (
              <option key={id} value={id}>{cfg.icon} {cfg.name}</option>
            ))}
          </select>
          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={store.moderatorDebates}
              onChange={e => store.setModerator(store.moderatorId, e.target.checked)}
            />
            <span>Moderador também participa do debate</span>
            <span className={styles.checkboxHint}>
              {store.moderatorDebates
                ? '⚠ Pode gerar conflito de interesse — a IA responde e avalia ao mesmo tempo'
                : 'Moderador só avalia — é removido da lista de participantes'}
            </span>
          </label>
        </div>

        {/* Research sources */}
        <div className={styles.section}>
          <button className={styles.collapsible} onClick={() => setResearchOpen(o => !o)}>
            <span>Fontes de pesquisa</span>
            <span className={styles.optionalTag}>
              {selectedFiles.length > 0 ? `${selectedFiles.length} fonte${selectedFiles.length > 1 ? 's' : ''}` : 'opcional'}
            </span>
            <span className={styles.chevron}>{researchOpen ? '▲' : '▼'}</span>
          </button>

          {researchOpen && (
            <div className={styles.constitutionPanel}>

              {/* URL fetch */}
              <div className={styles.constitutionBlock}>
                <div className={styles.constitutionLabel}>Adicionar URL como fonte</div>
                <div className={styles.urlRow}>
                  <input
                    className={styles.urlInput}
                    type="url"
                    placeholder="https://arxiv.org/abs/... ou qualquer página web"
                    value={urlInput}
                    onChange={e => setUrlInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleFetchUrl()}
                    disabled={fetchingUrl}
                  />
                  <button
                    className={styles.fetchBtn}
                    onClick={handleFetchUrl}
                    disabled={fetchingUrl || !urlInput.trim()}
                  >
                    {fetchingUrl ? '⏳ Baixando...' : '⬇ Buscar'}
                  </button>
                </div>
                {urlError && <div className={styles.urlError}>⚠ {urlError}</div>}
              </div>

              {/* Saved files */}
              {savedFiles.length > 0 && (
                <div className={styles.constitutionBlock}>
                  <div className={styles.constitutionLabel}>
                    Fontes disponíveis — marque as que entram neste debate
                  </div>
                  <div className={styles.researchFiles}>
                    {savedFiles.map(f => (
                      <label key={f.filename} className={`${styles.researchFile} ${selectedFiles.includes(f.filename) ? styles.researchFileSelected : ''}`}>
                        <input
                          type="checkbox"
                          checked={selectedFiles.includes(f.filename)}
                          onChange={() => toggleResearchFile(f.filename)}
                        />
                        <div className={styles.researchFileInfo}>
                          <span className={styles.researchFileUrl}>{f.url}</span>
                          <span className={styles.researchFileMeta}>
                            {(f.size / 1024).toFixed(0)}KB · {new Date(f.savedAt).toLocaleDateString('pt-BR')}
                            {f.scenarioId && f.scenarioId !== store.constitution?.scenarioId && (
                              <span className={styles.researchFileScenario}> · {f.scenarioId}</span>
                            )}
                          </span>
                        </div>
                        <button
                          className={styles.researchFileDelete}
                          onClick={e => { e.preventDefault(); handleDeleteResearchFile(f.filename, f.scenarioId); }}
                          title="Remover"
                        >✕</button>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Researcher AI */}
              <div className={styles.constitutionBlock}>
                <div className={styles.constitutionLabel}>Pesquisador automático</div>
                <select
                  className={styles.select}
                  value={researcherId}
                  onChange={e => setResearcherId(e.target.value)}
                >
                  <option value="">Nenhum — só usar as URLs acima</option>
                  <option value="perplexity" disabled={!agents.perplexity}>
                    ◉ Perplexity — busca web nativa ✓ sem config extra
                  </option>
                  <option value="gpt" disabled={!agents.gpt}>
                    ◎ GPT-4 — web search via tool use ✓ mesma API key
                  </option>
                  <option value="gemini" disabled={!agents.gemini}>
                    ◇ Gemini — Google Search nativo ✓ mesma API key
                  </option>
                </select>

                {researcherId === 'perplexity' && (
                  <div className={styles.researcherNote}>
                    ℹ️ Perplexity busca a web automaticamente — nenhuma configuração extra necessária.
                  </div>
                )}
                {researcherId === 'gpt' && (
                  <div className={styles.researcherNote}>
                    ℹ️ GPT-4 usa web search via tool use com a mesma OPENAI_API_KEY. Pode gerar pequeno custo adicional por busca.
                  </div>
                )}
                {researcherId === 'gemini' && (
                  <div className={styles.researcherNote}>
                    ℹ️ Gemini usa Google Search integrado com a mesma GEMINI_API_KEY. Sem configuração extra.
                  </div>
                )}

                {researcherId && (
                  <div className={styles.researcherFlow}>
                    <span>🔍 {agents[researcherId]?.name ?? researcherId} pesquisa</span>
                    <span>→</span>
                    <span>📋 resultado entra no contexto</span>
                    <span>→</span>
                    <span>🤖 IAs debatem com evidências</span>
                  </div>
                )}
              </div>

            </div>
          )}
        </div>

        {/* Constitution */}
        <div className={styles.section}>
          <button className={styles.collapsible} onClick={() => setConstitutionOpen(o => !o)}>
            <span>Como debater</span>
            <span className={styles.optionalTag}>
              {DEBATE_TONES.find(t => t.id === store.constitution.tone)?.icon} {DEBATE_TONES.find(t => t.id === store.constitution.tone)?.label}
            </span>
            <span className={styles.chevron}>{constitutionOpen ? '▲' : '▼'}</span>
          </button>

          {constitutionOpen && (
            <div className={styles.constitutionPanel}>

              {/* Cenário */}
              <div className={styles.constitutionBlock}>
                <div className={styles.constitutionLabel}>Cenário organizacional</div>
                <div className={styles.scenarioRow}>
                  <select
                    className={styles.select}
                    value={store.constitution.scenarioId}
                    onChange={e => handleScenarioSelect(e.target.value)}
                  >
                    <optgroup label="Cenários pré-definidos">
                      {PRESET_SCENARIOS.map(s => (
                        <option key={s.id} value={s.id}>{s.icon} {s.label}</option>
                      ))}
                    </optgroup>
                    {savedScenarios.length > 0 && (
                      <optgroup label="Meus cenários">
                        {savedScenarios.map(s => (
                          <option key={s.id} value={s.id}>{s.icon} {s.label}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  <button className={styles.saveScenarioBtn} onClick={handleSaveScenario} title="Salvar cenário atual">
                    💾
                  </button>
                  {savedScenarios.find(s => s.id === store.constitution.scenarioId) && (
                    <button className={styles.deleteScenarioBtn} onClick={() => handleDeleteScenario(store.constitution.scenarioId)} title="Excluir este cenário">
                      🗑
                    </button>
                  )}
                </div>
                <textarea
                  className={styles.briefingTextarea}
                  rows={4}
                  placeholder="Descreva o contexto organizacional, valores e restrições que as IAs devem seguir..."
                  value={store.constitution.scenarioText}
                  onChange={e => store.setConstitution({ scenarioText: e.target.value })}
                />
              </div>

              {/* Tom */}
              <div className={styles.constitutionBlock}>
                <div className={styles.constitutionLabel}>Tom do debate</div>
                <div className={styles.toneGrid}>
                  {DEBATE_TONES.map(t => (
                    <button
                      key={t.id}
                      className={`${styles.toneBtn} ${store.constitution.tone === t.id ? styles.toneSelected : ''}`}
                      onClick={() => store.setConstitution({ tone: t.id })}
                      title={t.description}
                    >
                      <span>{t.icon}</span>
                      <span>{t.label}</span>
                      <span className={styles.toneDesc}>{t.description}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Regras */}
              <div className={styles.constitutionBlock}>
                <div className={styles.constitutionLabel}>Regras da sala</div>
                <div className={styles.rulesList}>
                  {DEBATE_RULES.map(rule => (
                    <label key={rule.id} className={styles.ruleRow}>
                      <input
                        type="checkbox"
                        checked={store.constitution.rules.includes(rule.id)}
                        onChange={() => toggleRule(rule.id)}
                      />
                      <div className={styles.ruleText}>
                        <span className={styles.ruleLabel}>{rule.label}</span>
                        <span className={styles.ruleDesc}>{rule.description}</span>
                      </div>
                      {rule.id === 'word_limit' && store.constitution.rules.includes('word_limit') && (
                        <input
                          type="number"
                          className={styles.wordLimitInput}
                          value={store.constitution.wordLimit}
                          min={50} max={800} step={50}
                          onChange={e => store.setConstitution({ wordLimit: parseInt(e.target.value) || 150 })}
                        />
                      )}
                    </label>
                  ))}
                </div>
              </div>

              {/* Voz estendida */}
              <div className={styles.constitutionBlock}>
                <div className={styles.constitutionLabel}>Voz estendida</div>
                <select
                  className={styles.select}
                  value={store.constitution.extendedVoiceAgent ?? ''}
                  onChange={e => store.setConstitution({ extendedVoiceAgent: e.target.value || null })}
                >
                  <option value="">Nenhuma — todas com o mesmo limite</option>
                  {store.agentIds.map(id => {
                    const cfg = agents[id];
                    return cfg ? <option key={id} value={id}>{cfg.icon} {cfg.name} — pode responder mais</option> : null;
                  })}
                </select>
              </div>

            </div>
          )}
        </div>

        {/* Briefings */}
        <div className={styles.section}>
          <button className={styles.collapsible} onClick={() => setBriefingsOpen(o => !o)}>
            <span>Briefing privado por IA</span>
            <span className={styles.optionalTag}>opcional</span>
            <span className={styles.chevron}>{briefingsOpen ? '▲' : '▼'}</span>
          </button>
          {briefingsOpen && (
            <div className={styles.briefingList}>
              <p className={styles.briefingHint}>
                Instrua cada IA em particular antes do debate começar. As outras IAs não saberão.
              </p>
              {store.agentIds.map(id => {
                const cfg = agents[id];
                if (!cfg) return null;
                return (
                  <div key={id} className={styles.briefingItem}>
                    <label className={styles.briefingLabel} style={{ color: cfg.color }}>
                      {cfg.icon} {cfg.name}
                    </label>
                    <textarea
                      className={styles.briefingTextarea}
                      placeholder={`Instrução privada para ${cfg.name}...`}
                      value={store.briefings[id] ?? ''}
                      onChange={e => store.setBriefing(id, e.target.value)}
                      rows={2}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {error && <div className={styles.error}>{error}</div>}

        {/* ── Sessões anteriores como contexto ──────────────────────────── */}
        <div className={styles.section}>
          <button className={styles.collapsible} onClick={() => setKnowledgeOpen(o => !o)}>
            <span>🧠 Contexto de sessões anteriores</span>
            {contextSessions.length > 0 && <span className={styles.optionalTag}>{contextSessions.length} sessão(ões)</span>}
            <span className={styles.optionalTag}>opcional</span>
            <span className={styles.chevron}>{knowledgeOpen ? '▲' : '▼'}</span>
          </button>
          {knowledgeOpen && (
            <div className={styles.briefingList}>
              {knowledgeSessions.length === 0 ? (
                <p className={styles.briefingHint}>Nenhuma sessão marcada como Knowledge Base ainda. Finalize um debate e marque-o como referência no histórico.</p>
              ) : (
                <>
                  <p className={styles.briefingHint}>Selecione sessões anteriores para usar como contexto neste debate.</p>
                  {knowledgeSessions.map(s => (
                    <div key={s.sessionId} className={styles.knowledgeItem}>
                      <label className={styles.checkboxRow}>
                        <input type="checkbox"
                          checked={contextSessions.includes(s.sessionId)}
                          onChange={e => setContextSessions(prev =>
                            e.target.checked ? [...prev, s.sessionId] : prev.filter(id => id !== s.sessionId)
                          )}
                        />
                        <div>
                          <span className={styles.knowledgeTitle}>{s.theme || s.problem?.slice(0, 60)}</span>
                          {s.tags?.length > 0 && <span className={styles.knowledgeTags}>{s.tags.join(' · ')}</span>}
                          <span className={styles.knowledgeDate}>{new Date(s.startedAt).toLocaleDateString('pt-BR')}</span>
                        </div>
                      </label>
                    </div>
                  ))}
                </>
              )}

              {contextSessions.length > 0 && (
                <div className={styles.section}>
                  <label className={styles.label}>Como usar este contexto?</label>
                  {[
                    { id: 'continue',  icon: '🔄', label: 'Continuar e refinar',      desc: 'As IAs sabem tudo que foi decidido antes e constroem em cima. Bom para aprofundar ou resolver o que ficou em aberto.' },
                    { id: 'light',     icon: '💡', label: 'Inspiração leve',           desc: 'As IAs recebem só o resumo final. Sabem que existe mas não ficam presas. Bom para explorar direções novas sem partir do zero.' },
                    { id: 'challenge', icon: '⚔️', label: 'Questionar e refutar',      desc: 'As IAs recebem o passado com missão de encontrar falhas e alternativas melhores. Bom para validar se uma decisão ainda faz sentido.' },
                    { id: 'break',     icon: '💥', label: 'Romper com o passado',      desc: 'As IAs ignoram o caminho anterior e propõem algo completamente diferente. O passado entra só para dizer "não vá por aqui".' },
                    { id: 'free',      icon: '🆓', label: 'Debate livre',              desc: 'Nenhum contexto passado. As IAs exploram sem âncora. Bom para ideias genuinamente novas.' },
                  ].map(mode => (
                    <label key={mode.id} className={`${styles.modeOption} ${contextMode === mode.id ? styles.modeSelected : ''}`}
                      onClick={() => setContextMode(mode.id)}>
                      <div className={styles.modeHeader}>
                        <span>{mode.icon}</span>
                        <span className={styles.modeLabel}>{mode.label}</span>
                        {contextMode === mode.id && <span className={styles.modeCheck}>✓</span>}
                      </div>
                      <span className={styles.modeDesc}>{mode.desc}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Limitador de rounds ────────────────────────────────────────── */}
        <div className={styles.section}>
          <label className={styles.label}>Pausa automática a cada</label>
          <div className={styles.speedGrid}>
            {[null, 3, 5, 10, 15].map(n => (
              <button key={n ?? 'none'}
                className={`${styles.speedBtn} ${roundLimit === n ? styles.speedSelected : ''}`}
                onClick={() => setRoundLimit(n)}>
                {n === null ? 'Sem limite' : `${n} rounds`}
              </button>
            ))}
          </div>
          {roundLimit && <p className={styles.briefingHint}>O debate pausa a cada {roundLimit} rounds para você revisar e decidir se continua.</p>}
        </div>

        {/* ── Round 0 — Clarification ────────────────────────────────────── */}
        <div className={styles.section}>
          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={clarificationRound}
              onChange={e => setClarificationRound(e.target.checked)} />
            <div>
              <span>Permitir que as IAs peçam contexto antes de começar</span>
              <span className={styles.checkboxHint}>
                Antes do Round 1, a primeira IA avalia se tem informação suficiente. Se faltar algo, o debate pausa para você fornecer mais contexto.
              </span>
            </div>
          </label>
        </div>

        {/* ── Adversário ─────────────────────────────────────────────────── */}
        <div className={styles.section}>
          <label className={styles.checkboxRow}>
            <input type="checkbox"
              checked={adversaryId !== null}
              onChange={e => setAdversaryId(e.target.checked ? 'claude' : null)} />
            <div>
              <span>⚔ Ativar adversário</span>
              <span className={styles.checkboxHint}>
                Após cada round, uma IA questiona as respostas das outras — aponta argumentos fracos, repetições e premissas não desafiadas. Ela não vê as próprias respostas anteriores para evitar conflito de interesse.
              </span>
            </div>
          </label>

          {adversaryId !== null && (
            <div style={{ marginTop: 10 }}>
              <label className={styles.label}>Qual IA assume o papel de adversário?</label>
              <div className={styles.agentGrid} style={{ marginTop: 8 }}>
                {Object.entries(agents).map(([id, cfg]) => (
                  <div key={id}
                    className={`${styles.agentCardWrap} ${adversaryId === id ? styles.agentCardWrapSelected : ''}`}
                    style={{ '--agent-color': cfg.color, cursor: 'pointer' }}
                    onClick={() => setAdversaryId(id)}>
                    <div className={styles.agentCard}>
                      <span className={styles.agentIcon}>{cfg.icon}</span>
                      <span className={styles.agentName}>{cfg.name}</span>
                      <span className={styles.agentCompany}>
                        {adversaryId === id ? '⚔ adversário' : cfg.company}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <p className={styles.briefingHint}>
                A IA escolhida continua participando normalmente do debate — ela acumula os dois papéis. Ela não vê as próprias respostas quando está no papel de adversário.
              </p>
            </div>
          )}
        </div>

        {/* ── Verificador de fatos ───────────────────────────────────────── */}
        <div className={styles.section}>
          <label className={styles.checkboxRow}>
            <input type="checkbox"
              checked={factCheckerId !== null}
              onChange={e => {
                setFactCheckerId(e.target.checked ? 'perplexity' : null);
                setFactCheckerModel(null);
              }} />
            <div>
              <span>🔍 Ativar verificador de fatos</span>
              <span className={styles.checkboxHint}>
                Quando o debate contiver claims factuais contraditórios (números, datas, versões, preços), esta IA verifica com fontes externas antes do próximo round.
              </span>
            </div>
          </label>

          {factCheckerId !== null && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label className={styles.label}>Qual IA verifica os fatos?</label>
              <div className={styles.agentGrid}>
                {Object.entries(agents).map(([id, cfg]) => {
                  const hasWebAccess = id === 'perplexity';
                  const isSelected   = factCheckerId === id;
                  return (
                    <div key={id}
                      className={`${styles.agentCardWrap} ${isSelected ? styles.agentCardWrapSelected : ''}`}
                      style={{ '--agent-color': cfg.color, cursor: 'pointer' }}
                      onClick={() => { setFactCheckerId(id); setFactCheckerModel(null); }}>
                      <div className={styles.agentCard}>
                        <span className={styles.agentIcon}>{cfg.icon}</span>
                        <span className={styles.agentName}>{cfg.name}</span>
                        <span className={styles.agentCompany}>
                          {isSelected
                            ? (hasWebAccess ? '🌐 busca web real' : '⚠ sem web')
                            : (hasWebAccess ? '🌐 web nativa' : cfg.company)
                          }
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Aviso de acesso web */}
              {factCheckerId && factCheckerId !== 'perplexity' && (
                <div className={styles.factCheckerWarning}>
                  ⚠ {agents[factCheckerId]?.name} não tem acesso à web neste sistema. Vai verificar com conhecimento de treinamento, que pode estar desatualizado. Para grounding externo real, use Perplexity.
                </div>
              )}
              {factCheckerId === 'perplexity' && (
                <div className={styles.factCheckerOk}>
                  ✓ Perplexity busca a web em tempo real e retorna as fontes consultadas. Você verá as URLs no chat quando uma verificação ocorrer.
                </div>
              )}

              {/* Seletor de modelo */}
              {factCheckerId && agents[factCheckerId]?.models?.length > 0 && (
                <div>
                  <label className={styles.label}>Modelo do verificador</label>
                  <select
                    className={styles.select}
                    value={factCheckerModel ?? agents[factCheckerId]?.model ?? ''}
                    onChange={e => setFactCheckerModel(e.target.value)}
                    style={{ marginTop: 6 }}
                  >
                    {agents[factCheckerId].models.map(m => (
                      <option key={m.id} value={m.id}>
                        {m.label}{m.note ? ` — ${m.note}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Sintetizador final ─────────────────────────────────────────────────────── */}
        <div className={styles.section}>
          <button className={styles.collapsible} onClick={() => setSynthOpen(o => !o)}>
            <span>📄 Documento final — Sintetizador</span>
            <span className={styles.optionalTag}>opcional</span>
            <span className={styles.chevron}>{synthOpen ? '▲' : '▼'}</span>
          </button>
          {synthOpen && (
            <div className={styles.briefingList}>
              <p className={styles.briefingHint}>Ao finalizar, uma IA lê todo o debate e gera um documento estruturado.</p>

              <div>
                <label className={styles.label}>O que você quer produzir?</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                  {[
                    { id: 'decision', label: '🎯 Decisão fundamentada', desc: 'Recomendação clara com riscos e próximos passos' },
                    { id: 'spec',     label: '⚙️ Especificação técnica', desc: 'Documento para implementar ou delegar' },
                    { id: 'article',  label: '📝 Artigo / Publicação',   desc: 'Texto estruturado com argumentos e fontes' },
                    { id: 'business', label: '💼 Plano de negócio',       desc: 'Análise de viabilidade, mercado, estratégia' },
                    { id: 'research', label: '🔬 Pesquisa e análise',     desc: 'Mapeamento do tema, lacunas, estado da arte' },
                    { id: 'custom',   label: '✏️ Personalizado',          desc: 'Síntese geral completa do debate' },
                  ].map(obj => (
                    <label key={obj.id} className={`${styles.modeOption} ${synthesisObjective === obj.id ? styles.modeSelected : ''}`}
                      onClick={() => setSynthesisObjective(obj.id)}>
                      <div className={styles.modeHeader}>
                        <span className={styles.modeLabel}>{obj.label}</span>
                        {synthesisObjective === obj.id && <span className={styles.modeCheck}>✓</span>}
                      </div>
                      <span className={styles.modeDesc}>{obj.desc}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <label className={styles.label}>Quem sintetiza?</label>
                <div className={styles.agentGrid} style={{ marginTop: 8 }}>
                  {Object.entries(agents).map(([id, cfg]) => {
                    const strengths = {
                      claude:     'Raciocínio estruturado e nuances',
                      gpt:        'Formato executivo e linguagem de negócios',
                      gemini:     'Análise abrangente e estrutura',
                      perplexity: 'Pesquisa com fontes reais',
                      deepseek:   'Síntese eficiente e objetiva',
                      grok:       'Perspectiva direta e não convencional',
                      mistral:    'Abordagem vendor-neutral e prática',
                    };
                    return (
                      <div key={id}
                        className={`${styles.agentCardWrap} ${synthesizerId === id ? styles.agentCardWrapSelected : ''}`}
                        style={{ '--agent-color': cfg.color, cursor: 'pointer' }}
                        onClick={() => setSynthesizerId(id)}>
                        <div className={styles.agentCard} style={{ padding: '10px 8px' }}>
                          <span className={styles.agentIcon}>{cfg.icon}</span>
                          <span className={styles.agentName}>{cfg.name}</span>
                          <span className={styles.agentCompany} style={{ fontSize: 9, textAlign: 'center', lineHeight: 1.3 }}>
                            {strengths[id]}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className={styles.section}>
          <button
            className={styles.testBtn}
            onClick={handleTestConnections}
            disabled={testing}
          >
            {testing ? '⏳ Testando conexões...' : '🔌 Testar conexões'}
          </button>

          {testResults && (
            <div className={styles.testResults}>
              {Object.entries(agents).map(([id, cfg]) => {
                const r = testResults[id];
                if (!r) return null;
                return (
                  <div key={id} className={`${styles.testRow} ${r.ok ? styles.testOk : styles.testFail}`}>
                    <span className={styles.testIcon} style={{ color: cfg.color }}>{cfg.icon}</span>
                    <span className={styles.testName}>{cfg.name}</span>
                    <span className={styles.testModel}>{r.model}</span>
                    {r.ok ? (
                      <>
                        <span className={styles.testStatus}>✅ {r.latency}ms</span>
                        {r.preview && <span className={styles.testPreview}>"{r.preview}"</span>}
                      </>
                    ) : (
                      <>
                        <span className={styles.testStatus}>❌ {r.latency}ms</span>
                        <span className={styles.testError}>{r.error}</span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className={styles.actions}>
          <button className={styles.historyBtn} onClick={() => navigate('/history')}>
            📋 Histórico
          </button>
          <button className={styles.saveTemplateBtn} onClick={() => setSaveModal(true)}>
            💾 Salvar config
          </button>
          <button
            className={styles.startBtn}
            onClick={handleStart}
            disabled={loading || participantAgents.length < 2 || !store.problem.trim()}
          >
            {loading ? 'Iniciando...' : 'Iniciar debate →'}
          </button>
        </div>

        {/* Save template modal */}
        {saveModal && (
          <div className={styles.modalOverlay} onClick={() => setSaveModal(false)}>
            <div className={styles.modal} onClick={e => e.stopPropagation()}>
              <div className={styles.modalTitle}>Salvar configuração como template</div>
              <input
                className={styles.modalInput}
                placeholder="Nome do template..."
                value={templateName}
                onChange={e => setTemplateName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSaveTemplate()}
                autoFocus
              />
              <div className={styles.modalActions}>
                <button className={styles.modalCancel} onClick={() => setSaveModal(false)}>Cancelar</button>
                <button
                  className={styles.modalSave}
                  onClick={handleSaveTemplate}
                  disabled={saving || !templateName.trim()}
                >
                  {saving ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
