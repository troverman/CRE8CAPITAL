export const PageHeader = ({ title, subtitle, actions }) => (
  <div className="page-header">
    <div>
      <h1>{title}</h1>
      {subtitle && <p className="page-subtitle">{subtitle}</p>}
    </div>
    {actions && <div className="page-actions">{actions}</div>}
  </div>
);

export const Section = ({ title, action, children }) => (
  <div className="page-section">
    <div className="section-head">
      <h2>{title}</h2>
      {action}
    </div>
    {children}
  </div>
);

export const TabBar = ({ tabs, active, onChange }) => (
  <div className="tab-bar">
    {tabs.map((t) => (
      <button
        key={t.id}
        className={`tab-item ${active === t.id ? 'active' : ''}`}
        onClick={() => onChange(t.id)}
      >
        {t.label}
      </button>
    ))}
  </div>
);
