import { create } from 'zustand';
import { toStrategyKey } from '../lib/strategyView';

const STORAGE_KEY = 'cre8capital.strategy-toggle.v2';

const readStoredMap = () => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const next = {};
    for (const [key, value] of Object.entries(parsed)) {
      const normalized = toStrategyKey(key);
      if (!normalized) continue;
      next[normalized] = Boolean(value);
    }
    return next;
  } catch (error) {
    return {};
  }
};

const writeStoredMap = (map) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (error) {
    // noop
  }
};

const resolveDefaultEnabled = (row) => {
  if (row?.enabled === null || typeof row?.enabled === 'undefined') return true;
  return Boolean(row.enabled);
};

export const useStrategyToggleStore = create((set) => ({
  enabledByKey: readStoredMap(),
  ensureStrategies: (rows = []) =>
    set((state) => {
      const next = { ...state.enabledByKey };
      let changed = false;
      for (const row of rows) {
        const key = toStrategyKey(row?.key || row?.id || row?.name);
        if (!key) continue;
        if (typeof next[key] !== 'boolean') {
          next[key] = resolveDefaultEnabled(row);
          changed = true;
        }
      }
      if (!changed) return state;
      writeStoredMap(next);
      return {
        ...state,
        enabledByKey: next
      };
    }),
  setStrategyEnabled: (strategyKey, enabled) =>
    set((state) => {
      const key = toStrategyKey(strategyKey);
      if (!key) return state;
      const next = {
        ...state.enabledByKey,
        [key]: Boolean(enabled)
      };
      writeStoredMap(next);
      return {
        ...state,
        enabledByKey: next
      };
    }),
  clearStrategyToggles: () =>
    set((state) => {
      writeStoredMap({});
      return {
        ...state,
        enabledByKey: {}
      };
    })
}));
