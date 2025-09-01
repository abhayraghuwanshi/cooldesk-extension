import React from 'react';

const AccountTab = ({ 
  currentUser, 
  authLoading, 
  handleGoogleSignIn, 
  handleSignOut 
}) => {
  return (
    <div style={{ padding: '16px 0' }}>
      <h4 style={{
        margin: '0 0 12px 0',
        color: '#e5e7eb',
        fontSize: '16px',
        fontWeight: '500'
      }}>
        User Authentication
      </h4>

      {currentUser ? (
        <div>
          <div style={{
            background: 'rgba(16, 185, 129, 0.1)',
            border: '1px solid rgba(16, 185, 129, 0.2)',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '20px',
            backdropFilter: 'blur(10px)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <div style={{
                width: '8px',
                height: '8px',
                background: '#10b981',
                borderRadius: '50%'
              }}></div>
              <strong style={{ color: '#10b981', fontSize: '14px' }}>Signed In</strong>
            </div>
            <div style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '4px' }}>
              <strong>Email:</strong> {currentUser.email || 'Anonymous User'}
            </div>
            <div style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '4px' }}>
              <strong>User ID:</strong> {currentUser.uid?.substring(0, 8)}...
            </div>
            <div style={{ fontSize: '13px', color: '#9ca3af' }}>
              <strong>Type:</strong> {currentUser.isAnonymous ? 'Anonymous' : 'Email/Password'}
            </div>
          </div>

          <button
            className="add-link-btn"
            onClick={handleSignOut}
            disabled={authLoading}
            style={{
              background: '#dc2626',
              border: 'none',
              borderRadius: '12px',
              padding: '12px 20px',
              color: 'white',
              fontSize: '14px',
              fontWeight: '600',
              cursor: authLoading ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease',
              opacity: authLoading ? 0.6 : 1,
              boxShadow: '0 2px 8px rgba(220, 38, 38, 0.3)'
            }}
            onMouseEnter={(e) => {
              if (!authLoading) {
                e.target.style.transform = 'translateY(-1px)';
                e.target.style.boxShadow = '0 4px 12px rgba(220, 38, 38, 0.4)';
              }
            }}
            onMouseLeave={(e) => {
              if (!authLoading) {
                e.target.style.transform = 'translateY(0)';
                e.target.style.boxShadow = '0 2px 8px rgba(220, 38, 38, 0.3)';
              }
            }}
          >
            {authLoading ? 'Signing Out...' : 'Sign Out'}
          </button>
        </div>
      ) : (
        <div>
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <p style={{
              margin: '0 0 24px 0',
              color: '#9ca3af',
              fontSize: '14px',
              lineHeight: '1.5'
            }}>
              Sign in with your Google account to sync workspaces across all your devices.
            </p>

            <button
              className="add-link-btn"
              onClick={handleGoogleSignIn}
              disabled={authLoading}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '12px',
                margin: '0 auto',
                padding: '14px 28px',
                background: '#4285f4',
                border: 'none',
                borderRadius: '12px',
                fontSize: '14px',
                fontWeight: '600',
                color: 'white',
                opacity: authLoading ? 0.6 : 1,
                cursor: authLoading ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: '0 2px 8px rgba(66, 133, 244, 0.3)'
              }}
              onMouseEnter={(e) => {
                if (!authLoading) {
                  e.target.style.transform = 'translateY(-1px)';
                  e.target.style.boxShadow = '0 4px 12px rgba(66, 133, 244, 0.4)';
                }
              }}
              onMouseLeave={(e) => {
                if (!authLoading) {
                  e.target.style.transform = 'translateY(0)';
                  e.target.style.boxShadow = '0 2px 8px rgba(66, 133, 244, 0.3)';
                }
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="white" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="white" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="white" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="white" />
              </svg>
              {authLoading ? 'Signing In...' : 'Sign in with Google'}
            </button>
          </div>

          <div style={{
            padding: '16px',
            background: 'rgba(66, 133, 244, 0.1)',
            border: '1px solid rgba(66, 133, 244, 0.2)',
            borderRadius: '12px',
            fontSize: '13px',
            color: '#9ca3af',
            textAlign: 'center',
            backdropFilter: 'blur(10px)'
          }}>
            💡 <strong style={{ color: '#4285f4' }}>Note:</strong> Google sign-in allows you to sync workspaces across devices. Anonymous mode keeps data local to this browser.
          </div>
        </div>
      )}
    </div>
  );
};

export default AccountTab;