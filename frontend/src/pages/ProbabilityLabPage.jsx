import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FlashList from '../components/FlashList';
import GlowCard from '../components/GlowCard';
import LineChart from '../components/LineChart';
import { fmtInt, fmtNum, fmtPct, fmtTime } from '../lib/format';
import {
  blendColumns,
  blendPaintIntoColumns,
  buildIndicatorLayerColumns,
  buildPdfBuckets,
  buildProbabilityColumns,
  chooseSeriesForMarket,
  DEFAULT_PDF_LAYER_WEIGHTS,
  findNearestHorizonIndex,
  PDF_HORIZONS,
  rankMarketsByPdf,
  recommendPdfAction,
  summarizeProbabilityColumn
} from '../lib/probabilityLab';
import { Link } from '../lib/router';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const toNum = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const toneClass = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num === 0) return '';
  return num > 0 ? 'up' : 'down';
};

const fmtProb = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return `${(num * 100).toFixed(1)}%`;
};

const formatBucketLabel = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  const sign = num > 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
};

const rankMarkets = (markets = []) => {
  return [...(Array.isArray(markets) ? markets : [])]
    .filter((market) => Boolean(market?.key))
    .sort((a, b) => {
      const aScore = toNum(a.totalVolume, 0) + Math.abs(toNum(a.changePct, 0)) * 1000000;
      const bScore = toNum(b.totalVolume, 0) + Math.abs(toNum(b.changePct, 0)) * 1000000;
      return bScore - aScore;
    })
    .slice(0, 180);
};

const buildCellStyle = (cell, maxProb) => {
  const safeMax = Math.max(Number(maxProb) || 0, 0.00001);
  const intensity = clamp(toNum(cell?.value, 0) / safeMax, 0, 1);
  const paintLevel = clamp(toNum(cell?.paintValue, 0), 0, 1);
  const center = toNum(cell?.center, 0);
  const hue = center > 0 ? 156 : center < 0 ? 352 : 216;
  const sat = 52 + intensity * 36;
  const lightA = 10 + intensity * 24;
  const lightB = 7 + intensity * 12;
  const alphaA = 0.22 + intensity * 0.62;
  const alphaB = 0.86;
  const borderAlpha = 0.16 + intensity * 0.58 + paintLevel * 0.18;

  return {
    background: `linear-gradient(160deg, hsla(${hue}, ${sat}%, ${lightA}%, ${alphaA}), hsla(${hue}, ${Math.max(26, sat - 18)}%, ${lightB}%, ${alphaB}))`,
    borderColor: `hsla(${hue}, 86%, 72%, ${borderAlpha})`
  };
};

export default function ProbabilityLabPage({ snapshot, historyByMarket }) {
  const markets = useMemo(() => rankMarkets(snapshot?.markets || []), [snapshot?.markets]);
  const [marketKey, setMarketKey] = useState('');
  const [activeHorizon, setActiveHorizon] = useState(3);
  const [indicatorBlend, setIndicatorBlend] = useState(0.34);
  const [layerWeights, setLayerWeights] = useState(DEFAULT_PDF_LAYER_WEIGHTS);
  const [paintStrength, setPaintStrength] = useState(0.42);
  const [brushStep, setBrushStep] = useState(0.15);
  const [paintByHorizon, setPaintByHorizon] = useState({});
  const [dragDirection, setDragDirection] = useState(0);
  const [decisionFeed, setDecisionFeed] = useState([]);
  const decisionRef = useRef({ signature: '', timestamp: 0 });

  useEffect(() => {
    if (!markets.length) return;
    if (marketKey && markets.some((market) => market.key === marketKey)) return;
    setMarketKey(markets[0].key);
  }, [marketKey, markets]);

  const selectedMarket = useMemo(() => {
    if (!markets.length) return null;
    return markets.find((market) => market.key === marketKey) || markets[0];
  }, [marketKey, markets]);

  const buckets = useMemo(() => {
    return buildPdfBuckets({
      minPct: -4.5,
      maxPct: 4.5,
      stepPct: 0.25
    });
  }, []);

  const selectedSeriesData = useMemo(() => {
    if (!selectedMarket) {
      return {
        source: 'synthetic',
        series: [],
        sampleCount: 0
      };
    }
    return chooseSeriesForMarket({
      market: selectedMarket,
      historyByMarket,
      now: snapshot?.now || Date.now(),
      minPoints: 72,
      maxPoints: 320
    });
  }, [historyByMarket, selectedMarket, snapshot?.now]);

  const probabilityBase = useMemo(() => {
    return buildProbabilityColumns({
      series: selectedSeriesData.series,
      horizons: PDF_HORIZONS,
      buckets,
      halfLife: 96
    });
  }, [buckets, selectedSeriesData.series]);

  const horizons = probabilityBase.horizons.length ? probabilityBase.horizons : PDF_HORIZONS;

  const indicatorModel = useMemo(() => {
    return buildIndicatorLayerColumns({
      series: selectedSeriesData.series,
      horizons,
      buckets,
      layerWeights
    });
  }, [buckets, horizons, layerWeights, selectedSeriesData.series]);

  useEffect(() => {
    if (!horizons.length) return;
    if (horizons.includes(activeHorizon)) return;
    setActiveHorizon(horizons[0]);
  }, [activeHorizon, horizons]);

  const baseWithIndicators = useMemo(() => {
    return blendColumns({
      baseColumns: probabilityBase.columns,
      overlayColumns: indicatorModel.columns,
      overlayStrength: indicatorBlend
    });
  }, [indicatorBlend, indicatorModel.columns, probabilityBase.columns]);

  const blendedColumns = useMemo(() => {
    return blendPaintIntoColumns({
      baseColumns: baseWithIndicators,
      horizons,
      paintByHorizon,
      paintStrength
    });
  }, [baseWithIndicators, horizons, paintByHorizon, paintStrength]);

  const horizonSummaries = useMemo(() => {
    return horizons.map((horizon, index) => {
      const summary = summarizeProbabilityColumn({
        column: blendedColumns[index],
        buckets
      });
      return {
        horizon,
        summary,
        recommendation: recommendPdfAction({ summary })
      };
    });
  }, [buckets, blendedColumns, horizons]);

  const activeHorizonIndex = useMemo(() => {
    return findNearestHorizonIndex(horizons, activeHorizon);
  }, [activeHorizon, horizons]);

  const activeSummary = useMemo(() => {
    if (activeHorizonIndex < 0) {
      return {
        upProb: 0,
        downProb: 0,
        flatProb: 1,
        expectedMovePct: 0,
        volatilityPct: 0,
        skew: 0,
        confidencePct: 0
      };
    }
    return summarizeProbabilityColumn({
      column: blendedColumns[activeHorizonIndex],
      buckets
    });
  }, [activeHorizonIndex, blendedColumns, buckets]);

  const activeRecommendation = useMemo(() => {
    return recommendPdfAction({
      summary: activeSummary
    });
  }, [activeSummary]);

  const tensorSummary = useMemo(() => {
    if (!horizonSummaries.length) {
      return {
        upProb: 0,
        downProb: 0,
        flatProb: 1,
        expectedMovePct: 0,
        volatilityPct: 0,
        skew: 0,
        confidencePct: 0
      };
    }

    let weightTotal = 0;
    let upProb = 0;
    let downProb = 0;
    let flatProb = 0;
    let expectedMovePct = 0;
    let volatilityPct = 0;
    let skew = 0;
    let confidencePct = 0;

    for (const row of horizonSummaries) {
      const weight = 1 / Math.sqrt(Math.max(1, row.horizon));
      weightTotal += weight;
      upProb += row.summary.upProb * weight;
      downProb += row.summary.downProb * weight;
      flatProb += row.summary.flatProb * weight;
      expectedMovePct += row.summary.expectedMovePct * weight;
      volatilityPct += row.summary.volatilityPct * weight;
      skew += row.summary.skew * weight;
      confidencePct += row.summary.confidencePct * weight;
    }

    return {
      upProb: upProb / Math.max(weightTotal, 1e-9),
      downProb: downProb / Math.max(weightTotal, 1e-9),
      flatProb: flatProb / Math.max(weightTotal, 1e-9),
      expectedMovePct: expectedMovePct / Math.max(weightTotal, 1e-9),
      volatilityPct: volatilityPct / Math.max(weightTotal, 1e-9),
      skew: skew / Math.max(weightTotal, 1e-9),
      confidencePct: confidencePct / Math.max(weightTotal, 1e-9)
    };
  }, [horizonSummaries]);

  const tensorRecommendation = useMemo(() => {
    return recommendPdfAction({
      summary: tensorSummary,
      upThreshold: 0.54,
      downThreshold: 0.54,
      minExpectedMovePct: 0.03,
      minSkew: 0.06
    });
  }, [tensorSummary]);

  const heatmapRows = useMemo(() => {
    const rows = [];
    for (let bucketIndex = buckets.length - 1; bucketIndex >= 0; bucketIndex -= 1) {
      const center = toNum(buckets[bucketIndex]?.center, 0);
      rows.push({
        bucketIndex,
        center,
        cells: horizons.map((horizon, columnIndex) => {
          const value = toNum(blendedColumns[columnIndex]?.[bucketIndex], 0);
          const baseValue = toNum(probabilityBase.columns[columnIndex]?.[bucketIndex], 0);
          const paintValue = toNum(paintByHorizon?.[String(horizon)]?.[bucketIndex], 0);
          return {
            horizon,
            horizonKey: String(horizon),
            bucketIndex,
            center,
            value,
            baseValue,
            paintValue
          };
        })
      });
    }
    return rows;
  }, [blendedColumns, buckets, horizons, paintByHorizon, probabilityBase.columns]);

  const maxHeatmapProb = useMemo(() => {
    let max = 0;
    for (const row of heatmapRows) {
      for (const cell of row.cells) {
        max = Math.max(max, toNum(cell.value, 0));
      }
    }
    return Math.max(max, 0.00001);
  }, [heatmapRows]);

  const marketRankings = useMemo(() => {
    return rankMarketsByPdf({
      markets,
      historyByMarket,
      buckets,
      horizons,
      horizon: activeHorizon,
      indicatorBlend,
      layerWeights,
      now: snapshot?.now || Date.now()
    }).slice(0, 36);
  }, [activeHorizon, buckets, historyByMarket, horizons, indicatorBlend, layerWeights, markets, snapshot?.now]);

  const topRanking = marketRankings[0] || null;

  const updateLayerWeight = useCallback((key, value) => {
    const safe = clamp((Number(value) || 0) / 100, 0, 2);
    setLayerWeights((previous) => ({
      ...previous,
      [key]: safe
    }));
  }, []);

  const applyPaintToCell = useCallback(
    (horizonKey, bucketIndex, direction = 1) => {
      if (bucketIndex < 0 || bucketIndex >= buckets.length) return;
      const delta = clamp(Math.abs(brushStep), 0.02, 1) * (direction >= 0 ? 1 : -1);
      setPaintByHorizon((previous) => {
        const key = String(horizonKey);
        const next = { ...previous };
        const source = Array.isArray(next[key]) ? [...next[key]] : new Array(buckets.length).fill(0);
        source[bucketIndex] = clamp(toNum(source[bucketIndex], 0) + delta, 0, 1.4);
        next[key] = source;
        return next;
      });
    },
    [buckets.length, brushStep]
  );

  const applyTemplate = useCallback(
    (direction = 1) => {
      const safeDirection = direction >= 0 ? 1 : -1;
      setPaintByHorizon(() => {
        const next = {};
        for (const horizon of horizons) {
          const center = safeDirection * Math.min(2.6, 0.24 * horizon);
          const sigma = 0.35 + horizon * 0.075;
          const horizonPaint = buckets.map((bucket) => {
            const bucketCenter = toNum(bucket.center, 0);
            const z = (bucketCenter - center) / Math.max(0.08, sigma);
            return Math.exp(-(z * z) / 2);
          });
          next[String(horizon)] = horizonPaint;
        }
        return next;
      });
    },
    [buckets, horizons]
  );

  const clearPaint = useCallback(() => {
    setPaintByHorizon({});
  }, []);

  useEffect(() => {
    const stop = () => setDragDirection(0);
    window.addEventListener('mouseup', stop);
    return () => {
      window.removeEventListener('mouseup', stop);
    };
  }, []);

  useEffect(() => {
    if (!selectedMarket || activeHorizonIndex < 0) return;
    const latestPoint = selectedSeriesData.series[selectedSeriesData.series.length - 1];
    const timestamp = toNum(latestPoint?.t, Date.now());
    const signature = [
      selectedMarket.key,
      activeHorizon,
      activeRecommendation.action,
      activeSummary.upProb.toFixed(4),
      activeSummary.downProb.toFixed(4),
      activeSummary.expectedMovePct.toFixed(4)
    ].join('|');

    const prev = decisionRef.current;
    const elapsed = timestamp - toNum(prev.timestamp, 0);
    if (prev.signature === signature && elapsed < 14000) return;
    decisionRef.current = { signature, timestamp };

    setDecisionFeed((previous) => {
      const next = [
        {
          id: `pdf-decision:${selectedMarket.key}:${timestamp}:${Math.round(Math.random() * 10000)}`,
          timestamp,
          symbol: selectedMarket.symbol,
          assetClass: selectedMarket.assetClass,
          marketKey: selectedMarket.key,
          horizon: activeHorizon,
          action: activeRecommendation.action,
          stance: activeRecommendation.stance,
          reason: activeRecommendation.reason,
          upProb: activeSummary.upProb,
          downProb: activeSummary.downProb,
          expectedMovePct: activeSummary.expectedMovePct,
          source: selectedSeriesData.source
        },
        ...previous
      ];
      return next.slice(0, 180);
    });
  }, [
    activeHorizon,
    activeHorizonIndex,
    activeRecommendation.action,
    activeRecommendation.reason,
    activeRecommendation.stance,
    activeSummary.downProb,
    activeSummary.expectedMovePct,
    activeSummary.upProb,
    selectedMarket,
    selectedSeriesData.series,
    selectedSeriesData.source
  ]);

  if (!selectedMarket) {
    return (
      <section className="page-grid">
        <GlowCard className="detail-card">
          <h1>Probability Density Lab</h1>
          <p>Waiting for market data to initialize probability space.</p>
        </GlowCard>
      </section>
    );
  }

  return (
    <section className="page-grid">
      <GlowCard className="detail-card">
        <div className="section-head">
          <h1>Probability Density Lab</h1>
          <div className="section-actions">
            <Link to="/strategy" className="inline-link">
              Strategy Lab
            </Link>
            <Link to="/markets" className="inline-link">
              Markets
            </Link>
          </div>
        </div>
        <p>
          Heatmap of return buckets by future delta, with paintable probability overlays. Use this to shape expected outcomes and translate them into
          local strategy actions.
        </p>
      </GlowCard>

      <div className="probability-top-grid">
        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>PDF Controls</h2>
            <span>
              {selectedMarket.symbol} ({selectedMarket.assetClass})
            </span>
          </div>

          <div className="probability-controls-grid">
            <label className="control-field">
              <span>Market</span>
              <select value={selectedMarket.key} onChange={(event) => setMarketKey(event.target.value)}>
                {markets.map((market) => (
                  <option key={market.key} value={market.key}>
                    {market.symbol} ({market.assetClass})
                  </option>
                ))}
              </select>
            </label>

            <label className="control-field">
              <span>Focus Horizon (delta)</span>
              <select value={activeHorizon} onChange={(event) => setActiveHorizon(Math.max(1, Number(event.target.value) || activeHorizon))}>
                {horizons.map((horizon) => (
                  <option key={`horizon:${horizon}`} value={horizon}>
                    {horizon}
                  </option>
                ))}
              </select>
            </label>

            <label className="control-field">
              <span>Paint Influence</span>
              <input type="range" min={0} max={95} step={1} value={Math.round(paintStrength * 100)} onChange={(event) => setPaintStrength((Number(event.target.value) || 0) / 100)} />
            </label>

            <label className="control-field">
              <span>Brush Step</span>
              <input type="range" min={2} max={40} step={1} value={Math.round(brushStep * 100)} onChange={(event) => setBrushStep((Number(event.target.value) || 0) / 100)} />
            </label>

            <label className="control-field">
              <span>Indicator Blend</span>
              <input
                type="range"
                min={0}
                max={95}
                step={1}
                value={Math.round(indicatorBlend * 100)}
                onChange={(event) => setIndicatorBlend((Number(event.target.value) || 0) / 100)}
              />
            </label>

            <label className="control-field">
              <span>BBand Weight</span>
              <input type="range" min={0} max={200} step={1} value={Math.round((layerWeights.bband || 0) * 100)} onChange={(event) => updateLayerWeight('bband', event.target.value)} />
            </label>

            <label className="control-field">
              <span>EMA Weight</span>
              <input type="range" min={0} max={200} step={1} value={Math.round((layerWeights.ema || 0) * 100)} onChange={(event) => updateLayerWeight('ema', event.target.value)} />
            </label>

            <label className="control-field">
              <span>RSI Weight</span>
              <input type="range" min={0} max={200} step={1} value={Math.round((layerWeights.rsi || 0) * 100)} onChange={(event) => updateLayerWeight('rsi', event.target.value)} />
            </label>

            <label className="control-field">
              <span>MACD Weight</span>
              <input type="range" min={0} max={200} step={1} value={Math.round((layerWeights.macd || 0) * 100)} onChange={(event) => updateLayerWeight('macd', event.target.value)} />
            </label>
          </div>

          <div className="hero-actions">
            <button type="button" className="btn secondary" onClick={() => applyTemplate(1)}>
              Paint Bull Bias
            </button>
            <button type="button" className="btn secondary" onClick={() => applyTemplate(-1)}>
              Paint Bear Bias
            </button>
            <button type="button" className="btn secondary" onClick={clearPaint}>
              Clear Paint
            </button>
          </div>

          <p className="socket-status-copy">
            data source {selectedSeriesData.source} | history points {fmtInt(selectedSeriesData.sampleCount)} | model samples for horizon {activeHorizon}:{' '}
            {fmtInt(probabilityBase.sampleCounts[activeHorizonIndex] || 0)}
          </p>
          <div className="ta-chip-row">
            <span className={indicatorModel.signals?.bbandBias >= 0 ? 'status-pill up' : 'status-pill down'}>
              BB {(indicatorModel.signals?.bbandBias || 0).toFixed(2)}
            </span>
            <span className={indicatorModel.signals?.emaBias >= 0 ? 'status-pill up' : 'status-pill down'}>
              EMA {(indicatorModel.signals?.emaBias || 0).toFixed(2)}
            </span>
            <span className={indicatorModel.signals?.rsiBias >= 0 ? 'status-pill up' : 'status-pill down'}>
              RSI {(indicatorModel.signals?.rsiBias || 0).toFixed(2)} ({fmtNum(indicatorModel.signals?.rsi || 50, 1)})
            </span>
            <span className={indicatorModel.signals?.macdBias >= 0 ? 'status-pill up' : 'status-pill down'}>
              MACD {(indicatorModel.signals?.macdBias || 0).toFixed(2)}
            </span>
          </div>
        </GlowCard>

        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Live PDF Decision</h2>
            <span className={`tensor-chip ${activeRecommendation.action}`}>{activeRecommendation.action}</span>
          </div>
          <div className="tensor-metrics">
            <article>
              <span>Up Probability</span>
              <strong>{fmtProb(activeSummary.upProb)}</strong>
            </article>
            <article>
              <span>Down Probability</span>
              <strong>{fmtProb(activeSummary.downProb)}</strong>
            </article>
            <article>
              <span>Expected Move</span>
              <strong className={toneClass(activeSummary.expectedMovePct)}>{fmtPct(activeSummary.expectedMovePct)}</strong>
            </article>
            <article>
              <span>Confidence</span>
              <strong>{fmtNum(activeSummary.confidencePct, 1)}%</strong>
            </article>
          </div>
          <p className="socket-status-copy">{activeRecommendation.reason}</p>

          <div className="section-head">
            <h2>Tensor Blend</h2>
            <span className={`tensor-chip ${tensorRecommendation.action}`}>{tensorRecommendation.action}</span>
          </div>
          <div className="tensor-metrics">
            <article>
              <span>Up (weighted)</span>
              <strong>{fmtProb(tensorSummary.upProb)}</strong>
            </article>
            <article>
              <span>Down (weighted)</span>
              <strong>{fmtProb(tensorSummary.downProb)}</strong>
            </article>
            <article>
              <span>Expected (weighted)</span>
              <strong className={toneClass(tensorSummary.expectedMovePct)}>{fmtPct(tensorSummary.expectedMovePct)}</strong>
            </article>
            <article>
              <span>Volatility</span>
              <strong>{fmtNum(tensorSummary.volatilityPct, 3)}%</strong>
            </article>
          </div>
        </GlowCard>
      </div>

      <GlowCard className="chart-card">
        <LineChart
          title={`Price Trace - ${selectedMarket.symbol}`}
          points={selectedSeriesData.series.map((point) => point.price)}
          stroke="#65f5ca"
          fillFrom="rgba(70, 223, 176, 0.35)"
          fillTo="rgba(70, 223, 176, 0.03)"
        />
      </GlowCard>

      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>Probability Heatmap</h2>
          <span>click to paint, shift-click to erase</span>
        </div>
        <div className="pdf-heatmap-scroll" onMouseLeave={() => setDragDirection(0)}>
          <table className="pdf-heatmap-table">
            <thead>
              <tr>
                <th>% bucket</th>
                {horizons.map((horizon) => (
                  <th key={`head:${horizon}`}>
                    {horizon}
                    <span>delta</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {heatmapRows.map((row) => (
                <tr key={`bucket:${row.bucketIndex}`}>
                  <th>{formatBucketLabel(row.center)}</th>
                  {row.cells.map((cell) => (
                    <td key={`cell:${cell.horizon}:${cell.bucketIndex}`}>
                      <button
                        type="button"
                        className="pdf-heat-cell"
                        style={buildCellStyle(cell, maxHeatmapProb)}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          const direction = event.shiftKey ? -1 : 1;
                          setDragDirection(direction);
                          applyPaintToCell(cell.horizonKey, cell.bucketIndex, direction);
                        }}
                        onMouseEnter={() => {
                          if (!dragDirection) return;
                          applyPaintToCell(cell.horizonKey, cell.bucketIndex, dragDirection);
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          applyPaintToCell(cell.horizonKey, cell.bucketIndex, -1);
                        }}
                        title={`h${cell.horizon} | bucket ${formatBucketLabel(cell.center)} | base ${(cell.baseValue * 100).toFixed(2)}% | blended ${(
                          cell.value * 100
                        ).toFixed(2)}%`}
                      >
                        {(cell.value * 100).toFixed(1)}
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlowCard>

      <div className="two-col">
        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>PDF Decision Feed</h2>
            <span>{decisionFeed.length} rows</span>
          </div>
          <FlashList
            items={decisionFeed}
            height={360}
            itemHeight={76}
            className="tick-flash-list"
            emptyCopy="No PDF decisions yet."
            keyExtractor={(item) => item.id}
            renderItem={(item) => (
              <article className="tensor-event-row">
                <strong className={item.action === 'accumulate' ? 'up' : item.action === 'reduce' ? 'down' : ''}>
                  {item.symbol} ({item.assetClass}) | h{item.horizon} | {item.action}
                </strong>
                <p>{item.reason}</p>
                <small>
                  up {fmtProb(item.upProb)} | down {fmtProb(item.downProb)} | expected {fmtPct(item.expectedMovePct)} | source {item.source} | {fmtTime(item.timestamp)}
                </small>
              </article>
            )}
          />
        </GlowCard>

        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Market Probability Ranking</h2>
            <span>{marketRankings.length} tracked</span>
          </div>
          <p className="socket-status-copy">
            highest probability-up market for horizon {activeHorizon}: {topRanking ? `${topRanking.symbol} (${fmtProb(topRanking.upProb)})` : '-'}
          </p>
          <FlashList
            items={marketRankings}
            height={360}
            itemHeight={82}
            className="tick-flash-list"
            emptyCopy="Waiting for market rankings..."
            keyExtractor={(row) => `pdf-rank:${row.key}`}
            renderItem={(row, index) => (
              <article className="pdf-ranking-row">
                <div className="pdf-ranking-head">
                  <strong>
                    {index + 1}.{' '}
                    <Link to={`/market/${encodeURIComponent(row.key)}`} className="inline-link">
                      {row.symbol}
                    </Link>
                  </strong>
                  <span className={`tensor-chip ${row.recommendation.action}`}>{row.recommendation.action}</span>
                </div>
                <div className="pdf-ranking-metrics">
                  <small>
                    up {fmtProb(row.upProb)} | down {fmtProb(row.downProb)} | expected {fmtPct(row.expectedMovePct)}
                  </small>
                  <small>
                    {row.assetClass} | source {row.source} | model samples {fmtInt(row.modelSamples)}
                  </small>
                </div>
                <div className="section-actions">
                  <button type="button" className="btn secondary" onClick={() => setMarketKey(row.key)}>
                    Watch
                  </button>
                </div>
              </article>
            )}
          />
        </GlowCard>
      </div>
    </section>
  );
}
