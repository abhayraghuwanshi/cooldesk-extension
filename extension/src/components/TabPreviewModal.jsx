import React from 'react';

export default function TabPreviewModal({ open, onClose, data, loading, error, onOpenFull }) {
  React.useEffect(() => {
    if (open) {
      document.body.classList.add('modal-open');
      return () => document.body.classList.remove('modal-open');
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} style={backdropStyle}>
      <div className="modal" style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header" style={headerStyle}>
          <h3 style={{ margin: 0, fontSize: 16 }}>{data?.title || 'Preview'}</h3>
        </div>
        <div className="modal-body" style={bodyStyle}>
          {loading && <div>Loading preview…</div>}
          {!loading && error && (
            <div className="error" style={{ color: '#ef4444' }}>{String(error)}</div>
          )}
          {!loading && !error && (
            <div style={{ display: 'flex', gap: 12 }}>
              {data?.image && (
                <img src={data.image} alt="" style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 8 }} />
              )}
              <div>
                {data?.source && (
                  <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>{data.source}</div>
                )}
                {data?.description && (
                  <p style={{ marginTop: 0, whiteSpace: 'pre-wrap' }}>{data.description}</p>
                )}
                {!data?.description && data?.extract && (
                  <p style={{ marginTop: 0, whiteSpace: 'pre-wrap' }}>{data.extract}</p>
                )}
                {data?.url && (
                  <a href={data.url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                    {data.url}
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer" style={footerStyle}>
          <button onClick={onOpenFull} style={primaryBtn}>Open full article</button>
          <button onClick={onClose} style={secondaryBtn}>Close</button>
        </div>
      </div>
    </div>
  );
}

const backdropStyle = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
};
const modalStyle = {
  width: 'min(640px, 95vw)', background: '#0f1724', color: '#e5e7eb',
  borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column',
  maxHeight: '80vh', border: '1px solid #273043'
};
const headerStyle = { padding: '12px 16px', borderBottom: '1px solid #273043' };
const bodyStyle = { padding: '12px 16px', overflow: 'auto', maxHeight: '60vh' };
const footerStyle = { padding: '12px 16px', borderTop: '1px solid #273043', display: 'flex', gap: 8, justifyContent: 'flex-end' };
const primaryBtn = { padding: '6px 10px', borderRadius: 8, border: '1px solid #273043', background: '#1b2331', color: '#e5e7eb', fontSize: 12 };
const secondaryBtn = { padding: '6px 10px', borderRadius: 8, border: '1px solid #273043', background: 'transparent', color: '#e5e7eb', fontSize: 12 };
