export default function GlowCard({ className = '', children }) {
  return <section className={`glow-card ${className}`.trim()}>{children}</section>;
}

