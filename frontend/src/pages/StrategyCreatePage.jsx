import { useEffect, useMemo, useState } from 'react';
import GlowCard from '../components/GlowCard';
import { PageHeader } from '../components/PageLayout';
import { fmtInt, fmtNum, fmtTime } from '../lib/format';
import { createStrategy } from '../lib/capitalApi';
import { getStrategyImplementationDetail, STRATEGY_OPTIONS } from '../lib/strategyEngine';
import { Link, navigate } from '../lib/router';

const PROTOCOL_CONFIGS = {
  'tensor-lite': { recommended: 'crypto', fields: ['entryScore', 'exitScore', 'confidenceGate'] },
  'dca-baseline': { recommended: 'crypto/equity', fields: ['interval', 'amount'] },
  'scalper-baseline': { recommended: 'crypto', fields: ['entryThreshold', 'takeProfit', 'stopLoss'] },
  'grid-baseline': { recommended: 'crypto', fields: ['levels', 'spacing'] },
  'rsi-baseline': { recommended: 'crypto/equity', fields: ['period', 'oversold', 'overbought'] },
  'macd-baseline': { recommended: 'equity', fields: ['fastPeriod', 'slowPeriod', 'signalPeriod'] },
  'pairs-baseline': { recommended: 'equity', fields: ['symbolA', 'symbolB', 'lookback', 'zScore'] }
};

const DRAFT_STORAGE_KEY = 'cre8capital.strategy.create.drafts.v1';
const MAX_DRAFTS = 24;

const toNum = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const slugify = (value) => {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 52);
};

const createDefaultForm = () => ({
  name: '',
  id: '',
  templateId: 'tensor-lite',
  description: '',
  triggerMode: 'auto',
  executionMode: 'paper',
  assetClass: 'all',
  maxNotional: 5000,
  maxPositions: 3,
  cooldownSec: 45,
  entryScore: 5.2,
  exitScore: -5.2,
  confidenceGate: 0.55,
  marketScope: [],
  notes: ''
});

const sanitizeDrafts = (input) => {
  if (!Array.isArray(input)) return [];
  return input
    .filter((row) => row && typeof row === 'object')
    .map((row) => ({
      draftId: String(row.draftId || ''),
      createdAt: toNum(row.createdAt, Date.now()),
      name: String(row.name || 'Untitled Strategy'),
      id: String(row.id || ''),
      templateId: String(row.templateId || 'tensor-lite'),
      description: String(row.description || ''),
      triggerMode: String(row.triggerMode || 'auto'),
      executionMode: String(row.executionMode || 'paper'),
      assetClass: String(row.assetClass || 'all'),
      maxNotional: toNum(row.maxNotional, 0),
      maxPositions: toNum(row.maxPositions, 1),
      cooldownSec: toNum(row.cooldownSec, 0),
      entryScore: toNum(row.entryScore, 0),
      exitScore: toNum(row.exitScore, 0),
      confidenceGate: toNum(row.confidenceGate, 0),
      marketScope: Array.isArray(row.marketScope) ? row.marketScope.map((item) => String(item || '')) : [],
      notes: String(row.notes || '')
    }))
    .filter((row) => row.draftId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_DRAFTS);
};

const uniqueAssetClasses = (snapshot) => {
  const values = new Set((snapshot?.markets || []).map((market) => String(market?.assetClass || '').toLowerCase()).filter((value) => value));
  return ['all', ...[...values].sort()];
};

const buildMarketScopeRows = (snapshot) => {
  const markets = Array.isArray(snapshot?.markets) ? snapshot.markets : [];
  return [...markets]
    .filter((market) => market?.key && market?.symbol)
    .sort((a, b) => {
      const aWeight = toNum(a.totalVolume) + Math.abs(toNum(a.changePct)) * 1_000_000;
      const bWeight = toNum(b.totalVolume) + Math.abs(toNum(b.changePct)) * 1_000_000;
      return bWeight - aWeight;
    })
    .slice(0, 60)
    .map((market) => ({
      key: String(market.key),
      symbol: String(market.symbol),
      assetClass: String(market.assetClass || '').toLowerCase(),
      volume: Math.max(0, toNum(market.totalVolume)),
      changePct: toNum(market.changePct)
    }));
};

export default function StrategyCreatePage({ snapshot }) {
  const [form, setForm] = useState(createDefaultForm);
  const [drafts, setDrafts] = useState([]);
  const [message, setMessage] = useState('');

  const template = useMemo(() => getStrategyImplementationDetail(form.templateId), [form.templateId]);
  const assetClassOptions = useMemo(() => uniqueAssetClasses(snapshot), [snapshot]);
  const marketScopeRows = useMemo(() => buildMarketScopeRows(snapshot), [snapshot]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      setDrafts(sanitizeDrafts(parsed));
    } catch (error) {
      setMessage('Could not read saved strategy drafts. Starting fresh.');
    }
  }, []);

  const persistDrafts = (nextRows) => {
    const safeRows = sanitizeDrafts(nextRows);
    setDrafts(safeRows);
    try {
      window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(safeRows));
    } catch (error) {
      setMessage('Could not persist drafts to local storage.');
    }
  };

  const filteredScopeRows = useMemo(() => {
    if (form.assetClass === 'all') return marketScopeRows;
    return marketScopeRows.filter((row) => row.assetClass === form.assetClass);
  }, [form.assetClass, marketScopeRows]);

  const selectedScopeCount = form.marketScope.length;
  const linkedScopeRows = useMemo(() => {
    const keySet = new Set(form.marketScope);
    return filteredScopeRows.filter((row) => keySet.has(row.key));
  }, [filteredScopeRows, form.marketScope]);

  const generatedId = useMemo(() => {
    const candidate = slugify(form.id || form.name);
    return candidate || `strategy-${Date.now().toString(36).slice(-6)}`;
  }, [form.id, form.name]);

  const previewPayload = useMemo(() => {
    return {
      id: generatedId,
      name: form.name || 'Untitled Strategy',
      templateId: form.templateId,
      triggerMode: form.triggerMode,
      executionMode: form.executionMode,
      assetClass: form.assetClass,
      marketScope: form.marketScope,
      risk: {
        maxNotional: toNum(form.maxNotional, 0),
        maxPositions: toNum(form.maxPositions, 1),
        cooldownSec: toNum(form.cooldownSec, 0),
        confidenceGate: toNum(form.confidenceGate, 0)
      },
      scoreRules: {
        entryScore: toNum(form.entryScore, 0),
        exitScore: toNum(form.exitScore, 0)
      },
      notes: form.notes || ''
    };
  }, [
    form.assetClass,
    form.confidenceGate,
    form.cooldownSec,
    form.entryScore,
    form.executionMode,
    form.exitScore,
    form.marketScope,
    form.maxNotional,
    form.maxPositions,
    form.name,
    form.notes,
    form.templateId,
    form.triggerMode,
    generatedId
  ]);

  const onField = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: value
    }));
  };

  const onToggleMarket = (marketKey) => {
    setForm((current) => {
      const has = current.marketScope.includes(marketKey);
      const next = has ? current.marketScope.filter((item) => item !== marketKey) : [...current.marketScope, marketKey];
      return {
        ...current,
        marketScope: next
      };
    });
  };

  const onSelectTopScope = () => {
    const nextKeys = filteredScopeRows.slice(0, 12).map((row) => row.key);
    setForm((current) => ({
      ...current,
      marketScope: nextKeys
    }));
  };

  const onClearScope = () => {
    setForm((current) => ({
      ...current,
      marketScope: []
    }));
  };

  const validate = () => {
    if (!String(form.name || '').trim()) {
      return 'Strategy name is required.';
    }
    if (toNum(form.entryScore, 0) <= 0) {
      return 'Entry score should be above zero.';
    }
    if (toNum(form.exitScore, 0) >= 0) {
      return 'Exit score should be below zero.';
    }
    if (toNum(form.maxPositions, 0) < 1) {
      return 'Max positions must be at least 1.';
    }
    return '';
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    setMessage('');
    const error = validate();
    if (error) {
      setMessage(error);
      return;
    }

    const draftId = `${generatedId}:${Date.now().toString(36)}`;
    const draftRow = {
      draftId,
      createdAt: Date.now(),
      ...previewPayload,
      description: form.description || '',
      templateId: form.templateId
    };

    persistDrafts([draftRow, ...drafts]);

    // Also POST to backend API
    try {
      const result = await createStrategy({
        id: generatedId,
        name: form.name || 'Untitled Strategy',
        protocol: form.templateId,
        assetClasses: form.assetClass === 'all' ? ['crypto', 'equity'] : [form.assetClass],
        signals: ['momentum-shift'],
        config: {
          maxNotional: toNum(form.maxNotional, 0),
          maxPositions: toNum(form.maxPositions, 1),
          cooldownSec: toNum(form.cooldownSec, 0),
          entryScore: toNum(form.entryScore, 0),
          exitScore: toNum(form.exitScore, 0),
          confidenceGate: toNum(form.confidenceGate, 0),
          marketScope: form.marketScope
        }
      });
      if (result.ok) {
        setMessage(`Strategy ${draftRow.name} saved to server and local drafts.`);
        navigate('/strategies');
        return;
      }
      setMessage(`Draft saved locally. Server: ${result.message || result.error || 'unknown error'}.`);
    } catch (err) {
      setMessage(`Draft saved locally. Server save failed: ${err.message}`);
    }
  };

  const onLoadDraft = (draftId) => {
    const selected = drafts.find((row) => row.draftId === draftId);
    if (!selected) return;
    setForm({
      name: selected.name || '',
      id: selected.id || '',
      templateId: selected.templateId || 'tensor-lite',
      description: selected.description || '',
      triggerMode: selected.triggerMode || 'auto',
      executionMode: selected.executionMode || 'paper',
      assetClass: selected.assetClass || 'all',
      maxNotional: toNum(selected.maxNotional, 0),
      maxPositions: toNum(selected.maxPositions, 1),
      cooldownSec: toNum(selected.cooldownSec, 0),
      entryScore: toNum(selected.entryScore, 0),
      exitScore: toNum(selected.exitScore, 0),
      confidenceGate: toNum(selected.confidenceGate, 0),
      marketScope: Array.isArray(selected.marketScope) ? selected.marketScope : [],
      notes: selected.notes || ''
    });
    setMessage(`Loaded draft ${selected.name}.`);
  };

  const onDeleteDraft = (draftId) => {
    persistDrafts(drafts.filter((row) => row.draftId !== draftId));
  };

  const onResetForm = () => {
    setForm(createDefaultForm());
    setMessage('');
  };

  return (
    <section className="page-grid">
      <GlowCard className="detail-card">
        <div className="section-head">
          <h1>Create Strategy</h1>
          <div className="section-actions">
            <Link to="/strategies" className="inline-link">
              Back to strategies
            </Link>
            <Link to="/strategy" className="inline-link">
              Open strategy lab
            </Link>
          </div>
        </div>
        <p>Build a strategy config draft with template, risk controls, and market scope. Drafts are stored locally until backend passport/runtime wiring is finalized.</p>
      </GlowCard>

      <div className="strategy-create-grid">
        <GlowCard className="panel-card strategy-create-form-card">
          <div className="section-head">
            <h2>Strategy Form</h2>
            <span>local draft</span>
          </div>
          <form className="strategy-create-form" onSubmit={onSubmit}>
            <div className="strategy-control-grid">
              <label className="control-field">
                <span>Name</span>
                <input value={form.name} onChange={(event) => onField('name', event.target.value)} placeholder="Tensor Swing v2" />
              </label>
              <label className="control-field">
                <span>ID (optional)</span>
                <input value={form.id} onChange={(event) => onField('id', event.target.value)} placeholder="tensor-swing-v2" />
              </label>
              <label className="control-field" style={{ gridColumn: 'span 2' }}>
                <span>Asset Class Scope</span>
                <select value={form.assetClass} onChange={(event) => onField('assetClass', event.target.value)}>
                  {assetClassOptions.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="section-head">
              <h2>Protocol</h2>
              <span>{template.name}</span>
            </div>
            <div className="protocol-card-grid">
              {STRATEGY_OPTIONS.map((option) => {
                const cfg = PROTOCOL_CONFIGS[option.id] || {};
                return (
                  <div
                    key={option.id}
                    className={`protocol-card ${form.templateId === option.id ? 'selected' : ''}`}
                    onClick={() => onField('templateId', option.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onField('templateId', option.id); }}
                  >
                    <strong>{option.label}</strong>
                    <p>{option.description || 'Strategy protocol template.'}</p>
                    {cfg.recommended ? <span className="protocol-tag">{cfg.recommended}</span> : null}
                  </div>
                );
              })}
            </div>

            <label className="control-field">
              <span>Description</span>
              <input value={form.description} onChange={(event) => onField('description', event.target.value)} placeholder="Drift + momentum blend with stricter spread gate." />
            </label>

            <div className="strategy-risk-grid">
              <label className="control-field">
                <span>Trigger Mode</span>
                <select value={form.triggerMode} onChange={(event) => onField('triggerMode', event.target.value)}>
                  <option value="auto">auto</option>
                  <option value="price">price</option>
                  <option value="signal">signal</option>
                  <option value="hybrid">hybrid</option>
                </select>
              </label>
              <label className="control-field">
                <span>Execution</span>
                <select value={form.executionMode} onChange={(event) => onField('executionMode', event.target.value)}>
                  <option value="paper">paper</option>
                  <option value="guarded-live">guarded-live</option>
                  <option value="live">live</option>
                </select>
              </label>
              <label className="control-field">
                <span>Max Notional</span>
                <input type="number" min={0} step={100} value={form.maxNotional} onChange={(event) => onField('maxNotional', Math.max(0, toNum(event.target.value, 0)))} />
              </label>
              <label className="control-field">
                <span>Max Positions</span>
                <input type="number" min={1} step={1} value={form.maxPositions} onChange={(event) => onField('maxPositions', Math.max(1, Math.round(toNum(event.target.value, 1))))} />
              </label>
            </div>

            <div className="strategy-risk-grid">
              <label className="control-field">
                <span>Entry Score</span>
                <input type="number" step={0.1} value={form.entryScore} onChange={(event) => onField('entryScore', toNum(event.target.value, 0))} />
              </label>
              <label className="control-field">
                <span>Exit Score</span>
                <input type="number" step={0.1} value={form.exitScore} onChange={(event) => onField('exitScore', toNum(event.target.value, 0))} />
              </label>
              <label className="control-field">
                <span>Confidence Gate (0-1)</span>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={form.confidenceGate}
                  onChange={(event) => onField('confidenceGate', Math.min(1, Math.max(0, toNum(event.target.value, 0))))}
                />
              </label>
              <label className="control-field">
                <span>Cooldown Sec</span>
                <input type="number" min={0} step={5} value={form.cooldownSec} onChange={(event) => onField('cooldownSec', Math.max(0, Math.round(toNum(event.target.value, 0))))} />
              </label>
            </div>

            <GlowCard className="panel-card strategy-create-scope-card">
              <div className="section-head">
                <h2>Market Scope</h2>
                <span>{selectedScopeCount} selected</span>
              </div>
              <p className="socket-status-copy">
                Pick specific markets or leave empty for auto selection in runtime.
                <br />
                Filter active: {form.assetClass}
              </p>
              <div className="section-actions">
                <button type="button" className="btn secondary" onClick={onSelectTopScope}>
                  Select Top 12
                </button>
                <button type="button" className="btn secondary" onClick={onClearScope}>
                  Clear Scope
                </button>
              </div>
              <div className="strategy-create-scope-grid">
                {filteredScopeRows.map((row) => {
                  const selected = form.marketScope.includes(row.key);
                  return (
                    <label key={`scope:${row.key}`} className={selected ? 'strategy-scope-chip active' : 'strategy-scope-chip'}>
                      <input type="checkbox" checked={selected} onChange={() => onToggleMarket(row.key)} />
                      <span>{row.symbol}</span>
                      <small>
                        {row.assetClass} | vol {fmtNum(row.volume, 0)}
                      </small>
                    </label>
                  );
                })}
              </div>
            </GlowCard>

            <label className="control-field">
              <span>Notes</span>
              <textarea
                className="strategy-create-notes"
                value={form.notes}
                onChange={(event) => onField('notes', event.target.value)}
                placeholder="Optional rollout notes, guardrails, and follow-up experiments."
              />
            </label>

            <div className="hero-actions">
              <button type="submit" className="btn primary">
                Save Draft
              </button>
              <button type="button" className="btn secondary" onClick={onResetForm}>
                Reset Form
              </button>
              <button type="button" className="btn secondary" onClick={() => navigate('/strategy')}>
                Open Strategy Lab
              </button>
            </div>
          </form>
          {message ? <p className="action-message">{message}</p> : null}
        </GlowCard>

        <GlowCard className="panel-card strategy-create-preview-card">
          <div className="section-head">
            <h2>Template Runtime</h2>
            <span>{template.triggerKind} trigger</span>
          </div>
          <p className="socket-status-copy">
            {template.summary} | source {template.sourceFile}
          </p>
          <div className="strategy-function-grid">
            <article>
              <span>Template</span>
              <strong>{template.name}</strong>
            </article>
            <article>
              <span>Inputs</span>
              <strong>{fmtInt(template.inputs.length)}</strong>
            </article>
            <article>
              <span>Action Rules</span>
              <strong>{fmtInt(template.actionRules.length)}</strong>
            </article>
            <article>
              <span>Prerequisites</span>
              <strong>{fmtInt(template.prerequisites.length)}</strong>
            </article>
          </div>
          <ul className="strategy-function-list compact">
            {template.actionRules.map((rule, index) => (
              <li key={`template-rule:${template.id}:${index}`}>{rule}</li>
            ))}
          </ul>
          <div className="section-head">
            <h2>Generated Config</h2>
            <span>{generatedId}</span>
          </div>
          <pre className="strategy-function-code compact">
            <code>{JSON.stringify(previewPayload, null, 2)}</code>
          </pre>
        </GlowCard>
      </div>

      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>Saved Drafts</h2>
          <span>{fmtInt(drafts.length)} local drafts</span>
        </div>
        <div className="strategy-draft-list">
          {drafts.map((draft) => (
            <article key={draft.draftId} className="strategy-draft-row">
              <div className="strategy-draft-main">
                <strong>{draft.name}</strong>
                <small>
                  {draft.id} | {draft.templateId} | created {fmtTime(draft.createdAt)}
                </small>
                <small>
                  entry {fmtNum(draft.entryScore, 2)} | exit {fmtNum(draft.exitScore, 2)} | scope {fmtInt(draft.marketScope.length)} markets
                </small>
              </div>
              <div className="section-actions">
                <button type="button" className="btn secondary" onClick={() => onLoadDraft(draft.draftId)}>
                  Load
                </button>
                <button type="button" className="btn secondary" onClick={() => onDeleteDraft(draft.draftId)}>
                  Delete
                </button>
              </div>
            </article>
          ))}
          {drafts.length === 0 ? <p className="action-message">No strategy drafts saved yet.</p> : null}
        </div>
      </GlowCard>
    </section>
  );
}
