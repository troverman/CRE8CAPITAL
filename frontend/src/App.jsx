import { useEffect, useMemo, useState } from 'react';

const sections = [
  { id: 'automation', label: 'Automation Hub' },
  { id: 'ideas', label: 'Auto-Invest Ideas' },
  { id: 'guardrails', label: 'Risk Guardrails' },
  { id: 'tasks', label: 'Active Tasks' }
];

const seedIdeas = [
  {
    id: 'idea-1',
    asset: 'AI Infrastructure Basket',
    theme: 'Compute and data center exposure',
    confidence: 89,
    allocation: '14%',
    horizon: '6 months',
    status: 'ready'
  },
  {
    id: 'idea-2',
    asset: 'Treasury Yield Ladder',
    theme: 'Cash efficiency and downside insulation',
    confidence: 82,
    allocation: '18%',
    horizon: '12 months',
    status: 'review'
  },
  {
    id: 'idea-3',
    asset: 'Energy Transition Pair',
    theme: 'Hedge commodity spikes with growth upside',
    confidence: 77,
    allocation: '8%',
    horizon: '9 months',
    status: 'simulating'
  }
];

const seedWorkflows = [
  {
    id: 'wf-1',
    name: 'Weekly Idea Engine',
    trigger: 'Every Monday at 07:00',
    nextRun: 'Mon 07:00',
    owner: 'Agent Stack',
    mode: 'agentic',
    progress: 68
  },
  {
    id: 'wf-2',
    name: 'Capital Allocation Review',
    trigger: 'Drawdown > 3%',
    nextRun: 'Event driven',
    owner: 'CFO + Agent',
    mode: 'hybrid',
    progress: 43
  },
  {
    id: 'wf-3',
    name: 'Profit Lock Rotation',
    trigger: 'Take-profit threshold reached',
    nextRun: 'Live monitor',
    owner: 'Execution Agent',
    mode: 'agentic',
    progress: 91
  }
];

const seedTasks = [
  {
    id: 'task-1',
    title: 'Validate top 3 AI basket entries against liquidity floor',
    assignee: 'Capital Agent',
    due: 'Today 16:30',
    status: 'in-progress'
  },
  {
    id: 'task-2',
    title: 'Approve treasury ladder rebalance',
    assignee: 'Finance Lead',
    due: 'Today 18:00',
    status: 'awaiting-review'
  },
  {
    id: 'task-3',
    title: 'Publish strategy memo to investor room',
    assignee: 'Ops Team',
    due: 'Tomorrow 09:00',
    status: 'queued'
  }
];

const seedGuardrails = [
  { id: 'gr-1', label: 'Max Single-Asset Exposure', value: 17, limit: 20 },
  { id: 'gr-2', label: 'Cash Reserve Floor', value: 26, limit: 18 },
  { id: 'gr-3', label: 'Monthly Risk Budget', value: 62, limit: 75 }
];

const apiBase = import.meta.env.VITE_API_BASE || 'http://localhost:8787';

const toStateLabel = (value) =>
  value
    .split('-')
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(' ');

const confidenceClass = (confidence) => {
  if (confidence >= 85) return 'high';
  if (confidence >= 70) return 'medium';
  return 'low';
};

const percent = (value, limit) => {
  if (!limit || limit <= 0) return 0;
  return Math.min(100, Math.round((value / limit) * 100));
};

export default function App() {
  const [activeSection, setActiveSection] = useState('automation');
  const [mode, setMode] = useState('agentic');
  const [ideas, setIdeas] = useState(seedIdeas);
  const [workflows, setWorkflows] = useState(seedWorkflows);
  const [tasks, setTasks] = useState(seedTasks);
  const [guardrails, setGuardrails] = useState(seedGuardrails);
  const [connected, setConnected] = useState(false);
  const [syncMessage, setSyncMessage] = useState('Simulation mode: local idea engine');

  useEffect(() => {
    const controller = new AbortController();

    const fetchResource = async (path, setter) => {
      try {
        const response = await fetch(`${apiBase}${path}`, { signal: controller.signal });
        if (!response.ok) return false;
        const payload = await response.json();
        if (!Array.isArray(payload.items)) return false;
        setter(payload.items);
        return true;
      } catch {
        return false;
      }
    };

    const load = async () => {
      const [ideasOk, workflowsOk, tasksOk, guardrailsOk] = await Promise.all([
        fetchResource('/api/ideas', setIdeas),
        fetchResource('/api/workflows', setWorkflows),
        fetchResource('/api/tasks', setTasks),
        fetchResource('/api/guardrails', setGuardrails)
      ]);

      const hasApiData = ideasOk || workflowsOk || tasksOk || guardrailsOk;
      setConnected(hasApiData);
      if (hasApiData) {
        const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setSyncMessage(`API sync complete at ${stamp}`);
      }
    };

    load();
    return () => controller.abort();
  }, []);

  const activeLabel = useMemo(() => {
    const selected = sections.find((item) => item.id === activeSection);
    return selected ? selected.label : 'Automation Hub';
  }, [activeSection]);

  const queuedApprovals = ideas.filter((idea) => idea.status !== 'ready').length;
  const automatedFlows = workflows.filter((flow) => flow.mode === 'agentic').length;

  return (
    <main className="capital-app">
      <aside className="sidebar">
        <div className="brand-block">
          <p className="brand-url">capital.cre8.xyz</p>
          <h1>CRE8 Capital</h1>
          <p className="brand-copy">
            Capital automation for teams that want sharper bets and faster execution.
          </p>
        </div>

        <nav className="nav-stack">
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              className={section.id === activeSection ? 'nav-item active' : 'nav-item'}
              onClick={() => setActiveSection(section.id)}
            >
              {section.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-card">
          <p className="sidebar-label">Decision Mode</p>
          <div className="mode-switch">
            <button
              type="button"
              className={mode === 'human' ? 'mode-button active' : 'mode-button'}
              onClick={() => setMode('human')}
            >
              Human
            </button>
            <button
              type="button"
              className={mode === 'agentic' ? 'mode-button active' : 'mode-button'}
              onClick={() => setMode('agentic')}
            >
              Agentic
            </button>
          </div>
          <p className="sidebar-note">
            {mode === 'agentic'
              ? 'Agents can draft, score, and queue investment actions for approval.'
              : 'Human-led review mode with full manual approvals.'}
          </p>
        </div>

        <div className="sidebar-metrics">
          <div className="metric">
            <span>Automated Workflows</span>
            <strong>{automatedFlows}</strong>
          </div>
          <div className="metric">
            <span>Pending Approvals</span>
            <strong>{queuedApprovals}</strong>
          </div>
          <div className="metric">
            <span>Active Tasks</span>
            <strong>{tasks.length}</strong>
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <div>
            <span className={connected ? 'status-pill online' : 'status-pill'}>
              {connected ? 'API Connected' : 'Simulation Mode'}
            </span>
            <h2>{activeLabel}</h2>
            <p className="sync-copy">{syncMessage}</p>
          </div>
          <div className="header-actions">
            <button type="button" className="action-button neutral">
              Run Backtest
            </button>
            <button type="button" className="action-button">
              Launch Allocation Cycle
            </button>
          </div>
        </header>

        <div className="panel-grid">
          <article className="panel ideas">
            <div className="panel-head">
              <h3>Auto-Invest Ideas</h3>
              <span>{ideas.length} opportunities</span>
            </div>
            <div className="idea-list">
              {ideas.map((idea) => (
                <div key={idea.id} className="idea-card">
                  <div className="idea-header">
                    <h4>{idea.asset}</h4>
                    <span className={`confidence ${confidenceClass(idea.confidence)}`}>
                      {idea.confidence}% confidence
                    </span>
                  </div>
                  <p>{idea.theme}</p>
                  <div className="idea-meta">
                    <span>{idea.allocation} allocation</span>
                    <span>{idea.horizon}</span>
                    <span>{toStateLabel(idea.status)}</span>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="panel workflows">
            <div className="panel-head">
              <h3>Automation Flows</h3>
              <span>Human + agent collaboration</span>
            </div>
            <div className="workflow-list">
              {workflows.map((workflow) => (
                <div key={workflow.id} className="workflow-card">
                  <div className="workflow-top">
                    <h4>{workflow.name}</h4>
                    <span className="workflow-mode">{workflow.mode}</span>
                  </div>
                  <p className="workflow-copy">
                    Trigger: {workflow.trigger} | Next run: {workflow.nextRun}
                  </p>
                  <p className="workflow-owner">Owner: {workflow.owner}</p>
                  <div className="progress-track">
                    <span style={{ width: `${workflow.progress}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="panel tasks">
            <div className="panel-head">
              <h3>Active Tasks</h3>
              <span>Execution queue</span>
            </div>
            <div className="task-list">
              {tasks.map((task) => (
                <div key={task.id} className="task-row">
                  <div>
                    <h4>{task.title}</h4>
                    <p>{task.assignee}</p>
                  </div>
                  <div className="task-meta">
                    <span>{task.due}</span>
                    <span className="task-status">{toStateLabel(task.status)}</span>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="panel guardrails">
            <div className="panel-head">
              <h3>Portfolio Guardrails</h3>
              <span>Policy thresholds</span>
            </div>
            <div className="guardrail-list">
              {guardrails.map((guardrail) => (
                <div key={guardrail.id} className="guardrail">
                  <div className="guardrail-text">
                    <strong>{guardrail.label}</strong>
                    <span>
                      {guardrail.value}% / {guardrail.limit}%
                    </span>
                  </div>
                  <div className="guardrail-track">
                    <span style={{ width: `${percent(guardrail.value, guardrail.limit)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </article>
        </div>
      </section>
    </main>
  );
}
