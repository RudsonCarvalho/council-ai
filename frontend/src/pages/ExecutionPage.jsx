import { useState, useEffect } from 'react';
import { useNavigate }         from 'react-router-dom';
import { useDebateStore }      from '../store/debate.store.js';
import { fetchExecutors, executeSpec, storeExecutorCredentials } from '../services/debate.service.js';
import { downloadMarkdown }    from '../utils/format.js';
import styles from './ExecutionPage.module.css';

export default function ExecutionPage() {
  const navigate  = useNavigate();
  const store     = useDebateStore();

  const [executors,    setExecutors]    = useState([]);
  const [selected,     setSelected]     = useState([]);
  const [credentials,  setCredentials]  = useState({});
  const [credOpen,     setCredOpen]     = useState({});
  const [spec,         setSpec]         = useState(store.consensusResult?.spec ?? '');
  const [workDir,      setWorkDir]      = useState('');
  const [executing,    setExecuting]    = useState(false);
  const [results,      setResults]      = useState([]);

  useEffect(() => {
    fetchExecutors().then(setExecutors);
  }, []);

  function toggleExecutor(id) {
    setSelected(s => s.includes(id) ? s.filter(e => e !== id) : [...s, id]);
  }

  async function handleExecute() {
    if (!spec.trim() || selected.length === 0) return;
    setExecuting(true);
    setResults([]);

    // Store credentials privately first
    for (const execId of selected) {
      if (credentials[execId]?.trim()) {
        await storeExecutorCredentials(execId, store.sessionId, credentials[execId]);
      }
    }

    // Execute in parallel
    const execResults = await Promise.allSettled(
      selected.map(execId =>
        executeSpec(execId, { spec, workDir: workDir || undefined })
          .then(r => ({ execId, ...r }))
          .catch(err => ({ execId, success: false, error: err.message }))
      )
    );

    setResults(execResults.map(r => r.value ?? r.reason));
    setExecuting(false);
  }

  return (
    <div className={styles.page}>
      <div className={styles.container}>

        <div className={styles.header}>
          <button className={styles.back} onClick={() => navigate('/debate')}>← Voltar</button>
          <h1 className={styles.title}>Executar especificação</h1>
        </div>

        {/* Spec editor */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Especificação técnica</div>
          <textarea
            className={styles.specEditor}
            value={spec}
            onChange={e => setSpec(e.target.value)}
            rows={12}
            placeholder="Especificação técnica gerada pelo debate..."
          />
          <div className={styles.specActions}>
            <button className={styles.downloadBtn} onClick={() => downloadMarkdown(spec, 'spec.md')}>
              ⬇ Baixar spec (.md)
            </button>
          </div>
        </div>

        {/* Executor selector */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Selecionar agente executor</div>
          <div className={styles.executorGrid}>
            {executors.map(ex => (
              <div
                key={ex.id}
                className={`${styles.executorCard} ${selected.includes(ex.id) ? styles.selectedCard : ''}`}
                style={{ '--ex-color': ex.color }}
                onClick={() => toggleExecutor(ex.id)}
              >
                <div className={styles.exHeader}>
                  <span className={styles.exIcon} style={{ color: ex.color }}>{ex.icon}</span>
                  <span className={styles.exName}>{ex.name}</span>
                  <span className={`${styles.exStatus} ${ex.status === 'online' ? styles.online : styles.offline}`}>
                    {ex.status === 'online' ? '🟢' : '🔴'}
                  </span>
                </div>
                <p className={styles.exDesc}>{ex.description}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Credentials (private) */}
        {selected.length > 0 && (
          <div className={styles.section}>
            <div className={styles.sectionTitle}>
              🔑 Instruções privadas por executor
              <span className={styles.privateNote}>Não aparece no relatório</span>
            </div>
            {selected.map(execId => {
              const ex = executors.find(e => e.id === execId);
              return (
                <div key={execId} className={styles.credItem}>
                  <button
                    className={styles.credToggle}
                    onClick={() => setCredOpen(o => ({ ...o, [execId]: !o[execId] }))}
                  >
                    <span style={{ color: ex?.color }}>{ex?.icon} {ex?.name}</span>
                    <span>{credOpen[execId] ? '▲' : '▼'}</span>
                  </button>
                  {credOpen[execId] && (
                    <textarea
                      className={styles.credInput}
                      rows={3}
                      placeholder="Credenciais, tokens, paths, instruções privadas..."
                      value={credentials[execId] ?? ''}
                      onChange={e => setCredentials(c => ({ ...c, [execId]: e.target.value }))}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Work directory */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Diretório de trabalho</div>
          <input
            className={styles.input}
            value={workDir}
            onChange={e => setWorkDir(e.target.value)}
            placeholder={`${process.cwd?.() ?? '~/projects/meu-projeto'} (padrão)`}
          />
        </div>

        {/* Execute button */}
        <button
          className={styles.executeBtn}
          onClick={handleExecute}
          disabled={executing || selected.length === 0 || !spec.trim()}
        >
          {executing ? 'Executando...' : `→ Enviar para ${selected.length > 1 ? `${selected.length} agentes` : (executors.find(e => e.id === selected[0])?.name ?? 'agente')}`}
        </button>

        {/* Results */}
        {results.length > 0 && (
          <div className={styles.results}>
            {results.map((r, i) => {
              const ex = executors.find(e => e.id === r.execId);
              return (
                <div key={i} className={`${styles.result} ${r.success ? styles.resultOk : styles.resultErr}`}>
                  <div className={styles.resultHeader}>
                    <span style={{ color: ex?.color }}>{ex?.icon} {ex?.name}</span>
                    <span>{r.success ? '✓ Sucesso' : '✗ Erro'}</span>
                  </div>
                  {r.stdout && <pre className={styles.resultOutput}>{r.stdout}</pre>}
                  {r.stderr && <pre className={styles.resultErr2}>{r.stderr}</pre>}
                  {r.error  && <div className={styles.resultErrMsg}>{r.error}</div>}
                </div>
              );
            })}
          </div>
        )}

        <div className={styles.footer}>
          <button className={styles.backBtn} onClick={() => { store.reset(); navigate('/'); }}>
            Novo debate
          </button>
          <button className={styles.historyBtn} onClick={() => navigate('/history')}>
            Ver histórico
          </button>
        </div>

      </div>
    </div>
  );
}
