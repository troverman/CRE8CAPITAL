const apiBase = import.meta.env.VITE_API_BASE || 'http://localhost:8787';

export const getApiBase = () => apiBase;

export const snapshotUrl = `${apiBase}/api/snapshot`;
export const streamUrl = `${apiBase}/api/stream`;
export const restrategyUrl = `${apiBase}/api/triggers/restrategy`;

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
