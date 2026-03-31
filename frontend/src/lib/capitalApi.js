const inferDefaultApiBase = () => {
  if (typeof window === 'undefined') {
    return 'http://localhost:8787';
  }

  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    return 'http://localhost:8787';
  }

  return window.location.origin;
};

const apiBase = import.meta.env.VITE_API_BASE || inferDefaultApiBase();

export const getApiBase = () => apiBase;

export const snapshotUrl = `${apiBase}/api/snapshot`;
export const streamUrl = `${apiBase}/api/stream`;
export const restrategyUrl = `${apiBase}/api/triggers/restrategy`;
export const backtestUrl = `${apiBase}/api/backtest`;

export const getWsUrl = () => {
  const base = apiBase.replace(/^http/, 'ws');
  return `${base}/ws`;
};

export const getSnapshotUrl = ({
  marketLimit = 180,
  signalLimit = 100,
  decisionLimit = 100,
  feedLimit = 120
} = {}) => {
  const query = new URLSearchParams({
    marketLimit: String(marketLimit),
    signalLimit: String(signalLimit),
    decisionLimit: String(decisionLimit),
    feedLimit: String(feedLimit)
  });
  return `${snapshotUrl}?${query.toString()}`;
};

export const getStreamUrl = ({
  marketLimit = 180,
  signalLimit = 100,
  decisionLimit = 100,
  feedLimit = 120
} = {}) => {
  const query = new URLSearchParams({
    marketLimit: String(marketLimit),
    signalLimit: String(signalLimit),
    decisionLimit: String(decisionLimit),
    feedLimit: String(feedLimit)
  });
  return `${streamUrl}?${query.toString()}`;
};

// --- Backend data endpoints ---

export const fetchTrades = (strategyId) =>
  fetch(`${apiBase}/api/trades${strategyId ? `?strategyId=${encodeURIComponent(strategyId)}` : ''}`).then((r) => r.json());

export const fetchPositions = () =>
  fetch(`${apiBase}/api/positions`).then((r) => r.json());

export const fetchWallet = () =>
  fetch(`${apiBase}/api/wallet`).then((r) => r.json());

export const fetchExecution = () =>
  fetch(`${apiBase}/api/execution`).then((r) => r.json());

export const fetchSignalHistory = () =>
  fetch(`${apiBase}/api/signals/history`).then((r) => r.json());

export const fetchDecisionHistory = () =>
  fetch(`${apiBase}/api/decisions/history`).then((r) => r.json());

export const runBacktest = (params) =>
  fetch(`${apiBase}/api/backtest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  }).then((r) => r.json());

export const fetchRisk = () =>
  fetch(`${apiBase}/api/risk`).then((r) => r.json());

export const updateRisk = (params) =>
  fetch(`${apiBase}/api/risk`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  }).then((r) => r.json());
