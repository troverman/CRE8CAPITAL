import { useId, useMemo } from 'react';
import { fmtNum } from '../lib/format';

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const buildChartPoints = ({ points, width, height, min, max, pad }) => {
  const range = max - min || 1;
  return points.map((point, idx) => {
    const x = (idx / Math.max(points.length - 1, 1)) * width;
    const y = height - pad - ((point - min) / range) * (height - pad * 2);
    return { x, y };
  });
};

export default function LineChart({
  points = [],
  width = 920,
  height = 280,
  stroke = '#6fe7ff',
  fillFrom = 'rgba(75, 181, 255, 0.34)',
  fillTo = 'rgba(75, 181, 255, 0.02)',
  title = 'Chart',
  unit = ''
}) {
  const gradientId = useId();
  const values = useMemo(() => points.map(toNumber).filter((value) => value !== null), [points]);

  if (values.length < 2) {
    return <div className="chart-empty">Waiting for live data...</div>;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = 12;
  const graphPoints = buildChartPoints({
    points: values,
    width,
    height,
    min,
    max,
    pad
  });

  const linePath = graphPoints.map((point, idx) => `${idx === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;
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
      </svg>

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

