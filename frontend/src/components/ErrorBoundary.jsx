import React from 'react';

export default class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, color: '#ef4444', textAlign: 'center' }}>
          <h2>Something went wrong</h2>
          <p style={{ color: '#6b7280', fontSize: 13 }}>{this.state.error?.message}</p>
          <button
            onClick={() => this.setState({ hasError: false })}
            style={{
              marginTop: 16,
              padding: '8px 16px',
              background: '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer'
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
