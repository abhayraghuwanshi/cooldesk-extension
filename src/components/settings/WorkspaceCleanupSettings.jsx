import { faCheck, faSpinner, faTrashAlt } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';
import { listWorkspaces } from '../../db/index.js';
import { storageGet, storageSet } from '../../services/extensionApi.js';
import { CATEGORY_RULES, runWorkspaceCleanup } from '../../utils/urlQualification.js';

/**
 * Settings component for workspace cleanup configuration
 * Allows users to:
 * - View current cleanup thresholds
 * - Manually trigger cleanup
 * - Enable/disable auto-cleanup
 * - See cleanup statistics
 */
export function WorkspaceCleanupSettings() {
  const [isRunning, setIsRunning] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [autoCleanupEnabled, setAutoCleanupEnabled] = useState(true);
  const [workspaceStats, setWorkspaceStats] = useState({ total: 0, totalUrls: 0 });
  const [showThresholds, setShowThresholds] = useState(false);

  // Load settings and stats on mount
  useEffect(() => {
    loadSettings();
    loadWorkspaceStats();
  }, []);

  const loadSettings = async () => {
    try {
      const result = await storageGet(['autoWorkspaceCleanup', 'lastCleanupResult']);
      setAutoCleanupEnabled(result.autoWorkspaceCleanup !== false); // Default true
      if (result.lastCleanupResult) {
        setLastResult(result.lastCleanupResult);
      }
    } catch (e) {
      console.warn('[CleanupSettings] Failed to load settings:', e);
    }
  };

  const loadWorkspaceStats = async () => {
    try {
      const result = await listWorkspaces();
      const workspaces = result?.success ? result.data : (Array.isArray(result) ? result : []);
      const totalUrls = workspaces.reduce((sum, ws) => sum + (ws.urls?.length || 0), 0);
      setWorkspaceStats({ total: workspaces.length, totalUrls });
    } catch (e) {
      console.warn('[CleanupSettings] Failed to load workspace stats:', e);
    }
  };

  const handleAutoCleanupChange = async (enabled) => {
    setAutoCleanupEnabled(enabled);
    await storageSet({ autoWorkspaceCleanup: enabled });
  };

  const handleRunCleanup = async () => {
    setIsRunning(true);
    setLastResult(null);

    try {
      const result = await runWorkspaceCleanup({ force: true });
      setLastResult({
        ...result,
        timestamp: Date.now()
      });

      // Save result for persistence
      await storageSet({ lastCleanupResult: { ...result, timestamp: Date.now() } });

      // Reload stats
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
          Workspace Cleanup
        </h3>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', margin: 0 }}>
          Remove low-engagement URLs from workspaces to keep them focused and relevant.
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
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Total URLs</div>
        </div>
      </div>

      {/* Auto Cleanup Toggle */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        background: 'rgba(30, 41, 59, 0.3)',
        borderRadius: 10,
        border: '1px solid rgba(255,255,255,0.05)'
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#fff' }}>Auto-cleanup on startup</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
            Automatically remove unqualified URLs when extension loads
          </div>
        </div>
        <label style={{ position: 'relative', display: 'inline-block', width: 44, height: 24 }}>
          <input
            type="checkbox"
            checked={autoCleanupEnabled}
            onChange={(e) => handleAutoCleanupChange(e.target.checked)}
            style={{ opacity: 0, width: 0, height: 0 }}
          />
          <span style={{
            position: 'absolute',
            cursor: 'pointer',
            top: 0, left: 0, right: 0, bottom: 0,
            background: autoCleanupEnabled ? '#3B82F6' : 'rgba(255,255,255,0.2)',
            borderRadius: 24,
            transition: 'all 0.3s'
          }}>
            <span style={{
              position: 'absolute',
              height: 18, width: 18,
              left: autoCleanupEnabled ? 22 : 3,
              bottom: 3,
              background: '#fff',
              borderRadius: '50%',
              transition: 'all 0.3s'
            }} />
          </span>
        </label>
      </div>

      {/* Manual Cleanup Button */}
      <button
        onClick={handleRunCleanup}
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
        <FontAwesomeIcon icon={isRunning ? faSpinner : faTrashAlt} spin={isRunning} />
        {isRunning ? 'Cleaning up...' : 'Run Cleanup Now'}
      </button>

      {/* Last Cleanup Result */}
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
          ) : lastResult.skipped ? (
            <div style={{ color: '#94A3B8', fontSize: 13 }}>
              <FontAwesomeIcon icon={faCheck} style={{ marginRight: 8 }} />
              Cleanup already completed recently
            </div>
          ) : (
            <div style={{ color: '#22C55E', fontSize: 13 }}>
              <FontAwesomeIcon icon={faCheck} style={{ marginRight: 8 }} />
              Removed <strong>{lastResult.totalRemoved || 0}</strong> URLs from{' '}
              <strong>{lastResult.workspacesModified || 0}</strong> workspaces
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
            URLs must meet these thresholds to remain in workspaces:
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Object.entries(CATEGORY_RULES).map(([category, rules]) => (
              <div key={category} style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '6px 10px',
                background: 'rgba(0,0,0,0.2)',
                borderRadius: 6
              }}>
                <span style={{ textTransform: 'capitalize', fontWeight: 500 }}>{category}</span>
                <span style={{ color: 'rgba(255,255,255,0.5)' }}>
                  {rules.minDays}+ days OR ({rules.minVisits}+ visits & {Math.round(rules.minTimeMs / 60000)}+ min)
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
