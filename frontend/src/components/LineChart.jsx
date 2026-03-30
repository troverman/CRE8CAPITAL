import { useId, useMemo } from 'react';
import { fmtNum } from '../lib/format';

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const buildPathFromSeries = ({ series, width, height, min, max, pad }) => {
  const values = Array.isArray(series) ? series : [];
  if (!values.length) return '';
  const range = max - min || 1;
  const denominator = Math.max(values.length - 1, 1);
  let path = '';
  let active = false;

  for (let index = 0; index < values.length; index += 1) {
    const value = toNumber(values[index]);
    if (value === null) {
      active = false;
      continue;
    }
    const x = (index / denominator) * width;
    const y = height - pad - ((value - min) / range) * (height - pad * 2);
    path += `${active ? ' L' : 'M'} ${x} ${y}`;
    active = true;
  }

  return path.trim();
};

const buildAreaPathFromSeries = ({ series, width, height, min, max, pad }) => {
  const values = Array.isArray(series) ? series : [];
  if (!values.length) return '';
  const range = max - min || 1;
  const denominator = Math.max(values.length - 1, 1);
  let path = '';
  let segment = [];

  const flushSegment = () => {
    if (segment.length < 2) {
      segment = [];
      return;
    }
    const head = segment[0];
    const tail = segment[segment.length - 1];
    const line = segment.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
    path += `${line} L ${tail.x} ${height} L ${head.x} ${height} Z `;
    segment = [];
  };

  for (let index = 0; index < values.length; index += 1) {
    const value = toNumber(values[index]);
    if (value === null) {
      flushSegment();
      continue;
    }
    const x = (index / denominator) * width;
    const y = height - pad - ((value - min) / range) * (height - pad * 2);
    segment.push({ x, y });
  }

  flushSegment();
  return path.trim();
};

export default function LineChart({
  points = [],
  width = 920,
  height = 280,
  stroke = '#6fe7ff',
  fillFrom = 'rgba(75, 181, 255, 0.34)',
  fillTo = 'rgba(75, 181, 255, 0.02)',
  title = 'Chart',
  unit = '',
  overlays = []
}) {
  const gradientId = useId();
  const baseSeries = useMemo(() => (Array.isArray(points) ? points.map(toNumber) : []), [points]);
  const values = useMemo(() => baseSeries.filter((value) => value !== null), [baseSeries]);
  const overlaySeries = useMemo(() => {
    if (!Array.isArray(overlays)) return [];
    return overlays
      .map((overlay, index) => {
        const series = Array.isArray(overlay?.points) ? overlay.points.map(toNumber) : [];
        return {
          key: overlay?.key || overlay?.label || `overlay-${index}`,
          label: overlay?.label || `overlay ${index + 1}`,
          stroke: overlay?.stroke || '#8db3ff',
          strokeWidth: Number(overlay?.strokeWidth) > 0 ? Number(overlay.strokeWidth) : 1.5,
          dasharray: overlay?.dasharray || '',
          series
        };
      })
      .filter((overlay) => overlay.series.some((value) => value !== null));
  }, [overlays]);
  const overlayValues = useMemo(() => {
    return overlaySeries.flatMap((overlay) => overlay.series).filter((value) => value !== null);
  }, [overlaySeries]);

  if (values.length < 2) {
    return <div className="chart-empty">Waiting for live data...</div>;
  }

  const domainValues = overlayValues.length ? [...values, ...overlayValues] : values;
  const min = Math.min(...domainValues);
  const max = Math.max(...domainValues);
  const pad = 12;
  const linePath = buildPathFromSeries({
    series: baseSeries,
    width,
    height,
    min,
    max,
    pad
  });
  const areaPath = buildAreaPathFromSeries({
    series: baseSeries,
    width,
    height,
    min,
    max,
    pad
  });
  const latest = values[values.length - 1];
  const delta = latest - values[Math.max(values.length - 2, 0)];

  return (
    <div className="chart-wrap">
      <div className="chart-head">
        <strong>{title}</strong>
        <span className={delta >= 0 ? 'up' : 'down'}>
          {delta >= 0 ? '+' : ''}
          {fmtNum(delta, 4)}
          {unit}
        </span>
      </div>

      <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="line-chart-svg" role="img" aria-label={title}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={fillFrom} />
            <stop offset="100%" stopColor={fillTo} />
          </linearGradient>
        </defs>

        <path d={areaPath} fill={`url(#${gradientId})`} />
        <path d={linePath} fill="none" stroke={stroke} strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
        {overlaySeries.map((overlay) => {
          const path = buildPathFromSeries({
            series: overlay.series,
            width,
            height,
            min,
            max,
            pad
          });
          if (!path) return null;
          return (
            <path
              key={overlay.key}
              d={path}
              fill="none"
              stroke={overlay.stroke}
              strokeWidth={overlay.strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={overlay.dasharray}
            />
          );
        })}
      </svg>

      {overlaySeries.length ? (
        <div className="chart-legend">
          <span className="chart-legend-item">
            <span className="chart-legend-swatch" style={{ background: stroke }} />
            <small>price</small>
          </span>
          {overlaySeries.map((overlay) => (
            <span key={`legend:${overlay.key}`} className="chart-legend-item">
              <span className="chart-legend-swatch" style={{ background: overlay.stroke }} />
              <small>{overlay.label}</small>
            </span>
          ))}
        </div>
      ) : null}

      <div className="chart-foot">
        <span>
          min {fmtNum(min, 4)}
          {unit}
        </span>
        <span>
          max {fmtNum(max, 4)}
          {unit}
        </span>
        <span>
          latest {fmtNum(latest, 4)}
          {unit}
        </span>
      </div>
    </div>
  );
}
