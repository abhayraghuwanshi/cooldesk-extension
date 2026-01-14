import { faChartLine, faChevronDown, faChevronUp, faClock, faFire, faTrophy } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React from 'react';

export function ActivityInsightsWidget({ rows = [] }) {
  const [isExpanded, setIsExpanded] = React.useState(false);

  // Calculate daily insights
  const insights = React.useMemo(() => {
    const now = Date.now();
    const today = new Date().toISOString().split('T')[0];
    const todayStart = new Date(today).getTime();

    // Filter today's activity
    const todayActivity = rows.filter(r => {
      const lastVisit = r.lastVisit || 0;
      return lastVisit >= todayStart;
    });

    // Total screen time today
    const totalTimeToday = todayActivity.reduce((sum, r) => sum + (r.time || 0), 0);

    // Top 3 sites by time
    const topSites = [...rows]
      .sort((a, b) => (b.time || 0) - (a.time || 0))
      .slice(0, 3)
      .map(r => ({
        domain: r.domain || new URL(r.url).hostname.replace('www.', ''),
        time: r.time || 0,
        pageType: r.pageType || 'general'
      }));

    // Most active hour
    const allVisitTimes = rows.flatMap(r => r.visitTimes || []);
    const hourCounts = new Map();
    allVisitTimes.forEach(hour => {
      hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
    });
    const mostActiveHour = Array.from(hourCounts.entries())
      .sort((a, b) => b[1] - a[1])[0]?.[0] || new Date().getHours();

    // Productivity score (0-100)
    const workTypes = ['tool', 'docs', 'code', 'code-review'];
    const workTime = rows
      .filter(r => workTypes.includes(r.pageType))
      .reduce((sum, r) => sum + (r.time || 0), 0);
    const totalTime = rows.reduce((sum, r) => sum + (r.time || 0), 0);
    const productivityScore = totalTime > 0 ? Math.round((workTime / totalTime) * 100) : 0;

    // Quality insights
    const totalVisits = rows.reduce((sum, r) => sum + (r.visitCount || 0), 0);
    const totalBounces = rows.reduce((sum, r) => sum + (r.bounced || 0), 0);
    const bounceRate = totalVisits > 0 ? (totalBounces / totalVisits) * 100 : 0;

    const avgSessionDuration = rows
      .flatMap(r => r.sessionDurations || [])
      .reduce((sum, d, i, arr) => sum + d / arr.length, 0);

    // Find streaks
    const streaks = rows
      .filter(r => (r.returnVisits || 0) >= 3)
      .map(r => ({
        domain: r.domain || new URL(r.url).hostname.replace('www.', ''),
        days: (r.visitDays?.size || 0)
      }))
      .sort((a, b) => b.days - a.days)
      .slice(0, 3);

    // Generate insight message
    let insightMessage = '';
    if (productivityScore >= 70) {
      insightMessage = `🎯 Great focus! ${productivityScore}% work-related browsing`;
    } else if (productivityScore >= 40) {
      insightMessage = `⚖️ Balanced day with ${productivityScore}% productivity`;
    } else {
      insightMessage = `🎮 Leisure day - only ${productivityScore}% work time`;
    }

    // Context switches (number of different sites visited)
    const contextSwitches = todayActivity.length;

    return {
      totalTimeToday,
      topSites,
      mostActiveHour,
      productivityScore,
      bounceRate,
      avgSessionDuration,
      streaks,
      insightMessage,
      contextSwitches,
      todayVisits: todayActivity.reduce((sum, r) => sum + (r.visitCount || 0), 0)
    };
  }, [rows]);

  // Format time helper
  const formatTime = (ms) => {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  // Get emoji for page type
  const getTypeEmoji = (type) => {
    const emojis = {
      tool: '🔧',
      docs: '📚',
      code: '💻',
      'code-review': '🔍',
      article: '📝',
      social: '💬',
      video: '🎥',
      email: '📧',
      storage: '💾',
      general: '🌐'
    };
    return emojis[type] || '🌐';
  };

  return (
    <div style={{
      background: 'rgba(255, 255, 255, 0.03)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '12px',
      overflow: 'hidden',
      marginTop: '16px'
    }}>
      {/* Compact Header */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          padding: '12px 16px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          transition: 'background 0.2s ease'
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
          {/* Icon */}
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '8px',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <FontAwesomeIcon icon={faChartLine} style={{ color: '#fff', fontSize: '14px' }} />
          </div>

          {/* Summary Stats */}
          <div style={{ flex: 1 }}>
            <div style={{
              fontSize: '13px',
              fontWeight: 600,
              color: '#fff',
              marginBottom: '2px'
            }}>
              Today's Activity
            </div>
            <div style={{
              fontSize: '11px',
              color: 'rgba(255, 255, 255, 0.6)'
            }}>
              {formatTime(insights.totalTimeToday)} • {insights.todayVisits} visits • {insights.contextSwitches} apps
            </div>
          </div>

          {/* Expand/Collapse Icon */}
          <FontAwesomeIcon
            icon={isExpanded ? faChevronUp : faChevronDown}
            style={{ color: 'rgba(255, 255, 255, 0.4)', fontSize: '12px' }}
          />
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div style={{
          borderTop: '1px solid rgba(255, 255, 255, 0.05)',
          padding: '16px'
        }}>
          {/* Key Insight */}
          <div style={{
            background: 'rgba(102, 126, 234, 0.1)',
            border: '1px solid rgba(102, 126, 234, 0.3)',
            borderRadius: '8px',
            padding: '12px',
            marginBottom: '16px',
            fontSize: '13px',
            color: '#a5b4fc',
            textAlign: 'center'
          }}>
            {insights.insightMessage}
          </div>

          {/* Stats Grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '12px',
            marginBottom: '16px'
          }}>
            {/* Screen Time */}
            <div style={{
              background: 'rgba(255, 255, 255, 0.02)',
              borderRadius: '8px',
              padding: '12px',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '10px', color: 'rgba(255, 255, 255, 0.5)', marginBottom: '4px' }}>
                SCREEN TIME
              </div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#fff', marginBottom: '2px' }}>
                <FontAwesomeIcon icon={faClock} style={{ fontSize: '14px', marginRight: '6px', color: '#60a5fa' }} />
                {formatTime(insights.totalTimeToday)}
              </div>
            </div>

            {/* Productivity */}
            <div style={{
              background: 'rgba(255, 255, 255, 0.02)',
              borderRadius: '8px',
              padding: '12px',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '10px', color: 'rgba(255, 255, 255, 0.5)', marginBottom: '4px' }}>
                PRODUCTIVITY
              </div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#fff', marginBottom: '2px' }}>
                <FontAwesomeIcon icon={faTrophy} style={{ fontSize: '14px', marginRight: '6px', color: '#fbbf24' }} />
                {insights.productivityScore}%
              </div>
            </div>

            {/* Peak Hour */}
            <div style={{
              background: 'rgba(255, 255, 255, 0.02)',
              borderRadius: '8px',
              padding: '12px',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '10px', color: 'rgba(255, 255, 255, 0.5)', marginBottom: '4px' }}>
                PEAK HOUR
              </div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#fff', marginBottom: '2px' }}>
                <FontAwesomeIcon icon={faFire} style={{ fontSize: '14px', marginRight: '6px', color: '#f97316' }} />
                {insights.mostActiveHour}:00
              </div>
            </div>
          </div>

          {/* Top Sites */}
          {insights.topSites.length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{
                fontSize: '11px',
                fontWeight: 600,
                color: 'rgba(255, 255, 255, 0.7)',
                marginBottom: '8px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}>
                Top Sites
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {insights.topSites.map((site, idx) => (
                  <div key={idx} style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px',
                    background: 'rgba(255, 255, 255, 0.02)',
                    borderRadius: '6px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '14px' }}>{getTypeEmoji(site.pageType)}</span>
                      <span style={{ fontSize: '12px', color: '#fff' }}>{site.domain}</span>
                    </div>
                    <span style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.5)' }}>
                      {formatTime(site.time)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Streaks */}
          {insights.streaks.length > 0 && (
            <div>
              <div style={{
                fontSize: '11px',
                fontWeight: 600,
                color: 'rgba(255, 255, 255, 0.7)',
                marginBottom: '8px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}>
                Active Streaks
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {insights.streaks.map((streak, idx) => (
                  <div key={idx} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 10px',
                    background: 'rgba(251, 191, 36, 0.1)',
                    border: '1px solid rgba(251, 191, 36, 0.3)',
                    borderRadius: '6px',
                    fontSize: '11px',
                    color: '#fbbf24'
                  }}>
                    <FontAwesomeIcon icon={faFire} />
                    <span>{streak.domain}</span>
                    <span style={{ fontWeight: 700 }}>{streak.days}d</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quality Metrics */}
          <div style={{
            marginTop: '16px',
            padding: '12px',
            background: 'rgba(255, 255, 255, 0.02)',
            borderRadius: '8px',
            fontSize: '11px',
            color: 'rgba(255, 255, 255, 0.6)'
          }}>
            <div style={{ marginBottom: '4px' }}>
              Bounce Rate: <span style={{ color: insights.bounceRate < 30 ? '#22c55e' : '#f97316' }}>
                {insights.bounceRate.toFixed(0)}%
              </span>
            </div>
            <div>
              Avg Session: <span style={{ color: '#fff' }}>
                {formatTime(insights.avgSessionDuration)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
