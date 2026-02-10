/**
 * Note Templates Service
 * Provides ready-to-use templates for daily todos, planning, and productivity
 */

/**
 * Get today's date formatted
 */
function getFormattedDate() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

/**
 * Get current week dates
 */
function getWeekDates() {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - today.getDay() + 1);

  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);

  return {
    start: monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    end: friday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  };
}

/**
 * Available templates
 * 
 * STYLING GUIDE:
 * Templates use standard HTML. You can use:
 * 1. Standard Tags: <h1>, <h2>, <p>, <ul>, <table>, etc.
 * 2. Inline Styles: <div style="background: #f0f0f0; padding: 10px;">
 * 3. Utility Classes (supported by editor CSS):
 *    - Text: <strong>, <em>, <code>, <blockquote>
 *    - Checking: <ul data-type="taskList"> for checklists
 *    - Layout: <table> for grids
 * 
 * Note: Avoid complex scripts or external stylesheets as they won't render in the editor.
 */
export const NOTE_TEMPLATES = {
  // Daily Todo Template
  dailyTodo: {
    id: 'dailyTodo',
    name: 'Daily Todo',
    description: 'Plan your day with priorities and time blocks',
    icon: 'faClipboardList',
    category: 'productivity',
    getTitle: () => `Daily Todo - ${new Date().toLocaleDateString()}`,
    getContent: () => `
<h1>📋 Daily Todo - ${getFormattedDate()}</h1>

<h2>🎯 Top 3 Priorities</h2>
<p><em>What must get done today?</em></p>
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="false"><p>Priority 1: </p></li>
  <li data-type="taskItem" data-checked="false"><p>Priority 2: </p></li>
  <li data-type="taskItem" data-checked="false"><p>Priority 3: </p></li>
</ul>

<hr />

<h2>📝 Tasks</h2>

<h3>🔴 Must Do</h3>
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="false"><p></p></li>
</ul>

<h3>🟡 Should Do</h3>
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="false"><p></p></li>
</ul>

<h3>🟢 Nice to Do</h3>
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="false"><p></p></li>
</ul>

<hr />

<h2>📅 Time Blocks</h2>
<table>
  <thead>
    <tr>
      <th>Time</th>
      <th>Task</th>
      <th>Status</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>09:00 - 10:00</td>
      <td></td>
      <td>⬜ Pending</td>
    </tr>
    <tr>
      <td>10:00 - 11:00</td>
      <td></td>
      <td>⬜ Pending</td>
    </tr>
    <tr>
      <td>11:00 - 12:00</td>
      <td></td>
      <td>⬜ Pending</td>
    </tr>
    <tr>
      <td>13:00 - 14:00</td>
      <td></td>
      <td>⬜ Pending</td>
    </tr>
    <tr>
      <td>14:00 - 15:00</td>
      <td></td>
      <td>⬜ Pending</td>
    </tr>
    <tr>
      <td>15:00 - 16:00</td>
      <td></td>
      <td>⬜ Pending</td>
    </tr>
    <tr>
      <td>16:00 - 17:00</td>
      <td></td>
      <td>⬜ Pending</td>
    </tr>
  </tbody>
</table>

<hr />

<h2>📝 Notes</h2>
<p></p>

<h2>🌟 End of Day Review</h2>
<ul>
  <li><strong>Completed:</strong> </li>
  <li><strong>Moved to tomorrow:</strong> </li>
  <li><strong>Learned:</strong> </li>
</ul>
    `.trim()
  },

  // Feature Planning Template
  featurePlanning: {
    id: 'featurePlanning',
    name: 'Feature Planning',
    description: 'Plan a new feature with requirements and tasks',
    icon: 'faRocket',
    category: 'development',
    getTitle: () => 'Feature: [Feature Name]',
    getContent: () => `
<h1>🚀 Feature Planning</h1>
<p><strong>Feature Name:</strong> [Enter feature name]</p>
<p><strong>Owner:</strong> [Your name]</p>
<p><strong>Created:</strong> ${getFormattedDate()}</p>

<hr />

<h2>📋 Overview</h2>
<table>
  <thead>
    <tr>
      <th>Attribute</th>
      <th>Details</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>Status</strong></td>
      <td>🟡 Planning</td>
    </tr>
    <tr>
      <td><strong>Priority</strong></td>
      <td>P1 / P2 / P3</td>
    </tr>
    <tr>
      <td><strong>Target Release</strong></td>
      <td></td>
    </tr>
    <tr>
      <td><strong>Estimated Effort</strong></td>
      <td>S / M / L / XL</td>
    </tr>
  </tbody>
</table>

<h2>🎯 Problem Statement</h2>
<blockquote>
  <p>What problem does this feature solve? Who is affected?</p>
</blockquote>

<h2>💡 Proposed Solution</h2>
<p>Describe the solution at a high level...</p>

<h2>✅ Requirements</h2>
<h3>Must Have</h3>
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="false"><p></p></li>
</ul>

<h3>Should Have</h3>
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="false"><p></p></li>
</ul>

<h3>Nice to Have</h3>
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="false"><p></p></li>
</ul>

<hr />

<h2>🔧 Technical Design</h2>
<h3>Components Affected</h3>
<ul>
  <li></li>
</ul>

<h3>API Changes</h3>
<ul>
  <li></li>
</ul>

<h3>Database Changes</h3>
<ul>
  <li></li>
</ul>

<h2>📊 Implementation Tasks</h2>
<table>
  <thead>
    <tr>
      <th>Task</th>
      <th>Status</th>
      <th>Effort</th>
      <th>Notes</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Design UI mockups</td>
      <td>⬜ Todo</td>
      <td>S</td>
      <td></td>
    </tr>
    <tr>
      <td>Implement backend API</td>
      <td>⬜ Todo</td>
      <td>M</td>
      <td></td>
    </tr>
    <tr>
      <td>Build frontend components</td>
      <td>⬜ Todo</td>
      <td>M</td>
      <td></td>
    </tr>
    <tr>
      <td>Write tests</td>
      <td>⬜ Todo</td>
      <td>S</td>
      <td></td>
    </tr>
    <tr>
      <td>Documentation</td>
      <td>⬜ Todo</td>
      <td>S</td>
      <td></td>
    </tr>
  </tbody>
</table>

<h2>⚠️ Risks & Mitigation</h2>
<table>
  <thead>
    <tr>
      <th>Risk</th>
      <th>Impact</th>
      <th>Mitigation</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td></td>
      <td>High / Medium / Low</td>
      <td></td>
    </tr>
  </tbody>
</table>

<h2>📝 Open Questions</h2>
<ul>
  <li></li>
</ul>

<h2>📚 References</h2>
<ul>
  <li></li>
</ul>
    `.trim()
  },

  // Sprint Planning Template
  sprintPlanning: {
    id: 'sprintPlanning',
    name: 'Sprint Planning',
    description: 'Track sprint tasks with status columns',
    icon: 'faRunning',
    category: 'productivity',
    getTitle: () => {
      const week = getWeekDates();
      return `Sprint: ${week.start} - ${week.end}`;
    },
    getContent: () => {
      const week = getWeekDates();
      return `
<h1>🏃 Sprint Planning</h1>
<p><strong>Sprint:</strong> ${week.start} - ${week.end}</p>
<p><strong>Goal:</strong> [Define sprint goal]</p>

<hr />

<h2>📊 Sprint Overview</h2>
<table>
  <thead>
    <tr>
      <th>Metric</th>
      <th>Value</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Total Tasks</td>
      <td>0</td>
    </tr>
    <tr>
      <td>Completed</td>
      <td>0</td>
    </tr>
    <tr>
      <td>In Progress</td>
      <td>0</td>
    </tr>
    <tr>
      <td>Blocked</td>
      <td>0</td>
    </tr>
  </tbody>
</table>

<hr />

<h2>📋 Sprint Backlog</h2>

<h3>⬜ To Do</h3>
<table>
  <thead>
    <tr>
      <th>Task</th>
      <th>Priority</th>
      <th>Effort</th>
      <th>Assignee</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td></td>
      <td>🔴 High</td>
      <td>S / M / L</td>
      <td></td>
    </tr>
  </tbody>
</table>

<h3>🔄 In Progress</h3>
<table>
  <thead>
    <tr>
      <th>Task</th>
      <th>Priority</th>
      <th>Progress</th>
      <th>Assignee</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td></td>
      <td></td>
      <td>50%</td>
      <td></td>
    </tr>
  </tbody>
</table>

<h3>🔍 In Review</h3>
<table>
  <thead>
    <tr>
      <th>Task</th>
      <th>Reviewer</th>
      <th>Notes</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td></td>
      <td></td>
      <td></td>
    </tr>
  </tbody>
</table>

<h3>✅ Done</h3>
<table>
  <thead>
    <tr>
      <th>Task</th>
      <th>Completed</th>
      <th>Notes</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td></td>
      <td></td>
      <td></td>
    </tr>
  </tbody>
</table>

<hr />

<h2>🚧 Blockers</h2>
<table>
  <thead>
    <tr>
      <th>Blocker</th>
      <th>Task Affected</th>
      <th>Action Needed</th>
      <th>Owner</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
    </tr>
  </tbody>
</table>

<h2>📝 Daily Standups</h2>

<h3>Monday</h3>
<ul>
  <li><strong>Done:</strong> </li>
  <li><strong>Today:</strong> </li>
  <li><strong>Blockers:</strong> </li>
</ul>

<h3>Tuesday</h3>
<ul>
  <li><strong>Done:</strong> </li>
  <li><strong>Today:</strong> </li>
  <li><strong>Blockers:</strong> </li>
</ul>

<h3>Wednesday</h3>
<ul>
  <li><strong>Done:</strong> </li>
  <li><strong>Today:</strong> </li>
  <li><strong>Blockers:</strong> </li>
</ul>

<h3>Thursday</h3>
<ul>
  <li><strong>Done:</strong> </li>
  <li><strong>Today:</strong> </li>
  <li><strong>Blockers:</strong> </li>
</ul>

<h3>Friday</h3>
<ul>
  <li><strong>Done:</strong> </li>
  <li><strong>Today:</strong> </li>
  <li><strong>Blockers:</strong> </li>
</ul>

<hr />

<h2>🎯 Sprint Retrospective</h2>
<table>
  <thead>
    <tr>
      <th>What went well 👍</th>
      <th>What to improve 🔧</th>
      <th>Action items 📋</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td></td>
      <td></td>
      <td></td>
    </tr>
  </tbody>
</table>
      `.trim();
    }
  },

  // Meeting Notes Template
  meetingNotes: {
    id: 'meetingNotes',
    name: 'Meeting Notes',
    description: 'Capture meeting discussions and action items',
    icon: 'faComments',
    category: 'productivity',
    getTitle: () => `Meeting - ${new Date().toLocaleDateString()}`,
    getContent: () => `
<h1>📝 Meeting Notes</h1>
<p><strong>Date:</strong> ${getFormattedDate()}</p>
<p><strong>Time:</strong> </p>
<p><strong>Attendees:</strong> </p>

<hr />

<h2>📋 Agenda</h2>
<ul>
  <li></li>
</ul>

<h2>💬 Discussion Notes</h2>
<p></p>

<h2>📌 Key Decisions</h2>
<ul>
  <li></li>
</ul>

<h2>✅ Action Items</h2>
<table>
  <thead>
    <tr>
      <th>Action</th>
      <th>Owner</th>
      <th>Due Date</th>
      <th>Status</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td></td>
      <td></td>
      <td></td>
      <td>⬜ Pending</td>
    </tr>
  </tbody>
</table>

<h2>📅 Next Steps</h2>
<ul>
  <li></li>
</ul>
    `.trim()
  },

  // Weekly Review Template
  weeklyReview: {
    id: 'weeklyReview',
    name: 'Weekly Review',
    description: 'Reflect on the week and plan ahead',
    icon: 'faCalendarCheck',
    category: 'productivity',
    getTitle: () => {
      const week = getWeekDates();
      return `Weekly Review - ${week.start} to ${week.end}`;
    },
    getContent: () => {
      const week = getWeekDates();
      return `
<h1>📅 Weekly Review</h1>
<p><strong>Week of:</strong> ${week.start} - ${week.end}</p>

<hr />

<h2>🎯 Goals This Week</h2>
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="false"><p>Goal 1: </p></li>
  <li data-type="taskItem" data-checked="false"><p>Goal 2: </p></li>
  <li data-type="taskItem" data-checked="false"><p>Goal 3: </p></li>
</ul>

<h2>✅ Accomplishments</h2>
<ul>
  <li></li>
</ul>

<h2>📊 Progress on Projects</h2>
<table>
  <thead>
    <tr>
      <th>Project</th>
      <th>Status</th>
      <th>Progress</th>
      <th>Next Steps</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td></td>
      <td>🟢 On Track</td>
      <td>50%</td>
      <td></td>
    </tr>
  </tbody>
</table>

<h2>🚧 Challenges & Blockers</h2>
<ul>
  <li></li>
</ul>

<h2>💡 Lessons Learned</h2>
<ul>
  <li></li>
</ul>

<hr />

<h2>📅 Next Week Planning</h2>

<h3>Top Priorities</h3>
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="false"><p></p></li>
</ul>

<h3>Scheduled Meetings</h3>
<table>
  <thead>
    <tr>
      <th>Day</th>
      <th>Time</th>
      <th>Meeting</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Monday</td>
      <td></td>
      <td></td>
    </tr>
    <tr>
      <td>Tuesday</td>
      <td></td>
      <td></td>
    </tr>
    <tr>
      <td>Wednesday</td>
      <td></td>
      <td></td>
    </tr>
    <tr>
      <td>Thursday</td>
      <td></td>
      <td></td>
    </tr>
    <tr>
      <td>Friday</td>
      <td></td>
      <td></td>
    </tr>
  </tbody>
</table>

<h2>🌟 Focus Areas</h2>
<ul>
  <li></li>
</ul>
      `.trim();
    }
  },

  // Bug Report Template
  bugReport: {
    id: 'bugReport',
    name: 'Bug Report',
    description: 'Document and track bugs',
    icon: 'faBug',
    category: 'development',
    getTitle: () => 'Bug: [Brief Description]',
    getContent: () => `
<h1>🐛 Bug Report</h1>
<p><strong>Reported:</strong> ${getFormattedDate()}</p>
<p><strong>Reporter:</strong> </p>

<hr />

<h2>📋 Bug Details</h2>
<table>
  <thead>
    <tr>
      <th>Field</th>
      <th>Value</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>Status</strong></td>
      <td>🔴 Open</td>
    </tr>
    <tr>
      <td><strong>Severity</strong></td>
      <td>Critical / High / Medium / Low</td>
    </tr>
    <tr>
      <td><strong>Priority</strong></td>
      <td>P1 / P2 / P3</td>
    </tr>
    <tr>
      <td><strong>Component</strong></td>
      <td></td>
    </tr>
    <tr>
      <td><strong>Assignee</strong></td>
      <td></td>
    </tr>
  </tbody>
</table>

<h2>📝 Description</h2>
<p>Describe the bug in detail...</p>

<h2>🔄 Steps to Reproduce</h2>
<ol>
  <li>Step 1</li>
  <li>Step 2</li>
  <li>Step 3</li>
</ol>

<h2>✅ Expected Behavior</h2>
<p>What should happen...</p>

<h2>❌ Actual Behavior</h2>
<p>What actually happens...</p>

<h2>📸 Screenshots / Logs</h2>
<p></p>

<h2>🔧 Environment</h2>
<ul>
  <li><strong>Browser:</strong> </li>
  <li><strong>OS:</strong> </li>
  <li><strong>Version:</strong> </li>
</ul>

<h2>💡 Possible Fix</h2>
<p></p>

<h2>📋 Related Issues</h2>
<ul>
  <li></li>
</ul>
    `.trim()
  },

  // Blank Note (default)
  blank: {
    id: 'blank',
    name: 'Blank Note',
    description: 'Start with a clean slate',
    icon: 'faFile',
    category: 'basic',
    getTitle: () => 'Untitled',
    getContent: () => ''
  }
};

/**
 * Get all templates grouped by category
 */
export function getTemplatesByCategory() {
  const categories = {
    productivity: { name: 'Productivity', templates: [] },
    development: { name: 'Development', templates: [] },
    basic: { name: 'Basic', templates: [] }
  };

  Object.values(NOTE_TEMPLATES).forEach(template => {
    if (categories[template.category]) {
      categories[template.category].templates.push(template);
    }
  });

  return categories;
}

/**
 * Get a template by ID
 */
export function getTemplate(templateId) {
  return NOTE_TEMPLATES[templateId] || NOTE_TEMPLATES.blank;
}

/**
 * Create a note from a template
 */
export function createNoteFromTemplate(templateId) {
  const template = getTemplate(templateId);
  return {
    title: template.getTitle(),
    content: template.getContent(),
    folder: '',
    type: 'richtext'
  };
}
