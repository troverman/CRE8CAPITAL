import { toStrategyKey } from './strategyView';

const toText = (value, fallback = '') => {
  const text = String(value || '').trim();
  return text || fallback;
};

const toNum = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const toIdentity = (symbol, assetClass) => `${String(symbol || '').toUpperCase()}|${String(assetClass || '').toLowerCase()}`;

const normalizeAction = (value) => {
  const action = String(value || '').trim().toLowerCase();
  if (action === 'buy' || action === 'accumulate' || action === 'long') return 'accumulate';
  if (action === 'sell' || action === 'reduce' || action === 'short') return 'reduce';
  if (action === 'hold') return 'hold';
  return action || 'hold';
};

const pickDirectAccountId = (decision = {}) => {
  const directCandidates = [
    decision?.accountId,
    decision?.walletAccountId,
    decision?.walletId,
    decision?.account?.id,
    decision?.wallet?.id,
    decision?.meta?.accountId
  ];

  for (const candidate of directCandidates) {
    const id = toText(candidate);
    if (id) return id;
  }
  return '';
};

const scoreEventMatch = (decision, event, timeWindowMs) => {
  const decisionIdentity = toIdentity(decision?.symbol, decision?.assetClass);
  const eventIdentity = toIdentity(event?.symbol, event?.assetClass);
  const sameIdentity = decisionIdentity === eventIdentity;
  const sameSymbol = String(decision?.symbol || '').toUpperCase() === String(event?.symbol || '').toUpperCase();
  const sameAssetClass = String(decision?.assetClass || '').toLowerCase() === String(event?.assetClass || '').toLowerCase();
  const sameStrategy = toStrategyKey(decision?.strategyName || decision?.strategy) === toStrategyKey(event?.strategyId);
  const sameAction = normalizeAction(decision?.action) === normalizeAction(event?.action);
  const decisionTs = toNum(decision?.timestamp, 0);
  const eventTs = toNum(event?.timestamp, 0);
  const deltaMs = decisionTs > 0 && eventTs > 0 ? Math.abs(decisionTs - eventTs) : Number.POSITIVE_INFINITY;
  const withinWindow = Number.isFinite(deltaMs) && deltaMs <= timeWindowMs;
  const somewhatNear = Number.isFinite(deltaMs) && deltaMs <= timeWindowMs * 2;

  let score = 0;
  if (sameIdentity) score += 5;
  else {
    if (sameSymbol) score += 2;
    if (sameAssetClass) score += 1;
  }
  if (sameStrategy) score += 3;
  if (sameAction) score += 2;
  if (withinWindow) score += 3 * (1 - deltaMs / Math.max(timeWindowMs, 1));
  else if (somewhatNear) score += 0.5;

  const strictMatch = sameIdentity && sameStrategy && (withinWindow || sameAction);
  return {
    score,
    deltaMs,
    strictMatch,
    sameIdentity
  };
};

const resolveWalletName = (walletById, accountId, fallback = '') => {
  const fromWallet = walletById.get(accountId);
  const name = toText(fromWallet?.name || fallback);
  return name || accountId;
};

const findDecisionWalletLink = ({ decision, walletById, txEvents, timeWindowMs }) => {
  const directAccountId = pickDirectAccountId(decision);
  if (directAccountId && walletById.has(directAccountId)) {
    return {
      accountId: directAccountId,
      accountName: resolveWalletName(walletById, directAccountId, decision?.accountName || decision?.walletName || ''),
      source: 'decision',
      matchScore: 999
    };
  }

  let best = null;
  for (const event of txEvents) {
    const accountId = toText(event?.accountId);
    if (!accountId || !walletById.has(accountId)) continue;

    const match = scoreEventMatch(decision, event, timeWindowMs);
    if (!best || match.score > best.match.score || (match.score === best.match.score && match.deltaMs < best.match.deltaMs)) {
      best = { event, match };
    }
  }

  if (!best) return null;
  const decisionHasTimestamp = toNum(decision?.timestamp, 0) > 0;
  const passScore = best.match.strictMatch || best.match.score >= 8.5;
  const passTime = !decisionHasTimestamp || best.match.deltaMs <= timeWindowMs * 2;
  if (!passScore || !passTime) return null;

  const accountId = toText(best.event?.accountId);
  return {
    accountId,
    accountName: resolveWalletName(walletById, accountId, best.event?.accountName || ''),
    source: 'tx-event',
    matchScore: best.match.score
  };
};

export const buildDecisionWalletLinkIndex = ({ decisions = [], walletAccounts = [], txEvents = [], timeWindowMs = 180000 }) => {
  const walletById = new Map();
  for (const account of Array.isArray(walletAccounts) ? walletAccounts : []) {
    const accountId = toText(account?.id);
    if (!accountId) continue;
    walletById.set(accountId, account);
  }

  const txRows = Array.isArray(txEvents) ? txEvents : [];
  const map = new Map();

  for (const decision of Array.isArray(decisions) ? decisions : []) {
    const decisionId = toText(decision?.id);
    if (!decisionId) continue;
    const walletLink = findDecisionWalletLink({
      decision,
      walletById,
      txEvents: txRows,
      timeWindowMs
    });
    if (walletLink) {
      map.set(decisionId, walletLink);
    }
  }

  return map;
};
