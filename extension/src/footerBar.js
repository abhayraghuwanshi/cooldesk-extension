// Sider.ai-style Floating Button for Cool-Desk
export function injectFooterBar() {
  try {
    const FLAG_ID = 'cooldesk-floating-button';
    if (document.getElementById(FLAG_ID)) return; // already injected

    // Host + Shadow DOM
    const host = document.createElement('div');
    host.id = FLAG_ID;
    (document.documentElement || document.body).appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });

    // Styles
    const style = document.createElement('style');
    style.textContent = `
      :host, * { 
        all: revert; 
        box-sizing: border-box;
      }

      /* Floating Button Container */
      .floating-container {
        position: fixed;
        top: 50%;
        right: 20px;
        transform: translateY(-50%);
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }

      /* Main Toggle Button */
      .toggle-btn {
        width: 56px;
        height: 56px;
        border-radius: 16px;
        border: none;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 8px 24px rgba(102, 126, 234, 0.3);
        transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        position: relative;
        overflow: hidden;
      }

      .toggle-btn:hover {
        transform: translateY(-2px) scale(1.05);
        box-shadow: 0 12px 32px rgba(102, 126, 234, 0.4);
        background: linear-gradient(135deg, #7c94f0 0%, #8b5fbf 100%);
      }

      .toggle-btn:active {
        transform: translateY(-1px) scale(1.02);
        box-shadow: 0 6px 20px rgba(102, 126, 234, 0.35);
      }

      /* Icon */
      .btn-icon {
        width: 24px;
        height: 24px;
        transition: transform 0.3s ease;
      }

      .toggle-btn:hover .btn-icon {
        transform: rotate(10deg) scale(1.1);
      }

      /* Hover tooltip */
      .tooltip {
        position: absolute;
        right: 70px;
        top: 50%;
        transform: translateY(-50%);
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 8px 12px;
        border-radius: 8px;
        font-size: 14px;
        white-space: nowrap;
        opacity: 0;
        visibility: hidden;
        transition: all 0.3s ease;
        backdrop-filter: blur(10px);
        pointer-events: none;
      }

      .tooltip::after {
        content: '';
        position: absolute;
        left: 100%;
        top: 50%;
        transform: translateY(-50%);
        border: 6px solid transparent;
        border-left-color: rgba(0, 0, 0, 0.8);
      }

      .floating-container:hover .tooltip {
        opacity: 1;
        visibility: visible;
        transform: translateY(-50%) translateX(-8px);
      }

      /* Pulse animation on first load */
      @keyframes pulse {
        0% { box-shadow: 0 8px 24px rgba(102, 126, 234, 0.3); }
        50% { box-shadow: 0 8px 24px rgba(102, 126, 234, 0.6); }
        100% { box-shadow: 0 8px 24px rgba(102, 126, 234, 0.3); }
      }

      .toggle-btn.pulse {
        animation: pulse 2s ease-in-out 3;
      }
    `;

    // Create the floating button structure
    const container = document.createElement('div');
    container.className = 'floating-container';

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'toggle-btn pulse';
    toggleBtn.setAttribute('aria-label', 'Open CoolDesk sidebar');

    // Brain/AI icon SVG
    toggleBtn.innerHTML = `
      <svg class="btn-icon" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12,2A3,3 0 0,1 15,5V7A3,3 0 0,1 18,10V12A3,3 0 0,1 15,15V17A3,3 0 0,1 12,20A3,3 0 0,1 9,17V15A3,3 0 0,1 6,12V10A3,3 0 0,1 9,7V5A3,3 0 0,1 12,2M12,4A1,1 0 0,0 11,5V7.41A3,3 0 0,1 9,10V12A1,1 0 0,0 8,12V10A1,1 0 0,0 7,10V12A3,3 0 0,1 9,15V17A1,1 0 0,0 11,17V15.59A3,3 0 0,1 13,12V10A1,1 0 0,0 14,10V12A1,1 0 0,0 15,12V10A3,3 0 0,1 13,7.41V5A1,1 0 0,0 12,4Z"/>
      </svg>
    `;

    const tooltip = document.createElement('div');
    tooltip.className = 'tooltip';
    tooltip.textContent = 'Open CoolDesk';

    container.appendChild(toggleBtn);
    container.appendChild(tooltip);

    // Add elements to shadow DOM
    shadow.appendChild(style);
    shadow.appendChild(container);

    // Remove pulse animation after initial display
    setTimeout(() => {
      toggleBtn.classList.remove('pulse');
    }, 6000);

    // Helper: show notification to user
    const showNotification = (message, color = '#4A90E2', duration = 5000) => {
      const notification = document.createElement('div');
      notification.style.cssText = `
        position: fixed; 
        top: 20px; 
        right: 20px; 
        z-index: 2147483647;
        background: ${color}; 
        color: white; 
        padding: 12px 20px; 
        border-radius: 8px; 
        font-family: system-ui; 
        font-size: 14px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        max-width: 350px;
        word-wrap: break-word;
      `;
      notification.textContent = message;
      document.body.appendChild(notification);

      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, duration);
    };

    // Helper: open extension side panel
    const openSidePanel = async () => {
      console.log('[CoolDesk Button] Attempting to open side panel...');

      // Check if extension context is still valid
      if (!chrome?.runtime?.id) {
        console.warn('[CoolDesk Button] Extension context invalidated, cannot communicate with background');
        // Direct fallback to opening extension page
        try {
          const extensionUrl = `chrome-extension://${chrome.runtime.id || 'unknown'}/index.html`;

          window.open(extensionUrl, '_blank');
        } catch (e) {
          console.error('[CoolDesk Button] Failed to open extension directly:', e);
          alert('Extension needs to be reloaded. Please refresh the page and try again.');
        }
        return;
      }

      try {
        // Send message immediately in the user gesture context
        // This preserves the user gesture for the background script
        console.log('[CoolDesk Button] Sending openSidePanel message with user gesture...');

        const response = await new Promise((resolve) => {
          chrome.runtime.sendMessage({
            type: 'openSidePanel',
            timestamp: Date.now(),
            fromUserGesture: true
          }, resolve);
        });

        // Check for context invalidation error specifically
        if (chrome.runtime.lastError) {
          const error = chrome.runtime.lastError.message || chrome.runtime.lastError;
          console.warn('[CoolDesk Button] Runtime error:', error);

          if (error.includes('context invalidated') || error.includes('Extension context')) {
            console.log('[CoolDesk Button] Extension context lost, requesting page reload');
            showNotification('Extension disconnected. Please refresh the page to reconnect.', '#ff4444');
            return;
          }

          console.log('[CoolDesk Button] Falling back to tab...');
          // Fallback to tab for other errors
          try {
            window.open(chrome.runtime.getURL('index.html'), '_blank');
          } catch (e) {
            console.error('[CoolDesk Button] Failed to open fallback tab:', e);
          }
          return;
        }

        console.log('[CoolDesk Button] Background response:', response);

        const ok = response && response.ok !== false;
        if (!ok) {
          console.log('[CoolDesk Button] Side panel failed, opening tab instead');
          console.log('[CoolDesk Button] Error was:', response?.error);

          // Show helpful message about proper side panel usage
          if (response?.message) {
            showNotification(response.message, '#4A90E2', 8000);
          }

          // Fallback to opening the extension UI in a tab
          try {
            window.open(chrome.runtime.getURL('index.html'), '_blank');
          } catch (e) {
            console.error('[CoolDesk Button] Failed to open fallback tab:', e);
          }
        } else {
          console.log('[CoolDesk Button] Request processed successfully');
        }
      } catch (e) {
        console.error('[CoolDesk Button] Error in openSidePanel:', e);
        console.log('[CoolDesk Button] Direct fallback to tab...');
        try {
          window.open(chrome.runtime.getURL('index.html'), '_blank');
        } catch (e2) {
          console.error('[CoolDesk Button] Failed to open fallback tab:', e2);
        }
      }
    };

    // Click handler
    toggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Visual feedback
      toggleBtn.style.transform = 'translateY(-1px) scale(0.95)';
      setTimeout(() => {
        toggleBtn.style.transform = '';
      }, 150);

      openSidePanel();
    });

    // Prevent the button from interfering with page interactions
    container.addEventListener('mousedown', (e) => e.stopPropagation());
    container.addEventListener('mouseup', (e) => e.stopPropagation());

  } catch (e) {
    console.error('Error injecting CoolDesk floating button:', e);
  }
}

export default injectFooterBar;
