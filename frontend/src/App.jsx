const priorities = [
  'Capital planning that links strategy to daily execution',
  'A signal layer that exposes risks before they compound',
  'Operator-grade workflows for founders and finance teams'
];

const wins = [
  {
    title: 'Clarity',
    text: 'See runway, opportunities, and tradeoffs in one command center.'
  },
  {
    title: 'Velocity',
    text: 'Turn ideas into funded initiatives with lightweight workflows.'
  },
  {
    title: 'Confidence',
    text: 'Ship decisions with context, not guesswork.'
  }
];

export default function App() {
  return (
    <main className="shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <section className="hero">
        <p className="eyebrow">capital.cre8.xyz</p>
        <h1>Capital is a creative decision engine.</h1>
        <p className="subhead">
          CRE8 Capital is a focused operating layer for entrepreneurs building
          bold companies. Align people, priorities, and capital in one place.
        </p>
        <div className="hero-actions">
          <a className="button primary" href="#vision">
            Explore Vision
          </a>
          <a className="button secondary" href="mailto:founders@cre8.xyz">
            Join Early Access
          </a>
        </div>
      </section>

      <section className="grid" id="vision">
        <article className="card">
          <h2>What We Are Building</h2>
          <ul>
            {priorities.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article className="card">
          <h2>Core Experience</h2>
          <div className="wins">
            {wins.map((item) => (
              <div key={item.title} className="pill">
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </div>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}
