export default function Sparkline({ data = [], width = 120, height = 34, color = '#7bd9ff' }) {
  if (!Array.isArray(data) || data.length < 2) {
    return <div style={{ width, height }} />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 2;

  const points = data
    .map((value, idx) => {
      const x = (idx / (data.length - 1)) * width;
      const y = height - pad - ((value - min) / range) * (height - pad * 2);
      return `${x},${y}`;
    })
    .join(' ');

  const last = Number(data[data.length - 1]);
  const lastY = height - pad - ((last - min) / range) * (height - pad * 2);

  return (
    <svg width={width} height={height} className="sparkline-svg" aria-hidden>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={width} cy={lastY} r="2.4" fill={color} />
    </svg>
  );
}

