import BinanceBookTickerProvider from './BinanceBookTickerProvider';
import CoinbaseTickerProvider from './CoinbaseTickerProvider';

const providers = [new BinanceBookTickerProvider(), new CoinbaseTickerProvider()];

export const getSocketProviders = () => providers;

