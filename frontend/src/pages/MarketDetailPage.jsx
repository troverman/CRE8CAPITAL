import { useEffect, useMemo, useState } from 'react';
import FlashList from '../components/FlashList';
import GlowCard from '../components/GlowCard';
import LineChart from '../components/LineChart';
import Sparkline from '../components/Sparkline';
import useSocketProviders from '../hooks/useSocketProviders';
import { fmtCompact, fmtInt, fmtNum, fmtPct, fmtTime, severityClass } from '../lib/format';
import { Link } from '../lib/router';

export default function MarketDetailPage({ marketId, snapshot, historyByMarket, onRefresh, syncing }) {
  const normalizedId = String(marketId || '').toLowerCase();
  const market = snapshot.markets.find((item) => {
    return item.key === marketId || String(item.symbol || '').toLowerCase() === normalizedId;
  });

  const supportsSocketProviders = Boolean(market) && String(market.assetClass || '').toLowerCase() === 'crypto';
  const [socketEnabled, setSocketEnabled] = useState(false);

  useEffect(() => {
    setSocketEnabled(supportsSocketProviders);
  }, [supportsSocketProviders, market?.key]);

  const socketLiveEnabled = supportsSocketProviders && socketEnabled;
  const {
    providerStates,
    seriesByProvider,
    primaryProvider,
    primarySeries,
    recentTicks,
    localFallbackActive,
    externalProviderCount,
    externalConnectedCount
  } =
    useSocketProviders({
      market,
      enabled: socketLiveEnabled
    });

  if (!market) {
    return (
      <section className="page-grid">
        <GlowCard className="detail-card">
          <h1>Market not found</h1>
          <p>No market entry found for `{marketId}` in the current snapshot.</p>
          <Link to="/markets" className="inline-link">
            Back to markets
          </Link>
        </GlowCard>
      </section>
    );
  }

  const history = historyByMarket[market.key] || [];
  const signals = snapshot.signals.filter((signal) => signal.symbol === market.symbol && signal.assetClass === market.assetClass).slice(0, 10);
  const decisions = snapshot.decisions.filter((decision) => decision.symbol === market.symbol && decision.assetClass === market.assetClass).slice(0, 10);

  const runtimePriceSeries = history.map((point) => point.price);
  const runtimeSpreadSeries = history.map((point) => point.spread);
  const socketPriceSeries = primarySeries.map((point) => point.price);
  const socketSpreadSeries = primarySeries.map((point) => point.spread);

  const useSocketAsPrimary = socketLiveEnabled && socketPriceSeries.length > 1;
  const priceSeries = useSocketAsPrimary ? socketPriceSeries : runtimePriceSeries;
  const spreadSeries = useSocketAsPrimary ? socketSpreadSeries : runtimeSpreadSeries;
  const sourceLabel = useSocketAsPrimary ? `${primaryProvider?.name || 'Socket'} feed` : 'Runtime feed';

  const quoteRows = useMemo(() => {
    const runtimeRows = market.providers.map((provider) => ({
      id: `runtime:${provider.id}`,
      source: 'runtime',
      name: provider.name || provider.id,
      price: provider.price,
      bid: provider.bid,
      ask: provider.ask,
      volume: provider.volume,
      timestamp: provider.timestamp
    }));

    const socketRows = providerStates
      .filter((provider) => provider.price !== null)
      .map((provider) => ({
        id: `socket:${provider.id}`,
        source: 'socket',
        name: provider.name || provider.id,
        price: provider.price,
        bid: provider.bid,
        ask: provider.ask,
        volume: provider.volume,
        timestamp: provider.lastTickAt
      }));

    return [...runtimeRows, ...socketRows];
  }, [market.providers, providerStates]);

  return (
    <section className="page-grid">
      <GlowCard className="detail-card">
        <div className="section-head">
          <h1>market:{market.symbol}</h1>
          <div className="section-actions">
            <Link to="/markets" className="inline-link">
              Back to markets
            </Link>
            <button type="button" className="btn secondary" onClick={onRefresh} disabled={syncing}>
              {syncing ? 'Syncing...' : 'Refresh'}
            </button>
          </div>
        </div>
        <p>
          {market.assetClass} | key {market.key} | providers {fmtInt(market.providerCount)} | venues {fmtInt(market.venueCount)}
        </p>

        <div className="socket-toggle-row">
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={socketEnabled}
              onChange={(event) => setSocketEnabled(event.target.checked)}
              disabled={!supportsSocketProviders}
            />
            <span>Frontend socket providers</span>
          </label>
          <small>
            {supportsSocketProviders
              ? localFallbackActive
                ? 'External sockets unavailable, using local synthetic fallback'
                : 'Binance + Coinbase direct socket feed'
              : 'Socket providers currently enabled for crypto markets'}
          </small>
        </div>
      </GlowCard>

      <div className="detail-stat-grid">
        <GlowCard className="stat-card">
          <span>Reference</span>
          <strong>{fmtNum(market.referencePrice, 4)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Change</span>
          <strong className={Number(market.changePct) >= 0 ? 'up' : 'down'}>{fmtPct(market.changePct)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Spread</span>
          <strong>{fmtNum(market.spreadBps, 2)} bps</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Volume</span>
          <strong>{fmtCompact(market.totalVolume)}</strong>
        </GlowCard>
      </div>

      <GlowCard className="chart-card">
        <LineChart
          title={`Reference Price (Live) - ${sourceLabel}`}
          points={priceSeries}
          stroke="#77dcff"
          fillFrom="rgba(58, 147, 255, 0.36)"
          fillTo="rgba(58, 147, 255, 0.02)"
        />
      </GlowCard>

      <GlowCard className="chart-card">
        <LineChart
          title={`Spread (bps) - ${sourceLabel}`}
          points={spreadSeries}
          stroke="#ff9e74"
          fillFrom="rgba(255, 122, 64, 0.35)"
          fillTo="rgba(255, 122, 64, 0.02)"
          unit=" bps"
        />
      </GlowCard>

      {supportsSocketProviders ? (
        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Socket Provider Status</h2>
            <span>
              {providerStates.filter((provider) => provider.connected).length}/{providerStates.length} connected
            </span>
          </div>
          <p className="socket-status-copy">
            external {externalConnectedCount}/{externalProviderCount} connected
            {localFallbackActive ? ' | local fallback active' : ''}
          </p>
          <div className="socket-provider-grid">
            {providerStates.map((provider) => (
              <article key={provider.id} className="socket-provider-card">
                <div className="socket-provider-head">
                  <strong>{provider.name}</strong>
                  <span className={provider.connected ? 'status-pill online' : 'status-pill'}>
                    {provider.connected ? 'connected' : 'offline'}
                  </span>
                </div>
                <p>
                  price {fmtNum(provider.price, 4)} | bid {fmtNum(provider.bid, 4)} | ask {fmtNum(provider.ask, 4)}
                </p>
                <Sparkline data={(seriesByProvider[provider.id] || []).map((point) => point.price)} width={160} height={42} />
                <small>
                  {provider.error || `last tick ${fmtTime(provider.lastTickAt)}`}
                  {provider.guardDrops > 0 ? ` | guard drops ${fmtInt(provider.guardDrops)}` : ''}
                </small>
              </article>
            ))}
          </div>
        </GlowCard>
      ) : null}

      {supportsSocketProviders ? (
        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Live Tick Tape</h2>
            <span>{recentTicks.length} buffered</span>
          </div>
          <FlashList
            items={recentTicks}
            height={290}
            itemHeight={58}
            className="tick-flash-list"
            emptyCopy={socketLiveEnabled ? 'Waiting for live ticks...' : 'Enable frontend socket providers to stream ticks.'}
            keyExtractor={(tick) => tick.id}
            renderItem={(tick) => (
              <article className="tick-row">
                <div className="tick-main">
                  <strong>{tick.providerName || tick.providerId}</strong>
                  <small>
                    {tick.venue || 'unknown'} | {tick.symbol || '-'}
                  </small>
                </div>
                <div className="tick-metrics">
                  <span>{fmtNum(tick.price, 4)}</span>
                  <small>
                    spr {fmtNum(tick.spread, 2)} bps | vol {fmtCompact(tick.volume)}
                  </small>
                </div>
                <small>{fmtTime(tick.timestamp)}</small>
              </article>
            )}
          />
        </GlowCard>
      ) : null}

      <div className="two-col">
        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Provider Quotes</h2>
            <span>{quoteRows.length} rows</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Provider</th>
                  <th>Price</th>
                  <th>Bid</th>
                  <th>Ask</th>
                  <th>Volume</th>
                  <th>At</th>
                </tr>
              </thead>
              <tbody>
                {quoteRows.map((provider) => (
                  <tr key={provider.id}>
                    <td>{provider.source}</td>
                    <td>{provider.name}</td>
                    <td>{fmtNum(provider.price, 4)}</td>
                    <td>{fmtNum(provider.bid, 4)}</td>
                    <td>{fmtNum(provider.ask, 4)}</td>
                    <td>{fmtCompact(provider.volume)}</td>
                    <td>{fmtTime(provider.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlowCard>

        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Signals</h2>
            <span>{signals.length} recent</span>
          </div>
          <div className="list-stack">
            {signals.map((signal) => (
              <article key={signal.id} className="list-item">
                <strong>
                  {signal.type} | {signal.direction}
                </strong>
                <p>{signal.message}</p>
                <div className="item-meta">
                  <span className={`severity ${severityClass(signal.severity)}`}>{signal.severity}</span>
                  <small>score {fmtInt(signal.score)}</small>
                  <small>{fmtTime(signal.timestamp)}</small>
                </div>
              </article>
            ))}
          </div>
        </GlowCard>
      </div>

      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>Decisions</h2>
          <span>{decisions.length} recent</span>
        </div>
        <div className="list-stack">
          {decisions.map((decision) => (
            <article key={decision.id} className="list-item">
              <strong>
                {decision.strategyName} - {decision.action}
              </strong>
              <p>{decision.reason}</p>
              <div className="item-meta">
                <small>{decision.trigger}</small>
                <small>score {fmtInt(decision.score)}</small>
                <small>{fmtTime(decision.timestamp)}</small>
              </div>
            </article>
          ))}
        </div>
      </GlowCard>
    </section>
  );
}
