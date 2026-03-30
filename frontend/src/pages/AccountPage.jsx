import { useEffect, useMemo, useState } from 'react';
import GlowCard from '../components/GlowCard';
import { fmtCompact, fmtNum, fmtTime } from '../lib/format';

const STORAGE_KEY = 'cre8capital.account-passport.v1';

const PROVIDER_OPTIONS = [
  { id: 'binance', label: 'Binance', assetClass: 'crypto' },
  { id: 'coinbase-advanced', label: 'Coinbase Advanced', assetClass: 'crypto' },
  { id: 'kraken', label: 'Kraken', assetClass: 'crypto' },
  { id: 'alpaca', label: 'Alpaca', assetClass: 'equity' },
  { id: 'ibkr', label: 'Interactive Brokers', assetClass: 'multi-asset' },
  { id: 'oanda', label: 'OANDA', assetClass: 'fx' }
];

const createDefaultPassport = () => ({
  profileName: 'CRE8 Operator',
  executionMode: 'paper',
  externalActionsEnabled: false,
  maxOrderNotional: 2500,
  providers: []
});

const maskValue = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.length <= 6) return `${raw.slice(0, 1)}***${raw.slice(-1)}`;
  return `${raw.slice(0, 4)}...${raw.slice(-4)}`;
};

const createEmptyForm = () => ({
  provider: PROVIDER_OPTIONS[0].id,
  accountLabel: '',
  apiKey: '',
  apiSecret: '',
  passphrase: '',
  read: true,
  trade: true,
  withdraw: false,
  testnet: true
});

export default function AccountPage() {
  const [passport, setPassport] = useState(createDefaultPassport);
  const [linkForm, setLinkForm] = useState(createEmptyForm);
  const [message, setMessage] = useState('');

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      setPassport({
        ...createDefaultPassport(),
        ...parsed,
        providers: Array.isArray(parsed?.providers) ? parsed.providers : []
      });
    } catch (error) {
      setMessage('Passport storage could not be read. Using defaults.');
    }
  }, []);

  const persistPassport = (nextPassport) => {
    setPassport(nextPassport);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextPassport));
    } catch (error) {
      setMessage('Passport storage write failed.');
    }
  };

  const linkedCount = passport.providers.length;
  const validatedCount = passport.providers.filter((row) => row.status === 'validated').length;
  const liveReadyCount = passport.providers.filter((row) => row.status === 'validated' && !row.testnet && row.permissions.trade).length;

  const passportRiskExposure = useMemo(() => {
    const perProvider = Math.max(0, Number(passport.maxOrderNotional) || 0);
    return perProvider * linkedCount;
  }, [linkedCount, passport.maxOrderNotional]);

  const onLinkProvider = (event) => {
    event.preventDefault();
    setMessage('');
    if (!linkForm.apiKey.trim() || !linkForm.apiSecret.trim()) {
      setMessage('API key and API secret are required to create a provider link.');
      return;
    }

    const providerInfo = PROVIDER_OPTIONS.find((row) => row.id === linkForm.provider) || PROVIDER_OPTIONS[0];
    const now = Date.now();
    const providerRow = {
      id: `${linkForm.provider}:${now}`,
      provider: linkForm.provider,
      providerName: providerInfo.label,
      assetClass: providerInfo.assetClass,
      accountLabel: linkForm.accountLabel.trim() || `${providerInfo.label} account`,
      apiKeyMask: maskValue(linkForm.apiKey),
      apiSecretMask: maskValue(linkForm.apiSecret),
      passphraseMask: maskValue(linkForm.passphrase),
      permissions: {
        read: Boolean(linkForm.read),
        trade: Boolean(linkForm.trade),
        withdraw: Boolean(linkForm.withdraw)
      },
      testnet: Boolean(linkForm.testnet),
      status: 'linked',
      linkedAt: now,
      lastValidatedAt: null
    };

    const nextPassport = {
      ...passport,
      providers: [providerRow, ...passport.providers]
    };
    persistPassport(nextPassport);
    setLinkForm(createEmptyForm());
    setMessage(`Linked ${providerInfo.label}. Secret material was masked and not persisted in plaintext.`);
  };

  const onValidateProvider = (providerId) => {
    const nextPassport = {
      ...passport,
      providers: passport.providers.map((row) => {
        if (row.id !== providerId) return row;
        return {
          ...row,
          status: 'validated',
          lastValidatedAt: Date.now()
        };
      })
    };
    persistPassport(nextPassport);
    setMessage('Provider marked validated (local simulation state).');
  };

  const onUnlinkProvider = (providerId) => {
    const nextPassport = {
      ...passport,
      providers: passport.providers.filter((row) => row.id !== providerId)
    };
    persistPassport(nextPassport);
    setMessage('Provider link removed from local passport.');
  };

  const onPassportField = (field, value) => {
    const nextPassport = {
      ...passport,
      [field]: value
    };
    persistPassport(nextPassport);
  };

  return (
    <section className="page-grid">
      <GlowCard className="detail-card">
        <div className="section-head">
          <h1>Account Settings</h1>
          <span>{passport.executionMode} mode</span>
        </div>
        <p>Passport area for linking exchange/broker providers and API credentials for external actions. Secrets are masked on save and kept local-only in this frontend.</p>
      </GlowCard>

      <div className="detail-stat-grid">
        <GlowCard className="stat-card">
          <span>Linked Providers</span>
          <strong>{fmtNum(linkedCount, 0)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Validated</span>
          <strong>{fmtNum(validatedCount, 0)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Live Ready</span>
          <strong>{fmtNum(liveReadyCount, 0)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Max Exposure</span>
          <strong>{fmtCompact(passportRiskExposure)}</strong>
        </GlowCard>
      </div>

      <div className="account-grid">
        <GlowCard className="panel-card passport-card">
          <div className="section-head">
            <h2>Passport</h2>
            <span>{passport.externalActionsEnabled ? 'external actions enabled' : 'external actions disabled'}</span>
          </div>

          <div className="passport-config-grid">
            <label className="control-field">
              <span>Profile Name</span>
              <input value={passport.profileName} onChange={(event) => onPassportField('profileName', event.target.value)} placeholder="CRE8 Operator" />
            </label>

            <label className="control-field">
              <span>Execution Mode</span>
              <select value={passport.executionMode} onChange={(event) => onPassportField('executionMode', event.target.value)}>
                <option value="paper">paper</option>
                <option value="guarded-live">guarded-live</option>
                <option value="live">live</option>
              </select>
            </label>

            <label className="control-field">
              <span>Max Order Notional</span>
              <input
                type="number"
                min={0}
                step={50}
                value={passport.maxOrderNotional}
                onChange={(event) => onPassportField('maxOrderNotional', Math.max(0, Number(event.target.value) || 0))}
              />
            </label>

            <label className="toggle-label passport-toggle">
              <input
                type="checkbox"
                checked={Boolean(passport.externalActionsEnabled)}
                onChange={(event) => onPassportField('externalActionsEnabled', event.target.checked)}
              />
              <span>Allow external actions</span>
            </label>
          </div>

          <small className="socket-status-copy">Guardrail note: keep execution mode on `paper` unless provider validations and worker guards are fully in place.</small>
        </GlowCard>

        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Link Provider</h2>
            <span>local passport link</span>
          </div>

          <form className="passport-form" onSubmit={onLinkProvider}>
            <div className="passport-form-grid">
              <label className="control-field">
                <span>Provider</span>
                <select value={linkForm.provider} onChange={(event) => setLinkForm((previous) => ({ ...previous, provider: event.target.value }))}>
                  {PROVIDER_OPTIONS.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="control-field">
                <span>Account Label</span>
                <input
                  value={linkForm.accountLabel}
                  onChange={(event) => setLinkForm((previous) => ({ ...previous, accountLabel: event.target.value }))}
                  placeholder="Primary account"
                />
              </label>

              <label className="control-field">
                <span>API Key</span>
                <input
                  value={linkForm.apiKey}
                  onChange={(event) => setLinkForm((previous) => ({ ...previous, apiKey: event.target.value }))}
                  placeholder="key"
                  autoComplete="off"
                />
              </label>

              <label className="control-field">
                <span>API Secret</span>
                <input
                  value={linkForm.apiSecret}
                  onChange={(event) => setLinkForm((previous) => ({ ...previous, apiSecret: event.target.value }))}
                  placeholder="secret"
                  autoComplete="off"
                />
              </label>

              <label className="control-field">
                <span>Passphrase (optional)</span>
                <input
                  value={linkForm.passphrase}
                  onChange={(event) => setLinkForm((previous) => ({ ...previous, passphrase: event.target.value }))}
                  placeholder="passphrase"
                  autoComplete="off"
                />
              </label>
            </div>

            <div className="passport-permissions">
              <label className="toggle-label">
                <input checked={linkForm.read} onChange={(event) => setLinkForm((previous) => ({ ...previous, read: event.target.checked }))} type="checkbox" />
                <span>Read</span>
              </label>
              <label className="toggle-label">
                <input checked={linkForm.trade} onChange={(event) => setLinkForm((previous) => ({ ...previous, trade: event.target.checked }))} type="checkbox" />
                <span>Trade</span>
              </label>
              <label className="toggle-label">
                <input
                  checked={linkForm.withdraw}
                  onChange={(event) => setLinkForm((previous) => ({ ...previous, withdraw: event.target.checked }))}
                  type="checkbox"
                />
                <span>Withdraw</span>
              </label>
              <label className="toggle-label">
                <input
                  checked={linkForm.testnet}
                  onChange={(event) => setLinkForm((previous) => ({ ...previous, testnet: event.target.checked }))}
                  type="checkbox"
                />
                <span>Testnet</span>
              </label>
            </div>

            <div className="hero-actions">
              <button type="submit" className="btn primary">
                Link Provider
              </button>
            </div>
          </form>
        </GlowCard>
      </div>

      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>Linked Providers</h2>
          <span>{passport.providers.length} total</span>
        </div>
        <div className="passport-provider-grid">
          {passport.providers.map((provider) => (
            <article key={provider.id} className="passport-provider-card">
              <div className="passport-provider-head">
                <strong>{provider.providerName}</strong>
                <span className={provider.status === 'validated' ? 'status-pill online' : 'status-pill'}>{provider.status}</span>
              </div>
              <p>
                {provider.accountLabel} | {provider.assetClass}
              </p>
              <small>
                key {provider.apiKeyMask || '-'} | secret {provider.apiSecretMask || '-'} | pass {provider.passphraseMask || '-'}
              </small>
              <small>
                read {provider.permissions.read ? 'yes' : 'no'} | trade {provider.permissions.trade ? 'yes' : 'no'} | withdraw{' '}
                {provider.permissions.withdraw ? 'yes' : 'no'} | {provider.testnet ? 'testnet' : 'live'}
              </small>
              <small>
                linked {fmtTime(provider.linkedAt)} | validated {fmtTime(provider.lastValidatedAt)}
              </small>
              <div className="section-actions">
                <button type="button" className="btn secondary" onClick={() => onValidateProvider(provider.id)}>
                  Validate
                </button>
                <button type="button" className="btn secondary" onClick={() => onUnlinkProvider(provider.id)}>
                  Unlink
                </button>
              </div>
            </article>
          ))}
          {passport.providers.length === 0 ? <p className="action-message">No linked providers yet.</p> : null}
        </div>
      </GlowCard>

      {message ? (
        <GlowCard className="panel-card">
          <p className="action-message">{message}</p>
        </GlowCard>
      ) : null}
    </section>
  );
}
