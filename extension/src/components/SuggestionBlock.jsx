import React from 'react';

export function SuggestionBlock({ loading, error, suggestions, onClear, onAddRelated }) {
  if (loading) {
    return <div className="loading-spinner"></div>
  }

  if (error) {
    return <div className="error-message">Error: {error}</div>
  }

  if (suggestions.length === 0) {
    return null
  }

  return (
    <div className="related-products">
      <div className="related-header">
        <h4>Related Products</h4>
        <button onClick={onClear} className="clear-btn">
          Clear
        </button>
      </div>
      <div className="related-grid">
        {suggestions.map((item, index) => (
          <div key={index} className="related-item" onClick={() => onAddRelated(item)}>
            <div className="related-favicon-container">
              <img src={item.favicon} alt="" className="related-favicon" />
            </div>
            <div className="related-info">
              <div className="related-title-container">
                <span className="related-title">{item.title}</span>
              </div>
              <div className="related-domain">{item.domain}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
