import { useCallback, useEffect, useMemo, useState } from 'react';
import GlowCard from '../components/GlowCard';
import LineChart from '../components/LineChart';
import { fmtCompact, fmtInt, fmtNum, fmtPct, fmtTime } from '../lib/format';
import { createWalletState, executeWalletAction, markWallet } from '../lib/strategyEngine';
import { Link } from '../lib/router';

const WALLET_STORAGE_KEY = 'cre8capital.wallet-lab.v1';
const PASSPORT_STORAGE_KEY = 'cre8capital.account-passport.v1';

const MAX_EQUITY_POINTS = 420;
const MAX_TRADES = 180;
const DEFAULT_START_CASH = 100000;

const clamp = (value, min, max) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.min(max, Math.max(min, num));
};

const toNum = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const trimTail = (list, maxLength) => {
  if (list.length <= maxLength) return list;
  return list.slice(list.length - maxLength);
};

const trimHead = (list, maxLength) => {
  if (list.length <= maxLength) return list;
  return list.slice(0, maxLength);
};

const createDefaultWalletLab = () => ({
  wallet: createWalletState(DEFAULT_START_CASH),
  tradeLog: [],
  equityHistory: [],
  selectedMarketKey: '',
  orderUnits: 1,
  maxAbsUnits: 12,
  slippageBps: 1.2,
  note: 'manual wallet test'
});

const sanitizeWalletState = (raw) => {
  const base = createDefaultWalletLab();
  if (!raw || typeof raw !== 'object') return base;

  const sourceWallet = raw.wallet || {};
  const wallet = {
    cash: toNum(sourceWallet.cash, base.wallet.cash),
    units: Math.round(toNum(sourceWallet.units, base.wallet.units)),
    avgEntry: sourceWallet.avgEntry === null ? null : toNum(sourceWallet.avgEntry, null),
    realizedPnl: toNum(sourceWallet.realizedPnl, base.wallet.realizedPnl),
    unrealizedPnl: toNum(sourceWallet.unrealizedPnl, base.wallet.unrealizedPnl),
    equity: toNum(sourceWallet.equity, base.wallet.equity),
    tradeCount: Math.max(0, Math.round(toNum(sourceWallet.tradeCount, base.wallet.tradeCount))),
    winCount: Math.max(0, Math.round(toNum(sourceWallet.winCount, base.wallet.winCount))),
    lossCount: Math.max(0, Math.round(toNum(sourceWallet.lossCount, base.wallet.lossCount))),
    lastActionAt: Math.max(0, Math.round(toNum(sourceWallet.lastActionAt, 0)))
  };

  const tradeLog = Array.isArray(raw.tradeLog)
    ? raw.tradeLog
        .map((trade) => ({
          id: String(trade?.id || `trade:${Date.now()}`),
          timestamp: Math.max(0, Math.round(toNum(trade?.timestamp, Date.now()))),
          action: trade?.action === 'reduce' ? 'reduce' : 'accumulate',
          unitsDelta: toNum(trade?.unitsDelta, 0),
          unitsAfter: toNum(trade?.unitsAfter, 0),
          fillPrice: toNum(trade?.fillPrice, 0),
          markPrice: toNum(trade?.markPrice, 0),
          spreadBps: toNum(trade?.spreadBps, 0),
          realizedDelta: toNum(trade?.realizedDelta, 0),
          score: toNum(trade?.score, 0),
          reason: String(trade?.reason || '')
        }))
        .filter((trade) => Number.isFinite(trade.fillPrice) && trade.fillPrice > 0)
        .slice(0, MAX_TRADES)
    : [];

  const equityHistory = Array.isArray(raw.equityHistory)
    ? raw.equityHistory
        .map((row) => ({
          t: Math.max(0, Math.round(toNum(row?.t, Date.now()))),
          equity: toNum(row?.equity, wallet.equity),
          price: toNum(row?.price, 0)
        }))
        .filter((row) => Number.isFinite(row.equity))
        .slice(-MAX_EQUITY_POINTS)
    : [];

  return {
    wallet,
    tradeLog,
    equityHistory,
    selectedMarketKey: String(raw.selectedMarketKey || ''),
    orderUnits: clamp(raw.orderUnits, 1, 25),
    maxAbsUnits: clamp(raw.maxAbsUnits, 1, 80),
    slippageBps: clamp(raw.slippageBps, 0, 50),
    note: String(raw.note || base.note).slice(0, 140)
  };
};

const readPassportSummary = () => {
  const base = {
    linkedProviders: 0,
    validatedProviders: 0,
    liveReadyProviders: 0,
    externalActionsEnabled: false,
    executionMode: 'paper',
    profileName: 'CRE8 Operator'
  };

  try {
    const raw = window.localStorage.getItem(PASSPORT_STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    const providers = Array.isArray(parsed?.providers) ? parsed.providers : [];
    const validated = providers.filter((provider) => provider?.status === 'validated').length;
    const liveReady = providers.filter((provider) => provider?.status === 'validated' && provider?.testnet === false && provider?.permissions?.trade).length;
    return {
      linkedProviders: providers.length,
      validatedProviders: validated,
      liveReadyProviders: liveReady,
      externalActionsEnabled: Boolean(parsed?.externalActionsEnabled),
      executionMode: String(parsed?.executionMode || 'paper'),
      profileName: String(parsed?.profileName || 'CRE8 Operator')
    };
  } catch (error) {
    return base;
  }
};

export default function WalletPage({ snapshot }) {
  const rankedMarkets = useMemo(() => {
    const input = Array.isArray(snapshot?.markets) ? snapshot.markets : [];
    return [...input]
      .filter((market) => Boolean(market?.key))
      .sort((a, b) => {
        const aScore = toNum(a.totalVolume, 0) + Math.abs(toNum(a.changePct, 0)) * 1000000;
        const bScore = toNum(b.totalVolume, 0) + Math.abs(toNum(b.changePct, 0)) * 1000000;
        return bScore - aScore;
      })
      .slice(0, 220);
  }, [snapshot?.markets]);

  const [walletLab, setWalletLab] = useState(createDefaultWalletLab);
  const [passportSummary, setPassportSummary] = useState(() => readPassportSummary());
  const [message, setMessage] = useState('');

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(WALLET_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      setWalletLab(sanitizeWalletState(parsed));
    } catch (error) {
      setMessage('Wallet state could not be restored. Starting from defaults.');
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(walletLab));
    } catch (error) {
      setMessage('Wallet state could not be saved locally.');
    }
  }, [walletLab]);

  useEffect(() => {
    setPassportSummary(readPassportSummary());
  }, []);

  useEffect(() => {
    if (!rankedMarkets.length) return;
    const selectedExists = rankedMarkets.some((market) => market.key === walletLab.selectedMarketKey);
    if (selectedExists) return;
    setWalletLab((previous) => ({
      ...previous,
      selectedMarketKey: rankedMarkets[0].key
    }));
  }, [rankedMarkets, walletLab.selectedMarketKey]);

  const selectedMarket = useMemo(() => {
    return rankedMarkets.find((market) => market.key === walletLab.selectedMarketKey) || rankedMarkets[0] || null;
  }, [rankedMarkets, walletLab.selectedMarketKey]);

  const marketPrice = toNum(selectedMarket?.referencePrice, 0);
  const marketSpread = Math.max(0, toNum(selectedMarket?.spreadBps, 0));
  const marketVolume = Math.max(0, toNum(selectedMarket?.totalVolume, 0));

  useEffect(() => {
    if (!selectedMarket || marketPrice <= 0) return;
    const now = toNum(snapshot?.now, Date.now());
    setWalletLab((previous) => {
      const markedWallet = markWallet(previous.wallet, marketPrice);
      const tail = previous.equityHistory[previous.equityHistory.length - 1];
      const shouldAppend = !tail || Math.abs(toNum(tail.price, 0) - marketPrice) > 1e-10 || now - toNum(tail.t, 0) >= 4000;
      const nextHistory = shouldAppend
        ? trimTail(
            [
              ...previous.equityHistory,
              {
                t: now,
                equity: markedWallet.equity,
                price: marketPrice
              }
            ],
            MAX_EQUITY_POINTS
          )
        : previous.equityHistory;
      return {
        ...previous,
        wallet: markedWallet,
        equityHistory: nextHistory
      };
    });
  }, [marketPrice, selectedMarket, snapshot?.now]);

  const handleControlChange = (field, value) => {
    setWalletLab((previous) => ({
      ...previous,
      [field]: value
    }));
  };

  const executeManual = useCallback(
    (action) => {
      if (!selectedMarket || marketPrice <= 0) {
        setMessage('Select a valid market before submitting manual wallet actions.');
        return;
      }

      const now = Date.now();
      const point = {
        price: marketPrice,
        spread: marketSpread,
        volume: marketVolume
      };

      const requestedUnits = clamp(walletLab.orderUnits, 1, 25);
      const maxAbsUnits = clamp(walletLab.maxAbsUnits, 1, 80);
      const slippageBps = clamp(walletLab.slippageBps, 0, 50);
      const reason = String(walletLab.note || `manual ${action}`).slice(0, 140);

      let fills = 0;
      setWalletLab((previous) => {
        let wallet = previous.wallet;
        const trades = [];

        for (let index = 0; index < requestedUnits; index += 1) {
          const execution = executeWalletAction({
            wallet,
            action,
            point,
            timestamp: now + index,
            reason,
            score: 0,
            maxAbsUnits,
            cooldownMs: 0,
            slippageBps
          });
          wallet = execution.wallet;
          if (execution.trade) {
            trades.push(execution.trade);
          }
        }

        fills = trades.length;
        const nextHistory = trimTail(
          [
            ...previous.equityHistory,
            {
              t: now,
              equity: wallet.equity,
              price: marketPrice
            }
          ],
          MAX_EQUITY_POINTS
        );

        return {
          ...previous,
          wallet,
          tradeLog: trimHead([...trades.reverse(), ...previous.tradeLog], MAX_TRADES),
          equityHistory: nextHistory
        };
      });

      setMessage(
        fills > 0
          ? `${action === 'accumulate' ? 'Buy' : 'Sell'} filled ${fmtInt(fills)} unit${fills === 1 ? '' : 's'} on ${selectedMarket.symbol}.`
          : 'No fill produced. Max-units guard may be reached.'
      );
    },
    [marketPrice, marketSpread, marketVolume, selectedMarket, walletLab.maxAbsUnits, walletLab.note, walletLab.orderUnits, walletLab.slippageBps]
  );

  const handleReset = () => {
    const startCash = DEFAULT_START_CASH;
    const baseWallet = markWallet(createWalletState(startCash), marketPrice > 0 ? marketPrice : startCash);
    setWalletLab((previous) => ({
      ...createDefaultWalletLab(),
      selectedMarketKey: previous.selectedMarketKey,
      wallet: baseWallet,
      equityHistory:
        marketPrice > 0
          ? [
              {
                t: Date.now(),
                equity: baseWallet.equity,
                price: marketPrice
              }
            ]
          : []
    }));
    setMessage('Wallet lab reset to defaults.');
  };

  const refreshPassportSummary = () => {
    setPassportSummary(readPassportSummary());
    setMessage('Passport summary refreshed from account settings.');
  };

  const equitySeries = walletLab.equityHistory.map((row) => row.equity);
  const openNotional = Math.abs(walletLab.wallet.units) * Math.max(marketPrice, 0);
  const winRate = walletLab.wallet.tradeCount > 0 ? (walletLab.wallet.winCount / Math.max(walletLab.wallet.tradeCount, 1)) * 100 : 0;

  return (
    <section className="page-grid">
      <GlowCard className="detail-card">
        <div className="section-head">
          <h1>Wallet Lab</h1>
          <div className="section-actions">
            <Link to="/account" className="inline-link">
              Account Passport
            </Link>
            <Link to="/strategy" className="inline-link">
              Strategy Lab
            </Link>
          </div>
        </div>
        <p>
          Local-only paper wallet for testing manual actions and strategy behavior. External execution wiring is coming soon through passport-linked providers.
        </p>
      </GlowCard>

      <div className="detail-stat-grid">
        <GlowCard className="stat-card">
          <span>Wallet Equity</span>
          <strong className={walletLab.wallet.equity >= DEFAULT_START_CASH ? 'up' : 'down'}>{fmtNum(walletLab.wallet.equity, 2)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Realized PnL</span>
          <strong className={walletLab.wallet.realizedPnl >= 0 ? 'up' : 'down'}>{fmtNum(walletLab.wallet.realizedPnl, 2)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Unrealized PnL</span>
          <strong className={walletLab.wallet.unrealizedPnl >= 0 ? 'up' : 'down'}>{fmtNum(walletLab.wallet.unrealizedPnl, 2)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Open Notional</span>
          <strong>{fmtCompact(openNotional)}</strong>
        </GlowCard>
      </div>

      <div className="wallet-grid">
        <GlowCard className="panel-card wallet-control-card">
          <div className="section-head">
            <h2>Manual Paper Actions</h2>
            <span>{selectedMarket ? selectedMarket.symbol : 'no market selected'}</span>
          </div>
          <div className="wallet-control-grid">
            <label className="control-field">
              <span>Market</span>
              <select value={walletLab.selectedMarketKey} onChange={(event) => handleControlChange('selectedMarketKey', event.target.value)}>
                {rankedMarkets.map((market) => (
                  <option key={market.key} value={market.key}>
                    {market.symbol} ({market.assetClass})
                  </option>
                ))}
              </select>
            </label>
            <label className="control-field">
              <span>Order Units</span>
              <input
                type="number"
                min={1}
                max={25}
                step={1}
                value={walletLab.orderUnits}
                onChange={(event) => handleControlChange('orderUnits', clamp(event.target.value, 1, 25))}
              />
            </label>
            <label className="control-field">
              <span>Max Abs Units</span>
              <input
                type="number"
                min={1}
                max={80}
                step={1}
                value={walletLab.maxAbsUnits}
                onChange={(event) => handleControlChange('maxAbsUnits', clamp(event.target.value, 1, 80))}
              />
            </label>
            <label className="control-field">
              <span>Slippage (bps)</span>
              <input
                type="number"
                min={0}
                max={50}
                step={0.1}
                value={walletLab.slippageBps}
                onChange={(event) => handleControlChange('slippageBps', clamp(event.target.value, 0, 50))}
              />
            </label>
          </div>
          <label className="control-field">
            <span>Reason</span>
            <input value={walletLab.note} maxLength={140} onChange={(event) => handleControlChange('note', event.target.value)} placeholder="manual wallet test" />
          </label>
          <div className="wallet-action-row">
            <button type="button" className="btn primary" onClick={() => executeManual('accumulate')}>
              Buy
            </button>
            <button type="button" className="btn secondary" onClick={() => executeManual('reduce')}>
              Sell
            </button>
            <button type="button" className="btn secondary" onClick={handleReset}>
              Reset Wallet
            </button>
          </div>
          <p className="socket-status-copy">
            px {fmtNum(marketPrice, 4)} | spread {fmtNum(marketSpread, 2)} bps | vol {fmtCompact(marketVolume)} | trades {fmtInt(walletLab.wallet.tradeCount)} | win rate{' '}
            {fmtPct(winRate)}
          </p>
        </GlowCard>

        <GlowCard className="panel-card wallet-passport-card">
          <div className="section-head">
            <h2>Passport Integration</h2>
            <span>coming soon</span>
          </div>
          <p className="socket-status-copy">
            Profile {passportSummary.profileName} | mode {passportSummary.executionMode} | external actions{' '}
            {passportSummary.externalActionsEnabled ? 'enabled' : 'disabled'}
          </p>
          <div className="wallet-passport-metrics">
            <article>
              <span>Linked</span>
              <strong>{fmtInt(passportSummary.linkedProviders)}</strong>
            </article>
            <article>
              <span>Validated</span>
              <strong>{fmtInt(passportSummary.validatedProviders)}</strong>
            </article>
            <article>
              <span>Live Ready</span>
              <strong>{fmtInt(passportSummary.liveReadyProviders)}</strong>
            </article>
          </div>
          <p className="socket-status-copy">
            Next step: route wallet actions through provider guards once passport links are validated and runtime worker approvals are active.
          </p>
          <div className="wallet-action-row">
            <button type="button" className="btn secondary" onClick={refreshPassportSummary}>
              Refresh Passport
            </button>
            <Link className="btn secondary" to="/account">
              Open Account
            </Link>
          </div>
        </GlowCard>
      </div>

      <GlowCard className="chart-card">
        <LineChart
          title={`Equity Curve (Paper) - ${selectedMarket?.symbol || 'N/A'}`}
          points={equitySeries}
          stroke="#62ffcc"
          fillFrom="rgba(98, 255, 204, 0.28)"
          fillTo="rgba(98, 255, 204, 0.02)"
        />
      </GlowCard>

      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>Recent Trades</h2>
          <span>{walletLab.tradeLog.length} rows</span>
        </div>
        <div className="list-stack">
          {walletLab.tradeLog.map((trade) => (
            <article key={trade.id} className="list-item wallet-trade-item">
              <div className="wallet-trade-head">
                <strong className={trade.action === 'accumulate' ? 'up' : 'down'}>{trade.action === 'accumulate' ? 'buy' : 'sell'}</strong>
                <small>{fmtTime(trade.timestamp)}</small>
              </div>
              <p>{trade.reason || 'manual trade'}</p>
              <div className="item-meta">
                <small>fill {fmtNum(trade.fillPrice, 4)}</small>
                <small>mark {fmtNum(trade.markPrice, 4)}</small>
                <small>spread {fmtNum(trade.spreadBps, 2)} bps</small>
                <small>units {fmtNum(trade.unitsAfter, 0)}</small>
                <small className={trade.realizedDelta >= 0 ? 'up' : 'down'}>realized {fmtNum(trade.realizedDelta, 2)}</small>
              </div>
            </article>
          ))}
          {walletLab.tradeLog.length === 0 ? <p className="action-message">No paper trades yet. Use Buy/Sell above to test execution flow.</p> : null}
        </div>
      </GlowCard>

      {message ? (
        <GlowCard className="panel-card">
          <p className="action-message">{message}</p>
        </GlowCard>
      ) : null}
    </section>
  );
}
