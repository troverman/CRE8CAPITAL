import { useEffect, useMemo, useRef, useState } from 'react';
import GlowCard from '../components/GlowCard';
import LineChart from '../components/LineChart';
import { fmtCompact, fmtInt, fmtNum, fmtPct, fmtTime } from '../lib/format';
import { Link } from '../lib/router';

const HISTORY_LIMIT = 220;
const STEP_MS = 860;
const MARKET_LIMIT = 40;

const toNum = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const computeImpulse = ({ drift, breadth, liquidity, stress, volatility }) => {
  const breadthTilt = (breadth - 0.5) * 100;
  return drift * 68 + breadthTilt * 0.78 + liquidity * 5.2 - stress * 39 + volatility * 16;
};

const buildMarketRows = (snapshot) => {
  const markets = Array.isArray(snapshot?.markets) ? snapshot.markets : [];
  return [...markets]
    .filter((market) => Boolean(market?.key))
    .map((market) => ({
      key: market.key,
      symbol: market.symbol,
      assetClass: market.assetClass,
      volume: Math.max(0, toNum(market.totalVolume, 0)),
      changePct: toNum(market.changePct, 0),
      spreadBps: Math.max(0, toNum(market.spreadBps, 0)),
      price: toNum(market.referencePrice, 0)
    }))
    .sort((a, b) => {
      const aScore = a.volume + Math.abs(a.changePct) * 1_250_000;
      const bScore = b.volume + Math.abs(b.changePct) * 1_250_000;
      return bScore - aScore;
    })
    .slice(0, MARKET_LIMIT);
};

const buildTensorTarget = (marketRows) => {
  if (!Array.isArray(marketRows) || marketRows.length === 0) {
    return {
      drift: 0,
      breadth: 0.5,
      volatility: 0,
      liquidity: 0,
      stress: 0,
      spreadPressure: 0,
      totalVolume: 0,
      positiveCount: 0,
      contributionRows: []
    };
  }

  const weightRows = marketRows.map((row) => ({
    ...row,
    weight: Math.max(1, Math.sqrt(row.volume + 1))
  }));

  const totalWeight = weightRows.reduce((sum, row) => sum + row.weight, 0) || 1;
  const totalVolume = weightRows.reduce((sum, row) => sum + row.volume, 0);
  const weightedDrift = weightRows.reduce((sum, row) => sum + row.changePct * row.weight, 0) / totalWeight;
  const weightedSpread = weightRows.reduce((sum, row) => sum + row.spreadBps * row.weight, 0) / totalWeight;
  const positiveCount = weightRows.filter((row) => row.changePct >= 0).length;
  const breadth = positiveCount / Math.max(weightRows.length, 1);
  const mean = weightedDrift;
  const variance = weightRows.reduce((sum, row) => sum + Math.pow(row.changePct - mean, 2), 0) / Math.max(weightRows.length, 1);
  const volatility = Math.sqrt(Math.max(variance, 0));
  const liquidity = totalVolume > 0 ? Math.log10(totalVolume + 1) : 0;
  const stress = clamp(volatility * 1.25 + weightedSpread / 42, 0, 2.5);

  const totalAbsChange = weightRows.reduce((sum, row) => sum + Math.abs(row.changePct), 0) || 1;
  const contributionRows = weightRows
    .map((row) => {
      const volumeShare = totalVolume > 0 ? row.volume / totalVolume : 0;
      const changeShare = Math.abs(row.changePct) / totalAbsChange;
      const influence = clamp((volumeShare * 0.72 + changeShare * 0.28) * 100, 0, 100);
      return {
        key: row.key,
        symbol: row.symbol,
        assetClass: row.assetClass,
        influence,
        volumeShare,
        changePct: row.changePct,
        spreadBps: row.spreadBps
      };
    })
    .sort((a, b) => b.influence - a.influence)
    .slice(0, 14);

  return {
    drift: weightedDrift,
    breadth,
    volatility,
    liquidity,
    stress,
    spreadPressure: weightedSpread,
    totalVolume,
    positiveCount,
    contributionRows
  };
};

const createInitialPoint = (target, timestamp) => {
  const baseIndex = 100 + clamp(target.drift * 2.5, -7, 7);
  return {
    t: timestamp,
    marketIndex: baseIndex,
    drift: target.drift,
    breadth: target.breadth,
    volatility: target.volatility,
    liquidity: target.liquidity,
    stress: target.stress,
    impulse: computeImpulse(target)
  };
};

const evolvePoint = (previous, target, step, timestamp) => {
  const phase = step * 0.22;
  const driftNoise = Math.sin(phase * 1.27) * 0.019 + (Math.random() - 0.5) * 0.043;
  const breadthNoise = Math.cos(phase * 0.94) * 0.012 + (Math.random() - 0.5) * 0.02;
  const volatilityNoise = (Math.random() - 0.5) * 0.025;
  const liquidityNoise = Math.sin(phase * 0.51) * 0.03;
  const stressNoise = Math.cos(phase * 1.12) * 0.016 + (Math.random() - 0.5) * 0.018;

  const drift = previous.drift + (target.drift - previous.drift) * 0.31 + driftNoise;
  const breadth = clamp(previous.breadth + (target.breadth - previous.breadth) * 0.28 + breadthNoise, 0.02, 0.98);
  const volatility = clamp(previous.volatility + (target.volatility - previous.volatility) * 0.27 + volatilityNoise, 0, 4.5);
  const liquidity = clamp(previous.liquidity + (target.liquidity - previous.liquidity) * 0.2 + liquidityNoise, 0, 16);
  const stress = clamp(previous.stress + (target.stress - previous.stress) * 0.29 + stressNoise, 0, 4.8);

  const impulse = computeImpulse({ drift, breadth, volatility, liquidity, stress });
  const momentum =
    drift * 0.0072 + (breadth - 0.5) * 0.0054 - stress * 0.003 + (Math.random() - 0.5) * 0.0015 + Math.sin(phase * 1.39) * 0.0008;
  const marketIndex = clamp(previous.marketIndex * (1 + momentum), 35, 460);

  return {
    t: timestamp,
    marketIndex,
    drift,
    breadth,
    volatility,
    liquidity,
    stress,
    impulse
  };
};

const toTensorColor = (value) => {
  const clamped = clamp(value, -1, 1);
  const intensity = Math.abs(clamped);
  const alpha = 0.15 + intensity * 0.64;
  if (clamped >= 0) {
    const red = Math.round(70 + intensity * 70);
    const green = Math.round(152 + intensity * 94);
    const blue = Math.round(168 + intensity * 60);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }
  const red = Math.round(168 + intensity * 78);
  const green = Math.round(78 + intensity * 34);
  const blue = Math.round(118 + intensity * 42);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
};

export default function TotalMarketLabPage({ snapshot }) {
  const marketRows = useMemo(() => buildMarketRows(snapshot), [snapshot]);
  const target = useMemo(() => buildTensorTarget(marketRows), [marketRows]);
  const targetRef = useRef(target);
  const stepRef = useRef(0);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  const [history, setHistory] = useState(() => [createInitialPoint(target, Date.now())]);

  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    setHistory((current) => {
      if (current.length > 0) return current;
      return [createInitialPoint(target, Date.now())];
    });
  }, [target]);

  useEffect(() => {
    const timerId = setInterval(() => {
      if (pausedRef.current) return;
      const targetNow = targetRef.current;
      const timestamp = Date.now();
      setHistory((current) => {
        const last = current[current.length - 1] || createInitialPoint(targetNow, timestamp);
        const next = evolvePoint(last, targetNow, stepRef.current, timestamp);
        stepRef.current += 1;
        const rows = [...current, next];
        if (rows.length > HISTORY_LIMIT) {
          rows.splice(0, rows.length - HISTORY_LIMIT);
        }
        return rows;
      });
    }, STEP_MS);
    return () => clearInterval(timerId);
  }, []);

  const latest = history[history.length - 1] || createInitialPoint(target, Date.now());
  const marketIndexSeries = useMemo(() => history.map((point) => point.marketIndex), [history]);
  const impulseSeries = useMemo(() => history.map((point) => point.impulse), [history]);
  const driftSeries = useMemo(() => history.map((point) => point.drift * 100), [history]);
  const breadthSeries = useMemo(() => history.map((point) => (point.breadth - 0.5) * 120), [history]);
  const stressSeries = useMemo(() => history.map((point) => point.stress * -36), [history]);

  const axes = useMemo(() => {
    return [
      {
        key: 'trend',
        label: 'Trend',
        value: clamp(latest.drift / 1.35, -1, 1)
      },
      {
        key: 'breadth',
        label: 'Breadth',
        value: clamp((latest.breadth - 0.5) * 2, -1, 1)
      },
      {
        key: 'liquidity',
        label: 'Liquidity',
        value: clamp((latest.liquidity - 5) / 4, -1, 1)
      },
      {
        key: 'stress',
        label: 'Stress',
        value: clamp(latest.stress / 2.2, -1, 1)
      }
    ];
  }, [latest.breadth, latest.drift, latest.liquidity, latest.stress]);

  const matrixRows = useMemo(() => {
    return axes.map((rowAxis, rowIndex) => {
      return axes.map((colAxis, colIndex) => {
        const raw = rowIndex === colIndex ? rowAxis.value : rowAxis.value * colAxis.value;
        const value = clamp(raw, -1, 1);
        return {
          key: `${rowAxis.key}:${colAxis.key}`,
          rowLabel: rowAxis.label,
          colLabel: colAxis.label,
          value
        };
      });
    });
  }, [axes]);

  const resetTrail = () => {
    stepRef.current = 0;
    setHistory([createInitialPoint(targetRef.current, Date.now())]);
  };

  return (
    <section className="page-grid">
      <GlowCard className="detail-card">
        <div className="section-head">
          <h1>Total Market Lab</h1>
          <div className="section-actions">
            <button type="button" className="btn secondary" onClick={() => setPaused((current) => !current)}>
              {paused ? 'Resume Tensor' : 'Pause Tensor'}
            </button>
            <button type="button" className="btn secondary" onClick={resetTrail}>
              Reset Trail
            </button>
            <Link to="/other" className="inline-link">
              Back to other
            </Link>
          </div>
        </div>
        <p>
          Experimental total-market tensor over time. The lab fuses drift, breadth, volatility, liquidity, and spread stress into a live animated state.
        </p>
      </GlowCard>

      <div className="detail-stat-grid">
        <GlowCard className="stat-card">
          <span>Watched Markets</span>
          <strong>{fmtInt(marketRows.length)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Tensor Drift</span>
          <strong className={latest.drift >= 0 ? 'up' : 'down'}>{fmtPct(latest.drift)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Breadth</span>
          <strong>{fmtPct((latest.breadth || 0) * 100)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Total Volume</span>
          <strong>{fmtCompact(target.totalVolume)}</strong>
        </GlowCard>
      </div>

      <div className="total-market-grid">
        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Total Market Index</h2>
            <span>
              {paused ? 'paused' : 'live'} | {fmtTime(latest.t)}
            </span>
          </div>
          <LineChart
            title="Tensor Index"
            points={marketIndexSeries}
            stroke="#72ecff"
            fillFrom="rgba(82, 199, 255, 0.34)"
            fillTo="rgba(82, 199, 255, 0.03)"
          />
        </GlowCard>

        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Tensor Components</h2>
            <span>impulse {fmtNum(latest.impulse, 2)}</span>
          </div>
          <LineChart
            title="Impulse + Components"
            points={impulseSeries}
            stroke="#9cf3cf"
            fillFrom="rgba(104, 238, 195, 0.3)"
            fillTo="rgba(104, 238, 195, 0.02)"
            overlays={[
              {
                key: 'drift',
                label: 'drift x100',
                points: driftSeries,
                stroke: '#9db4ff'
              },
              {
                key: 'breadth',
                label: 'breadth bias',
                points: breadthSeries,
                stroke: '#ffcc8a',
                dasharray: '6 5'
              },
              {
                key: 'stress',
                label: 'stress penalty',
                points: stressSeries,
                stroke: '#ff8eaa',
                dasharray: '4 4'
              }
            ]}
          />
        </GlowCard>
      </div>

      <div className="total-market-grid">
        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Tensor Matrix</h2>
            <span>4 x 4 interaction field</span>
          </div>
          <div className="tensor-axis-head">
            {axes.map((axis) => (
              <span key={`axis-head:${axis.key}`}>{axis.label}</span>
            ))}
          </div>
          <div className="tensor-matrix-grid">
            {matrixRows.flatMap((row, rowIndex) =>
              row.map((cell, colIndex) => (
                <article
                  key={cell.key}
                  className="tensor-cell"
                  title={`${cell.rowLabel} x ${cell.colLabel}: ${fmtNum(cell.value, 3)}`}
                  style={{
                    background: toTensorColor(cell.value),
                    transform: `scale(${0.96 + Math.abs(cell.value) * 0.07})`
                  }}
                >
                  <small>{rowIndex === 0 ? cell.colLabel : ''}</small>
                  <strong>{fmtNum(cell.value, 2)}</strong>
                  <small>{colIndex === 0 ? cell.rowLabel : ''}</small>
                </article>
              ))
            )}
          </div>
          <p className="socket-status-copy">
            Positive cells show aligned components. Negative cells highlight regime conflict and potential strategy turbulence.
          </p>
        </GlowCard>

        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Market Contribution</h2>
            <span>{fmtInt(target.positiveCount)} up / {fmtInt(marketRows.length)} watched</span>
          </div>
          <div className="total-market-contrib-list">
            {target.contributionRows.map((row) => (
              <article key={`contrib:${row.key}`} className="total-market-contrib-row">
                <div className="total-market-contrib-head">
                  <strong>{row.symbol}</strong>
                  <small>{row.assetClass}</small>
                  <span className={row.changePct >= 0 ? 'up' : 'down'}>{fmtPct(row.changePct)}</span>
                </div>
                <div className="total-market-contrib-bar-track">
                  <div className={row.changePct >= 0 ? 'total-market-contrib-bar up' : 'total-market-contrib-bar down'} style={{ width: `${row.influence.toFixed(2)}%` }} />
                </div>
                <small>
                  influence {fmtNum(row.influence, 2)}% | volume share {fmtNum(row.volumeShare * 100, 2)}% | spread {fmtNum(row.spreadBps, 2)} bps
                </small>
              </article>
            ))}
            {target.contributionRows.length === 0 ? <p className="action-message">No markets available for tensor contribution yet.</p> : null}
          </div>
        </GlowCard>
      </div>
    </section>
  );
}
