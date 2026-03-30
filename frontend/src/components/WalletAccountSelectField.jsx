const toAccountRows = (accounts) => (Array.isArray(accounts) ? accounts : []);

export default function WalletAccountSelectField({
  label = 'Account',
  accounts = [],
  value = '',
  onChange,
  disabled = false,
  emptyLabel = 'No accounts',
  idPrefix = 'wallet-account'
}) {
  const rows = toAccountRows(accounts);
  const hasAccounts = rows.length > 0;

  return (
    <label className="control-field">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => {
          if (typeof onChange === 'function') onChange(event.target.value);
        }}
        disabled={disabled || !hasAccounts}
      >
        {!hasAccounts ? (
          <option value="">{emptyLabel}</option>
        ) : (
          rows.map((account) => (
            <option key={`${idPrefix}:${account.id}`} value={account.id}>
              {account.name}
            </option>
          ))
        )}
      </select>
    </label>
  );
}
