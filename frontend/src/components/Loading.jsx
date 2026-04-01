export default function Loading({ message = 'Loading...' }) {
  return (
    <div className="loading-state">
      <span className="loading-spinner" />
      <p>{message}</p>
    </div>
  );
}
