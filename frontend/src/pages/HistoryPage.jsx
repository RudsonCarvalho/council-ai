import { useState, useEffect, useRef } from 'react';
import { useNavigate }   from 'react-router-dom';
import { useDebateStore } from '../store/debate.store.js';
import { fetchSessions, deleteSession } from '../services/debate.service.js';
import { AGENTS_CONFIG } from '../../../config/agents.config.js';
import styles from './HistoryPage.module.css';

const BASE = 'http://localhost:3001';

export default function HistoryPage() {
  const navigate  = useNavigate();
  const store     = useDebateStore();
  const [sessions,      setSessions]      = useState([]);
  const [search,        setSearch]        = useState('');
  const [loading,       setLoading]       = useState(true);
  const [selected,      setSelected]      = useState(null);     // sessão selecionada
  const [messages,      setMessages]      = useState([]);        // mensagens da sessão
  const [loadingMsgs,   setLoadingMsgs]   = useState(false);
  const [editTheme,     setEditTheme]     = useState('');
  const [editTags,      setEditTags]      = useState('');
  const [editKb,        setEditKb]        = useState(false);
  const [savingMeta,    setSavingMeta]    = useState(false);
  const [lessons,       setLessons]       = useState([]);
  const [newLesson,     setNewLesson]     = useState('');
  const [editingLesson, setEditingLesson] = useState(null); // index being edited
  const chatRef = useRef(null);

  useEffect(() => {
    fetchSessions().then(data => { setSessions(data); setLoading(false); });
  }, []);

  async function openSession(s) {
    setSelected(s);
    setEditTheme(s.theme ?? '');
    setEditTags((s.tags ?? []).join(', '));
    setEditKb(s.isKnowledgeBase ?? false);
    setLessons(s.lessons ?? []);
    setNewLesson('');
    setEditingLesson(null);
    setMessages([]);
    setLoadingMsgs(true);
    try {
      const res = await fetch(`${BASE}/api/sessions/${s.sessionId}/messages`);
      const data = await res.json();
      setMessages(data);
    } catch { setMessages([]); }
    setLoadingMsgs(false);
    setTimeout(() => chatRef.current?.scrollTo(0, 0), 100);
  }

  async function handleDelete(id) {
    if (!confirm('Excluir esta sessão e todas as mensagens?')) return;
    await deleteSession(id);
    setSessions(prev => prev.filter(x => x.sessionId !== id));
    if (selected?.sessionId === id) setSelected(null);
  }

  async function handleSaveMeta() {
    setSavingMeta(true);
    try {
      await fetch(`${BASE}/api/sessions/${selected.sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          theme: editTheme,
          tags:  editTags.split(',').map(t => t.trim()).filter(Boolean),
          isKnowledgeBase: editKb,
          lessons,
        }),
      });
      setSessions(prev => prev.map(s =>
        s.sessionId === selected.sessionId
          ? { ...s, theme: editTheme, tags: editTags.split(',').map(t => t.trim()).filter(Boolean), isKnowledgeBase: editKb, lessons }
          : s
      ));
      setSelected(prev => ({ ...prev, theme: editTheme, isKnowledgeBase: editKb, lessons }));
    } catch {}
    setSavingMeta(false);
  }

  async function saveLessons(updated) {
    setLessons(updated);
    try {
      await fetch(`${BASE}/api/sessions/${selected.sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lessons: updated }),
      });
      setSessions(prev => prev.map(s =>
        s.sessionId === selected.sessionId ? { ...s, lessons: updated } : s
      ));
    } catch {}
  }

  function addLesson() {
    if (!newLesson.trim()) return;
    saveLessons([...lessons, newLesson.trim()]);
    setNewLesson('');
  }

  function updateLesson(i, text) {
    const updated = lessons.map((l, idx) => idx === i ? text : l);
    saveLessons(updated);
    setEditingLesson(null);
  }

  function removeLesson(i) {
    saveLessons(lessons.filter((_, idx) => idx !== i));
  }

  function handleReopen(s) {
    store.setProblem(s.problem ?? '');
    store.setAgentIds(s.agentIds ?? []);
    store.setModerator(s.moderatorId ?? 'claude', false);
    store.setSpeed(s.speed ?? 0);
    navigate('/');
  }

  function copyAll() {
    const text = messages.map(m => {
      const label = m.isHuman ? 'MODERADOR' : m.agentName;
      return `[Round ${m.round}] ${label}:\n${m.text}`;
    }).join('\n\n---\n\n');
    navigator.clipboard.writeText(text);
  }

  const filtered = sessions.filter(s =>
    !search || (s.problem ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (s.theme ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (s.tags ?? []).some(t => t.toLowerCase().includes(search.toLowerCase()))
  );

  const byRound = {};
  messages.forEach(m => {
    if (!byRound[m.round]) byRound[m.round] = [];
    byRound[m.round].push(m);
  });

  return (
    <div className={styles.page}>

      {/* ── Lista de sessões ─────────────────────────────────────── */}
      <div className={styles.list}>
        <div className={styles.listHeader}>
          <button className={styles.back} onClick={() => navigate('/')}>← Voltar</button>
          <h2 className={styles.listTitle}>Histórico</h2>
        </div>
        <input className={styles.search} placeholder="Buscar por tema, tags, problema..."
          value={search} onChange={e => setSearch(e.target.value)} />
        {loading && <div className={styles.muted}>Carregando...</div>}
        {!loading && filtered.length === 0 && <div className={styles.muted}>Nenhuma sessão encontrada.</div>}
        {filtered.map(s => (
          <div key={s.sessionId}
            className={`${styles.card} ${selected?.sessionId === s.sessionId ? styles.cardActive : ''}`}
            onClick={() => openSession(s)}>
            <div className={styles.cardProblem}>{(s.problem ?? '').slice(0, 80)}{(s.problem ?? '').length > 80 ? '...' : ''}</div>
            <div className={styles.cardMeta}>
              <span>{s.agentIds?.map(id => AGENTS_CONFIG[id]?.icon ?? '·').join('')}</span>
              <span>{s.theme || <em style={{opacity:0.4}}>sem tema</em>}</span>
              <span className={s.status === 'done' ? styles.done : styles.interrupted}>
                {s.status === 'done' ? '✓' : '—'}
              </span>
              {s.isKnowledgeBase && <span className={styles.kbBadge}>🧠</span>}
            </div>
            {(s.tags ?? []).length > 0 && (
              <div className={styles.tags}>{s.tags.map(t => <span key={t} className={styles.tag}>{t}</span>)}</div>
            )}
            <div className={styles.cardDate}>{new Date(s.startedAt).toLocaleDateString('pt-BR')}</div>
          </div>
        ))}
      </div>

      {/* ── Painel de detalhe ────────────────────────────────────── */}
      {selected ? (
        <div className={styles.detail}>

          {/* Header */}
          <div className={styles.detailHeader}>
            <div className={styles.detailProblem}>{selected.problem}</div>
            <div className={styles.detailActions}>
              <button className={styles.actionBtn} onClick={copyAll}>📋 Copiar tudo</button>
              <button className={styles.actionBtn} onClick={() => handleReopen(selected)}>↩ Reabrir</button>
              <button className={styles.deleteBtn} onClick={() => handleDelete(selected.sessionId)}>✕ Excluir</button>
            </div>
          </div>

          {/* Metadados editáveis */}
          <div className={styles.metaBar}>
            <input className={styles.metaInput} placeholder="Tema da sessão..."
              value={editTheme} onChange={e => setEditTheme(e.target.value)} />
            <input className={styles.metaInput} placeholder="Tags (vírgula)"
              value={editTags} onChange={e => setEditTags(e.target.value)} />
            <label className={styles.kbLabel}>
              <input type="checkbox" checked={editKb} onChange={e => setEditKb(e.target.checked)}
                style={{ accentColor: '#F59E0B' }} />
              🧠 Knowledge Base
            </label>
            <button className={styles.saveMetaBtn} onClick={handleSaveMeta} disabled={savingMeta}>
              {savingMeta ? '...' : 'Salvar'}
            </button>
          </div>

          {/* Lições aprendidas */}
          <div className={styles.lessonsPanel}>
            <div className={styles.lessonsTitle}>📌 Lições aprendidas</div>
            <p className={styles.lessonsHint}>
              O que você aprendeu após executar as decisões desta sessão? Estes registros entram como contexto em debates futuros que usarem esta sessão como referência.
            </p>

            {lessons.map((l, i) => (
              <div key={i} className={styles.lessonItem}>
                {editingLesson === i ? (
                  <input
                    className={styles.lessonInput}
                    defaultValue={l}
                    autoFocus
                    onBlur={e => updateLesson(i, e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') updateLesson(i, e.target.value);
                      if (e.key === 'Escape') setEditingLesson(null);
                    }}
                  />
                ) : (
                  <span className={styles.lessonText} onClick={() => setEditingLesson(i)}>
                    {i + 1}. {l}
                  </span>
                )}
                <button className={styles.lessonRemove} onClick={() => removeLesson(i)}>✕</button>
              </div>
            ))}

            <div className={styles.lessonAddRow}>
              <input
                className={styles.lessonInput}
                placeholder="Adicionar lição... (ex: A decisão X falhou porque Y)"
                value={newLesson}
                onChange={e => setNewLesson(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addLesson()}
              />
              <button className={styles.lessonAddBtn} onClick={addLesson} disabled={!newLesson.trim()}>
                + Adicionar
              </button>
            </div>
          </div>

          {/* Chat completo */}
          <div className={styles.chat} ref={chatRef}>
            {loadingMsgs && <div className={styles.muted}>Carregando mensagens...</div>}
            {!loadingMsgs && messages.length === 0 && (
              <div className={styles.muted}>Nenhuma mensagem salva nesta sessão.</div>
            )}
            {Object.entries(byRound).sort((a,b) => Number(a[0]) - Number(b[0])).map(([round, msgs]) => (
              <div key={round} className={styles.roundBlock}>
                <div className={styles.roundLabel}>Round {round}</div>
                {msgs.map((m, i) => {
                  const cfg   = AGENTS_CONFIG[m.agentId];
                  const color = m.isHuman ? '#94A3B8' : m.isJudge ? '#EC4899' : (cfg?.color ?? '#64748B');
                  return (
                    <div key={i} className={`${styles.bubble} ${m.isHuman ? styles.humanBubble : ''}`}>
                      <div className={styles.bubbleHeader}>
                        <span style={{ color, fontWeight: 700, fontSize: 12 }}>
                          {cfg?.icon ?? (m.isHuman ? '✎' : '·')} {m.agentName}
                        </span>
                        {m.model && <span className={styles.model}>{m.model}</span>}
                        {m.partial && <span className={styles.partial}>✂ interrompido</span>}
                        <button className={styles.copyBtn}
                          onClick={() => navigator.clipboard.writeText(m.text)} title="Copiar">📋</button>
                      </div>
                      <div className={styles.bubbleText}>{m.text}</div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>💬</div>
          <div className={styles.emptyText}>Selecione uma sessão para ver o debate completo</div>
        </div>
      )}
    </div>
  );
}
