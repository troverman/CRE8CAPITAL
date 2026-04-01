// storeSync.js — sets up cross-store subscriptions
import { useEffect } from 'react';
import { useStrategyLabStore } from '../store/strategyLabStore';
import { useCapitalStore } from '../store/capitalStore';

export function useStoreSync() {
  useEffect(() => {
    let prevWalletAccounts = useStrategyLabStore.getState().walletAccounts;
    let prevActiveWalletAccountId = useStrategyLabStore.getState().activeWalletAccountId;

    const unsub = useStrategyLabStore.subscribe((state) => {
      const nextWalletAccounts = state.walletAccounts;
      const nextActiveWalletAccountId = state.activeWalletAccountId;

      if (
        nextWalletAccounts === prevWalletAccounts &&
        nextActiveWalletAccountId === prevActiveWalletAccountId
      ) {
        return;
      }

      prevWalletAccounts = nextWalletAccounts;
      prevActiveWalletAccountId = nextActiveWalletAccountId;

      if (nextWalletAccounts?.length > 0) {
        const capitalState = useCapitalStore.getState();
        if (capitalState.upsertWalletAccounts) {
          capitalState.upsertWalletAccounts({
            walletAccounts: nextWalletAccounts,
            activeWalletId: nextActiveWalletAccountId
          });
        }
      }
    });

    // Perform initial sync
    const initialState = useStrategyLabStore.getState();
    if (initialState.walletAccounts?.length > 0) {
      useCapitalStore.getState().upsertWalletAccounts({
        walletAccounts: initialState.walletAccounts,
        activeWalletId: initialState.activeWalletAccountId
      });
    }

    return unsub;
  }, []);
}
