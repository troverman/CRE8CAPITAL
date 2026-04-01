import { create } from 'zustand';
import { STRATEGY_OPTIONS } from '../lib/strategyEngine';
import { toStrategyKey } from '../lib/strategyView';
import { useStrategyLabStore } from './strategyLabStore';

const STORAGE_KEY = 'cre8capital.strategy-toggle.v2';
const STORAGE_VERSION = 2;
const RUNTIME_STRATEGY_IDS = STRATEGY_OPTIONS.map((strategy) => String(strategy?.id || '')).filter((id) => Boolean(id));
const RUNTIME_STRATEGY_KEYS = RUNTIME_STRATEGY_IDS.map((id) => toStrategyKey(id));
const STRATEGY_ID_BY_KEY = new Map(RUNTIME_STRATEGY_IDS.map((id) => [toStrategyKey(id), id]));

const readStoredMap = () => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    // Version check: discard stale data when strategy list changes
    if (parsed._version !== STORAGE_VERSION) {
      window.localStorage.removeItem(STORAGE_KEY);
      return {};
    }
    const source = parsed.map && typeof parsed.map === 'object' ? parsed.map : parsed;
    const next = {};
    for (const [key, value] of Object.entries(source)) {
      if (key.startsWith('_')) continue;
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
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      _version: STORAGE_VERSION,
      map,
      _updatedAt: Date.now()
    }));
  } catch (error) {
    // noop
  }
};

const resolveDefaultEnabled = (row) => {
  if (row?.enabled === null || typeof row?.enabled === 'undefined') return true;
  return Boolean(row.enabled);
};

const normalizeRuntimeEnabledIds = (strategyIds = []) => {
  const ids = [];
  for (const rawId of Array.isArray(strategyIds) ? strategyIds : []) {
    const id = String(rawId || '');
    if (!id || !RUNTIME_STRATEGY_IDS.includes(id) || ids.includes(id)) continue;
    ids.push(id);
  }
  return ids;
};

const mergeMapWithRuntimeIds = (map, runtimeEnabledIds = []) => {
  const enabledKeySet = new Set(runtimeEnabledIds.map((id) => toStrategyKey(id)));
  const next = { ...(map || {}) };
  for (const key of RUNTIME_STRATEGY_KEYS) {
    next[key] = enabledKeySet.has(key);
  }
  return next;
};

const buildRuntimeIdsFromMap = (map) => {
  return RUNTIME_STRATEGY_IDS.filter((id) => {
    const key = toStrategyKey(id);
    if (typeof map?.[key] === 'boolean') return map[key];
    return true;
  });
};

const syncRuntimeStoreWithMap = (map) => {
  const runtimeIds = buildRuntimeIdsFromMap(map);
  const runtimeStore = useStrategyLabStore.getState();
  if (runtimeStore && typeof runtimeStore.setEnabledStrategies === 'function') {
    runtimeStore.setEnabledStrategies(runtimeIds);
    return normalizeRuntimeEnabledIds(useStrategyLabStore.getState().enabledStrategyIds);
  }
  return runtimeIds;
};

const mapsEqual = (a = {}, b = {}) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
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
      const syncedRuntimeIds = syncRuntimeStoreWithMap(next);
      const normalized = mergeMapWithRuntimeIds(next, syncedRuntimeIds);
      writeStoredMap(normalized);
      return {
        ...state,
        enabledByKey: normalized
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
      const runtimeStrategyId = STRATEGY_ID_BY_KEY.get(key);
      const syncedRuntimeIds = runtimeStrategyId ? syncRuntimeStoreWithMap(next) : normalizeRuntimeEnabledIds(useStrategyLabStore.getState().enabledStrategyIds);
      const normalized = mergeMapWithRuntimeIds(next, syncedRuntimeIds);
      writeStoredMap(normalized);
      return {
        ...state,
        enabledByKey: normalized
      };
    }),
  syncRuntimeFromToggleMap: () =>
    set((state) => {
      const syncedRuntimeIds = syncRuntimeStoreWithMap(state.enabledByKey);
      const normalized = mergeMapWithRuntimeIds(state.enabledByKey, syncedRuntimeIds);
      if (mapsEqual(normalized, state.enabledByKey)) return state;
      writeStoredMap(normalized);
      return {
        ...state,
        enabledByKey: normalized
      };
    }),
  syncFromRuntimeEnabledIds: (strategyIds = []) =>
    set((state) => {
      const runtimeEnabledIds = normalizeRuntimeEnabledIds(strategyIds);
      const normalized = mergeMapWithRuntimeIds(state.enabledByKey, runtimeEnabledIds);
      if (mapsEqual(normalized, state.enabledByKey)) return state;
      writeStoredMap(normalized);
      return {
        ...state,
        enabledByKey: normalized
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
