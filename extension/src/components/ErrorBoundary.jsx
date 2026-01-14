import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Log the error to console for debugging
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    
    // Update state with error details
    this.setState({
      error,
      errorInfo
    });
  }

  render() {
    if (this.state.hasError) {
      // Fallback UI when there's an error
      return (
        <div style={{
          padding: '16px',
          margin: '8px 0',
          border: '1px solid #ff6b6b',
          borderRadius: '8px',
          backgroundColor: '#ffe0e0',
          color: '#d63031'
        }}>
          <h3 style={{ margin: '0 0 8px 0', fontSize: 'var(--font-size-base)', fontWeight: 'bold' }}>
            Something went wrong
          </h3>
          <p style={{ margin: '0 0 8px 0', fontSize: 'var(--font-size-sm)' }}>
            This section encountered an error and couldn't load properly.
          </p>
          {this.state.error && (
            <details style={{ fontSize: 'var(--font-size-xs)', marginTop: '8px' }}>
              <summary style={{ cursor: 'pointer', marginBottom: '4px' }}>
                Error Details
              </summary>
              <pre style={{
                backgroundColor: '#f8f8f8',
                padding: '8px',
                borderRadius: '4px',
                overflow: 'auto',
                fontSize: 'calc(var(--font-size-xs) * 0.85)',
                margin: '4px 0'
              }}>
                {this.state.error.toString()}
                {this.state.errorInfo && this.state.errorInfo.componentStack}
              </pre>
            </details>
          )}
          <button
            onClick={() => this.setState({ hasError: false, error: null, errorInfo: null })}
            style={{
              marginTop: '8px',
              padding: '4px 8px',
              fontSize: 'var(--font-size-xs)',
              backgroundColor: '#d63031',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
