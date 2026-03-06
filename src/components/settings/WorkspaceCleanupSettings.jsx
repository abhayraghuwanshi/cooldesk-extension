import { faCheck, faSpinner, faSync } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';
import { listWorkspaces } from '../../db/index.js';
import { storageGet } from '../../services/extensionApi.js';
import { QUALIFICATION_THRESHOLDS } from '../../utils/urlQualification.js';

/**
 * Settings component for workspace URL promotion status.
 * Replaced old runWorkspaceCleanup UI with new two-tier promotion system info.
 */
export function WorkspaceCleanupSettings() {
  const [isRunning, setIsRunning] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [workspaceStats, setWorkspaceStats] = useState({ total: 0, totalUrls: 0, draftUrls: 0 });
  const [showThresholds, setShowThresholds] = useState(false);

  useEffect(() => {
    loadSettings();
    loadWorkspaceStats();
  }, []);

  const loadSettings = async () => {
    try {
      const result = await storageGet(['lastPromotionResult']);
      if (result.lastPromotionResult) {
        setLastResult(result.lastPromotionResult);
      }
    } catch (e) {
      console.warn('[CleanupSettings] Failed to load settings:', e);
    }
  };

  const loadWorkspaceStats = async () => {
    try {
      const result = await listWorkspaces();
      const workspaces = result?.success ? result.data : (Array.isArray(result) ? result : []);
      let totalUrls = 0;
      let draftUrls = 0;
      workspaces.forEach(ws => {
        (ws.urls || []).forEach(u => {
          totalUrls++;
          if (u.status === 'draft') draftUrls++;
        });
      });
      setWorkspaceStats({ total: workspaces.length, totalUrls, draftUrls });
    } catch (e) {
      console.warn('[CleanupSettings] Failed to load workspace stats:', e);
    }
  };

  const handleRunPromotion = async () => {
    setIsRunning(true);
    setLastResult(null);
    try {
      // Trigger promotion via background message
      const result = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'runPromotion' }, (res) => {
          resolve(res || { error: 'No response from background' });
        });
      });
      setLastResult({ ...result, timestamp: Date.now() });
      await loadWorkspaceStats();
    } catch (e) {
      setLastResult({ error: e.message });
    } finally {
      setIsRunning(false);
    }
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return 'Never';
    return new Date(timestamp).toLocaleString();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div>
        <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 8px 0', color: '#fff' }}>
          URL Promotion
        </h3>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', margin: 0 }}>
          URLs are automatically promoted from <strong>Draft → Active</strong> based on engagement.
          The promotion job runs on startup and every 30 minutes.
        </p>
      </div>

      {/* Current Stats */}
      <div style={{
        display: 'flex',
        gap: 16,
        padding: 16,
        background: 'rgba(30, 41, 59, 0.5)',
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.1)'
      }}>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#60A5FA' }}>{workspaceStats.total}</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Workspaces</div>
        </div>
        <div style={{ width: 1, background: 'rgba(255,255,255,0.1)' }} />
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#34D399' }}>{workspaceStats.totalUrls}</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Active URLs</div>
        </div>
        <div style={{ width: 1, background: 'rgba(255,255,255,0.1)' }} />
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#FBBF24' }}>{workspaceStats.draftUrls}</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Upcoming</div>
        </div>
      </div>

      {/* Manual Promotion Button */}
      <button
        onClick={handleRunPromotion}
        disabled={isRunning}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          padding: '14px 20px',
          background: isRunning ? 'rgba(59, 130, 246, 0.3)' : 'linear-gradient(135deg, #3B82F6, #8B5CF6)',
          border: 'none',
          borderRadius: 10,
          color: '#fff',
          fontSize: 14,
          fontWeight: 600,
          cursor: isRunning ? 'wait' : 'pointer',
          transition: 'all 0.2s',
          opacity: isRunning ? 0.7 : 1
        }}
      >
        <FontAwesomeIcon icon={isRunning ? faSpinner : faSync} spin={isRunning} />
        {isRunning ? 'Running promotion...' : 'Run Promotion Now'}
      </button>

      {/* Last Promotion Result */}
      {lastResult && (
        <div style={{
          padding: 14,
          background: lastResult.error
            ? 'rgba(239, 68, 68, 0.1)'
            : 'rgba(34, 197, 94, 0.1)',
          borderRadius: 10,
          border: `1px solid ${lastResult.error ? 'rgba(239, 68, 68, 0.3)' : 'rgba(34, 197, 94, 0.3)'}`
        }}>
          {lastResult.error ? (
            <div style={{ color: '#EF4444', fontSize: 13 }}>
              Error: {lastResult.error}
            </div>
          ) : (
            <div style={{ color: '#22C55E', fontSize: 13 }}>
              <FontAwesomeIcon icon={faCheck} style={{ marginRight: 8 }} />
              Promoted <strong>{lastResult.promoted || 0}</strong> new,{' '}
              upgraded <strong>{lastResult.upgraded || 0}</strong> draft → active
              {lastResult.timestamp && (
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
                  {formatDate(lastResult.timestamp)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Threshold Info Toggle */}
      <button
        onClick={() => setShowThresholds(!showThresholds)}
        style={{
          background: 'none',
          border: 'none',
          color: '#60A5FA',
          fontSize: 13,
          cursor: 'pointer',
          textAlign: 'left',
          padding: 0
        }}
      >
        {showThresholds ? '- Hide qualification thresholds' : '+ Show qualification thresholds'}
      </button>

      {/* Threshold Details */}
      {showThresholds && (
        <div style={{
          padding: 16,
          background: 'rgba(30, 41, 59, 0.3)',
          borderRadius: 10,
          border: '1px solid rgba(255,255,255,0.05)',
          fontSize: 12,
          color: 'rgba(255,255,255,0.7)'
        }}>
          <p style={{ margin: '0 0 12px 0', color: 'rgba(255,255,255,0.5)' }}>
            URLs transition through two tiers based on engagement:
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[['Draft (Upcoming)', QUALIFICATION_THRESHOLDS.url.draft], ['Active', QUALIFICATION_THRESHOLDS.url.active]].map(([label, t]) => (
              <div key={label} style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '6px 10px',
                background: 'rgba(0,0,0,0.2)',
                borderRadius: 6
              }}>
                <span style={{ fontWeight: 500 }}>{label}</span>
                <span style={{ color: 'rgba(255,255,255,0.5)' }}>
                  {t.minDays ? `${t.minDays}+ days` : `${t.minVisits}+ visits`}
                  {t.minTimeMs && ` OR ${Math.round(t.minTimeMs / 60000)}+ min`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default WorkspaceCleanupSettings;
