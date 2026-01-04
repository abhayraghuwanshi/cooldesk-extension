# 🤖 Intelligent Project-Aware URL Auto-Categorization System

## Overview

This system implements **smart, context-aware URL categorization** that automatically detects projects you're working on and categorizes URLs based on your browsing session, project context, and AI analysis.

---

## 🎯 Key Features

### 1. **Session Tracking**
- Monitors your browser tabs in real-time
- Detects patterns in your browsing behavior
- Groups related tabs into "sessions"
- 30-minute session timeout for context switching

### 2. **Gradual Project Discovery**
- Automatically detects new projects from your browsing patterns
- Recognizes project indicators:
  - GitHub repos (`github.com/user/repo`)
  - Localhost ports (`localhost:3000`, `localhost:8080`)
  - File-based services (Notion, Figma, Google Drive)
  - Deployment URLs (Vercel, Netlify, etc.)

### 3. **Environment Detection**
Auto-categorizes URLs by environment:
- **Dev**: `localhost`, `127.0.0.1`, `*.local`, `dev.*`
- **Staging**: `staging.*`, `*-staging.*`, `preview.*`
- **Production**: Vercel, Netlify, Heroku, Railway, Fly.io, custom domains

### 4. **AI-Powered Categorization**
Uses **Gemini AI** (existing integration) to categorize URLs:
- Analyzes URL, page title, and browsing context
- Uses `appstore.json` as knowledge base (1500+ domains across 12 categories)
- Auto-creates new categories when confidence is high
- Associates research URLs with active project

### 5. **Smart Project Association**
Answers the question: *"How does the system know this Stack Overflow link belongs to my E-commerce project?"*

**Answer**: By analyzing your session context:
```javascript
// Example session analysis
Session {
  tabs: [
    "localhost:3000" (E-commerce App),
    "github.com/user/ecommerce" (E-commerce App),
    "stackoverflow.com/..." (Being categorized)
  ]
  → AI infers: Stack Overflow link is for E-commerce App
}
```

---

## 📁 Architecture

### Core Components

#### 1. **Session Tracker** ([src/ml/sessionTracker.js](src/ml/sessionTracker.js))
```javascript
class SessionTracker {
  - updateTab(tabId, url, title)      // Track tab activity
  - getCurrentSession()                // Get current session context
  - detectProject()                    // Detect project from patterns
  - getRelatedTabs(url)               // Find related tabs
  - setEnabled(boolean)                // Privacy toggle
}
```

**Features:**
- Tracks up to 50 recent tabs per session
- Extracts URL patterns (e.g., `github.com/user/repo`)
- Detects localhost ports and file IDs
- Session history with 10 past sessions stored

#### 2. **Project Detector** ([src/ml/projectDetector.js](src/ml/projectDetector.js))
```javascript
class ProjectDetector {
  - createProject(name, urlPatterns)   // Create new project
  - findProjectByUrl(url)              // Match URL to project
  - analyzeSessionForProject()         // Detect new project
  - setActiveProject(projectId)        // Switch active project
  - getProjectContext(url)             // Get context for AI
}
```

**Project Data Structure:**
```javascript
{
  id: "proj_ecommerce_app_1234567890",
  name: "E-commerce App",
  urlPatterns: [
    "github.com/user/ecommerce",
    "localhost:3000",
    "my-ecommerce.vercel.app"
  ],
  environments: {
    dev: ["localhost:3000"],
    staging: ["staging.my-ecommerce.vercel.app"],
    production: ["my-ecommerce.vercel.app"]
  },
  categories: {
    development: [...],
    documentation: [...],
    deployment: [...]
  },
  lastActive: 1704153600000,
  color: "#FF6B6B"
}
```

#### 3. **AI Categorizer** ([src/ml/categorizer.js](src/ml/categorizer.js))
```javascript
class Categorizer {
  - categorize(url, title, apiKey)    // AI categorization
  - quickCategorize(url)               // Fallback domain match
  - addToCategory(category, url)       // Add domain to category
  - getCategories()                    // Get all categories
}
```

**Categorization Result:**
```javascript
{
  category: "development",
  subcategory: "documentation",
  confidence: 0.92,
  isNewCategory: false,
  projectId: "proj_ecommerce_app_...",
  projectName: "E-commerce App",
  environment: "dev",
  reasoning: "Stack Overflow documentation for React hooks",
  timestamp: 1704153600000
}
```

#### 4. **Project Context Manager** ([src/background/projectContext.js](src/background/projectContext.js))
Background service that:
- Listens to tab events (`onActivated`, `onUpdated`, `onRemoved`)
- Auto-switches active project based on current tab
- Detects new projects every 2 minutes
- Handles all message passing between UI and background

---

## 🚀 How It Works: Complete Flow

### Scenario: You're working on "E-commerce App"

#### **Step 1: Project Detection**
```
1. You open: localhost:3000 (E-commerce App running)
2. You open: github.com/user/ecommerce (Project repo)
3. Session Tracker groups these tabs
4. Project Detector analyzes:
   - Pattern: Both tabs match "ecommerce"
   - Localhost port: 3000
   - Project name extracted: "E-commerce App"
5. System shows popup: "New project detected: E-commerce App"
6. You confirm → Project created and set as active
```

#### **Step 2: Research URL Categorization**
```
7. You open: stackoverflow.com/questions/react-hooks
8. Categorizer receives:
   - URL: stackoverflow.com/questions/react-hooks
   - Title: "How to use React hooks?"
   - Session context: [localhost:3000, github.com/user/ecommerce, stackoverflow...]
   - Active project: "E-commerce App"

9. AI Prompt sent to Gemini:
   """
   URL: stackoverflow.com/questions/react-hooks
   Title: How to use React hooks?
   Environment: unknown

   Current Project: E-commerce App

   Recent Session Context:
   - localhost:3000 (E-commerce App)
   - github.com/user/ecommerce (E-commerce App - GitHub)
   - stackoverflow.com/questions/react-hooks (How to use React hooks?)

   Known Categories:
   - development: github.com, stackoverflow.com, ...
   - finance: ally.com, coinbase.com, ...
   ...

   Categorize this URL.
   """

10. AI Response:
    {
      category: "development",
      subcategory: "documentation",
      confidence: 0.95,
      reasoning: "Stack Overflow documentation URL in same session as E-commerce project"
    }

11. URL saved to:
    Project: E-commerce App
    Category: development → documentation
```

#### **Step 3: Deployment URL**
```
12. You open: my-ecommerce.vercel.app
13. Environment Detector:
    - Hostname ends with .vercel.app → Production
14. Project Detector:
    - Searches for project with similar name
    - Finds "E-commerce App" project
    - Auto-adds URL to project.environments.production
15. Auto-switches active project (already E-commerce App)
```

#### **Step 4: New Project Switch**
```
16. You switch to: localhost:8080 (Blog Platform)
17. Session Tracker: Detects new localhost port
18. Project Detector:
    - No existing project matches localhost:8080
    - Waits for more context...
19. You open: github.com/user/blog
20. Project Detector analyzes:
    - localhost:8080 + github.com/user/blog in same session
    - Extracts project name: "Blog"
21. Shows popup: "New project detected: Blog"
22. You confirm → "Blog Platform" project created
23. Auto-switches active project to "Blog Platform"
```

---

## 🎨 UI Components (To Be Built)

### 1. Project Indicator (Header/VerticalHeader)
```jsx
<div className="project-indicator">
  <span className="project-icon" style={{ color: project.color }}>⚡</span>
  <span className="project-name">{activeProject.name}</span>
  <span className="environment-badge">{environment}</span>
  <button onClick={showProjectSwitcher}>▼</button>
</div>
```

**Position**: Above workspace selector in Header.jsx / VerticalHeader.jsx

### 2. Project Discovery Dialog
```jsx
<Dialog open={pendingProjectDiscovery}>
  <h3>🎯 New Project Detected</h3>
  <p>From your tabs: localhost:3000 + github.com/user/my-app</p>
  <input
    defaultValue="My App"
    placeholder="Project name"
  />
  <button onClick={confirmProject}>Create Project</button>
  <button onClick={rejectProject}>Ignore</button>
</Dialog>
```

### 3. Settings Page Integration
```jsx
<SettingsSection title="Session Tracking">
  <Toggle
    label="Enable smart project detection"
    checked={sessionTrackingEnabled}
    onChange={toggleSessionTracking}
  />
  <p>Monitor tabs to automatically detect projects and categorize URLs</p>
</SettingsSection>
```

---

## 🔌 API Usage

### From React Components

```javascript
// Get current project context
const { session, activeProject, allProjects } = await chrome.runtime.sendMessage({
  action: 'getProjectContext'
});

// Create new project
const { project } = await chrome.runtime.sendMessage({
  action: 'createProject',
  name: 'My New Project',
  urlPatterns: ['localhost:3000', 'github.com/user/my-project']
});

// Categorize URL
const { result } = await chrome.runtime.sendMessage({
  action: 'categorizeUrl',
  url: 'https://example.com',
  title: 'Example Page',
  apiKey: geminiApiKey  // Optional, uses stored key if not provided
});

// Switch active project
await chrome.runtime.sendMessage({
  action: 'setActiveProject',
  projectId: 'proj_my_app_123'
});

// Toggle session tracking
await chrome.runtime.sendMessage({
  action: 'toggleSessionTracking',
  enabled: true
});
```

### From Background Scripts

```javascript
import { sessionTracker } from '../ml/sessionTracker.js';
import { projectDetector } from '../ml/projectDetector.js';
import { categorizer } from '../ml/categorizer.js';

// Direct access to singletons
const session = sessionTracker.getCurrentSession();
const project = projectDetector.getActiveProject();
const category = await categorizer.categorize(url, title);
```

---

## 📊 Data Storage

### Chrome Storage Structure

```javascript
{
  // Session Tracking
  sessionTracking: {
    enabled: true,
    currentSession: { /* Session object */ },
    history: [ /* Past sessions */ ],
    lastUpdate: 1704153600000
  },

  // Projects
  projects: {
    "proj_ecommerce_app_123": { /* Project object */ },
    "proj_blog_platform_456": { /* Project object */ },
    ...
  },
  activeProjectId: "proj_ecommerce_app_123",

  // Custom Categories
  customCategories: ["machine-learning", "devops"],
  customCategoryDomains: {
    "machine-learning": ["kaggle.com", "paperswithcode.com"],
    "devops": ["kubernetes.io", "docker.com"]
  },

  // Existing Gemini API key (already present)
  geminiApiKey: "YOUR_API_KEY"
}
```

---

## 🔧 Configuration

### Default Settings

```javascript
// Session timeout
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

// Project detection interval
const CHECK_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

// Cache TTL
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Confidence thresholds
const AUTO_CREATE_CATEGORY_THRESHOLD = 0.8; // 80% confidence
const AUTO_SWITCH_PROJECT_THRESHOLD = 0.7;  // 70% confidence
```

---

## 🎯 Next Steps

### Phase 1: UI Components (Current)
- [ ] Add project indicator to Header/VerticalHeader
- [ ] Create ProjectDiscoveryDialog component
- [ ] Add session tracking toggle to Settings

### Phase 2: Integration
- [ ] Integrate categorization with Daily Notes save flow
- [ ] Update GenericUrlParser.js to use categorizer
- [ ] Add project context to workspace URLs

### Phase 3: Polish
- [ ] Add project management UI (create, edit, delete)
- [ ] Project color picker
- [ ] Category management UI
- [ ] Export/import projects

---

## 🐛 Troubleshooting

### "Session tracking not working"
**Check:**
1. Is it enabled? `chrome.storage.local.get(['sessionTracking'])`
2. Check console for initialization errors: `[ProjectContext] Initialized`
3. Verify tab listeners are set up

### "Projects not auto-switching"
**Check:**
1. Active project URL patterns match current URL
2. Session has recent activity (< 30 min ago)
3. Console logs: `[ProjectContext] Auto-switched to project`

### "AI categorization failing"
**Check:**
1. Gemini API key is set in settings
2. API key is valid (test with existing AI features)
3. Check network tab for API errors
4. Fallback: `quickCategorize()` should still work using domain matching

### "Categories not being created"
**Check:**
1. AI confidence is >= 0.8 for auto-create
2. Check `customCategories` in storage
3. Manually create via settings if needed

---

## 📚 File Reference

**Core ML Services:**
- [src/ml/sessionTracker.js](src/ml/sessionTracker.js) - Browser session monitoring
- [src/ml/projectDetector.js](src/ml/projectDetector.js) - Project pattern detection
- [src/ml/categorizer.js](src/ml/categorizer.js) - AI categorization engine

**Background Services:**
- [src/background/projectContext.js](src/background/projectContext.js) - Main background orchestrator
- [src/background/background.js](src/background/background.js) - Integration point

**Data:**
- [src/data/appstore.json](src/data/appstore.json) - Category knowledge base (1500+ domains)

**Existing AI Integration:**
- [src/background/ai.js](src/background/ai.js) - Gemini API wrapper

---

## 💡 Example Use Cases

### 1. Full-Stack Developer
```
Projects:
- "E-commerce Frontend" (localhost:3000, github.com/user/frontend)
- "E-commerce Backend" (localhost:8000, github.com/user/backend)
- "Admin Dashboard" (localhost:5173, admin.mysite.com)

Auto-categorization:
- stackoverflow.com → "development/documentation" (active project context)
- react.dev → "development/documentation"
- localhost:3000 → "E-commerce Frontend/dev"
- admin.mysite.com → "Admin Dashboard/production"
```

### 2. Researcher
```
Projects:
- "ML Paper Review" (arxiv.org, paperswithcode.com)
- "Dataset Analysis" (kaggle.com, localhost:8888/notebooks)

Auto-categorization:
- arxiv.org/abs/2301.12345 → "ML Paper Review/education"
- localhost:8888/notebooks → "Dataset Analysis/dev"
```

### 3. Multi-Client Freelancer
```
Projects:
- "Client A Website" (clienta.com, localhost:3000)
- "Client B App" (clientb.com, localhost:3001)

Auto-categorization:
- Switches project based on localhost port
- Associates research URLs with active client project
```

---

## 🎉 Success!

You now have an intelligent URL auto-categorization system that:
✅ Tracks your browsing sessions
✅ Detects projects automatically
✅ Categorizes URLs using AI + context
✅ Handles unlimited projects
✅ Detects dev/staging/production environments
✅ Auto-switches projects as you work
✅ Creates categories on demand

**Build and test:**
```bash
npm run build
# Load extension in Chrome
# Open console and check for: [ProjectContext] Initialized successfully
```
