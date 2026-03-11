/**
 * Task Manager - Core logic for Task-First Tab Modeling
 *
 * Rules:
 * 1. Opener Rule: Child tabs join parent's task
 * 2. Time Window Rule: New task if >5min since last activity
 * 3. Active Task Tracking: Track current task for continuity
 * 4. Window Agnostic: Window switches don't affect task assignment
 */

// ==========================================
// CONSTANTS
// ==========================================

const TASK_TIME_WINDOW_MS = 5 * 60 * 1000;  // 5 minutes
const TASK_STORAGE_KEY = 'cooldesk_tasks';
const TASK_STATE_KEY = 'cooldesk_task_state';
const TASK_COLORS = ['blue', 'green', 'orange', 'purple', 'pink', 'cyan', 'red', 'yellow'];

// ==========================================
// STATE
// ==========================================

let tasks = new Map();           // taskId -> Task object
let tabToTask = new Map();       // tabId -> taskId
let activeTaskId = null;
let lastActiveTime = Date.now();
let initialized = false;

// ==========================================
// PERSISTENCE
// ==========================================

async function loadState() {
  try {
    const result = await chrome.storage.local.get([TASK_STORAGE_KEY, TASK_STATE_KEY]);

    if (result[TASK_STORAGE_KEY]) {
      const storedTasks = result[TASK_STORAGE_KEY];
      tasks = new Map(Object.entries(storedTasks));

      // Rebuild tabToTask index
      tabToTask.clear();
      for (const [taskId, task] of tasks) {
        for (const tabId of task.tabIds) {
          tabToTask.set(tabId, taskId);
        }
      }
    }

    if (result[TASK_STATE_KEY]) {
      activeTaskId = result[TASK_STATE_KEY].activeTaskId;
      lastActiveTime = result[TASK_STATE_KEY].lastActiveTime || Date.now();
    }

    console.log('[TaskManager] Loaded state:', tasks.size, 'tasks');
  } catch (e) {
    console.error('[TaskManager] Error loading state:', e);
  }
}

async function saveState() {
  try {
    // Convert Map to plain object for storage
    const tasksObj = Object.fromEntries(tasks);

    await chrome.storage.local.set({
      [TASK_STORAGE_KEY]: tasksObj,
      [TASK_STATE_KEY]: {
        activeTaskId,
        lastActiveTime
      }
    });
  } catch (e) {
    console.error('[TaskManager] Error saving state:', e);
  }
}

// Debounced save to reduce storage writes
let saveTimeout = null;
function scheduleSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => saveState(), 1000);
}

// ==========================================
// HELPERS
// ==========================================

function generateTaskId() {
  return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function generateColorIndex(taskId) {
  // Hash task ID to get consistent color
  let hash = 0;
  for (let i = 0; i < taskId.length; i++) {
    hash = ((hash << 5) - hash) + taskId.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash) % TASK_COLORS.length;
}

function extractDomainName(url) {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace('www.', '').split('.')[0];
  } catch {
    return null;
  }
}

function isSystemUrl(url) {
  if (!url) return true;
  return url.startsWith('chrome://') ||
         url.startsWith('chrome-extension://') ||
         url.startsWith('about:') ||
         url.startsWith('edge://') ||
         url === 'about:blank';
}

// ==========================================
// TASK CREATION
// ==========================================

async function createTask(rootTabId, initialName = null) {
  const taskId = generateTaskId();

  // Get tab info for fallback name
  let fallbackName = 'New Task';
  try {
    const tab = await chrome.tabs.get(rootTabId);
    fallbackName = tab.title || extractDomainName(tab.url) || 'New Task';
    // Truncate long titles
    if (fallbackName.length > 50) {
      fallbackName = fallbackName.substring(0, 47) + '...';
    }
  } catch (e) {
    console.warn('[TaskManager] Could not get tab info for fallback name:', e);
  }

  const task = {
    id: taskId,
    name: initialName || fallbackName,
    rootTabId,
    tabIds: [rootTabId],
    startTime: Date.now(),
    lastUpdated: Date.now(),
    colorIndex: generateColorIndex(taskId),
    aiNamed: false
  };

  tasks.set(taskId, task);
  tabToTask.set(rootTabId, taskId);
  activeTaskId = taskId;
  lastActiveTime = Date.now();

  scheduleSave();
  broadcastUpdate();

  console.log('[TaskManager] Created task:', taskId, 'with name:', task.name);
  return task;
}

// ==========================================
// TAB ASSIGNMENT LOGIC
// ==========================================

async function assignTabToTask(tabId, openerTabId = null) {
  if (!initialized) await initialize();

  // Skip system URLs
  try {
    const tab = await chrome.tabs.get(tabId);
    if (isSystemUrl(tab.url)) {
      console.log('[TaskManager] Skipping system URL:', tab.url);
      return null;
    }
  } catch {
    // Tab might not exist anymore
    return null;
  }

  // Check if tab is already assigned
  if (tabToTask.has(tabId)) {
    return tasks.get(tabToTask.get(tabId));
  }

  const now = Date.now();
  let targetTaskId = null;

  // Rule 1: Opener Rule (Ancestry)
  if (openerTabId && tabToTask.has(openerTabId)) {
    targetTaskId = tabToTask.get(openerTabId);
    console.log(`[TaskManager] Tab ${tabId} joins parent's task via opener ${openerTabId}`);
  }
  // Rule 2: Time Window Rule
  else if (activeTaskId && tasks.has(activeTaskId) && (now - lastActiveTime) <= TASK_TIME_WINDOW_MS) {
    targetTaskId = activeTaskId;
    console.log(`[TaskManager] Tab ${tabId} joins active task (within 5min window)`);
  }
  // Rule 3: Create New Task
  else {
    const task = await createTask(tabId);
    console.log(`[TaskManager] Tab ${tabId} created new task: ${task.id}`);
    return task;
  }

  // Add tab to existing task
  const task = tasks.get(targetTaskId);
  if (task && !task.tabIds.includes(tabId)) {
    task.tabIds.push(tabId);
    task.lastUpdated = now;
    tabToTask.set(tabId, targetTaskId);
    scheduleSave();
    broadcastUpdate();
  }

  return task;
}

// ==========================================
// TAB LIFECYCLE HANDLERS
// ==========================================

async function handleTabCreated(tab) {
  if (!initialized) await initialize();

  // Skip system URLs
  if (isSystemUrl(tab.url || tab.pendingUrl)) {
    return;
  }

  await assignTabToTask(tab.id, tab.openerTabId || null);
}

async function handleTabActivated(tabId) {
  if (!initialized) await initialize();

  const taskId = tabToTask.get(tabId);
  if (taskId && tasks.has(taskId)) {
    activeTaskId = taskId;
    lastActiveTime = Date.now();

    const task = tasks.get(taskId);
    if (task) {
      task.lastUpdated = Date.now();
    }

    scheduleSave();
    // Don't broadcast on every activation to reduce noise
  }
}

async function handleTabRemoved(tabId) {
  if (!initialized) await initialize();

  const taskId = tabToTask.get(tabId);
  if (!taskId) return;

  tabToTask.delete(tabId);

  const task = tasks.get(taskId);
  if (task) {
    task.tabIds = task.tabIds.filter(id => id !== tabId);

    // If task has no more tabs, remove it
    if (task.tabIds.length === 0) {
      tasks.delete(taskId);
      console.log('[TaskManager] Removed empty task:', taskId);
      if (activeTaskId === taskId) {
        activeTaskId = null;
      }
    }
  }

  scheduleSave();
  broadcastUpdate();
}

async function handleTabUpdated(tabId, changeInfo, tab) {
  if (!initialized) await initialize();

  // If URL changed from system URL to regular URL, assign to task
  if (changeInfo.url && !isSystemUrl(changeInfo.url) && !tabToTask.has(tabId)) {
    await assignTabToTask(tabId, tab.openerTabId || null);
  }
}

// ==========================================
// TASK OPERATIONS
// ==========================================

async function renameTask(taskId, newName) {
  const task = tasks.get(taskId);
  if (task) {
    task.name = newName;
    task.lastUpdated = Date.now();
    scheduleSave();
    broadcastUpdate();
    console.log('[TaskManager] Renamed task:', taskId, 'to:', newName);
    return true;
  }
  return false;
}

async function setTaskAiNamed(taskId, aiNamed = true) {
  const task = tasks.get(taskId);
  if (task) {
    task.aiNamed = aiNamed;
    scheduleSave();
    return true;
  }
  return false;
}

async function mergeTasksInto(sourceTaskId, targetTaskId) {
  const sourceTask = tasks.get(sourceTaskId);
  const targetTask = tasks.get(targetTaskId);

  if (!sourceTask || !targetTask) return false;

  // Move all tabs from source to target
  for (const tabId of sourceTask.tabIds) {
    if (!targetTask.tabIds.includes(tabId)) {
      targetTask.tabIds.push(tabId);
    }
    tabToTask.set(tabId, targetTaskId);
  }

  targetTask.lastUpdated = Date.now();
  tasks.delete(sourceTaskId);

  if (activeTaskId === sourceTaskId) {
    activeTaskId = targetTaskId;
  }

  scheduleSave();
  broadcastUpdate();
  console.log('[TaskManager] Merged task', sourceTaskId, 'into', targetTaskId);
  return true;
}

async function moveTabToTask(tabId, targetTaskId) {
  const currentTaskId = tabToTask.get(tabId);
  if (currentTaskId === targetTaskId) return false;

  // Remove from current task
  if (currentTaskId) {
    const currentTask = tasks.get(currentTaskId);
    if (currentTask) {
      currentTask.tabIds = currentTask.tabIds.filter(id => id !== tabId);
      if (currentTask.tabIds.length === 0) {
        tasks.delete(currentTaskId);
        console.log('[TaskManager] Removed empty task:', currentTaskId);
      }
    }
  }

  // Add to target task
  const targetTask = tasks.get(targetTaskId);
  if (targetTask) {
    if (!targetTask.tabIds.includes(tabId)) {
      targetTask.tabIds.push(tabId);
    }
    targetTask.lastUpdated = Date.now();
    tabToTask.set(tabId, targetTaskId);
  }

  scheduleSave();
  broadcastUpdate();
  return true;
}

// ==========================================
// QUERY API
// ==========================================

function getAllTasks() {
  const allTasks = Array.from(tasks.values());
  console.log('[TaskManager] getAllTasks() returning', allTasks.length, 'tasks');
  return allTasks;
}

function getTaskById(taskId) {
  return tasks.get(taskId) || null;
}

function getTaskForTab(tabId) {
  const taskId = tabToTask.get(tabId);
  return taskId ? tasks.get(taskId) : null;
}

function getActiveTask() {
  return activeTaskId ? tasks.get(activeTaskId) : null;
}

function getActiveTaskId() {
  return activeTaskId;
}

// ==========================================
// UI COMMUNICATION
// ==========================================

function broadcastUpdate() {
  const payload = {
    type: 'TASKS_UPDATED',
    tasks: getAllTasks(),
    activeTaskId
  };

  // Notify UI components via BroadcastChannel
  try {
    const bc = new BroadcastChannel('cooldesk_tasks');
    bc.postMessage({
      type: 'tasksChanged',
      tasks: getAllTasks(),
      activeTaskId
    });
    bc.close();
  } catch (e) {
    // BroadcastChannel may not be available in all contexts
  }

  // Also send via chrome.runtime for popup/side panel
  try {
    chrome.runtime.sendMessage(payload).catch(() => {});
  } catch {
    // Ignore errors if no listeners
  }
}

// ==========================================
// INITIALIZATION
// ==========================================

async function initialize() {
  if (initialized) {
    console.log('[TaskManager] Already initialized, skipping');
    return;
  }

  console.log('[TaskManager] Starting initialization...');
  await loadState();
  initialized = true;

  // Validate existing tasks against actual tabs
  try {
    const currentTabs = await chrome.tabs.query({});
    console.log('[TaskManager] Found', currentTabs.length, 'current tabs');
    const validTabIds = new Set(currentTabs.map(t => t.id));

    // Clean up stale tab references
    for (const [taskId, task] of tasks) {
      task.tabIds = task.tabIds.filter(id => validTabIds.has(id));
      if (task.tabIds.length === 0) {
        tasks.delete(taskId);
        console.log('[TaskManager] Removed stale task:', taskId);
      }
    }

    // Rebuild tabToTask
    tabToTask.clear();
    for (const [taskId, task] of tasks) {
      for (const tabId of task.tabIds) {
        tabToTask.set(tabId, taskId);
      }
    }

    // Assign orphan tabs to tasks
    // Sort tabs by index to maintain some logical order
    const orphanTabs = currentTabs
      .filter(tab => !tabToTask.has(tab.id) && !isSystemUrl(tab.url))
      .sort((a, b) => (a.index || 0) - (b.index || 0));

    console.log('[TaskManager] Found', orphanTabs.length, 'orphan tabs to assign');

    if (orphanTabs.length > 0) {
      // Group orphan tabs by window for initial assignment
      const tabsByWindow = {};
      for (const tab of orphanTabs) {
        const winId = tab.windowId || 0;
        if (!tabsByWindow[winId]) tabsByWindow[winId] = [];
        tabsByWindow[winId].push(tab);
      }

      // For each window, create one task for all its orphan tabs
      for (const [windowId, windowTabs] of Object.entries(tabsByWindow)) {
        if (windowTabs.length === 0) continue;

        // Use the active tab or first tab as the root
        const activeTab = windowTabs.find(t => t.active) || windowTabs[0];
        const task = await createTask(activeTab.id);

        // Add remaining tabs to this task
        for (const tab of windowTabs) {
          if (tab.id !== activeTab.id && !tabToTask.has(tab.id)) {
            task.tabIds.push(tab.id);
            tabToTask.set(tab.id, task.id);
          }
        }

        console.log(`[TaskManager] Created initial task for window ${windowId} with ${task.tabIds.length} tabs`);
      }
    }

    scheduleSave();
    console.log('[TaskManager] Initialized with', tasks.size, 'tasks');

    // Broadcast initial state to UI
    broadcastUpdate();
  } catch (e) {
    console.error('[TaskManager] Error during initialization:', e);
  }
}

// ==========================================
// EXPORTS
// ==========================================

export {
  // Initialization
  initialize,

  // Tab lifecycle handlers
  handleTabCreated,
  handleTabActivated,
  handleTabRemoved,
  handleTabUpdated,

  // Task assignment
  assignTabToTask,
  createTask,

  // Task operations
  renameTask,
  setTaskAiNamed,
  mergeTasksInto,
  moveTabToTask,

  // Query API
  getAllTasks,
  getTaskById,
  getTaskForTab,
  getActiveTask,
  getActiveTaskId,

  // Persistence
  loadState,
  saveState,

  // Constants
  TASK_COLORS
};
