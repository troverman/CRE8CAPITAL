import BinanceBookTickerProvider from './BinanceBookTickerProvider';
import CoinbaseTickerProvider from './CoinbaseTickerProvider';
import LocalSyntheticProvider from './LocalSyntheticProvider';

const externalProviders = [new BinanceBookTickerProvider(), new CoinbaseTickerProvider()];
const localProviders = [new LocalSyntheticProvider()];

export const getExternalSocketProviders = () => externalProviders;
export const getLocalFallbackProviders = () => localProviders;
export const getSocketProviders = () => [...externalProviders, ...localProviders];
