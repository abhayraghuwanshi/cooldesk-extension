/**
 * Daily Story Service
 * Generates AI-enhanced daily browsing narratives with rich metrics and insights
 */

import { getMemoryEvents } from './eventAggregator';
import { NanoAIService } from '../nanoAIService';

// Page type categories for analysis
const PAGE_TYPE_CONFIG = {
  code: { label: 'Coding', color: '#10b981', icon: '💻', productive: true },
  docs: { label: 'Documentation', color: '#3b82f6', icon: '📚', productive: true },
  article: { label: 'Articles', color: '#8b5cf6', icon: '📰', productive: true },
  video: { label: 'Video', color: '#ef4444', icon: '🎬', productive: false },
  social: { label: 'Social', color: '#f59e0b', icon: '💬', productive: false },
  email: { label: 'Email', color: '#06b6d4', icon: '📧', productive: true },
  tool: { label: 'Tools', color: '#14b8a6', icon: '🔧', productive: true },
  shopping: { label: 'Shopping', color: '#ec4899', icon: '🛒', productive: false },
  general: { label: 'Other', color: '#64748b', icon: '🌐', productive: null }
};

// Productive domain patterns
const PRODUCTIVE_DOMAINS = ['github', 'stackoverflow', 'gitlab', 'localhost', 'figma', 'notion', 'linear', 'jira', 'docs.google', 'claude', 'chatgpt', 'confluence'];
const DISTRACTING_DOMAINS = ['youtube', 'twitter', 'x.com', 'reddit', 'facebook', 'instagram', 'netflix', 'tiktok', 'twitch'];

/**
 * Process raw activity events into structured metrics
 */
export function processActivityData(events) {
  const visits = events.filter(e => e.type === 'visit');

  if (visits.length === 0) {
    return null;
  }

  // Domain aggregation with rich metrics
  const domainMetrics = aggregateDomainMetrics(visits);

  // Session building with engagement patterns
  const sessions = buildEngagementSessions(visits);

  // Page type breakdown
  const pageTypeBreakdown = calculatePageTypeBreakdown(visits);

  // Calculate composite scores
  const scores = calculateDayScores(domainMetrics, sessions);

  // Deep dives (pages with significant engagement)
  const deepDives = identifyDeepDives(visits);

  return {
    visits,
    domainMetrics,
    sessions,
    pageTypeBreakdown,
    scores,
    deepDives,
    totalVisits: visits.length,
    uniqueDomains: domainMetrics.size
  };
}

/**
 * Aggregate metrics by domain
 */
function aggregateDomainMetrics(visits) {
  const metrics = new Map();

  visits.forEach(v => {
    try {
      const url = new URL(v.url);
      const domain = url.hostname.replace(/^www\./, '');
      const time = v.metadata?.timeSpent || 0;
      const scroll = v.metadata?.scrollDepth || 0;
      const clicks = v.metadata?.clicks || 0;
      const forms = v.metadata?.forms || 0;
      const engagement = v.metadata?.engagementScore || 0;

      if (!metrics.has(domain)) {
        metrics.set(domain, {
          domain,
          totalTime: 0,
          visibleTime: 0,
          scrollDepths: [],
          clicks: 0,
          forms: 0,
          engagementScores: [],
          visits: 0,
          titles: new Set(),
          pageTypes: new Set()
        });
      }

      const m = metrics.get(domain);
      m.totalTime += time;
      m.visibleTime += v.metadata?.visibleTime || time;
      if (scroll > 0) m.scrollDepths.push(scroll);
      m.clicks += clicks;
      m.forms += forms;
      if (engagement > 0) m.engagementScores.push(engagement);
      m.visits++;
      if (v.metadata?.title) m.titles.add(v.metadata.title);
      if (v.pageType) m.pageTypes.add(v.pageType);
    } catch (e) {
      // Invalid URL, skip
    }
  });

  // Calculate averages
  metrics.forEach((m, domain) => {
    m.avgScrollDepth = m.scrollDepths.length > 0
      ? Math.round(m.scrollDepths.reduce((a, b) => a + b, 0) / m.scrollDepths.length)
      : 0;
    m.maxScrollDepth = m.scrollDepths.length > 0
      ? Math.max(...m.scrollDepths)
      : 0;
    m.avgEngagement = m.engagementScores.length > 0
      ? Math.round(m.engagementScores.reduce((a, b) => a + b, 0) / m.engagementScores.length)
      : 0;
    m.isProductive = PRODUCTIVE_DOMAINS.some(pd => domain.includes(pd));
    m.isDistracting = DISTRACTING_DOMAINS.some(dd => domain.includes(dd));
  });

  return metrics;
}

/**
 * Build sessions with engagement patterns
 */
function buildEngagementSessions(visits) {
  const sorted = [...visits].sort((a, b) => a.timestamp - b.timestamp);
  const sessions = [];
  let currentSession = null;
  const SESSION_GAP_MS = 15 * 60 * 1000; // 15 minutes

  sorted.forEach(visit => {
    const time = visit.metadata?.timeSpent || 0;
    const engagement = visit.metadata?.engagementScore || 0;

    if (!currentSession) {
      currentSession = createSession(visit);
    } else {
      const gap = visit.timestamp - currentSession.lastTimestamp;
      if (gap > SESSION_GAP_MS) {
        // Finalize current session
        finalizeSession(currentSession);
        sessions.push(currentSession);
        currentSession = createSession(visit);
      } else {
        // Add to current session
        addToSession(currentSession, visit);
      }
    }
  });

  if (currentSession) {
    finalizeSession(currentSession);
    sessions.push(currentSession);
  }

  return sessions;
}

function createSession(visit) {
  const domain = getDomain(visit.url);
  return {
    startTime: visit.timestamp,
    endTime: visit.timestamp,
    lastTimestamp: visit.timestamp,
    duration: visit.metadata?.timeSpent || 0,
    domains: new Set([domain]),
    domainTimes: { [domain]: visit.metadata?.timeSpent || 0 },
    engagementScores: [visit.metadata?.engagementScore || 0],
    pageTypes: new Set([visit.pageType || 'general']),
    visitCount: 1
  };
}

function addToSession(session, visit) {
  const domain = getDomain(visit.url);
  const time = visit.metadata?.timeSpent || 0;

  session.endTime = visit.timestamp;
  session.lastTimestamp = visit.timestamp;
  session.duration += time;
  session.domains.add(domain);
  session.domainTimes[domain] = (session.domainTimes[domain] || 0) + time;
  session.engagementScores.push(visit.metadata?.engagementScore || 0);
  session.pageTypes.add(visit.pageType || 'general');
  session.visitCount++;
}

function finalizeSession(session) {
  // Calculate session metrics
  session.avgEngagement = session.engagementScores.length > 0
    ? Math.round(session.engagementScores.reduce((a, b) => a + b, 0) / session.engagementScores.length)
    : 0;

  // Find dominant domain
  let maxTime = 0;
  session.dominantDomain = null;
  Object.entries(session.domainTimes).forEach(([domain, time]) => {
    if (time > maxTime) {
      maxTime = time;
      session.dominantDomain = domain;
    }
  });

  // Determine if this is a deep work session (>20 min, high engagement)
  session.isDeepWork = session.duration > 20 * 60 * 1000 && session.avgEngagement > 40;

  // Format times for display
  session.startTimeStr = new Date(session.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  session.endTimeStr = new Date(session.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  session.durationMinutes = Math.round(session.duration / 60000);
}

/**
 * Calculate page type breakdown
 */
function calculatePageTypeBreakdown(visits) {
  const breakdown = {};
  let totalTime = 0;

  visits.forEach(v => {
    const type = v.pageType || 'general';
    const time = v.metadata?.timeSpent || 0;
    breakdown[type] = (breakdown[type] || 0) + time;
    totalTime += time;
  });

  return Object.entries(breakdown)
    .map(([type, time]) => ({
      type,
      time,
      percent: totalTime > 0 ? Math.round((time / totalTime) * 100) : 0,
      ...PAGE_TYPE_CONFIG[type] || PAGE_TYPE_CONFIG.general
    }))
    .sort((a, b) => b.time - a.time);
}

/**
 * Calculate composite day scores
 */
function calculateDayScores(domainMetrics, sessions) {
  let productiveTime = 0;
  let distractingTime = 0;
  let totalTime = 0;
  let deepWorkMinutes = 0;

  domainMetrics.forEach(m => {
    totalTime += m.totalTime;
    if (m.isProductive) productiveTime += m.totalTime;
    if (m.isDistracting) distractingTime += m.totalTime;
  });

  sessions.forEach(s => {
    if (s.isDeepWork) deepWorkMinutes += s.durationMinutes;
  });

  const focusRatio = totalTime > 0 ? productiveTime / totalTime : 0;
  const distractRatio = totalTime > 0 ? distractingTime / totalTime : 0;

  // Focus score: 0-100, higher = more focused
  let focusScore = 50; // Baseline
  focusScore += focusRatio * 40; // +40 for all productive
  focusScore -= distractRatio * 30; // -30 for all distracting
  focusScore += Math.min(deepWorkMinutes / 60, 1) * 10; // +10 for 1hr+ deep work
  focusScore = Math.max(0, Math.min(100, Math.round(focusScore)));

  return {
    focusScore,
    productiveMinutes: Math.round(productiveTime / 60000),
    distractingMinutes: Math.round(distractingTime / 60000),
    totalMinutes: Math.round(totalTime / 60000),
    deepWorkMinutes,
    sessionCount: sessions.length
  };
}

/**
 * Identify deep dive pages (significant focused reading)
 */
function identifyDeepDives(visits) {
  return visits
    .filter(v => {
      const time = v.metadata?.timeSpent || 0;
      const scroll = v.metadata?.scrollDepth || 0;
      const engagement = v.metadata?.engagementScore || 0;
      // Deep dive: >3 min, scrolled meaningfully, decent engagement
      return time > 180000 && scroll > 30 && engagement > 25;
    })
    .map(v => {
      const domain = getDomain(v.url);
      return {
        url: v.url,
        title: v.metadata?.title || domain,
        domain,
        duration: Math.round((v.metadata?.timeSpent || 0) / 60000),
        scrollDepth: v.metadata?.scrollDepth || 0,
        engagementScore: v.metadata?.engagementScore || 0,
        pageType: v.pageType || 'general'
      };
    })
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 5); // Top 5
}

/**
 * Detect patterns and generate insights
 */
export function detectPatterns(data) {
  if (!data) return [];

  const insights = [];
  const { sessions, scores, domainMetrics, pageTypeBreakdown, deepDives } = data;

  // Deep work detection
  const deepWorkSessions = sessions.filter(s => s.isDeepWork);
  if (deepWorkSessions.length > 0) {
    const totalDeepWork = deepWorkSessions.reduce((acc, s) => acc + s.durationMinutes, 0);
    insights.push({
      type: 'positive',
      icon: '🧠',
      title: 'Deep Work Detected',
      detail: `${totalDeepWork} minutes of focused work across ${deepWorkSessions.length} session${deepWorkSessions.length > 1 ? 's' : ''}`
    });
  }

  // Learning/research detection
  const docsTime = pageTypeBreakdown.find(p => p.type === 'docs')?.time || 0;
  const articleTime = pageTypeBreakdown.find(p => p.type === 'article')?.time || 0;
  const learningTime = Math.round((docsTime + articleTime) / 60000);
  if (learningTime > 20) {
    insights.push({
      type: 'positive',
      icon: '📚',
      title: 'Research Mode',
      detail: `${learningTime} minutes reading documentation and articles`
    });
  }

  // Productive peak detection
  const productiveSessions = sessions.filter(s => s.avgEngagement > 50);
  if (productiveSessions.length > 0) {
    const peakSession = productiveSessions.reduce((best, s) =>
      s.avgEngagement > (best?.avgEngagement || 0) ? s : best, null);
    if (peakSession) {
      insights.push({
        type: 'positive',
        icon: '⚡',
        title: 'Peak Productivity',
        detail: `Highest engagement at ${peakSession.startTimeStr} on ${peakSession.dominantDomain}`
      });
    }
  }

  // Distraction warning
  if (scores.distractingMinutes > 60) {
    insights.push({
      type: 'warning',
      icon: '⚠️',
      title: 'Distraction Alert',
      detail: `${scores.distractingMinutes} minutes on distracting sites`
    });
  }

  // Variety insight
  if (data.uniqueDomains > 15) {
    insights.push({
      type: 'neutral',
      icon: '🔀',
      title: 'Context Switching',
      detail: `Visited ${data.uniqueDomains} different sites - consider focusing on fewer tasks`
    });
  }

  // Coding focus
  const codeTime = pageTypeBreakdown.find(p => p.type === 'code')?.time || 0;
  if (codeTime > 60 * 60 * 1000) { // >1hr
    const codeMinutes = Math.round(codeTime / 60000);
    insights.push({
      type: 'positive',
      icon: '💻',
      title: 'Coding Focus',
      detail: `${codeMinutes} minutes on development platforms`
    });
  }

  return insights.slice(0, 4); // Limit to 4 insights
}

/**
 * Generate AI narrative using NanoAI
 */
export async function generateAINarrative(data, dateDisplay) {
  if (!data) {
    return { narrative: null, source: 'none' };
  }

  // Build concise prompt for AI
  const topDomains = [...data.domainMetrics.entries()]
    .sort((a, b) => b[1].totalTime - a[1].totalTime)
    .slice(0, 5)
    .map(([domain, m]) => `${domain} (${Math.round(m.totalTime / 60000)}min)`);

  const patterns = detectPatterns(data)
    .map(i => `${i.icon} ${i.title}: ${i.detail}`)
    .join('\n');

  const prompt = `You are summarizing someone's browsing day. Write a 2-3 paragraph natural narrative.

DATE: ${dateDisplay}

STATS:
- Active time: ${data.scores.totalMinutes} minutes across ${data.scores.sessionCount} sessions
- Focus score: ${data.scores.focusScore}/100
- Deep work: ${data.scores.deepWorkMinutes} minutes
- Sites visited: ${data.uniqueDomains}

TOP SITES: ${topDomains.join(', ')}

PATTERNS:
${patterns || '- No notable patterns detected'}

DEEP DIVES:
${data.deepDives.slice(0, 3).map(d => `- "${d.title}" (${d.duration}min, ${d.scrollDepth}% read)`).join('\n') || '- None'}

Write an engaging summary that:
1. Describes the day's flow naturally
2. Highlights achievements and focus periods
3. Notes any interesting patterns
4. Ends with a brief insight or reflection

Keep it concise and friendly. No bullet points - write in prose.`;

  try {
    // Try NanoAI
    const nanoStatus = await NanoAIService.init();
    if (nanoStatus.available) {
      const result = await NanoAIService.prompt(prompt, 45000);
      if (result && result.length > 50) {
        return { narrative: result, source: 'nano' };
      }
    }
  } catch (error) {
    console.warn('[DailyStory] AI generation failed:', error);
  }

  // Fallback to template-based narrative
  return { narrative: generateStaticNarrative(data, dateDisplay), source: 'static' };
}

/**
 * Generate template-based narrative when AI unavailable
 */
function generateStaticNarrative(data, dateDisplay) {
  const { scores, sessions, deepDives, domainMetrics } = data;

  const topDomain = [...domainMetrics.entries()]
    .sort((a, b) => b[1].totalTime - a[1].totalTime)[0]?.[0] || 'various sites';

  const topTime = Math.round(([...domainMetrics.values()][0]?.totalTime || 0) / 60000);

  let narrative = '';

  // Opening based on focus score
  if (scores.focusScore >= 70) {
    narrative += `A focused and productive day! You spent ${scores.totalMinutes} minutes browsing across ${sessions.length} sessions, maintaining a strong focus score of ${scores.focusScore}/100. `;
  } else if (scores.focusScore >= 40) {
    narrative += `A balanced day with ${scores.totalMinutes} minutes of browsing activity. Your focus score of ${scores.focusScore}/100 reflects a mix of productive work and general browsing. `;
  } else {
    narrative += `Your day included ${scores.totalMinutes} minutes of browsing. With a focus score of ${scores.focusScore}/100, there may be opportunities to reduce distractions. `;
  }

  // Middle section about activity
  narrative += `Most of your time was spent on ${topDomain} (${topTime} minutes). `;

  if (scores.deepWorkMinutes > 0) {
    narrative += `You had ${scores.deepWorkMinutes} minutes of deep work - periods of sustained, focused activity. `;
  }

  // Deep dives mention
  if (deepDives.length > 0) {
    const dive = deepDives[0];
    narrative += `Your most engaged reading was "${dive.title}" where you read ${dive.scrollDepth}% of the content. `;
  }

  // Closing insight
  if (scores.productiveMinutes > scores.distractingMinutes * 2) {
    narrative += `Overall, a productive session with meaningful engagement.`;
  } else if (scores.distractingMinutes > 60) {
    narrative += `Consider setting focused work blocks to minimize distractions tomorrow.`;
  } else {
    narrative += `A typical browsing day with room for deeper focus.`;
  }

  return narrative;
}

/**
 * Render the complete story HTML
 */
export function renderStoryHTML(data, insights, narrative, dateDisplay) {
  if (!data) {
    return `
      <div style="text-align: center; padding: 40px; color: var(--text-secondary);">
        <div style="font-size: 48px; margin-bottom: 16px;">📭</div>
        <h2 style="margin: 0 0 8px; font-size: 20px;">No Activity Found</h2>
        <p style="margin: 0; font-size: 14px;">No browsing activity was recorded for this day.</p>
      </div>
    `;
  }

  const { scores, sessions, deepDives, pageTypeBreakdown, domainMetrics } = data;

  // Focus score color
  const focusColor = scores.focusScore >= 70 ? '#10b981' : scores.focusScore >= 40 ? '#f59e0b' : '#ef4444';
  const focusLabel = scores.focusScore >= 70 ? 'Excellent' : scores.focusScore >= 40 ? 'Good' : 'Needs Work';

  // Get top domains for the table
  const topDomains = [...domainMetrics.entries()]
    .sort((a, b) => b[1].totalTime - a[1].totalTime)
    .slice(0, 6);

  return `
<div class="daily-story">

  <!-- Header -->
  <h1>${dateDisplay}</h1>
  <p><em>Your Daily Browsing Story</em></p>

  <hr />

  <!-- Quick Stats Table -->
  <h2>📊 Quick Stats</h2>
  <table>
    <thead>
      <tr>
        <th>Metric</th>
        <th>Value</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>🧠 Focus Score</strong></td>
        <td>${scores.focusScore}/100</td>
        <td><span style="color: ${focusColor}; font-weight: 600;">${focusLabel}</span></td>
      </tr>
      <tr>
        <td><strong>⏱️ Total Active Time</strong></td>
        <td>${formatDuration(scores.totalMinutes)}</td>
        <td>${scores.sessionCount} sessions</td>
      </tr>
      <tr>
        <td><strong>⚡ Deep Work</strong></td>
        <td>${formatDuration(scores.deepWorkMinutes)}</td>
        <td>${scores.deepWorkMinutes > 60 ? '🔥 Great focus!' : scores.deepWorkMinutes > 0 ? '👍 Good start' : '—'}</td>
      </tr>
      <tr>
        <td><strong>🌐 Sites Visited</strong></td>
        <td>${data.uniqueDomains} unique sites</td>
        <td>${data.totalVisits} total visits</td>
      </tr>
      <tr>
        <td><strong>✅ Productive Time</strong></td>
        <td>${formatDuration(scores.productiveMinutes)}</td>
        <td>${scores.totalMinutes > 0 ? Math.round((scores.productiveMinutes / scores.totalMinutes) * 100) : 0}% of total</td>
      </tr>
    </tbody>
  </table>

  <!-- AI Summary -->
  <h2>📝 Summary</h2>
  <blockquote>
    ${narrative.narrative || 'No summary available for this day.'}
  </blockquote>
  <p><small><em>${narrative.source === 'nano' ? '🤖 AI Generated' : '📊 Data Summary'}</em></small></p>

  <hr />

  <!-- Top Sites Table -->
  <h2>🏆 Top Sites</h2>
  <table>
    <thead>
      <tr>
        <th>Site</th>
        <th>Time Spent</th>
        <th>Visits</th>
        <th>Engagement</th>
      </tr>
    </thead>
    <tbody>
      ${topDomains.map(([domain, m]) => `
      <tr>
        <td><strong>${domain}</strong></td>
        <td>${formatDuration(Math.round(m.totalTime / 60000))}</td>
        <td>${m.visits}</td>
        <td>${m.avgEngagement > 0 ? `${m.avgEngagement}/100` : '—'}</td>
      </tr>
      `).join('')}
    </tbody>
  </table>

  <!-- Sessions Timeline Table -->
  <h2>🗺️ Session Timeline</h2>
  <table>
    <thead>
      <tr>
        <th>Time</th>
        <th>Duration</th>
        <th>Main Sites</th>
        <th>Focus</th>
      </tr>
    </thead>
    <tbody>
      ${sessions.filter(s => s.durationMinutes >= 2).map(session => `
      <tr${session.isDeepWork ? ' style="background: rgba(16,185,129,0.08);"' : ''}>
        <td>${session.startTimeStr} - ${session.endTimeStr}</td>
        <td><strong>${session.durationMinutes}m</strong></td>
        <td>${[...session.domains].slice(0, 3).join(', ')}</td>
        <td>
          <span style="color: ${getEngagementColor(session.avgEngagement)};">
            ${session.isDeepWork ? '🧠 Deep Work' : session.avgEngagement >= 50 ? '✅ Focused' : session.avgEngagement >= 20 ? '📖 Active' : '👀 Light'}
          </span>
        </td>
      </tr>
      `).join('')}
    </tbody>
  </table>

  <!-- Content Types -->
  <h2>📊 Content Breakdown</h2>
  <table>
    <thead>
      <tr>
        <th>Type</th>
        <th>Time</th>
        <th>Share</th>
      </tr>
    </thead>
    <tbody>
      ${pageTypeBreakdown.filter(p => p.percent >= 3).map(pt => `
      <tr>
        <td>${pt.icon} <strong>${pt.label}</strong></td>
        <td>${formatDuration(Math.round(pt.time / 60000))}</td>
        <td>${pt.percent}%</td>
      </tr>
      `).join('')}
    </tbody>
  </table>

  ${deepDives.length > 0 ? `
  <!-- Deep Dives -->
  <h2>🧠 Deep Dives</h2>
  <p><em>Pages where you spent significant focused time:</em></p>
  <table>
    <thead>
      <tr>
        <th>Page</th>
        <th>Time</th>
        <th>Read</th>
      </tr>
    </thead>
    <tbody>
      ${deepDives.map(dive => `
      <tr>
        <td><a href="${dive.url}" target="_blank">${dive.title.length > 50 ? dive.title.substring(0, 50) + '...' : dive.title}</a></td>
        <td>${dive.duration}m</td>
        <td>${dive.scrollDepth}%</td>
      </tr>
      `).join('')}
    </tbody>
  </table>
  ` : ''}

  ${insights.length > 0 ? `
  <!-- Insights -->
  <h2>💡 Insights</h2>
  <ul>
    ${insights.map(insight => `
    <li><strong>${insight.icon} ${insight.title}:</strong> ${insight.detail}</li>
    `).join('')}
  </ul>
  ` : ''}

</div>
  `;
}

/**
 * Format minutes into human-readable duration
 */
function formatDuration(minutes) {
  if (minutes < 1) return '< 1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function getEngagementColor(engagement) {
  if (engagement >= 70) return '#10b981';
  if (engagement >= 40) return '#3b82f6';
  if (engagement >= 20) return '#f59e0b';
  return '#64748b';
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

/**
 * Main entry point - generates complete daily story
 */
export async function generateDailyStory(dateStr) {
  const date = new Date(dateStr);
  const startOfDay = new Date(dateStr).setHours(0, 0, 0, 0);
  const endOfDay = new Date(dateStr).setHours(23, 59, 59, 999);
  const dateDisplay = date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  try {
    // Fetch events
    const events = await getMemoryEvents({
      startDate: startOfDay,
      endDate: endOfDay,
      types: ['visit'],
      limit: 5000
    });

    // Process data
    const data = processActivityData(events);

    if (!data) {
      return renderStoryHTML(null, [], { narrative: null, source: 'none' }, dateDisplay);
    }

    // Detect patterns
    const insights = detectPatterns(data);

    // Generate AI narrative
    const narrative = await generateAINarrative(data, dateDisplay);

    // Render HTML
    return renderStoryHTML(data, insights, narrative, dateDisplay);

  } catch (error) {
    console.error('[DailyStory] Generation failed:', error);
    return `
      <div style="text-align: center; padding: 40px; color: var(--text-secondary);">
        <div style="font-size: 48px; margin-bottom: 16px;">⚠️</div>
        <h2 style="margin: 0 0 8px; font-size: 20px;">Generation Failed</h2>
        <p style="margin: 0; font-size: 14px;">Error: ${error.message}</p>
      </div>
    `;
  }
}
