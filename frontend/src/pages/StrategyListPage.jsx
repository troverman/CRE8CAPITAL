import { useCallback, useEffect, useMemo, useState } from 'react';
import WalletAccountSelectField from '../components/WalletAccountSelectField';
import GlowCard from '../components/GlowCard';
import RuntimeExecutionControls from '../components/RuntimeExecutionControls';
import { fmtInt, fmtNum, fmtTime } from '../lib/format';
import { fetchStrategies, toggleStrategy } from '../lib/capitalApi';
import { selectActiveWalletAccount } from '../lib/strategyLabSelectors';
import { buildStrategyRows, toStrategyKey } from '../lib/strategyView';
import { Link, navigate } from '../lib/router';
import { useStrategyLabStore } from '../store/strategyLabStore';
import { useStrategyToggleStore } from '../store/strategyToggleStore';

const resolveEnabled = (strategy, enabledByKey) => {
  const key = String(strategy?.key || '');
  if (typeof enabledByKey?.[key] === 'boolean') return enabledByKey[key];
  if (strategy?.enabled === null || typeof strategy?.enabled === 'undefined') return true;
  return Boolean(strategy.enabled);
};

export default function StrategyListPage({ snapshot }) {
  const [search, setSearch] = useState('');
  const [serverStrategies, setServerStrategies] = useState([]);
  const enabledByKey = useStrategyToggleStore((state) => state.enabledByKey);
  const ensureStrategies = useStrategyToggleStore((state) => state.ensureStrategies);
  const setStrategyEnabled = useStrategyToggleStore((state) => state.setStrategyEnabled);
  const strategyId = useStrategyLabStore((state) => state.strategyId);
  const enabledStrategyIds = useStrategyLabStore((state) => state.enabledStrategyIds);
  const executionStrategyMode = useStrategyLabStore((state) => state.executionStrategyMode);
  const executionWalletScope = useStrategyLabStore((state) => state.executionWalletScope);
  const walletAccounts = useStrategyLabStore((state) => state.walletAccounts);
  const activeWalletAccountId = useStrategyLabStore((state) => state.activeWalletAccountId);
  const setActiveWalletAccount = useStrategyLabStore((state) => state.setActiveWalletAccount);

  const loadServerStrategies = useCallback(async () => {
    try {
      const data = await fetchStrategies();
      setServerStrategies(data.items || []);
    } catch (_) {}
  }, []);

  useEffect(() => {
    loadServerStrategies();
  }, [loadServerStrategies]);

  const handleToggleServer = useCallback(async (id) => {
    try {
      await toggleStrategy(id);
      loadServerStrategies();
    } catch (_) {}
  }, [loadServerStrategies]);

  const strategies = useMemo(() => {
    // Merge snapshot strategies with server strategies
    const base = buildStrategyRows(snapshot);
    // Add any server-only strategies not in snapshot
    const knownIds = new Set(base.map(s => s.id));
    for (const ss of serverStrategies) {
      if (!knownIds.has(ss.id)) {
        base.push({
          key: ss.id,
          id: ss.id,
          name: ss.name || ss.id,
          description: ss.description || `${ss.protocol} strategy`,
          protocol: ss.protocol,
          assetClasses: ss.assetClasses,
          signalTypes: ss.signalTypes,
          enabled: ss.enabled,
          custom: ss.custom || false,
          decisionCount: ss.metrics?.decisionCount || 0,
          marketCount: 0,
          avgScore: 0,
          lastAction: '-',
          lastDecisionAt: 0
        });
      }
    }
    return base;
  }, [snapshot, serverStrategies]);

  useEffect(() => {
    ensureStrategies(strategies);
  }, [ensureStrategies, strategies]);

  const hydratedStrategies = useMemo(() => {
    return strategies.map((strategy) => ({
      ...strategy,
      enabled: resolveEnabled(strategy, enabledByKey)
    }));
  }, [enabledByKey, strategies]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return hydratedStrategies;
    return hydratedStrategies.filter((strategy) => {
      return (
        String(strategy.name || '').toLowerCase().includes(term) ||
        String(strategy.id || '').toLowerCase().includes(term) ||
        String(strategy.key || '').toLowerCase().includes(term) ||
        String(strategy.description || '').toLowerCase().includes(term)
      );
    });
  }, [hydratedStrategies, search]);

  const activeWallet = useMemo(() => {
    return selectActiveWalletAccount(walletAccounts, activeWalletAccountId);
  }, [activeWalletAccountId, walletAccounts]);

  const selectedRuntimeStrategy = useMemo(() => {
    const key = toStrategyKey(strategyId);
    return hydratedStrategies.find((strategy) => strategy.key === key) || null;
  }, [hydratedStrategies, strategyId]);

  const openStrategy = (strategy) => {
    const strategyTarget = strategy?.id || strategy?.name || strategy?.key;
    navigate(`/strategy/${encodeURIComponent(strategyTarget)}`);
  };

  const shouldSkipCardNavigate = (event) => {
    const target = event?.target;
    if (!(target instanceof HTMLElement)) return false;
    return Boolean(target.closest('a,button,input,select,textarea,label'));
  };

  const onCardClick = (event, strategy) => {
    if (shouldSkipCardNavigate(event)) return;
    openStrategy(strategy);
  };

  const onCardKeyDown = (event, strategy) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (shouldSkipCardNavigate(event)) return;
    event.preventDefault();
    openStrategy(strategy);
  };

  return (
    <section className="page-grid">
      <GlowCard className="list-header-card">
        <div className="section-head">
          <h1>Strategies</h1>
          <div className="section-actions">
            <span>{filtered.length} shown</span>
            <Link to="/strategy/create" className="btn primary">
              Create Strategy
            </Link>
            <Link to="/strategy" className="btn secondary">
              Open Strategy Lab
            </Link>
          </div>
        </div>
        <input
          className="filter-input"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search strategy name or id"
          aria-label="Search strategies"
        />
      </GlowCard>

      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>Runtime Sync</h2>
          <span>
            enabled {fmtInt(enabledStrategyIds.length)} / {fmtInt(hydratedStrategies.length)}
          </span>
        </div>
        <div className="strategy-control-grid">
          <WalletAccountSelectField
            label="Active Runtime Wallet"
            accounts={walletAccounts}
            value={activeWalletAccountId}
            onChange={setActiveWalletAccount}
            emptyLabel="No paper wallets"
            idPrefix="strategy-list-wallet"
          />
        </div>
        <p className="socket-status-copy">
          active wallet {activeWallet?.name || '-'} ({activeWallet?.enabled ? 'enabled' : 'paused'}) | strategy focus {selectedRuntimeStrategy?.name || strategyId || '-'} (
          {selectedRuntimeStrategy?.enabled === false ? 'disabled' : 'enabled'})
        </p>
        <RuntimeExecutionControls strategyMode={executionStrategyMode} walletScope={executionWalletScope} showControls={false} summaryPrefix="engine mode" summarySuffix="" />
        <div className="section-actions">
          <Link to="/wallet" className="inline-link">
            Open wallet runtime
          </Link>
          <Link to="/strategy" className="inline-link">
            Open strategy lab
          </Link>
        </div>
      </GlowCard>

      <div className="strategy-grid">
        {filtered.map((strategy) => (
          <GlowCard
            key={strategy.key}
            className="strategy-card strategy-card-clickable"
            role="link"
            tabIndex={0}
            onClick={(event) => onCardClick(event, strategy)}
            onKeyDown={(event) => onCardKeyDown(event, strategy)}
          >
            <div className="strategy-head">
              <strong>
                <Link to={`/strategy/${encodeURIComponent(strategy.id || strategy.name || strategy.key)}`} className="inline-link strategy-title-link">
                  {strategy.name}
                </Link>
              </strong>
              <label className="toggle-label strategy-toggle-switch">
                <input
                  type="checkbox"
                  checked={Boolean(strategy.enabled)}
                  onChange={(event) => setStrategyEnabled(strategy.key, event.target.checked)}
                />
                <span>{strategy.enabled ? 'enabled' : 'disabled'}</span>
              </label>
            </div>
            <p>
              decisions {fmtInt(strategy.decisionCount)} | markets {fmtInt(strategy.marketCount)}
            </p>
            <p className="socket-status-copy">{strategy.description || 'No description available yet.'}</p>
            <div className="strategy-metrics">
              <small>avg score {fmtNum(strategy.avgScore, 2)}</small>
              <small>last action {strategy.lastAction}</small>
              <small>last {fmtTime(strategy.lastDecisionAt)}</small>
              <Link to={`/strategy/${encodeURIComponent(strategy.id || strategy.name || strategy.key)}`} className="inline-link">
                open strategy
              </Link>
            </div>
          </GlowCard>
        ))}
      </div>
    </section>
  );
}
