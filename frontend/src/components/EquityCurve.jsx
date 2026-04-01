import GlowCard from './GlowCard';
import LineChart from './LineChart';

/**
 * Equity over time chart section.
 * Wraps LineChart in a GlowCard with configurable title, colors, and markers.
 */
export default function EquityCurve({
  title = 'Equity Curve',
  points = [],
  stroke = '#62ffcc',
  fillFrom = 'rgba(98, 255, 204, 0.28)',
  fillTo = 'rgba(98, 255, 204, 0.02)',
  markers,
  overlays
}) {
  return (
    <GlowCard className="chart-card">
      <LineChart
        title={title}
        points={points}
        stroke={stroke}
        fillFrom={fillFrom}
        fillTo={fillTo}
        markers={markers}
        overlays={overlays}
      />
    </GlowCard>
  );
}
