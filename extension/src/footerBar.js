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
        display: flex;
        flex-direction: column-reverse;
        align-items: center;
        gap: 12px;
        padding-bottom: 8px; /* Hit area extension */
      }

      .floating-container:hover {
        z-index: 2147483650; /* Ensure on top when expanded */
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



      /* Action Buttons (Hidden by default) */
      /* Action Buttons (Hidden by default) */
      .action-btn {
        width: 44px;
        height: 44px;
        min-width: 44px;
        min-height: 44px;
        flex-shrink: 0;
        border-radius: 50%;
        background: #ffffff;
        border: 1px solid #e5e7eb;
        color: #4b5563;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        font-size: 20px;
        box-shadow: 
          0 4px 6px -1px rgba(0, 0, 0, 0.1), 
          0 2px 4px -1px rgba(0, 0, 0, 0.06),
          0 0 0 1px rgba(0,0,0,0.05); /* Outline shadow for white backgrounds */
        opacity: 0;
        transform: translateY(20px) scale(0.8);
        pointer-events: none;
        position: relative;
        margin-right: 16px; /* Align visually with center of toggle btn */
      }

      .floating-container:hover .action-btn {
        opacity: 1;
        transform: translateY(0) scale(1);
        pointer-events: auto;
      }

      .action-btn:hover {
        transform: scale(1.15) !important;
        background: white;
        box-shadow: 0 6px 16px rgba(0,0,0,0.2);
      }
      
      /* SVG Styling - Force visibility and handle colors */
      .action-btn svg {
        width: 22px;
        height: 22px;
        flex-shrink: 0;
        stroke: #4b5563;
        transition: stroke 0.2s;
      }
      
      .action-btn:hover svg { stroke: #2563eb; }
      .add-note-btn:hover svg { stroke: #10b981; }
      .highlight-btn:hover svg { stroke: #f59e0b; }

      /* Tooltip for Actions */
      .action-tooltip {
        position: absolute;
        right: 50px;
        top: 50%;
        transform: translateY(-50%) translateX(10px);
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 12px;
        white-space: nowrap;
        opacity: 0;
        visibility: hidden;
        transition: all 0.2s ease;
        pointer-events: none;
      }

      .action-btn:hover .action-tooltip {
        opacity: 1;
        visibility: visible;
        transform: translateY(-50%) translateX(0);
      }
      
      .sticky-editor {
        animation: popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      }
      
      @keyframes popIn {
        from { transform: scale(0.8) rotate(-5deg); opacity: 0; }
        to { transform: scale(1) rotate(0deg); opacity: 1; }
      }
    `;

    // Inject Global Styles for Highlights (Must be in Light DOM)
    // Always remove and re-add to ensure they are fresh and working
    const globalStyleId = 'cooldesk-global-styles';
    const existingStyle = document.getElementById(globalStyleId);
    if (existingStyle) {
      existingStyle.remove();
    }

    const globalStyle = document.createElement('style');
    globalStyle.id = globalStyleId;
    globalStyle.textContent = `
      /* On-Page Highlighting */
      mark.cooldesk-text-highlight {
        background-color: #fef08a !important;
        color: inherit !important;
        cursor: pointer;
        border-radius: 2px;
        transition: background-color 0.2s;
        box-shadow: 0 0 0 2px rgba(254, 240, 138, 0.3);
        text-decoration: none;
        display: inline;
      }
      
      mark.cooldesk-text-highlight:hover {
        background-color: #fde047 !important; /* Darker yellow */
        box-shadow: 0 0 0 2px rgba(253, 224, 71, 0.5);
      }
    `;
    document.head.appendChild(globalStyle);

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
          <path d="M12,2A2,2 0 0,1 14,4C14,4.74 13.6,5.39 13,5.73V7A1,1 0 0,0 14,8H16A1,1 0 0,0 17,7V5.73C16.4,5.39 16,4.74 16,4A2,2 0 0,1 18,2A2,2 0 0,1 20,4C20,4.74 19.6,5.39 19,5.73V7A3,3 0 0,1 16,10V10.5A1.5,1.5 0 0,0 17.5,12A1.5,1.5 0 0,0 19,10.5A1.5,1.5 0 0,1 20.5,9A1.5,1.5 0 0,1 22,10.5C22,11.38 21.47,12.13 20.66,12.43C20.88,13.07 21,13.76 21,14.5C21,16.06 20.33,17.45 19.24,18.39L17.12,19.95A3,3 0 0,1 14.5,20.5H9.5A3,3 0 0,1 6.88,19.95L4.76,18.39C3.67,17.45 3,16.06 3,14.5C3,13.76 3.12,13.07 3.34,12.43C2.53,12.13 2,11.38 2,10.5A1.5,1.5 0 0,1 3.5,9A1.5,1.5 0 0,1 5,10.5A1.5,1.5 0 0,0 6.5,12A1.5,1.5 0 0,0 8,10.5V10A3,3 0 0,1 5,7V5.73C4.4,5.39 4,4.74 4,4A2,2 0 0,1 6,2A2,2 0 0,1 8,4C8,4.74 7.6,5.39 7,5.73V7A1,1 0 0,0 8,8H10A1,1 0 0,0 11,7V5.73C10.4,5.39 10,4.74 10,4A2,2 0 0,1 12,2Z" />
        </svg>
        `;
      };
    } catch (e) {
      console.error('[CoolDesk] Error setting up logo:', e);
      // Fallback icon
      toggleBtn.innerHTML = `
        < svg class="btn-icon" viewBox = "0 0 24 24" fill = "currentColor" style = "width: 24px; height: 24px;" >
          <path d="M12,2A2,2 0 0,1 14,4C14,4.74 13.6,5.39 13,5.73V7A1,1 0 0,0 14,8H16A1,1 0 0,0 17,7V5.73C16.4,5.39 16,4.74 16,4A2,2 0 0,1 18,2A2,2 0 0,1 20,4C20,4.74 19.6,5.39 19,5.73V7A3,3 0 0,1 16,10V10.5A1.5,1.5 0 0,0 17.5,12A1.5,1.5 0 0,0 19,10.5A1.5,1.5 0 0,1 20.5,9A1.5,1.5 0 0,1 22,10.5C22,11.38 21.47,12.13 20.66,12.43C20.88,13.07 21,13.76 21,14.5C21,16.06 20.33,17.45 19.24,18.39L17.12,19.95A3,3 0 0,1 14.5,20.5H9.5A3,3 0 0,1 6.88,19.95L4.76,18.39C3.67,17.45 3,16.06 3,14.5C3,13.76 3.12,13.07 3.34,12.43C2.53,12.13 2,11.38 2,10.5A1.5,1.5 0 0,1 3.5,9A1.5,1.5 0 0,1 5,10.5A1.5,1.5 0 0,0 6.5,12A1.5,1.5 0 0,0 8,10.5V10A3,3 0 0,1 5,7V5.73C4.4,5.39 4,4.74 4,4A2,2 0 0,1 6,2A2,2 0 0,1 8,4C8,4.74 7.6,5.39 7,5.73V7A1,1 0 0,0 8,8H10A1,1 0 0,0 11,7V5.73C10.4,5.39 10,4.74 10,4A2,2 0 0,1 12,2Z" />
        </svg >
        `;
      return;
    }

    toggleBtn.appendChild(logoImg);
    container.appendChild(toggleBtn);

    // --- Action Buttons ---

    // 1. Add Note Button
    // Helper to create SVG icon
    const createIcon = (paths) => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '24');
      svg.setAttribute('height', '24');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', '#4b5563');
      svg.setAttribute('stroke-width', '2');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');

      paths.forEach(d => {
        let el;
        if (d.startsWith('line')) {
          // special case for line command stored as object or string? 
          // Simpler: Just innerHTML for content, but wrapper is NS.
          // Actually mixed approach is fine if wrapper is NS.
          // Let's stick to innerHTML for content if wrapper is NS? 
          // No, full DOM is safer.
        }
      });
      // Fallback: Just set innerHTML of the NS-created SVG. 
      // This is often safe if the parent is correct.
      svg.innerHTML = paths;
      return svg;
    };

    // 1. Add Note Button
    const addNoteBtn = document.createElement('div');
    addNoteBtn.className = 'action-btn add-note-btn';

    // Create Plus Icon
    const plusSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    plusSvg.setAttribute('width', '24');
    plusSvg.setAttribute('height', '24');
    plusSvg.setAttribute('viewBox', '0 0 24 24');
    plusSvg.setAttribute('fill', 'none');
    plusSvg.setAttribute('stroke', '#4b5563');
    plusSvg.setAttribute('stroke-width', '2');
    plusSvg.setAttribute('stroke-linecap', 'round');
    plusSvg.setAttribute('stroke-linejoin', 'round');
    plusSvg.innerHTML = '<line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>';
    addNoteBtn.appendChild(plusSvg);

    addNoteBtn.title = 'Add Sticky Note';
    addNoteBtn.onclick = (e) => {
      e.stopPropagation();
      spawnNewStickyNote();
    };
    addNoteBtn.onmousedown = (e) => e.stopPropagation();

    // Tooltip for Note
    const noteTooltip = document.createElement('div');
    noteTooltip.className = 'action-tooltip';
    noteTooltip.textContent = 'Add Note';
    addNoteBtn.appendChild(noteTooltip);

    container.appendChild(addNoteBtn);


    // 2. Highlight Button
    const highlightBtn = document.createElement('div');
    highlightBtn.className = 'action-btn highlight-btn';

    // Create Highlight Icon
    const highlightSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    highlightSvg.setAttribute('width', '22');
    highlightSvg.setAttribute('height', '22');
    highlightSvg.setAttribute('viewBox', '0 0 24 24');
    highlightSvg.setAttribute('fill', 'none');
    highlightSvg.setAttribute('stroke', '#4b5563');
    highlightSvg.setAttribute('stroke-width', '2');
    highlightSvg.setAttribute('stroke-linecap', 'round');
    highlightSvg.setAttribute('stroke-linejoin', 'round');
    // Using standard paths
    highlightSvg.innerHTML = `
      <path d="M9 11l-6 6v3h3l6-6"/>
      <path d="M22 7l-3-3"/>
      <path d="M19 4l3 3"/>
    `;
    highlightBtn.appendChild(highlightSvg);

    highlightBtn.onclick = async (e) => {
      e.stopPropagation();
      const selection = window.getSelection();
      const text = selection ? selection.toString().trim() : '';

      if (text) {
        // Instant Save for Highlights
        try {
          const note = {
            id: 'note_' + Date.now(),
            url: window.location.href,
            text: text,
            type: 'highlight',
            createdAt: Date.now()
          };

          console.log('[CoolDesk Highlight] Attempting to save note:', note);

          const response = await new Promise(resolve => {
            chrome.runtime.sendMessage({ action: 'saveUrlNote', note }, resolve);
          });

          console.log('[CoolDesk Highlight] Save response:', response);

          if (response && response.success) {
            console.log('[CoolDesk Highlight] Save successful, calling renderStickyNotes...');
            renderStickyNotes(); // Triggers the inline highlighter
            showNotification('Text Highlighted!', '#f59e0b');
            selection.removeAllRanges();
          } else {
            console.error('[CoolDesk Highlight] Save failed:', response);
            throw new Error(response?.error || 'Unknown error');
          }
        } catch (err) {
          console.error('Failed to highlight:', err);
          showNotification('Failed to save highlight', '#ef4444');
        }
      } else {
        showNotification('Select text to highlight', '#f59e0b');
      }
    };
    highlightBtn.onmousedown = (e) => e.stopPropagation();

    // Tooltip for Highlight
    const highlightTooltip = document.createElement('div');
    highlightTooltip.className = 'action-tooltip';
    highlightTooltip.textContent = 'Highlight Text';
    highlightBtn.appendChild(highlightTooltip);

    container.appendChild(highlightBtn);


    // Main Button Tooltip (Adjusted position to avoid overlap)
    const tooltip = document.createElement('div');
    tooltip.className = 'tooltip';
    tooltip.textContent = 'Open CoolDesk';
    // Override default tooltip position to align with bottom button
    tooltip.style.cssText = `
      top: auto;
      bottom: 25px;
      transform: translateY(50%);
    `;
    container.appendChild(tooltip);

    // Spawn New Sticky Note
    const spawnNewStickyNote = (initialText = '', initialType = 'text') => {
      const stickyNote = document.createElement('div');
      stickyNote.className = 'cooldesk-sticky-note sticky-editor';

      const right = 300;
      const top = 100;

      stickyNote.style.cssText = `
      position: fixed;
      top: ${top}px;
      right: ${right}px;
      width: 240px; /* Matched width */
      min-height: 180px; /* Matched height */
      background: linear-gradient(135deg, #fef9c3 0%, #fef08a 100%); /* Matched gradient */
      border-radius: 2px 2px 20px 2px; /* Matched corners */
      box-shadow: 
        0 20px 25px -5px rgba(0, 0, 0, 0.1),
        0 10px 10px -5px rgba(0, 0, 0, 0.04); /* Elevated shadow for active note */
      z-index: 2147483650;
      display: flex;
      flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; /* Matched font */
      font-size: 14px;
      color: #1f2937;
      transform: rotate(0deg); /* Straight when editing */
      overflow: hidden;
      `;

      // Header for consistency
      // Header for consistency
      const header = document.createElement('div');
      header.style.cssText = `
      padding: 8px 12px;
      border-bottom: 1px solid rgba(0, 0, 0, 0.05);
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      color: #6b7280;
      background: rgba(255, 255, 255, 0.3);
      `;
      const title = initialType === 'highlight' ? 'New Highlight' : 'New Note';
      const titleColor = initialType === 'highlight' ? '#f59e0b' : '#10b981';
      header.innerHTML = `<span style="font-weight:600; color:${titleColor};">${title}</span>`;

      const textarea = document.createElement('textarea');
      textarea.value = initialText || '';
      textarea.placeholder = 'Type your note here...';
      textarea.style.cssText = `
      flex: 1;
      background: transparent;
      border: none;
      outline: none;
      resize: none; /* Auto-resize could be added but fixed for now */
      padding: 12px;
      font - family: inherit;
      font - size: 14px;
      line - height: 1.5;
      min - height: 100px;
      color: #374151;
      `;
      textarea.focus();

      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display: flex; gap: 8px; justify-content: flex-end; padding: 8px 12px;';

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.cssText = 'background: transparent; border: none; padding: 4px 8px; cursor: pointer; color: #6b7280; font-size: 12px; font-weight: 500; font-family: inherit;';
      cancelBtn.onmouseenter = () => cancelBtn.style.color = '#374151';
      cancelBtn.onmouseleave = () => cancelBtn.style.color = '#6b7280';
      cancelBtn.onclick = () => stickyNote.remove();

      const saveBtn = document.createElement('button');
      saveBtn.textContent = 'Save Note';
      saveBtn.style.cssText = 'background: rgba(255,255,255,0.5); border: 1px solid rgba(0,0,0,0.05); padding: 4px 12px; border-radius: 12px; cursor: pointer; color: #059669; font-size: 12px; font-weight: 600; font-family: inherit; transition: all 0.2s;';
      saveBtn.onmouseenter = () => { saveBtn.style.background = '#10b981'; saveBtn.style.color = 'white'; };
      saveBtn.onmouseleave = () => { saveBtn.style.background = 'rgba(255,255,255,0.5)'; saveBtn.style.color = '#059669'; };

      saveBtn.onclick = async () => {
        const text = textarea.value.trim();
        if (!text) return;

        try {
          const note = {
            id: 'note_' + Date.now(),
            url: window.location.href,
            text: text,
            type: initialType,
            createdAt: Date.now()
          };

          const response = await new Promise(resolve => {
            chrome.runtime.sendMessage({ action: 'saveUrlNote', note }, resolve);
          });

          if (response && response.success) {
            stickyNote.remove();
            renderStickyNotes(); // Refresh to show the new saved note
            showNotification('Note saved!', '#10b981');
          } else {
            throw new Error(response?.error || 'Unknown error');
          }
        } catch (e) {
          console.error('Failed to save note:', e);
          showNotification('Failed to save: ' + (e.message || 'Error'), '#ef4444');
        }
      };

      btnRow.appendChild(cancelBtn);
      btnRow.appendChild(saveBtn);

      stickyNote.appendChild(header);
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
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25), 0 2px 10px rgba(0, 0, 0, 0.15);
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

    // --- Helper 1: Inline Highlighter (Robust Multi-Node) ---
    const renderInlineHighlight = (note) => {
      if (!note.text) return;

      try {
        const searchStr = note.text.trim().replace(/\s+/g, ' '); // Normalize spaces
        if (!searchStr) return;

        // Strategy: Brute force text search across all visible text nodes? 
        // Better: Use TreeWalker to build a map of text content.

        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
          {
            acceptNode: (node) => {
              // Skip hidden nodes or our own shadow host if possible (though shadow host is element)
              if (node.parentElement && (node.parentElement.offsetParent === null || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(node.parentElement.tagName))) {
                return NodeFilter.FILTER_REJECT;
              }
              return NodeFilter.FILTER_ACCEPT;
            }
          },
          false
        );

        // We need to find the sequence of text nodes that matches searchStr.
        // Since `window.find` modifies selection, we avoid it.
        // We'll iterate all text nodes, build a parallel string, find the index, then map back to nodes.

        let allText = '';
        const textNodes = [];

        let currentNode;
        while (currentNode = walker.nextNode()) {
          const val = currentNode.nodeValue;
          // We keep original text but will search in normalized text? 
          // Searching in exact text is safer for replacement.
          // But user selection might have crossed block boundaries which introduces newlines.

          // Simplified approach: Search in current node first (fast path)
          if (val.includes(searchStr)) {
            // ... (Existing logic for single node match) ...
          }

          textNodes.push({
            node: currentNode,
            start: allText.length,
            length: val.length,
            text: val
          });
          allText += val;
        }

        // Normalize for search: Collapsing spaces might be needed if HTML has extra spaces.
        // We use Regex to match the search string tolerant of whitespace differences.

        const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // 1. Escape special regex chars
        let pattern = escapeRegExp(searchStr);

        // 2. Allow flexibility for spaces (replace escaped spaces with \s+)
        pattern = pattern.replace(/\\s+/g, '\\s+');

        // 3. Allow flexibility for quotes (smart vs straight)
        pattern = pattern.replace(/'/g, "['’]"); // Handle single quotes/apostrophes
        pattern = pattern.replace(/"/g, '["“”]'); // Handle double quotes

        const regex = new RegExp(pattern, 'mi'); // multiline + case-insensitive for robustness? (maybe just 'm' is safer to avoid over-matching)
        // Let's stick to case-sensitive for data integrity, but smart quotes are crucial.

        const match = regex.exec(allText);
        const matchIndex = match ? match.index : -1;

        if (matchIndex === -1) {
          console.warn('Could not find text match:', searchStr);
          console.log('Search Pattern Used:', pattern);
          return;
        }

        // Debug: Count total matches
        const globalRegex = new RegExp(pattern, 'gmi');
        const totalMatches = (allText.match(globalRegex) || []).length;
        console.log(`[CoolDesk Search] Pattern found ${totalMatches} times.`);
        console.log(`[CoolDesk Search] Highlighting first match at index ${matchIndex}.`);

        // We have a match starting at matchIndex in allText.
        // Find which text node this falls into.

        let currentIdx = matchIndex;
        // IMPORTANT: Use the actual length of the matched string in DOM, not the search string length
        // because DOM might have extra spaces "foo   bar" vs "foo bar"
        let remainingLen = match[0].length;

        // Optimization: Start binary search or just iterate? Iterate is fine.
        let startNodeIdx = textNodes.findIndex(t => currentIdx >= t.start && currentIdx < t.start + t.length);

        if (startNodeIdx === -1) return;

        // We found the start node.
        // The match might span multiple nodes.

        const rangesToHighlight = [];

        for (let i = startNodeIdx; i < textNodes.length && remainingLen > 0; i++) {
          const t = textNodes[i];
          let nodeStartOffset = (i === startNodeIdx) ? (currentIdx - t.start) : 0;
          let nodeEndOffset = Math.min(t.length, nodeStartOffset + remainingLen);

          if (nodeEndOffset > nodeStartOffset) {
            rangesToHighlight.push({
              node: t.node,
              start: nodeStartOffset,
              end: nodeEndOffset
            });
            remainingLen -= (nodeEndOffset - nodeStartOffset);
          }
        }

        // Apply highlights (in reverse order to not mess up offsets of earlier nodes?)
        // Actually, replaceChild messes up the walker but we are done walking.
        // Splitting text nodes validates other references? 
        // Yes, splitting `node` invalidates `start / length` calculations for subsequent nodes 
        // ONLY if they are the SAME node. But our loop moves to next node (or stays if same?).
        // ACTUALLY if we have multiple ranges in SAME node (recursive?), we need to be careful.
        // But we only support ONE instance highlight per call for now.

        rangesToHighlight.reverse().forEach(({ node, start, end }) => {
          const range = document.createRange();
          range.setStart(node, start);
          range.setEnd(node, end);

          const mark = document.createElement('mark');
          mark.className = 'cooldesk-text-highlight';
          mark.dataset.id = note.id;
          mark.title = 'CoolDesk Highlight (Click to Delete)';
          mark.textContent = range.toString();

          // Force inline styles to bypass CSP/Stylesheet blocking
          mark.style.backgroundColor = '#fef08a';
          mark.style.color = 'inherit';
          mark.style.cursor = 'pointer';
          mark.style.borderRadius = '2px';
          mark.style.boxShadow = '0 0 0 2px rgba(254, 240, 138, 0.3)';

          mark.onclick = async (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (confirm('Delete this highlight?')) {
              try {
                await new Promise(resolve => {
                  chrome.runtime.sendMessage({ action: 'deleteUrlNote', noteId: note.id }, resolve);
                });

                // Remove ALL marks with this ID
                const relatedMarks = document.querySelectorAll(`mark.cooldesk-text-highlight[data-id="${note.id}"]`);
                relatedMarks.forEach(m => {
                  const parent = m.parentNode;
                  const textNode = document.createTextNode(m.textContent);
                  parent.replaceChild(textNode, m);
                  parent.normalize();
                });

                showNotification('Highlight removed', '#4b5563');
              } catch (err) {
                console.error('Failed to delete highlight:', err);
              }
            }
          };

          // Extract contents and wrap
          range.deleteContents();
          range.insertNode(mark);
        });

      } catch (e) {
        console.error('Error rendering inline highlight:', e);
      }
    };

    // --- Helper 2: Sticky Card Renderer ---
    const renderSingleSticky = (note, index) => {
      const stickyNote = document.createElement('div');
      stickyNote.className = 'cooldesk-sticky-note';

      // Stacked positions
      const initialTop = 100 + (index * 40);
      const initialRight = 80 + (index * 5);

      stickyNote.style.cssText = `
        position: fixed;
        top: ${initialTop} px;
        right: ${initialRight} px;
        width: 240px;
        min - height: ${note.isCollapsed ? '40px' : '180px'};
        height: ${note.isCollapsed ? 'auto' : ''};
        background: linear - gradient(135deg, #fef9c3 0 %, #fef08a 100 %);
        color: #1f2937;
        border - radius: 8px;
        box - shadow: 0 4px 6px - 1px rgba(0, 0, 0, 0.1), 0 2px 4px - 1px rgba(0, 0, 0, 0.06);
        font - family: -apple - system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans - serif;
        font - size: 14px;
        z - index: ${2147483645 + index};
        transition: min - height 0.2s ease, box - shadow 0.2s ease;
        display: flex;
        flex - direction: column;
        overflow: hidden;
        `;

      let isCollapsed = !!note.isCollapsed;

      // Note Header
      // Note Header
      const header = document.createElement('div');
      header.style.cssText = `
        padding: 8px 12px;
        border - bottom: 1px solid rgba(0, 0, 0, 0.05);
        display: flex;
        justify - content: space - between;
        align - items: center;
        font - size: 11px;
        color: #6b7280;
        background: rgba(255, 255, 255, 0.4);
        cursor: grab;
        user - select: none;
        `;

      // Title Area
      const titleArea = document.createElement('div');
      titleArea.style.cssText = 'display: flex; align-items: center; gap: 8px; flex: 1; overflow: hidden;';

      const toggleIcon = document.createElement('span');
      toggleIcon.innerHTML = '▼';
      toggleIcon.style.cssText = `cursor: pointer; font - size: 10px; transition: transform 0.2s; padding: 2px; transform: ${isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)'}; `;

      const titleText = document.createElement('span');
      titleText.textContent = new Date(note.updatedAt || note.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      titleText.style.cssText = 'white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';

      titleArea.appendChild(toggleIcon);
      titleArea.appendChild(titleText);

      const deleteBtn = document.createElement('div');
      deleteBtn.innerHTML = 'Ã—';
      deleteBtn.title = 'Delete Note';
      deleteBtn.style.cssText = `cursor: pointer; font - size: 18px; line - height: 1; color: #9ca3af; font - weight: bold; padding: 0 4px; margin - left: 8px; `;
      deleteBtn.onmouseenter = () => deleteBtn.style.color = '#ef4444';
      deleteBtn.onmouseleave = () => deleteBtn.style.color = '#9ca3af';
      deleteBtn.onclick = async (e) => {
        e.stopPropagation();
        if (confirm('Delete this note?')) {
          try {
            await new Promise(resolve => {
              chrome.runtime.sendMessage({ action: 'deleteUrlNote', noteId: note.id }, resolve);
            });
            stickyNote.style.transform = 'scale(0.9) opacity(0)';
            setTimeout(() => stickyNote.remove(), 200);
            showNotification('Note deleted', '#4b5563');
          } catch (err) {
            console.error('Failed to delete note:', err);
          }
        }
      };

      header.appendChild(titleArea);
      header.appendChild(deleteBtn);

      // Textarea
      const textarea = document.createElement('textarea');
      textarea.value = note.text || note.description || '';
      textarea.placeholder = 'Empty note...';
      textarea.style.cssText = `
        flex: 1; width: 100 %; border: none; background: transparent; resize: none; padding: 12px; font - family: inherit; font - size: 14px; line - height: 1.5; color: #374151; outline: none;
        display: ${isCollapsed ? 'none' : 'block'}; min - height: 140px;
        `;

      // Logic
      const toggleCollapse = (e) => {
        if (e) e.stopPropagation();
        isCollapsed = !isCollapsed;
        if (isCollapsed) {
          textarea.style.display = 'none';
          stickyNote.style.minHeight = 'auto';
          stickyNote.style.height = 'auto';
          toggleIcon.style.transform = 'rotate(-90deg)';
          const preview = (note.text || '').split('\n')[0].substring(0, 20);
          if (preview) titleText.textContent = preview + (note.text.length > 20 ? '...' : '');
        } else {
          textarea.style.display = 'block';
          stickyNote.style.minHeight = '180px';
          toggleIcon.style.transform = 'rotate(0deg)';
          titleText.textContent = new Date(note.updatedAt || note.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        }
      };
      toggleIcon.onclick = toggleCollapse;

      // Drag
      let isDragging = false;
      let startX, startY, initialLeft, initialTopDrag;
      header.onmousedown = (e) => {
        if (e.target === deleteBtn || e.target === toggleIcon) return;
        isDragging = true;
        header.style.cursor = 'grabbing';
        stickyNote.style.zIndex = '2147483650';
        const rect = stickyNote.getBoundingClientRect();
        startX = e.clientX; startY = e.clientY; initialLeft = rect.left; initialTopDrag = rect.top;
        e.preventDefault();
      };
      const onMouseMove = (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX; const dy = e.clientY - startY;
        stickyNote.style.right = 'auto'; stickyNote.style.left = `${initialLeft + dx} px`; stickyNote.style.top = `${initialTopDrag + dy} px`;
      };
      const onMouseUp = () => { if (isDragging) { isDragging = false; header.style.cursor = 'grab'; } };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);

      // Save
      let originalGenericText = note.text || '';
      const saveChanges = async () => {
        const newText = textarea.value.trim();
        if (newText !== originalGenericText) {
          try {
            const updatedNote = { ...note, text: newText, updatedAt: Date.now() };
            const res = await new Promise(resolve => { chrome.runtime.sendMessage({ action: 'saveUrlNote', note: updatedNote }, resolve); });
            if (res && res.success) {
              originalGenericText = newText;
              showNotification('Note updated', '#10b981', 2000);
              if (!isCollapsed) titleText.textContent = 'Just now';
            }
          } catch (err) { console.error('Error saving:', err); }
        }
      };
      textarea.addEventListener('blur', saveChanges);
      textarea.addEventListener('keydown', (e) => { if (e.ctrlKey && e.key === 'Enter') textarea.blur(); });

      stickyNote.appendChild(header);
      stickyNote.appendChild(textarea);
      stickyNote.onmouseenter = () => { if (!isDragging) { stickyNote.style.zIndex = '2147483650'; stickyNote.style.boxShadow = '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)'; } };
      stickyNote.onmouseleave = () => { if (!isDragging && document.activeElement !== textarea) { stickyNote.style.zIndex = `${2147483645 + index} `; stickyNote.style.boxShadow = '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)'; } };

      shadow.appendChild(stickyNote);
    };

    // Sticky Notes Functionality
    const renderStickyNotes = async () => {
      try {
        console.log('[CoolDesk] Fetching notes for URL:', window.location.href);
        const response = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'getUrlNotes', url: window.location.href }, resolve);
        });

        console.log('[CoolDesk] Full Notes Response:', response);

        // Remove existing sticky notes (but preserve open editors if any)
        const existingNotes = shadow.querySelectorAll('.cooldesk-sticky-note:not(.sticky-editor)');
        existingNotes.forEach(n => n.remove());

        // Remove existing inline highlights
        const oldHighlights = document.querySelectorAll('mark.cooldesk-text-highlight');
        oldHighlights.forEach(mark => {
          const parent = mark.parentNode;
          while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
          parent.removeChild(mark);
        });

        if (response && response.success && response.notes && response.notes.length > 0) {
          console.log('[CoolDesk] Rendering', response.notes.length, 'notes');

          const stickyNotes = response.notes.filter(n => n.type !== 'highlight');
          const highlights = response.notes.filter(n => n.type === 'highlight');

          console.log('[CoolDesk] Sticky notes:', stickyNotes.length, stickyNotes);
          console.log('[CoolDesk] Highlights:', highlights.length, highlights);

          stickyNotes.forEach(renderSingleSticky);
          highlights.forEach(renderInlineHighlight);
        } else {
          console.log('[CoolDesk] No notes to render or fetch failed');
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
