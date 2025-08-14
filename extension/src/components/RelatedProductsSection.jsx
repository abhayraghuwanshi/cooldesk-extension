import React from 'react';
import { getDomainFromUrl } from '../utils';

export function RelatedProductsSection({ relatedItems, onClear }) {
  if (!relatedItems || relatedItems.length === 0) return null

  return (
    <section className="related-products-section">
      <div className="section-header">
        <h3>Related & Similar Products</h3>
        <button className="clear-btn" onClick={onClear} title="Clear suggestions">
          ✕
        </button>
      </div>
      <div className="related-grid">
        {relatedItems.map((item, idx) => (
          <div key={idx} className="related-item" onClick={() => window.open(item.url, '_blank')}>
            <div className="related-info">
              <div className="related-title">{item.label || item.title || 'Related Item'}</div>
              <div className="related-description">{item.suggestion || item.description}</div>
              <div className="related-domain">{getDomainFromUrl(item.url)}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
