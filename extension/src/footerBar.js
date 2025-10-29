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
        right: 0px;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        cursor: move;
        user-select: none;
        transition: transform 0.2s ease;
        transform: translateY(-50%);
      }

      .floating-container.dragging {
        transform: translateY(-50%) scale(1.1);
        opacity: 0.8;
      }

      /* Main Toggle Button - Right Side Curved Style */
      .toggle-btn {
        width: 60px;
        height: 60px;
        border-radius: 30px 0 0 30px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-right: none;
        background: rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(20px);
        color: white;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: -2px 0 16px rgba(0, 0, 0, 0.1);
        transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        position: relative;
        overflow: hidden;
        padding-right: 8px;
      }

      .toggle-btn:hover {
        transform: translateX(-4px) scale(1.05);
        box-shadow: -4px 0 24px rgba(0, 0, 0, 0.15);
        background: rgba(255, 255, 255, 0.15);
        border-color: rgba(255, 255, 255, 0.3);
      }

      .toggle-btn:active {
        transform: translateX(-2px) scale(1.02);
        box-shadow: -2px 0 12px rgba(0, 0, 0, 0.1);
      }

      /* Icon */
      .btn-icon {
        width: 24px;
        height: 24px;
        transition: transform 0.3s ease;
      }

      .toggle-btn:hover .btn-icon {
        transform: scale(1.1);
      }

      .toggle-btn:hover img.btn-icon {
        filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.4)) brightness(1.1);
      }

      .toggle-btn:hover svg.btn-icon {
        filter: brightness(1.2);
      }

      /* Hover tooltip */
      .tooltip {
        position: absolute;
        right: 80px;
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
        0% {
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
          border-color: rgba(255, 255, 255, 0.2);
        }
        50% {
          box-shadow: 0 8px 24px rgba(255, 255, 255, 0.2);
          border-color: rgba(255, 255, 255, 0.4);
        }
        100% {
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
          border-color: rgba(255, 255, 255, 0.2);
        }
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

    // Logo image with error fallback
    const logoImg = document.createElement('img');
    logoImg.className = 'btn-icon';
    logoImg.alt = 'CoolDesk Logo';
    logoImg.style.cssText = `
      width: 60px;
      height: 60px;
      border-radius: 6px;
      object-fit: contain;
      filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
    `;

    // Try to load the logo, fallback to SVG if it fails
    try {
      logoImg.src = chrome.runtime.getURL('logo-2.png');

      // Add error handler for fallback
      logoImg.onerror = () => {
        console.log('[CoolDesk] Logo failed to load, using fallback icon');
        // Create fallback SVG icon
        toggleBtn.innerHTML = `
          <svg class="btn-icon" viewBox="0 0 24 24" fill="currentColor" style="width: 24px; height: 24px;">
            <path d="M12,2A2,2 0 0,1 14,4C14,4.74 13.6,5.39 13,5.73V7A1,1 0 0,0 14,8H16A1,1 0 0,0 17,7V5.73C16.4,5.39 16,4.74 16,4A2,2 0 0,1 18,2A2,2 0 0,1 20,4C20,4.74 19.6,5.39 19,5.73V7A3,3 0 0,1 16,10V10.5A1.5,1.5 0 0,0 17.5,12A1.5,1.5 0 0,0 19,10.5A1.5,1.5 0 0,1 20.5,9A1.5,1.5 0 0,1 22,10.5C22,11.38 21.47,12.13 20.66,12.43C20.88,13.07 21,13.76 21,14.5C21,16.06 20.33,17.45 19.24,18.39L17.12,19.95A3,3 0 0,1 14.5,20.5H9.5A3,3 0 0,1 6.88,19.95L4.76,18.39C3.67,17.45 3,16.06 3,14.5C3,13.76 3.12,13.07 3.34,12.43C2.53,12.13 2,11.38 2,10.5A1.5,1.5 0 0,1 3.5,9A1.5,1.5 0 0,1 5,10.5A1.5,1.5 0 0,0 6.5,12A1.5,1.5 0 0,0 8,10.5V10A3,3 0 0,1 5,7V5.73C4.4,5.39 4,4.74 4,4A2,2 0 0,1 6,2A2,2 0 0,1 8,4C8,4.74 7.6,5.39 7,5.73V7A1,1 0 0,0 8,8H10A1,1 0 0,0 11,7V5.73C10.4,5.39 10,4.74 10,4A2,2 0 0,1 12,2Z"/>
          </svg>
        `;
      };
    } catch (e) {
      console.error('[CoolDesk] Error setting up logo:', e);
      // Fallback icon
      toggleBtn.innerHTML = `
        <svg class="btn-icon" viewBox="0 0 24 24" fill="currentColor" style="width: 24px; height: 24px;">
          <path d="M12,2A2,2 0 0,1 14,4C14,4.74 13.6,5.39 13,5.73V7A1,1 0 0,0 14,8H16A1,1 0 0,0 17,7V5.73C16.4,5.39 16,4.74 16,4A2,2 0 0,1 18,2A2,2 0 0,1 20,4C20,4.74 19.6,5.39 19,5.73V7A3,3 0 0,1 16,10V10.5A1.5,1.5 0 0,0 17.5,12A1.5,1.5 0 0,0 19,10.5A1.5,1.5 0 0,1 20.5,9A1.5,1.5 0 0,1 22,10.5C22,11.38 21.47,12.13 20.66,12.43C20.88,13.07 21,13.76 21,14.5C21,16.06 20.33,17.45 19.24,18.39L17.12,19.95A3,3 0 0,1 14.5,20.5H9.5A3,3 0 0,1 6.88,19.95L4.76,18.39C3.67,17.45 3,16.06 3,14.5C3,13.76 3.12,13.07 3.34,12.43C2.53,12.13 2,11.38 2,10.5A1.5,1.5 0 0,1 3.5,9A1.5,1.5 0 0,1 5,10.5A1.5,1.5 0 0,0 6.5,12A1.5,1.5 0 0,0 8,10.5V10A3,3 0 0,1 5,7V5.73C4.4,5.39 4,4.74 4,4A2,2 0 0,1 6,2A2,2 0 0,1 8,4C8,4.74 7.6,5.39 7,5.73V7A1,1 0 0,0 8,8H10A1,1 0 0,0 11,7V5.73C10.4,5.39 10,4.74 10,4A2,2 0 0,1 12,2Z"/>
        </svg>
      `;
      return;
    }

    toggleBtn.appendChild(logoImg);

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
        // When context is invalidated, we cannot get the extension URL reliably
        alert('Extension disconnected. Please refresh the page to reconnect and use the extension.');
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
      toggleBtn.style.transform = 'translateX(-2px) scale(0.95)';
      setTimeout(() => {
        toggleBtn.style.transform = '';
      }, 150);

      openSidePanel();
    });

    // Drag functionality
    let isDragging = false;
    let startX, startY, startLeft, startTop;

    const handleMouseDown = (e) => {
      // Only start drag if not clicking the button itself
      if (e.target === toggleBtn || toggleBtn.contains(e.target)) {
        return;
      }

      isDragging = true;
      container.classList.add('dragging');

      startX = e.clientX;
      startY = e.clientY;

      const rect = container.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;

      e.preventDefault();
      e.stopPropagation();
    };

    const handleMouseMove = (e) => {
      if (!isDragging) return;

      const deltaY = e.clientY - startY;
      let newTop = startTop + deltaY;

      // Keep button within viewport bounds (vertical only)
      const buttonHeight = 60;
      const margin = 10;

      newTop = Math.max(margin, Math.min(window.innerHeight - buttonHeight - margin, newTop));

      container.style.top = newTop + 'px';
      container.style.right = '0px';
      container.style.transform = 'translateY(-50%)';

      e.preventDefault();
      e.stopPropagation();
    };

    const handleMouseUp = (e) => {
      if (!isDragging) return;

      isDragging = false;
      container.classList.remove('dragging');

      // Save vertical position to localStorage
      try {
        const rect = container.getBoundingClientRect();
        localStorage.setItem('cooldesk-button-position', JSON.stringify({
          top: rect.top
        }));
      } catch (e) {
        console.warn('Could not save button position:', e);
      }

      e.stopPropagation();
    };

    // Load saved vertical position
    try {
      const savedPosition = localStorage.getItem('cooldesk-button-position');
      if (savedPosition) {
        const data = JSON.parse(savedPosition);
        if (data.top !== undefined) {
          container.style.top = data.top + 'px';
          container.style.right = '0px';
          container.style.transform = 'translateY(-50%)';
        }
      }
    } catch (e) {
      console.warn('Could not load saved button position:', e);
    }

    // Add event listeners
    container.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    // Prevent the button from interfering with page interactions
    container.addEventListener('dragstart', (e) => e.preventDefault());

  } catch (e) {
    console.error('Error injecting CoolDesk floating button:', e);
  }
}

export default injectFooterBar;
