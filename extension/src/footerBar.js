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

      /* Loading state */
      .toggle-btn.loading {
        pointer-events: none;
        opacity: 0.8;
      }

      .toggle-btn.loading .btn-icon {
        animation: loading-spin 1s linear infinite;
      }

    // ... (existing styles) ...

      /* Add Note Button */
      .add-note-btn {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        margin-top: 10px;
        transition: all 0.2s ease;
        font-size: 20px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        margin-left: auto; /* Align to right like toggle btn */
        margin-right: 10px;
      }

      .add-note-btn:hover {
        background: rgba(16, 185, 129, 0.8); /* Green */
        transform: scale(1.1);
        border-color: rgba(16, 185, 129, 1);
      }
      
      .sticky-editor {
        animation: popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      }
      
      @keyframes popIn {
        from { transform: scale(0.8) rotate(-5deg); opacity: 0; }
        to { transform: scale(1) rotate(0deg); opacity: 1; }
      }
    `;

    // Create the floating button structure
    const container = document.createElement('div');
    container.className = 'floating-container';

    // Main Toggle Button
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
    container.appendChild(toggleBtn);

    // Add Note Button
    const addNoteBtn = document.createElement('button');
    addNoteBtn.className = 'add-note-btn';
    addNoteBtn.innerHTML = '+';
    addNoteBtn.title = 'Add Sticky Note';
    addNoteBtn.onclick = (e) => {
      e.stopPropagation(); // Don't drag
      spawnNewStickyNote();
    };
    // Prevent drag on this button too
    addNoteBtn.addEventListener('mousedown', (e) => e.stopPropagation());

    container.appendChild(addNoteBtn);

    // Tooltip
    const tooltip = document.createElement('div');
    tooltip.className = 'tooltip';
    tooltip.textContent = 'Open CoolDesk';
    container.appendChild(tooltip);

    // Spawn New Sticky Note
    const spawnNewStickyNote = () => {
      const stickyNote = document.createElement('div');
      stickyNote.className = 'cooldesk-sticky-note sticky-editor';

      const right = 300;
      const top = 100;

      stickyNote.style.cssText = `
          position: fixed;
          top: ${top}px;
          right: ${right}px;
          width: 220px;
          min-height: 180px;
          background: #fef08a;
          padding: 12px;
          border-radius: 4px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.2);
          z-index: 2147483646;
          display: flex;
          flex-direction: column;
          gap: 8px;
          font-family: sans-serif;
       `;

      const textarea = document.createElement('textarea');
      textarea.placeholder = 'Type your note here...';
      textarea.style.cssText = `
         flex: 1;
         background: transparent;
         border: none;
         outline: none;
         resize: none;
         font-family: 'Comic Sans MS', sans-serif;
         font-size: 14px;
         min-height: 100px;
       `;
      textarea.focus();

      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display: flex; gap: 8px; justify-content: flex-end; margin-top: auto;';

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.cssText = 'background: transparent; border: 1px solid #9ca3af; padding: 4px 8px; border-radius: 4px; cursor: pointer; color: #4b5563; font-size: 12px;';
      cancelBtn.onclick = () => stickyNote.remove();

      const saveBtn = document.createElement('button');
      saveBtn.textContent = 'Save';
      saveBtn.style.cssText = 'background: #10b981; border: none; padding: 4px 12px; border-radius: 4px; cursor: pointer; color: white; font-size: 12px; font-weight: bold;';
      saveBtn.onclick = async () => {
        const text = textarea.value.trim();
        if (!text) return;

        try {
          const note = {
            id: 'note_' + Date.now(),
            url: window.location.href,
            text: text,
            type: 'text',
            createdAt: Date.now()
          };

          await new Promise(resolve => {
            chrome.runtime.sendMessage({ action: 'saveUrlNote', note }, resolve);
          });

          stickyNote.remove();
          renderStickyNotes(); // Refresh to show the new saved note
          showNotification('Note saved!', '#10b981');
        } catch (e) {
          console.error('Failed to save note:', e);
          showNotification('Failed to save', '#ef4444');
        }
      };

      btnRow.appendChild(cancelBtn);
      btnRow.appendChild(saveBtn);

      stickyNote.appendChild(textarea);
      stickyNote.appendChild(btnRow);

      shadow.appendChild(stickyNote);

      // Focus
      setTimeout(() => textarea.focus(), 50);
    };

    // ... (rest of logic) ...

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
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        font-weight: 500;
        box-shadow: 0 4px 20px rgba(0,0,0,0.25), 0 2px 10px rgba(0,0,0,0.15);
        max-width: 350px;
        word-wrap: break-word;
        backdrop-filter: blur(10px);
        transform: translateX(100%);
        transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
        border: 1px solid rgba(255, 255, 255, 0.2);
      `;
      notification.textContent = message;
      document.body.appendChild(notification);

      // Animate in
      setTimeout(() => {
        notification.style.transform = 'translateX(0)';
      }, 10);

      setTimeout(() => {
        // Animate out
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
          if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
          }
        }, 300);
      }, duration - 300);
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
          showNotification('Runtime error, opening in new tab...', '#ff8c00', 4000);
          try {
            window.open(chrome.runtime.getURL('index.html'), '_blank');
            showNotification('CoolDesk opened in new tab', '#4CAF50', 3000);
          } catch (e) {
            console.error('[CoolDesk Button] Failed to open fallback tab:', e);
            showNotification('Failed to open CoolDesk. Please try again.', '#ff4444', 5000);
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
            showNotification(response.message, '#ff8c00', 8000);
          } else {
            showNotification('Side panel unavailable, opening in new tab...', '#ff8c00', 4000);
          }

          // Fallback to opening the extension UI in a tab
          try {
            window.open(chrome.runtime.getURL('index.html'), '_blank');
            showNotification('CoolDesk opened in new tab', '#4CAF50', 3000);
          } catch (e) {
            console.error('[CoolDesk Button] Failed to open fallback tab:', e);
            showNotification('Failed to open CoolDesk. Please try again.', '#ff4444', 5000);
          }
        } else {
          console.log('[CoolDesk Button] Request processed successfully');
          showNotification('CoolDesk side panel opened!', '#4CAF50', 2000);
        }
      } catch (e) {
        console.error('[CoolDesk Button] Error in openSidePanel:', e);
        console.log('[CoolDesk Button] Direct fallback to tab...');
        showNotification('Connection error, opening in new tab...', '#ff8c00', 4000);
        try {
          window.open(chrome.runtime.getURL('index.html'), '_blank');
          showNotification('CoolDesk opened in new tab', '#4CAF50', 3000);
        } catch (e2) {
          console.error('[CoolDesk Button] Failed to open fallback tab:', e2);
          showNotification('Failed to open CoolDesk. Please try refreshing the page.', '#ff4444', 5000);
        }
      }
    };

    // Click handler
    toggleBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Prevent double-clicks while processing
      if (toggleBtn.classList.contains('loading')) return;

      // Visual feedback
      toggleBtn.style.transform = 'translateX(-2px) scale(0.95)';
      setTimeout(() => {
        toggleBtn.style.transform = '';
      }, 150);

      // Add loading state
      toggleBtn.classList.add('loading');

      // Show immediate feedback that the click was registered
      showNotification('Opening CoolDesk...', '#4A90E2', 3000);

      try {
        await openSidePanel();
      } catch (error) {
        console.error('[CoolDesk Button] Error in click handler:', error);
        showNotification('Failed to open CoolDesk. Please try again.', '#ff4444', 5000);
      } finally {
        // Remove loading state
        setTimeout(() => {
          toggleBtn.classList.remove('loading');
        }, 500);
      }
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

    // ... (existing resize/drag logic) ...

    // Sticky Notes Functionality
    const renderStickyNotes = async () => {
      try {
        console.log('[CoolDesk] Fetching notes for URL:', window.location.href);
        const response = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'getUrlNotes', url: window.location.href }, resolve);
        });

        console.log('[CoolDesk] Notes response:', response);

        // Remove existing sticky notes (but preserve open editors if any)
        const existingNotes = shadow.querySelectorAll('.cooldesk-sticky-note:not(.sticky-editor)');
        existingNotes.forEach(n => n.remove());

        if (response && response.success && response.notes && response.notes.length > 0) {
          console.log('[CoolDesk] Rendering', response.notes.length, 'notes');
          response.notes.forEach((note, index) => {
            // Only show recent or pinned-like notes to avoid clutter? 
            // For now, show all but stacked or scattered.
            const stickyNote = document.createElement('div');
            stickyNote.className = 'cooldesk-sticky-note';

            // Randomish position or stacked
            const top = 100 + (index * 120);
            const right = 80; // Left of the floating button

            stickyNote.style.cssText = `
              position: fixed;
              top: ${top}px;
              right: ${right}px;
              width: 200px;
              min-height: 150px;
              background: #fef08a; /* Yellow sticky note */
              color: #1f2937;
              padding: 16px;
              border-radius: 4px;
              box-shadow: 2px 4px 12px rgba(0,0,0,0.15);
              font-family: 'Comic Sans MS', 'Chalkboard SE', sans-serif;
              font-size: 14px;
              z-index: 2147483645;
              transform: rotate(${Math.random() * 4 - 2}deg);
              transition: transform 0.2s ease, opacity 0.2s ease;
              cursor: default;
              opacity: 0.9;
            `;

            stickyNote.innerHTML = `
              <div style="font-weight: bold; margin-bottom: 8px; border-bottom: 1px solid rgba(0,0,0,0.1); padding-bottom: 4px;">
                ${new Date(note.createdAt).toLocaleDateString()}
              </div>
              <div style="white-space: pre-wrap; word-break: break-word;">
                ${note.text || note.description || 'No content'}
              </div>
              <div style="position: absolute; bottom: 8px; right: 8px; font-size: 10px; color: #6b7280;">
                ${note.type === 'voice' ? '🎤 Voice' : note.type === 'screenshot' ? '📸 Image' : '📝 Note'}
              </div>
            `;

            // Hover effect
            stickyNote.onmouseenter = () => { stickyNote.style.opacity = '1'; stickyNote.style.transform = 'scale(1.05)'; };
            stickyNote.onmouseleave = () => { stickyNote.style.opacity = '0.9'; stickyNote.style.transform = `rotate(${Math.random() * 4 - 2}deg)`; };

            // Allow closing/hiding locally
            const closeBtn = document.createElement('div');
            closeBtn.textContent = '×';
            closeBtn.style.cssText = `
              position: absolute;
              top: 4px;
              right: 8px;
              cursor: pointer;
              font-size: 18px;
              font-weight: bold;
              opacity: 0.5;
            `;
            closeBtn.onclick = (e) => {
              e.stopPropagation();
              stickyNote.remove();
            };
            closeBtn.onmouseenter = () => closeBtn.style.opacity = '1';
            closeBtn.onmouseleave = () => closeBtn.style.opacity = '0.5';

            stickyNote.appendChild(closeBtn);
            shadow.appendChild(stickyNote);
          });
        }
      } catch (e) {
        console.warn('Failed to load sticky notes:', e);
      }
    };

    // Initial load
    setTimeout(renderStickyNotes, 1000);

    // Listen for refreshes
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.action === 'refreshNotesCount') {
        renderStickyNotes();
      }
    });

  } catch (e) {
    console.error('Error injecting CoolDesk floating button:', e);
  }
}

export default injectFooterBar;
