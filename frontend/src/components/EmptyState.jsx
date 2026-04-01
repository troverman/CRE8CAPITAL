export default function EmptyState({ message = 'Nothing here yet.', action = null }) {
  return (
    <div className="empty-state">
      <p>{message}</p>
      {action}
    </div>
  );
}
