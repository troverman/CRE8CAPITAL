import GlowCard from './GlowCard';

/**
 * Reusable grid of metric cards.
 * @param {{ metrics: Array<{ label: string, value: string|number, color?: string, className?: string }> }} props
 */
export default function MetricsGrid({ metrics = [] }) {
  return (
    <div className="detail-stat-grid">
      {metrics.map((metric, index) => (
        <GlowCard key={`metric:${metric.label}:${index}`} className="stat-card">
          <span>{metric.label}</span>
          <strong className={metric.className || ''}>{metric.value}</strong>
        </GlowCard>
      ))}
    </div>
  );
}
