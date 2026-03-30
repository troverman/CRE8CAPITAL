const QUOTES = ['USDT', 'USDC', 'USD', 'BTC', 'ETH', 'EUR', 'GBP', 'JPY'];

const asUpper = (value) => String(value || '').toUpperCase();

export const normalizeSymbol = (symbol) => {
  return asUpper(symbol).replace(/[^A-Z0-9]/g, '');
};

const splitTokenSymbol = (symbol) => {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) return null;

  for (const quote of QUOTES) {
    if (normalized.endsWith(quote) && normalized.length > quote.length) {
      const base = normalized.slice(0, normalized.length - quote.length);
      if (base.length >= 2) {
        return { base, quote };
      }
    }
  }
  return null;
};

export const toBinanceSymbol = (symbol) => {
  const normalized = normalizeSymbol(symbol);
  return normalized || null;
};

export const toCoinbaseProduct = (symbol) => {
  const clean = asUpper(symbol);
  if (clean.includes('-')) return clean;
  if (clean.includes('/')) return clean.replace('/', '-');

  const pair = splitTokenSymbol(clean);
  if (!pair) return null;

  const quote = pair.quote === 'USDT' ? 'USD' : pair.quote;
  const allowed = new Set(['USD', 'USDC', 'BTC', 'EUR', 'GBP']);
  if (!allowed.has(quote)) return null;

  return `${pair.base}-${quote}`;
};

