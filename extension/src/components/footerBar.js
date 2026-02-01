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

      .floating-container.expanded .action-btn {
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

      /* Spotlight Modal Styles */
      .spotlight-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.4);
        backdrop-filter: blur(8px);
        display: none; /* Hidden by default */
        z-index: 2147483647;
        align-items: flex-start;
        justify-content: center;
        padding-top: 15vh;
        animation: fadeIn 0.2s ease;
      }

      .spotlight-overlay.visible {
        display: flex;
      }

      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      .spotlight-container {
        width: 100%;
        max-width: 680px;
        background: rgba(23, 23, 23, 0.85);
        backdrop-filter: blur(25px) saturate(150%);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 20px;
        box-shadow: 
          0 25px 50px -12px rgba(0, 0, 0, 0.5),
          0 0 0 1px rgba(255, 255, 255, 0.05);
        overflow: hidden;
        animation: slideDown 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        display: flex;
        flex-direction: column;
      }

      @keyframes slideDown {
        from { transform: translateY(-20px) scale(0.95); opacity: 0; }
        to { transform: translateY(0) scale(1); opacity: 1; }
      }

      .spotlight-search-box {
        padding: 20px 24px;
        display: flex;
        align-items: center;
        gap: 16px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      }

      .spotlight-prompt {
        font-family: 'Fira Code', monospace;
        font-weight: 700;
        font-size: 20px;
        color: #34C759;
        user-select: none;
      }

      .spotlight-input {
        flex: 1;
        background: transparent;
        border: none;
        outline: none;
        color: white;
        font-size: 20px;
        font-family: inherit;
        padding: 0;
      }

      .spotlight-input::placeholder {
        color: rgba(255, 255, 255, 0.2);
      }

      .spotlight-results {
        max-height: 420px;
        overflow-y: auto;
        padding: 8px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .result-item {
        padding: 12px 16px;
        display: flex;
        align-items: center;
        gap: 12px;
        border-radius: 12px;
        cursor: pointer;
        transition: all 0.1s ease;
        color: rgba(255, 255, 255, 0.7);
        font-size: 14px;
      }

      .result-item.selected {
        background: rgba(255, 255, 255, 0.1);
        color: white;
      }

      .result-item:hover {
        background: rgba(255, 255, 255, 0.05);
        color: white;
      }

      .result-icon {
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 8px;
        font-size: 18px;
        flex-shrink: 0;
      }

      .result-content {
        flex: 1;
        min-width: 0;
      }

      .result-title {
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        display: block;
      }

      .result-desc {
        font-size: 12px;
        opacity: 0.5;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        display: block;
      }

      .result-badge {
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: rgba(255, 255, 255, 0.4);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .spotlight-footer {
        padding: 12px 24px;
        background: rgba(0, 0, 0, 0.2);
        display: flex;
        align-items: center;
        gap: 16px;
        font-size: 11px;
        color: rgba(255, 255, 255, 0.3);
        border-top: 1px solid rgba(255, 255, 255, 0.05);
      }

      .shortcut-hint {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .shortcut-key {
        padding: 2px 6px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 4px;
        color: rgba(255, 255, 255, 0.6);
        font-family: monospace;
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

    // Create Note Icon
    const noteIcon = document.createElement('div');
    noteIcon.textContent = '📝';
    noteIcon.style.fontSize = '20px';
    noteIcon.style.lineHeight = '1';
    addNoteBtn.appendChild(noteIcon);

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
    const highlightIcon = document.createElement('div');
    highlightIcon.textContent = '🖍️';
    highlightIcon.style.fontSize = '20px';
    highlightIcon.style.lineHeight = '1';
    highlightBtn.appendChild(highlightIcon);

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


    // 3. Scrape Links Button
    const scrapeBtn = document.createElement('div');
    scrapeBtn.className = 'action-btn scrape-btn';
    scrapeBtn.id = 'cooldesk-scrape-btn';

    // Create Link/Scrape Icon
    const scrapeIcon = document.createElement('div');
    scrapeIcon.textContent = '🔗';
    scrapeIcon.style.fontSize = '20px';
    scrapeIcon.style.lineHeight = '1';
    scrapeBtn.appendChild(scrapeIcon);

    scrapeBtn.onclick = async (e) => {
      e.stopPropagation();
      // Visual feedback
      scrapeBtn.style.transform = 'scale(0.95)';
      setTimeout(() => scrapeBtn.style.transform = '', 150);

      // Enter select mode for scraping
      enterLinkSelectMode(shadow, showNotification);
    };
    scrapeBtn.onmousedown = (e) => e.stopPropagation();

    // Tooltip for Scrape
    const scrapeTooltip = document.createElement('div');
    scrapeTooltip.className = 'action-tooltip';
    scrapeTooltip.textContent = 'Scrape Links';
    scrapeBtn.appendChild(scrapeTooltip);

    container.appendChild(scrapeBtn);


    // 4. AI Voice Button
    const voiceBtn = document.createElement('div');
    voiceBtn.className = 'action-btn voice-btn';
    voiceBtn.id = 'cooldesk-voice-btn'; // For easier selection

    // Create Microphone Icon
    const micIcon = document.createElement('div');
    micIcon.textContent = '🎤';
    micIcon.style.fontSize = '20px';
    micIcon.style.lineHeight = '1';
    voiceBtn.appendChild(micIcon);



    voiceBtn.onclick = async (e) => {
      e.stopPropagation();
      // Visual feedback
      voiceBtn.style.transform = 'scale(0.95)';
      setTimeout(() => voiceBtn.style.transform = '', 150);

      showNotification('Opening Voice Chat...', '#ec4899', 2000);

      // Open side panel with voice mode enabled
      await openSidePanel(true); // Pass true to start voice mode
    };
    voiceBtn.onmousedown = (e) => e.stopPropagation();

    // Tooltip for Voice
    const voiceTooltip = document.createElement('div');
    voiceTooltip.className = 'action-tooltip';
    voiceTooltip.textContent = 'Voice Command';
    voiceBtn.appendChild(voiceTooltip);

    container.appendChild(voiceBtn);



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
    const openSidePanel = async (startVoice = false) => {
      console.log('[CoolDesk Button] Attempting to open side panel...', startVoice ? '(Voice Mode)' : '');

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
            fromUserGesture: true,
            startVoice: startVoice // Flag to auto-start voice
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

    // --- Spotlight Search Bar (Raycast Style) ---
    const spotlightOverlay = document.createElement('div');
    spotlightOverlay.className = 'spotlight-overlay';

    const spotlightContainer = document.createElement('div');
    spotlightContainer.className = 'spotlight-container';

    spotlightContainer.innerHTML = `
      <div class="spotlight-search-box">
        <span class="spotlight-prompt">></span>
        <input type="text" class="spotlight-input" placeholder="Search tabs, history, or type ! for commands..." spellcheck="false">
      </div>
      <div class="spotlight-results"></div>
      <div class="spotlight-footer">
        <div class="shortcut-hint"><span class="shortcut-key">↵</span> to Open</div>
        <div class="shortcut-hint"><span class="shortcut-key">↑↓</span> to Navigate</div>
        <div class="shortcut-hint"><span class="shortcut-key">ESC</span> to Close</div>
      </div>
    `;

    spotlightOverlay.appendChild(spotlightContainer);
    shadow.appendChild(spotlightOverlay);

    const spotlightInput = spotlightContainer.querySelector('.spotlight-input');
    const spotlightResults = spotlightContainer.querySelector('.spotlight-results');
    let selectedIndex = -1;
    let currentResults = [];

    const toggleSpotlight = () => {
      const isVisible = spotlightOverlay.classList.toggle('visible');
      if (isVisible) {
        spotlightInput.value = '';
        renderResults([]);
        setTimeout(() => spotlightInput.focus(), 50);
      }
    };

    const renderResults = (results) => {
      currentResults = results;
      selectedIndex = results.length > 0 ? 0 : -1;

      spotlightResults.innerHTML = results.map((res, i) => `
        <div class="result-item ${i === 0 ? 'selected' : ''}" data-index="${i}">
          <div class="result-icon">${res.icon || '🔍'}</div>
          <div class="result-content">
            <span class="result-title">${res.title}</span>
            <span class="result-desc">${res.description || res.url || ''}</span>
          </div>
          ${res.category ? `<span class="result-badge">${res.category}</span>` : ''}
        </div>
      `).join('');

      // Add click listeners
      spotlightResults.querySelectorAll('.result-item').forEach(item => {
        item.onclick = () => {
          const idx = parseInt(item.dataset.index);
          executeResult(currentResults[idx]);
        };
      });
    };

    const executeResult = async (item) => {
      if (!item) return;

      if (item.command) {
        chrome.runtime.sendMessage({
          type: 'EXECUTE_COMMAND',
          commandValue: item.command
        }, (response) => {
          if (response?.success) toggleSpotlight();
        });
      } else if (item.tabId) {
        chrome.runtime.sendMessage({ type: 'JUMP_TO_TAB', tabId: item.tabId });
        toggleSpotlight();
      } else if (item.url) {
        window.open(item.url, '_blank');
        toggleSpotlight();
      }
    };

    spotlightInput.oninput = async () => {
      const value = spotlightInput.value.trim();
      if (!value) {
        renderResults([]);
        return;
      }

      // Request suggestions from background
      chrome.runtime.sendMessage({
        type: 'GET_SPOTLIGHT_SUGGESTIONS',
        query: value
      }, (response) => {
        if (response?.results) {
          renderResults(response.results);
        }
      });
    };

    spotlightInput.onkeydown = (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = (selectedIndex + 1) % currentResults.length;
        updateSelection();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = (selectedIndex - 1 + currentResults.length) % currentResults.length;
        updateSelection();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (selectedIndex >= 0) {
          executeResult(currentResults[selectedIndex]);
        }
      } else if (e.key === 'Escape') {
        toggleSpotlight();
      }
    };

    const updateSelection = () => {
      const items = spotlightResults.querySelectorAll('.result-item');
      items.forEach((item, i) => {
        item.classList.toggle('selected', i === selectedIndex);
        if (i === selectedIndex) {
          item.scrollIntoView({ block: 'nearest' });
        }
      });
    };

    spotlightOverlay.onclick = (e) => {
      if (e.target === spotlightOverlay) toggleSpotlight();
    };

    // Listen for global command from background
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'TOGGLE_SPOTLIGHT') {
        toggleSpotlight();
      }
    });

    // Fallback keyboard shortcut for Alt+S
    window.addEventListener('keydown', (e) => {
      if (e.altKey && (e.key === 's' || e.key === 'S')) {
        // Only trigger if not in an input/textarea (unless it's our own spotlight input)
        const target = e.target;
        const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
        
        if (isInput && target !== spotlightInput) return;

        e.preventDefault();
        e.stopPropagation();
        toggleSpotlight();
      }
    }, true);

    // --- End Spotlight ---

    // Click handler - toggle menu expansion
    toggleBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Toggle expanded state
      container.classList.toggle('expanded');

      // Visual feedback
      toggleBtn.style.transform = 'translateX(-2px) scale(0.95)';
      setTimeout(() => {
        toggleBtn.style.transform = '';
      }, 150);
    });

    // Double-click handler - open side panel
    toggleBtn.addEventListener('dblclick', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Prevent double-clicks while processing
      if (toggleBtn.classList.contains('loading')) return;

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

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
      if (!host.contains(e.target)) {
        container.classList.remove('expanded');
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

    // --- Helper 1: Inline Highlighter (Robust Multi-Node Global Mapping) ---
    // Store active highlights to re-apply them on DOM changes
    let activeHighlights = [];
    let observer = null;
    let observerTimeout = null;

    // Listen for notifications
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'SHOW_NOTIFICATION') {
        showNotification(msg.message, msg.color || '#4A90E2');
      }
    });

    const renderInlineHighlight = (note) => {
      if (!note.text) return;

      try {
        const searchStr = note.text.trim();
        if (!searchStr) return;

        // Step 1: Build a global map of all text content
        const nodeMapping = [];
        let allText = '';

        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
          {
            acceptNode: (node) => {
              // Skip empty/whitespace-only (unless it has newlines which might be structural)
              if (!node.nodeValue.trim() && !node.nodeValue.includes('\n')) return NodeFilter.FILTER_SKIP;

              const parent = node.parentElement;
              if (!parent) return NodeFilter.FILTER_REJECT;

              // AGGRESSIVE FILTERING: Skip "noise" elements
              // 1. Script/Style/Form inputs
              if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION'].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;

              // 2. Interactive elements that usually contain "UI text" not "Content"
              // (e.g. "Copy Code", "Submit", "Menu")
              if (['BUTTON', 'svg', 'nav', 'menu'].includes(parent.tagName.toLowerCase())) return NodeFilter.FILTER_REJECT;
              if (parent.closest('button') || parent.closest('a[role="button"]')) return NodeFilter.FILTER_REJECT;

              // 3. Accessibility hidden content
              if (parent.getAttribute('aria-hidden') === 'true') return NodeFilter.FILTER_REJECT;

              // 4. Our own elements
              if (parent.closest('.cooldesk-sticky-note') || parent.closest('#cooldesk-footer-bar') || parent.classList.contains('cooldesk-text-highlight')) return NodeFilter.FILTER_REJECT;

              // Check visibility (expensive but necessary for "visual" search?)
              if (parent.offsetParent === null) return NodeFilter.FILTER_REJECT;

              return NodeFilter.FILTER_ACCEPT;
            }
          },
          false
        );

        let currentNode;
        while (currentNode = walker.nextNode()) {
          const val = currentNode.nodeValue;
          nodeMapping.push({
            node: currentNode,
            start: allText.length,
            end: allText.length + val.length,
            length: val.length,
            text: val
          });
          allText += val;
        }

        // Step 2: Create a robust regex
        const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Normalize search string: condense multiple spaces to single space for the pattern base
        const normalizedSearch = searchStr.replace(/\s+/g, ' ').trim();

        let pattern = escapeRegExp(normalizedSearch);

        // Match zero or more whitespace/newlines between words
        pattern = pattern.replace(/ /g, '[\\s\\n]*');

        // Handle smart quotes
        pattern = pattern.replace(/'/g, "['’]");
        pattern = pattern.replace(/"/g, '["“”]');

        const regex = new RegExp(pattern, 'gmi');

        // Step 3: Find matches
        let match;
        let foundAny = false;

        while ((match = regex.exec(allText)) !== null) {
          foundAny = true;
          const globalStart = match.index;
          const globalEnd = match.index + match[0].length;

          // Step 4: Map back to nodes
          const affectedNodes = nodeMapping.filter(m =>
            (m.start < globalEnd) && (m.end > globalStart)
          );

          if (affectedNodes.length === 0) continue;

          affectedNodes.forEach(m => {
            const nodeStart = Math.max(0, globalStart - m.start);
            const nodeEnd = Math.min(m.length, globalEnd - m.start);

            if (nodeEnd > nodeStart) {
              // Check if already highlighted
              if (m.node.parentElement && m.node.parentElement.classList.contains('cooldesk-text-highlight') && m.node.parentElement.dataset.id === note.id) {
                return;
              }

              try {
                const range = document.createRange();
                range.setStart(m.node, nodeStart);
                range.setEnd(m.node, nodeEnd);

                const mark = document.createElement('mark');
                mark.className = 'cooldesk-text-highlight';
                mark.dataset.id = note.id;
                mark.title = 'CoolDesk Highlight';

                // Styles: Minimal "Highlighter" Look
                // Strictly no layout impact: no padding, no border, no margin
                // Styles: Minimal "Highlighter" Look
                // Strictly no layout impact: no padding, no border, no margin
                mark.style.backgroundColor = 'rgba(250, 204, 21, 0.3)'; // Default Yellow for dark text
                mark.style.color = 'inherit';

                // Dynamic Contrast: Switch highlight color if original text is light (e.g. white on dark mode)
                // Robust detection: traverse UP the DOM to find the effective color
                try {
                  // Helper function to find effective text color
                  const getEffectiveTextColor = (node) => {
                    let element = node.parentElement;
                    while (element) {
                      const style = window.getComputedStyle(element);
                      const color = style.color;
                      // Skip transparent/default colors
                      if (color && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') {
                        return color;
                      }
                      element = element.parentElement;
                      if (!element || element === document.body) break;
                    }
                    // Fallback: check body
                    const bodyStyle = window.getComputedStyle(document.body);
                    return bodyStyle.color || 'rgb(0, 0, 0)';
                  };

                  const effectiveColor = getEffectiveTextColor(m.node);
                  const rgb = effectiveColor.match(/\d+/g);

                  console.log('[CoolDesk] Detected color:', effectiveColor, 'RGB:', rgb);

                  if (rgb && rgb.length >= 3) {
                    const r = parseInt(rgb[0]);
                    const g = parseInt(rgb[1]);
                    const b = parseInt(rgb[2]);
                    const brightness = (r * 299 + g * 587 + b * 114) / 1000;

                    console.log('[CoolDesk] Brightness:', brightness, '(threshold: 128)');

                    if (brightness > 128) { // Light text detected
                      // Use VIOLET background for light text (high contrast!)
                      // Use setProperty with !important to force this color
                      mark.style.setProperty('background-color', 'rgba(139, 92, 246, 0.6)', 'important');
                      mark.dataset.mode = 'light-text'; // Set mode for hover handlers
                      console.log('[CoolDesk] ✓ Applied VIOLET background for light text');
                    } else {
                      console.log('[CoolDesk] ✓ Keeping YELLOW background for dark text');
                    }
                  }
                } catch (e) {
                  console.warn('[CoolDesk] Color detection failed:', e);
                }

                mark.style.cursor = 'pointer';
                // Remove border/padding to strictly preserve original line-height and layout
                mark.style.padding = '0';
                // Small negative horizontal margin to eliminate side gaps
                mark.style.marginLeft = '-0.5px';
                mark.style.marginRight = '-0.5px';
                mark.style.marginTop = '0';  // No vertical margin - let box-decoration-break handle it
                mark.style.marginBottom = '0';
                mark.style.border = 'none';
                mark.style.borderRadius = '0';

                // Make each line fragment independent (like native text selection)
                mark.style.display = 'inline';
                mark.style.boxDecorationBreak = 'clone';  // Each line is independent
                mark.style.webkitBoxDecorationBreak = 'clone';  // Safari support
                mark.style.lineHeight = 'inherit';
                mark.style.verticalAlign = 'baseline';
                mark.style.letterSpacing = 'inherit';
                mark.style.wordSpacing = 'inherit';

                mark.style.transition = 'background-color 0.2s ease';
                mark.onmouseenter = () => {
                  if (mark.dataset.mode === 'light-text') {
                    mark.style.backgroundColor = 'rgba(139, 92, 246, 0.8)'; // Darker violet on hover
                  } else {
                    mark.style.backgroundColor = 'rgba(250, 204, 21, 0.5)'; // Darker yellow on hover
                  }
                };
                mark.onmouseleave = () => {
                  if (mark.dataset.mode === 'light-text') {
                    mark.style.backgroundColor = 'rgba(139, 92, 246, 0.6)';
                  } else {
                    mark.style.backgroundColor = 'rgba(250, 204, 21, 0.3)';
                  }
                };

                mark.onclick = async (e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (confirm('Delete this highlight?')) {
                    try {
                      await new Promise(resolve => {
                        chrome.runtime.sendMessage({ action: 'deleteUrlNote', noteId: note.id }, resolve);
                      });

                      document.querySelectorAll(`mark.cooldesk-text-highlight[data-id="${note.id}"]`).forEach(el => {
                        const parent = el.parentNode;
                        while (el.firstChild) parent.insertBefore(el.firstChild, el);
                        parent.removeChild(el);
                        parent.normalize();
                      });

                      activeHighlights = activeHighlights.filter(h => h.id !== note.id);
                      showNotification('Highlight removed', '#4b5563');
                    } catch (err) {
                      console.error('Failed to delete highlight:', err);
                    }
                  }
                };

                range.surroundContents(mark);
              } catch (e) {
                console.warn('[CoolDesk Highlight] Failed to wrap node:', e);
              }
            }
          });
        }

        if (foundAny) {
          console.log('[CoolDesk] Highlight applied for:', normalizedSearch.substring(0, 20) + '...');
        }

      } catch (e) {
        console.error('Error rendering inline highlight:', e);
      }
    };

    // Mutation Observer to handle dynamic content (ChatGPT streaming)
    const setupObserver = () => {
      if (observer) return;

      observer = new MutationObserver((mutations) => {
        // Debounce: only run if no new mutations for 1s
        if (observerTimeout) clearTimeout(observerTimeout);

        observerTimeout = setTimeout(() => {
          if (activeHighlights.length > 0) {
            // console.log('[CoolDesk] DOM changed, re-applying highlights');
            activeHighlights.forEach(renderInlineHighlight);
          }
        }, 1000);
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
      });
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
        top: ${initialTop}px;
        right: ${initialRight}px;
        width: 240px;
        min-height: ${note.isCollapsed ? '40px' : '180px'};
        height: ${note.isCollapsed ? 'auto' : ''};
        background: linear-gradient(135deg, #fef9c3 0%, #fef08a 100%);
        color: #1f2937;
        border-radius: 8px;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        z-index: ${2147483645 + index};
        transition: min-height 0.2s ease, box-shadow 0.2s ease;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      `;

      let isCollapsed = !!note.isCollapsed;

      // Note Header
      const header = document.createElement('div');
      header.style.cssText = `
        padding: 8px 12px;
        border-bottom: 1px solid rgba(0, 0, 0, 0.05);
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 11px;
        color: #6b7280;
        background: rgba(255, 255, 255, 0.4);
        cursor: grab;
        user-select: none;
      `;

      // Title Area
      const titleArea = document.createElement('div');
      titleArea.style.cssText = 'display: flex; align-items: center; gap: 8px; flex: 1; overflow: hidden;';

      const toggleIcon = document.createElement('span');
      toggleIcon.innerHTML = '▼';
      toggleIcon.style.cssText = `cursor: pointer; font-size: 10px; transition: transform 0.2s; padding: 2px; transform: ${isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)'};`;

      const titleText = document.createElement('span');
      titleText.textContent = new Date(note.updatedAt || note.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      titleText.style.cssText = 'white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';

      titleArea.appendChild(toggleIcon);
      titleArea.appendChild(titleText);

      const deleteBtn = document.createElement('div');
      deleteBtn.innerHTML = '×';
      deleteBtn.title = 'Delete Note';
      deleteBtn.style.cssText = `cursor: pointer; font-size: 18px; line-height: 1; color: #9ca3af; font-weight: bold; padding: 0 4px; margin-left: 8px;`;
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
        flex: 1; width: 100%; border: none; background: transparent; resize: none; padding: 12px; font-family: inherit; font-size: 14px; line-height: 1.5; color: #374151; outline: none;
        display: ${isCollapsed ? 'none' : 'block'}; min-height: 140px;
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
        stickyNote.style.right = 'auto'; stickyNote.style.left = `${initialLeft + dx}px`; stickyNote.style.top = `${initialTopDrag + dy}px`;
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
      stickyNote.onmouseleave = () => { if (!isDragging && document.activeElement !== textarea) { stickyNote.style.zIndex = `${2147483645 + index}`; stickyNote.style.boxShadow = '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)'; } };

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

          // Store active highlights for observer
          activeHighlights = highlights;
          setupObserver();


          // Store active highlights for observer
          activeHighlights = highlights;
          setupObserver();

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

/**
 * ============================================
 * CLICK-TO-SCRAPE LINK SELECTOR
 * ============================================
 * Allows users to click on any link to scrape all similar links
 */

/**
 * Predefined Selectors for common platforms
 * Allows auto-scraping without manual selection
 */
const PREDEFINED_SELECTORS = {
  // GitHub
  'github.com': [
    // File list
    {
      selector: '.js-navigation-container .js-navigation-item .js-navigation-open[href]',
      container: '.js-navigation-container',
      links: '.js-navigation-item .js-navigation-open[href]',
      description: 'GitHub File List',
      scrapeLimit: 100
    },
    // Issue/PR list
    {
      selector: '.js-issue-row .js-navigation-open[href]',
      container: '.js-navigation-container',
      links: '.js-issue-row .js-navigation-open[href]',
      description: 'GitHub Issues/PRs',
      scrapeLimit: 50
    }
  ],
  // Hacker News
  'news.ycombinator.com': [
    {
      selector: '.athing .titleline > a',
      container: '#hnmain',
      links: '.athing .titleline > a',
      description: 'Hacker News Stories',
      scrapeLimit: 30
    }
  ],
  // Stack Overflow
  'stackoverflow.com': [
    {
      selector: '.s-post-summary--content-title a.s-link',
      container: '#questions',
      links: '.s-post-summary--content-title a.s-link',
      description: 'StackOverflow Questions',
      scrapeLimit: 50
    }
  ],
  // YouTube (Generic fallback, hard due to Shadow DOM but worth a try)
  'youtube.com': [
    {
      selector: 'ytd-rich-grid-media #video-title-link',
      container: 'ytd-rich-grid-renderer',
      links: '#video-title-link',
      description: 'YouTube Home Videos',
      scrapeLimit: 20
    }
  ],
  // Wikipedia
  'wikipedia.org': [
    {
      selector: '#mw-content-text ul li a[href^="/wiki/"]:not(.new)',
      container: '#mw-content-text',
      links: 'ul li a[href^="/wiki/"]:not(.new)',
      description: 'Wikipedia List Links',
      scrapeLimit: 100
    }
  ]
};

let isSelectMode = false;
let isSelectionLocked = false;
let isTableVisible = false; // New state for table view
let excludedPatterns = new Set(); // New state for path patterns
let includedPatterns = new Set(); // New state for path patterns (whitelist)
let manuallyExcludedUrls = new Set(); // New state for individual URL exclusion
// State for auto-scrape observers
let autoScrapeObserver = null;
let lastAutoScrapeUrl = '';
let autoScrapeTimeout = null;
let isObserverActive = false;
let selectOverlay = null;
let selectTooltip = null;
let highlightedLink = null;
let currentShadowRoot = null;
let currentShowNotification = null;
let pendingSelectorInfo = null;
let excludedDomains = new Set();
let scrapeLimit = 50; // Default limit for scraped items

/**
 * Get hostname for storage key
 */
function getHostKey() {
  return window.location.hostname.replace(/^www\./, '');
}

/**
 * Generate CSS selector for similar links
 * Strategy: Find the repeating card/item pattern, not just any container
 */
function generateLinkSelector(link) {
  // Strategy 1: Find the card/item wrapper that repeats
  const cardInfo = findRepeatingCard(link);
  if (cardInfo) {
    return cardInfo;
  }

  // Strategy 2: Find parent container with multiple links
  const container = findLinkContainer(link);
  if (!container) {
    return buildSimpleSelector(link);
  }

  const containerSelector = buildContainerSelector(container);
  const linkPattern = buildLinkPattern(link, container);

  return {
    container: containerSelector,
    links: linkPattern,
    full: containerSelector ? `${containerSelector} ${linkPattern}` : linkPattern,
    sample: {
      title: extractLinkTitle(link),
      url: link.href,
    }
  };
}

/**
 * Find the repeating card/item pattern
 * Look for parent elements that have siblings with the same structure
 */
function findRepeatingCard(link) {
  let current = link;
  let depth = 0;
  const maxDepth = 8; // Don't go too far up

  while (current && current !== document.body && depth < maxDepth) {
    const parent = current.parentElement;
    if (!parent) break;

    // Check if this element has siblings with similar structure
    const siblings = Array.from(parent.children);
    const similarSiblings = siblings.filter(sibling => {
      if (sibling === current) return true;
      // Check if sibling has similar structure (same tag, similar classes)
      if (sibling.tagName !== current.tagName) return false;
      // Must contain at least one link
      if (!sibling.querySelector('a[href]')) return false;
      // Similar class pattern (at least one shared class)
      const currentClasses = getMeaningfulClasses(current);
      const siblingClasses = getMeaningfulClasses(sibling);
      if (currentClasses.length > 0 && siblingClasses.length > 0) {
        const shared = currentClasses.filter(c => siblingClasses.includes(c));
        return shared.length > 0;
      }
      return true;
    });

    // Found repeating pattern with 2+ similar items
    if (similarSiblings.length >= 2) {
      // Build selector for the card and its primary link
      const cardSelector = buildCardSelector(current, parent);
      const linkInCard = buildLinkInCardSelector(link, current);

      // Verify the selector matches expected count
      const fullSelector = `${cardSelector} ${linkInCard}`;
      try {
        const matches = document.querySelectorAll(fullSelector);
        // Good if it matches roughly the number of similar siblings
        if (matches.length >= 2 && matches.length <= similarSiblings.length * 3) {
          return {
            container: cardSelector,
            links: linkInCard,
            full: fullSelector,
            cardCount: similarSiblings.length,
            sample: {
              title: extractLinkTitle(link),
              url: link.href,
            }
          };
        }
      } catch (e) {
        console.warn('[Scraper] Invalid selector:', fullSelector);
      }
    }

    current = parent;
    depth++;
  }

  return null;
}

/**
 * Build selector for the card element
 */
function buildCardSelector(card, parent) {
  const parts = [];

  // Start with parent selector if it has ID or meaningful class
  if (parent.id) {
    parts.push(`#${CSS.escape(parent.id)}`);
  } else {
    const parentClasses = getMeaningfulClasses(parent);
    if (parentClasses.length > 0) {
      parts.push(`.${CSS.escape(parentClasses[0])}`);
    }
  }

  // Add card tag
  parts.push(card.tagName.toLowerCase());

  // Add card's meaningful classes (max 2)
  const cardClasses = getMeaningfulClasses(card);
  if (cardClasses.length > 0) {
    parts.push(`.${cardClasses.slice(0, 2).map(c => CSS.escape(c)).join('.')}`);
  }

  // Add data attributes if present (common in React/Vue apps)
  const dataAttrs = Array.from(card.attributes).filter(a => a.name.startsWith('data-') && a.value);
  for (const attr of dataAttrs.slice(0, 1)) {
    // Only use boolean-style data attrs or short values
    if (!attr.value || attr.value.length < 30) {
      parts.push(`[${attr.name}]`);
      break;
    }
  }

  return parts.join(' > ');
}

/**
 * Build selector for the link within a card
 */
function buildLinkInCardSelector(link, card) {
  // If link is direct child
  if (link.parentElement === card) {
    const linkClasses = getMeaningfulClasses(link);
    if (linkClasses.length > 0) {
      return `> a.${CSS.escape(linkClasses[0])}[href]`;
    }
    return '> a[href]';
  }

  // Link is nested - try to find its direct container
  const linkClasses = getMeaningfulClasses(link);
  if (linkClasses.length > 0) {
    return `a.${CSS.escape(linkClasses[0])}[href]`;
  }

  // Check if link has href pattern we can use
  const href = link.getAttribute('href') || '';
  if (href.startsWith('/')) {
    // Internal link - use first path segment as pattern
    const pathMatch = href.match(/^\/([a-z0-9-]+)/i);
    if (pathMatch) {
      return `a[href^="/${pathMatch[1]}"]`;
    }
  }

  // Fallback: first link in card
  return 'a[href]:first-of-type';
}

/**
 * Find container with multiple similar links (fallback)
 */
function findLinkContainer(link) {
  let current = link.parentElement;
  let bestContainer = null;
  let bestScore = 0;

  while (current && current !== document.body) {
    const links = current.querySelectorAll('a[href]');
    const linkCount = links.length;

    if (linkCount >= 3) {
      const score = linkCount;
      const isSemanticContainer =
        current.tagName === 'NAV' ||
        current.tagName === 'UL' ||
        current.tagName === 'OL' ||
        current.getAttribute('role') === 'navigation' ||
        current.getAttribute('role') === 'menu' ||
        current.classList.contains('sidebar') ||
        current.id?.includes('sidebar');

      if (isSemanticContainer && score > bestScore) {
        bestScore = score;
        bestContainer = current;
      } else if (score > bestScore * 1.5) {
        bestScore = score;
        bestContainer = current;
      }
    }
    current = current.parentElement;
  }
  return bestContainer;
}

/**
 * Build selector for container
 */
function buildContainerSelector(container) {
  if (container.id) {
    return `#${CSS.escape(container.id)}`;
  }

  const parts = [container.tagName.toLowerCase()];

  const role = container.getAttribute('role');
  if (role) {
    parts.push(`[role="${role}"]`);
    return parts.join('');
  }

  const meaningfulClasses = getMeaningfulClasses(container);
  if (meaningfulClasses.length > 0) {
    parts.push(`.${meaningfulClasses.slice(0, 2).map(c => CSS.escape(c)).join('.')}`);
  }

  return parts.join('');
}

/**
 * Build pattern to match links
 */
function buildLinkPattern(link, container) {
  const listItem = link.closest('li');
  if (listItem && container.contains(listItem)) {
    return 'li a[href]';
  }

  const linkClasses = getMeaningfulClasses(link);
  if (linkClasses.length > 0) {
    return `a.${CSS.escape(linkClasses[0])}[href]`;
  }

  return 'a[href]';
}

/**
 * Build simple selector fallback
 */
function buildSimpleSelector(link) {
  const parts = ['a'];
  const classes = getMeaningfulClasses(link);
  if (classes.length > 0) {
    parts.push(`.${classes.slice(0, 2).map(c => CSS.escape(c)).join('.')}`);
  }
  parts.push('[href]');

  return {
    container: null,
    links: parts.join(''),
    full: parts.join(''),
    sample: {
      title: extractLinkTitle(link),
      url: link.href,
    }
  };
}

/**
 * Get meaningful class names (filter utility classes)
 */
function getMeaningfulClasses(element) {
  const classList = Array.from(element.classList || []);
  const skipPatterns = [
    /^(p|m|px|py|mx|my|pt|pb|pl|pr|mt|mb|ml|mr)-/,
    /^(w|h|min|max)-/,
    /^(flex|grid|block|inline|hidden)/,
    /^(text|font|bg|border|rounded|shadow)/,
    /^(hover|focus|active|disabled):/,
    /^(sm|md|lg|xl|2xl):/,
    /^_/,
    /^css-/,
    /^sc-/,
    /^[a-z]{1,2}$/,
  ];

  return classList.filter(cls => {
    if (cls.length < 2) return false;
    return !skipPatterns.some(pattern => pattern.test(cls));
  });
}

/**
 * Extract title from link
 */
function extractLinkTitle(link) {
  const strategies = [
    () => link.getAttribute('title'),
    () => link.getAttribute('aria-label'),
    () => link.querySelector('[title]')?.getAttribute('title'),
    () => link.querySelector('.truncate')?.textContent?.trim(),
    () => link.querySelector('span, p')?.textContent?.trim(),
    () => {
      const clone = link.cloneNode(true);
      clone.querySelectorAll('svg, img').forEach(el => el.remove());
      const text = clone.textContent?.trim();
      return text && text.length > 0 && text.length < 200 ? text : null;
    },
  ];

  for (const strategy of strategies) {
    try {
      const title = strategy();
      if (title && title.trim().length > 0) {
        return title.trim().replace(/\s+/g, ' ');
      }
    } catch { continue; }
  }
  return null;
}

/**
 * Count similar links that would be matched
 */
function countSimilarLinks(link) {
  const selector = generateLinkSelector(link);
  if (!selector) return 1;

  // If we found a card pattern, return the card count
  if (selector.cardCount) {
    return selector.cardCount;
  }

  try {
    const matches = document.querySelectorAll(selector.full);
    // Filter to only count unique URLs
    const uniqueUrls = new Set();
    for (const el of matches) {
      const a = el.tagName === 'A' ? el : el.querySelector('a[href]');
      if (a && a.href) {
        uniqueUrls.add(a.href);
      }
    }
    return uniqueUrls.size || matches.length;
  } catch { return 1; }
}

/**
 * Scrape links using selector
 * @param {string} selector - CSS selector
 * @param {Set<string>} domainsToExclude - Domains to skip
 */
function scrapeWithSelector(selector, domainsToExclude = new Set()) {
  const links = [];
  const seenUrls = new Set();

  try {
    const elements = document.querySelectorAll(selector);
    console.log(`[CoolDesk Scraper] Selector "${selector}" matched ${elements.length} elements`);
    if (domainsToExclude.size > 0) {
      console.log(`[CoolDesk Scraper] Excluding domains:`, Array.from(domainsToExclude));
    }

    for (const el of elements) {
      const link = el.tagName === 'A' ? el : el.querySelector('a[href]');
      if (!link) continue;

      const url = link.href;
      if (!url || !url.startsWith('http')) continue;

      // Check if domain is excluded
      try {
        const domain = new URL(url).hostname.replace(/^www\./, '');
        if (domainsToExclude.has(domain)) continue;
      } catch { /* ignore */ }

      // Normalize URL (remove trailing slashes, query params for dedup)
      const normalizedUrl = normalizeUrlForDedup(url);
      if (seenUrls.has(normalizedUrl)) continue;
      seenUrls.add(normalizedUrl);

      // Try to get title from the card/container, not just the link
      const card = el.tagName === 'A' ? el.parentElement : el;
      const title = extractLinkTitle(link) || extractCardTitle(card);
      if (!title || title.length < 2) continue;

      // Skip generic/navigation titles
      const lowerTitle = title.toLowerCase();
      if (['home', 'back', 'next', 'previous', 'menu', 'skip', 'close'].includes(lowerTitle)) continue;

      links.push({
        url,
        title,
        linkId: extractIdFromUrl(url),
        platform: detectPlatformName(),
        scrapedAt: Date.now(),
      });
    }

    console.log(`[CoolDesk Scraper] Found ${links.length} unique links (after domain filtering)`);
  } catch (error) {
    console.error('[CoolDesk Scraper] Selector error:', error);
  }
  return links;
}

/**
 * Normalize URL for deduplication
 */
function normalizeUrlForDedup(url) {
  try {
    const u = new URL(url);
    // Remove common tracking params
    u.searchParams.delete('ref');
    u.searchParams.delete('utm_source');
    u.searchParams.delete('utm_medium');
    u.searchParams.delete('utm_campaign');
    // Remove hash
    u.hash = '';
    // Remove trailing slash
    let path = u.pathname;
    if (path.endsWith('/') && path.length > 1) {
      path = path.slice(0, -1);
    }
    return `${u.origin}${path}${u.search}`;
  } catch {
    return url;
  }
}

/**
 * Extract title from card element (not just link)
 */
function extractCardTitle(card) {
  if (!card) return null;

  // Look for common title patterns in cards
  const titleSelectors = [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    '[class*="title"]', '[class*="name"]', '[class*="heading"]',
    '.truncate', '[class*="truncate"]',
    'strong', 'b',
  ];

  for (const selector of titleSelectors) {
    const el = card.querySelector(selector);
    if (el) {
      const text = el.textContent?.trim();
      if (text && text.length > 1 && text.length < 200) {
        return text;
      }
    }
  }

  return null;
}

/**
 * Extract ID from URL
 */
function extractIdFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split('/').filter(Boolean);

    // UUID
    for (const seg of segments) {
      if (seg.length === 36 && seg.split('-').length === 5) return seg;
    }
    // Numeric
    for (const seg of segments) {
      if (/^\d+$/.test(seg) && seg.length < 20) return seg;
    }
    return segments[segments.length - 1] || pathname;
  } catch { return url; }
}

/**
 * Detect platform name
 */
function detectPlatformName() {
  const hostname = getHostKey();
  const platforms = {
    'github.com': 'GitHub', 'gitlab.com': 'GitLab', 'vercel.com': 'Vercel',
    'netlify.com': 'Netlify', 'console.cloud.google.com': 'Google Cloud',
    'console.firebase.google.com': 'Firebase', 'notion.so': 'Notion',
    'linear.app': 'Linear', 'figma.com': 'Figma', 'render.com': 'Render',
    'railway.app': 'Railway', 'supabase.com': 'Supabase',
  };
  for (const [domain, name] of Object.entries(platforms)) {
    if (hostname.includes(domain.split('.')[0])) return name;
  }
  return hostname.split('.')[0].charAt(0).toUpperCase() + hostname.split('.')[0].slice(1);
}

/**
 * Save selector for domain with filters
 */
async function saveSelectorForDomain(selectorInfo) {
  const hostKey = getHostKey();
  try {
    const result = await chrome.storage.local.get('domainSelectors');
    const selectors = result.domainSelectors || {};

    // Create new config object
    const newConfig = {
      selector: selectorInfo.full,
      container: selectorInfo.container,
      links: selectorInfo.links,
      sample: selectorInfo.sample,
      savedAt: Date.now(),
      // Save filters
      excludedDomains: Array.from(selectorInfo.excludedDomains || []),
      excludedPatterns: Array.from(selectorInfo.excludedPatterns || []),
      includedPatterns: Array.from(selectorInfo.includedPatterns || []),
      scrapeLimit: selectorInfo.scrapeLimit || 0
    };

    selectors[hostKey] = newConfig;

    await chrome.storage.local.set({ domainSelectors: selectors });
    console.log(`[CoolDesk Scraper] Saved selector & filters for ${hostKey}:`, newConfig);
  } catch (error) {
    console.error('[CoolDesk Scraper] Failed to save selector:', error);
  }
}

/**
 * Process raw links with filters
 * Centralized logic for filtering links by domain, pattern, and limit
 */
function processScrapedLinks(rawLinks, settings = {}) {
  const {
    excludedDomains = new Set(),
    excludedPatterns = new Set(),
    includedPatterns = new Set(),
    scrapeLimit = 0
  } = settings;

  // Ensure sets
  const exDomains = excludedDomains instanceof Set ? excludedDomains : new Set(excludedDomains);
  const exPatterns = excludedPatterns instanceof Set ? excludedPatterns : new Set(excludedPatterns);
  const inPatterns = includedPatterns instanceof Set ? includedPatterns : new Set(includedPatterns);

  // 1. Filter by Domain
  let filtered = rawLinks.filter(l => {
    try {
      const domain = new URL(l.url).hostname.replace(/^www\./, '');
      if (exDomains.size > 0 && exDomains.has(domain)) return false;
      return true;
    } catch { return false; }
  });

  // 2. Filter by Pattern

  // A. Whitelist (Included Patterns) - Strict Include
  if (inPatterns.size > 0) {
    filtered = filtered.filter(l => {
      // Must match at least one included pattern
      for (const pattern of inPatterns) {
        if (urlMatchesPattern(l.url, pattern)) return true;
      }
      return false;
    });
  }

  // B. Blacklist (Excluded Patterns)
  if (exPatterns.size > 0) {
    filtered = filtered.filter(l => {
      for (const pattern of exPatterns) {
        if (urlMatchesPattern(l.url, pattern)) return false;
      }
      return true;
    });
  }

  // 3. Apply Limit (slice from end for newest/most relevant usually)
  const total = filtered.length;
  if (scrapeLimit > 0 && total > scrapeLimit) {
    filtered = filtered.slice(-scrapeLimit);
  }

  return {
    links: filtered,
    totalAvailable: total,
    finalCount: filtered.length
  };
}

/**
 * Create select mode overlay
 */
function createSelectOverlay(shadowRoot) {
  // Tooltip at top
  selectTooltip = document.createElement('div');
  selectTooltip.id = 'cooldesk-scrape-tooltip';
  selectTooltip.style.cssText = `
    position: fixed;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    color: white;
    padding: 14px 24px;
    border-radius: 12px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    z-index: 2147483647;
    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
    display: flex;
    gap: 16px;
    border: 1px solid rgba(255,255,255,0.1);
    min-width: 320px;
    max-width: 480px;
    backdrop-filter: blur(12px);
  `;
  selectTooltip.innerHTML = `
    <span style="display: flex; align-items: center; gap: 8px;">
      <span style="font-size: 20px;">🎯</span>
      <span>Click on any link to scrape similar links</span>
    </span>
    <button id="cooldesk-scrape-cancel" style="
      background: linear-gradient(135deg, #ff4757 0%, #ff6b81 100%);
      border: none;
      color: white;
      padding: 8px 16px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      transition: transform 0.2s, box-shadow 0.2s;
    ">Cancel (Esc)</button>
  `;

  shadowRoot.appendChild(selectTooltip);

  // Initial render content placeholder
  selectTooltip.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px;">
      <span style="font-size: 20px;">🎯</span>
      <div>
        <div style="font-weight: 600;">Link Selector Mode</div>
        <div style="font-size: 12px; opacity: 0.8;">Hover links to preview • Click to lock & filter</div>
      </div>
    </div>
    <button id="cooldesk-scrape-cancel" style="
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.2);
      color: white;
      padding: 6px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      margin-left: 16px;
    ">Exit (Esc)</button>
  `;

  // Cancel button handler
  const cancelBtn = selectTooltip.querySelector('#cooldesk-scrape-cancel');
  cancelBtn.onmouseenter = () => {
    cancelBtn.style.transform = 'scale(1.05)';
    cancelBtn.style.boxShadow = '0 4px 12px rgba(255,71,87,0.4)';
  };
  cancelBtn.onmouseleave = () => {
    cancelBtn.style.transform = '';
    cancelBtn.style.boxShadow = '';
  };
  cancelBtn.onclick = (e) => {
    e.stopPropagation();
    exitLinkSelectMode();
  };
}

/**
 * Remove select overlay
 */
function removeSelectOverlay() {
  if (selectTooltip) {
    selectTooltip.remove();
    selectTooltip = null;
  }
}

/**
 * Extract domain info for preview
 */
function extractDomainsPreview(selectorInfo) {
  try {
    const elements = document.querySelectorAll(selectorInfo.full);
    const domains = new Map(); // domain -> count

    for (const el of elements) {
      const link = el.tagName === 'A' ? el : el.querySelector('a[href]');
      if (!link || !link.href) continue;

      try {
        const url = new URL(link.href);
        const domain = url.hostname.replace(/^www\./, '');
        domains.set(domain, (domains.get(domain) || 0) + 1);
      } catch { continue; }
    }

    // Sort by count descending
    return Array.from(domains.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5); // Top 5 domains
  } catch {
    return [];
  }
}

/**
 * Extract URL pattern from selector
 */
function extractUrlPattern(selectorInfo) {
  try {
    const elements = document.querySelectorAll(selectorInfo.full);
    if (elements.length === 0) return null;

    // Get first few URLs to detect pattern
    const urls = [];
    for (const el of Array.from(elements).slice(0, 5)) {
      const link = el.tagName === 'A' ? el : el.querySelector('a[href]');
      if (link && link.href) {
        try {
          const u = new URL(link.href);
          urls.push(u.pathname);
        } catch { continue; }
      }
    }

    if (urls.length === 0) return null;

    // Find common pattern
    const first = urls[0];
    const parts = first.split('/').filter(Boolean);

    if (parts.length >= 2) {
      // Check if first part is consistent
      const firstParts = urls.map(u => u.split('/').filter(Boolean)[0]);
      const allSame = firstParts.every(p => p === parts[0]);

      if (allSame) {
        return `/${parts[0]}/...`;
      }
    }

    return first.length > 30 ? first.substring(0, 30) + '...' : first;
  } catch {
    return null;
  }
}





/**
 * Check if URL matches a pattern key (supporting * wildcards)
 */
function urlMatchesPattern(urlStr, patternKey) {
  try {
    const url = new URL(urlStr);
    const urlSegments = url.pathname.split('/').filter(Boolean);
    const patternSegments = patternKey.split('/').filter(Boolean);

    if (urlSegments.length !== patternSegments.length) return false;

    for (let i = 0; i < patternSegments.length; i++) {
      const p = patternSegments[i];
      const u = urlSegments[i];
      if (p !== '*' && p !== u) return false;
    }
    return true;
  } catch { return false; }
}

/**
 * Analyze URL path patterns using statistical variance
 */
function analyzePathPatterns(links) {
  try {
    const parsed = links.map(l => {
      try {
        return new URL(l.url).pathname.split('/').filter(Boolean);
      } catch { return []; }
    }).filter(p => p.length > 0);

    if (parsed.length === 0) return [];

    const maxDepth = Math.max(...parsed.map(p => p.length));
    const variableIndices = new Set();
    const total = parsed.length;

    // Detect variable positions
    for (let i = 0; i < maxDepth; i++) {
      const values = parsed.map(p => p[i]).filter(v => v !== undefined);
      const unique = new Set(values);

      // Heuristics for "Variable Segment":
      // 1. Looks like an ID (UUID, Long Number, Hash)
      // 2. High Cardinality (> 3 unique values AND > 10% of total)
      // 3. (Optional) If we consistently see different slugs

      let isIdLike = false;
      // Check sample of values for ID-traits
      const sample = Array.from(unique).slice(0, 5);
      if (sample.some(s => /^[0-9a-f]{8}-[0-9a-f]{4}/.test(s) || (/^\d+$/.test(s) && s.length > 3))) {
        isIdLike = true;
      }

      const uniqueRatio = unique.size / (values.length || 1);

      if (isIdLike || (unique.size > 2 && uniqueRatio > 0.1)) {
        variableIndices.add(i);
      }
    }

    // specific hack: if index 0 is high variance? maybe keeps it?
    // usually we want to group by resource. 

    const patterns = new Map();
    parsed.forEach(segments => {
      // Reconstruct path with wildcards
      const keyParts = segments.map((s, i) => variableIndices.has(i) ? '*' : s);
      const key = '/' + keyParts.join('/');
      patterns.set(key, (patterns.get(key) || 0) + 1);
    });

    return Array.from(patterns.entries()).sort((a, b) => b[1] - a[1]);
  } catch (e) {
    console.warn('Pattern analysis failed', e);
    return [];
  }
}

/**
 * Render usage stats and actions in tooltip
 */
function renderTooltipContent(link, selectorInfo, domains, includedCount, title, urlPattern) {
  if (!selectTooltip) return;

  // Defaults
  let finalLinks = [];
  let finalCount = includedCount || 0;
  let showPatterns = false;
  let domainsHtml = '';
  let patternsHtml = '';
  let tableHtml = '';
  let totalAvailable = 0;

  try {
    // Ensure state sets exist
    if (!excludedDomains) excludedDomains = new Set();
    if (!excludedPatterns) excludedPatterns = new Set();
    if (!includedPatterns) includedPatterns = new Set();

    if (selectorInfo && selectorInfo.full) {
      // 1. Filter by Domain first
      const domainFilteredLinks = scrapeWithSelector(selectorInfo.full, excludedDomains);

      // 2. Analyze Patterns
      const patterns = analyzePathPatterns(domainFilteredLinks);
      showPatterns = patterns.length > 1;

      // Use centralized processing
      const processed = processScrapedLinks(domainFilteredLinks, {
        excludedDomains: excludedDomains,
        excludedPatterns: excludedPatterns,
        includedPatterns: includedPatterns,
        scrapeLimit: scrapeLimit
      });

      finalLinks = processed.links;
      totalAvailable = processed.totalAvailable;
      finalCount = processed.finalCount;

      // --- Generate Filter HTML ---

      // A. Domain Filters
      if (domains.length > 0) {
        // Show if not locked OR if multiple domains exist (so you can filter)
        if (!isSelectionLocked || domains.length > 1) {
          const domainItems = domains.map(([domain, cnt]) => {
            const isChecked = !excludedDomains.has(domain);
            const shortDomain = domain.length > 26 ? domain.substring(0, 24) + '...' : domain;
            return `
                <label data-domain="${domain}" class="cooldesk-domain-item" style="
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 6px 8px;
                    background: ${isChecked ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255,255,255,0.03)'};
                    border: 1px solid ${isChecked ? 'rgba(16, 185, 129, 0.3)' : 'rgba(255,255,255,0.08)'};
                    border-radius: 6px;
                    font-size: 11px;
                    cursor: pointer;
                    transition: all 0.2s;
                    user-select: none;
                    opacity: ${isChecked ? '1' : '0.6'};
                ">
                    <input type="checkbox" ${isChecked ? 'checked' : ''} data-domain="${domain}" style="
                    width: 14px; height: 14px; cursor: pointer; accent-color: #10b981; outline: none;
                    "/>
                    <span style="flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;">${shortDomain}</span>
                    <span style="opacity: 0.6;">${cnt}</span>
                </label>
                `;
          }).join('');

          domainsHtml = `
                <div style="margin-top: 12px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.1);">
                <div style="font-size: 10px; opacity: 0.7; margin-bottom: 6px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                    Filter Domains
                </div>
                <div style="display: flex; flex-direction: column; gap: 4px; max-height: 120px; overflow-y: auto;">
                    ${domainItems}
                </div>
                </div>
            `;
        }
      }

      // B. Pattern Filters
      if (showPatterns) {
        const patternItems = patterns.map(([pattern, cnt]) => {
          const isChecked = !excludedPatterns.has(pattern);
          return `
              <label data-pattern="${pattern}" class="cooldesk-pattern-item" style="
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 6px 8px;
                background: ${isChecked ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255,255,255,0.03)'};
                border: 1px solid ${isChecked ? 'rgba(99, 102, 241, 0.4)' : 'rgba(255,255,255,0.08)'};
                border-radius: 6px;
                font-size: 11px;
                cursor: pointer;
                transition: all 0.2s;
                user-select: none;
                opacity: ${isChecked ? '1' : '0.6'};
              ">
                <input type="checkbox" ${isChecked ? 'checked' : ''} data-pattern="${pattern}" style="
                  width: 14px; height: 14px; cursor: pointer; accent-color: #6366f1; outline: none;
                "/>
                <div style="flex: 1; overflow: hidden;">
                  <div style="white-space: nowrap; text-overflow: ellipsis; font-family: monospace; color: #a5b4fc;">${pattern}</div>
                </div>
                <span style="opacity: 0.6;">${cnt}</span>
              </label>
          `;
        }).join('');

        patternsHtml = `
          <div style="margin-top: 12px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.1);">
            <div style="font-size: 10px; opacity: 0.7; margin-bottom: 6px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; display: flex; justify-content: space-between;">
               <span>Filter URL Patterns</span>
               ${isSelectionLocked ? `<a href="#" id="cooldesk-reset-patterns" style="color: #a5b4fc; text-decoration: none;">Reset</a>` : ''}
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px; max-height: 140px; overflow-y: auto;">
              ${patternItems}
            </div>
          </div>
        `;
      }

      // C. Table View
      if (isTableVisible && isSelectionLocked) {
        const rows = finalLinks.slice(0, 100).map((l, i) => `
          <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
            <td style="padding: 6px; font-size: 11px; opacity: 0.7;">${i + 1}</td>
            <td style="padding: 6px; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px;" title="${l.title}">${l.title || 'No Title'}</td>
            <td style="padding: 6px; font-size: 11px; color: #60a5fa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px;" title="${l.url}">${l.url}</td>
          </tr>
        `).join('');

        tableHtml = `
          <div style="margin-top: 12px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <strong style="font-size: 12px;">Data Preview (${finalLinks.length})</strong>
              <div style="display: flex; gap: 8px;">
                <button id="cooldesk-export-csv" style="padding: 4px 8px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.1); color: white; border-radius: 4px; font-size: 10px; cursor: pointer;">CSV</button>
                <button id="cooldesk-export-json" style="padding: 4px 8px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.1); color: white; border-radius: 4px; font-size: 10px; cursor: pointer;">JSON</button>
              </div>
            </div>
            <div style="max-height: 250px; overflow-y: auto; background: rgba(0,0,0,0.2); border-radius: 6px; border: 1px solid rgba(255,255,255,0.05);">
              <table style="width: 100%; border-collapse: collapse; text-align: left;">
                <thead style="position: sticky; top: 0; background: #1f2937;">
                  <tr>
                    <th style="padding: 6px; font-size: 10px; color: #9ca3af; width: 30px;">#</th>
                    <th style="padding: 6px; font-size: 10px; color: #9ca3af;">Title</th>
                    <th style="padding: 6px; font-size: 10px; color: #9ca3af;">URL</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows}
                </tbody>
              </table>
              ${finalLinks.length > 100 ? '<div style="padding: 8px; text-align: center; font-size: 10px; opacity: 0.5;">Showing first 100 rows</div>' : ''}
            </div>
          </div>
        `;
        selectTooltip.style.maxWidth = '650px';
      } else {
        selectTooltip.style.maxWidth = '480px';
      }
    }
  } catch (err) {
    console.error('[CoolDesk] Error calculating tooltip stats:', err);
    // Continue with defaults so at least basic info is shown
  }

  // --- Render to DOM ---
  const headerColor = isSelectionLocked ? '#10b981' : '#60a5fa';
  const headerIcon = isSelectionLocked ? '🔒' : '🎯';
  const headerText = isSelectionLocked ? 'Selection Locked' : 'Preview Mode';

  selectTooltip.innerHTML = `
      <div style="flex: 1; min-width: 0;">
        <div style="
          font-weight: 600; 
          margin-bottom: 8px; 
          display: flex; 
          align-items: center; 
          gap: 8px; 
          color: ${headerColor}; 
          text-transform: uppercase; 
          letter-spacing: 0.5px; 
          font-size: 11px;
        ">
          <span style="font-size: 14px;">${headerIcon}</span>
          <span>${headerText}</span>
        </div>
        
        <div style="margin-bottom: 8px;">
          <div style="font-size: 15px; font-weight: 600; color: white; display: flex; align-items: center; gap: 8px;">
             ${title.length > 40 ? title.substring(0, 40) + '...' : title}
          </div>
        </div>

        <div style="
          background: rgba(0,0,0,0.2);
          padding: 10px;
          border-radius: 8px;
          margin-bottom: 4px;
          border: 1px solid rgba(255,255,255,0.05);
        ">
          <div style="font-size: 13px; margin-bottom: 4px; display: flex; align-items: center; justify-content: space-between;">
            <div>
              <strong style="color: white; font-size: 16px;">${finalCount}</strong> 
              <span style="opacity: 0.8;">links</span>
              ${scrapeLimit > 0 && finalCount < totalAvailable ? `<span style="opacity: 0.5; font-size: 11px;">(of ${totalAvailable})</span>` : ''}
              ${domains.length > 0 ? `<span style="opacity: 0.5; font-size: 11px; margin-left: 4px;">from ${domains.length} domains</span>` : ''}
            </div>
            
            <div style="display: flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px;">
              <span style="font-size: 10px; opacity: 0.7; text-transform: uppercase;">Limit</span>
              <input id="cooldesk-scrape-limit" type="number" min="0" step="10" value="${scrapeLimit}" style="
                width: 40px;
                background: transparent;
                border: none;
                color: white;
                font-family: inherit;
                font-size: 11px;
                text-align: right;
                outline: none;
                padding: 0;
              " title="Set to 0 for unlimited" />
            </div>
          </div>
          
          ${urlPattern ? `
          <div style="font-size: 11px; opacity: 0.6; margin-top: 4px; display: flex; gap: 6px;">
            <span style="color: #a78bfa;">Pattern:</span> 
            <code style="font-family: 'Menlo', monospace;">${urlPattern}</code>
          </div>
          ` : ''}
        </div>

        ${domainsHtml}
        ${patternsHtml}
        ${tableHtml}
      </div>
      
      <div style="
        display: flex; 
        flex-direction: column; 
        gap: 8px; 
        margin-left: 16px; 
        padding-left: 16px; 
        border-left: 1px solid rgba(255,255,255,0.1);
        justify-content: flex-start;
      ">
        ${isSelectionLocked ? `
          <button id="cooldesk-scrape-confirm" class="cooldesk-btn-primary" style="
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            border: none;
            color: white;
            padding: 10px 20px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            white-space: nowrap;
            box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
            transition: transform 0.1s;
          ">Confirm & Send</button>
          
          <button id="cooldesk-toggle-table" style="
            background: rgba(255,255,255,0.1);
            border: 1px solid rgba(255,255,255,0.1);
            color: white;
            padding: 8px 16px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 13px;
            white-space: nowrap;
            display: flex; align-items: center; justify-content: center; gap: 6px;
          ">
            <span>${isTableVisible ? 'Hide Table' : 'Show Table'}</span>
          </button>

          <button id="cooldesk-scrape-unlock" style="
            background: transparent;
            border: 1px solid rgba(255,255,255,0.2);
            color: white;
            padding: 8px 16px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 13px;
            white-space: nowrap;
            opacity: 0.8;
          ">Unlock / Edit</button>
        ` : `
          <div style="
            font-size: 11px; 
            opacity: 0.5; 
            text-align: center; 
            font-style: italic;
            max-width: 80px;
          ">
            Click link<br>to lock<br>& filter
          </div>
        `}
        
        <button id="cooldesk-scrape-cancel" style="
          background: transparent;
          border: none;
          color: #ff4757;
          padding: 4px;
          cursor: pointer;
          font-size: 12px;
          margin-top: ${isSelectionLocked ? '4px' : '8px'};
          opacity: 0.8;
          text-decoration: underline;
        ">Cancel Mode</button>
      </div>
    `;

  // --- Attach Listeners ---

  // Checkboxes for Domains
  selectTooltip.querySelectorAll('.cooldesk-domain-item input').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      const domain = checkbox.dataset.domain;
      if (checkbox.checked) excludedDomains.delete(domain);
      else excludedDomains.add(domain);
      // Recalculate
      renderTooltipContent(link, selectorInfo, domains, 0, title, urlPattern);
    });
  });

  // Checkboxes for Patterns
  selectTooltip.querySelectorAll('.cooldesk-pattern-item input').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      const pattern = checkbox.dataset.pattern;
      if (checkbox.checked) excludedPatterns.delete(pattern);
      else excludedPatterns.add(pattern);
      renderTooltipContent(link, selectorInfo, domains, 0, title, urlPattern);
    });
  });

  // Reset Patterns
  const resetPatternsBtn = selectTooltip.querySelector('#cooldesk-reset-patterns');
  if (resetPatternsBtn) {
    resetPatternsBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      excludedPatterns.clear();
      includedPatterns.clear();
      renderTooltipContent(link, selectorInfo, domains, 0, title, urlPattern);
    };
  }

  // Export Buttons
  const csvBtn = selectTooltip.querySelector('#cooldesk-export-csv');
  if (csvBtn) {
    csvBtn.onclick = (e) => {
      e.stopPropagation();
      const csv = 'Title,URL\n' + finalLinks.map(l => `"${(l.title || '').replace(/"/g, '""')}","${l.url}"`).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `scraped_links_${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    };
  }

  const jsonBtn = selectTooltip.querySelector('#cooldesk-export-json');
  if (jsonBtn) {
    jsonBtn.onclick = (e) => {
      e.stopPropagation();
      const blob = new Blob([JSON.stringify(finalLinks, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `scraped_links_${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    };
  }

  // Toggle Table
  const toggleTableBtn = selectTooltip.querySelector('#cooldesk-toggle-table');
  if (toggleTableBtn) {
    toggleTableBtn.onclick = (e) => {
      e.stopPropagation();
      isTableVisible = !isTableVisible;
      renderTooltipContent(link, selectorInfo, domains, finalCount, title, urlPattern);
    };
  }

  // Limit Input
  const limitInput = selectTooltip.querySelector('#cooldesk-scrape-limit');
  if (limitInput) {
    limitInput.onchange = (e) => {
      e.stopPropagation();
      const val = parseInt(e.target.value, 10);
      scrapeLimit = isNaN(val) ? 0 : val;
      renderTooltipContent(link, selectorInfo, domains, 0, title, urlPattern);
    };
    limitInput.onclick = (e) => e.stopPropagation();
    limitInput.onkeydown = (e) => e.stopPropagation(); // Allow typing
  }

  // Cancel
  const cancelBtn = selectTooltip.querySelector('#cooldesk-scrape-cancel');
  if (cancelBtn) {
    cancelBtn.onclick = (e) => {
      e.stopPropagation();
      exitLinkSelectMode();
    };
  }

  // Unlock
  const unlockBtn = selectTooltip.querySelector('#cooldesk-scrape-unlock');
  if (unlockBtn) {
    unlockBtn.onclick = (e) => {
      e.stopPropagation();
      isSelectionLocked = false;
      isTableVisible = false; // Reset table
      highlightLink(link);
    };
  }

  // Confirm
  const confirmBtn = selectTooltip.querySelector('#cooldesk-scrape-confirm');
  if (confirmBtn) {
    confirmBtn.onclick = (e) => {
      e.stopPropagation();

      // Add filters to selector info for saving (Convert Sets to Arrays for JSON/Messaging)
      const saveInfo = {
        ...selectorInfo,
        excludedDomains: Array.from(excludedDomains),
        excludedPatterns: Array.from(excludedPatterns),
        includedPatterns: Array.from(includedPatterns),
        scrapeLimit: scrapeLimit
      };

      // Auto-save the config with filters!
      saveSelectorForDomain(saveInfo);

      // Use filtered links (finalLinks) instead of re-scraping
      const results = finalLinks;

      if (currentShowNotification) {
        currentShowNotification(`✓ Scraped ${results.length} links!`, '#10b981');
      }

      // Send updated config to background
      sendScrapedLinks(results, saveInfo);

      // Exit
      setTimeout(() => exitLinkSelectMode(), 500);
    };
  }
}

/**
 * Remove link highlight
 */
function unhighlightLink() {
  if (highlightedLink) {
    highlightedLink.style.outline = '';
    highlightedLink.style.outlineOffset = '';
    highlightedLink.style.backgroundColor = '';
    highlightedLink.style.borderRadius = '';
    highlightedLink = null;
  }
}

/**
 * Highlight link on hover (or update if locked)
 */
function highlightLink(element) {
  // If locked, we only update if it is the same link (re-render)
  // or do nothing if trying to highlight new link
  if (isSelectionLocked) {
    if (element !== highlightedLink) return;
  } else {
    // Normal hover mode: unhighlight previous
    unhighlightLink();
  }

  const link = element?.tagName === 'A' ? element : element?.closest('a');
  if (!link) return;

  highlightedLink = link;
  const isLocked = isSelectionLocked;

  // Styles
  link.style.outline = isLocked ? '3px solid #10b981' : '3px solid #60a5fa'; // Green if locked, Blue if hover
  link.style.outlineOffset = '2px';
  link.style.backgroundColor = isLocked ? 'rgba(16, 185, 129, 0.15)' : 'rgba(96, 165, 250, 0.15)';
  link.style.borderRadius = '4px';

  // Update tooltip with preview
  const title = extractLinkTitle(link) || 'No title';
  const selectorInfo = generateLinkSelector(link);
  pendingSelectorInfo = selectorInfo;
  const domains = extractDomainsPreview(selectorInfo);
  const urlPattern = extractUrlPattern(selectorInfo);

  // Calculate count excluding excluded domains
  const includedCount = domains
    .filter(([domain]) => !excludedDomains.has(domain))
    .reduce((sum, [, cnt]) => sum + cnt, 0);

  renderTooltipContent(link, selectorInfo, domains, includedCount, title, urlPattern);
}

/**
 * Handle mouse move in select mode
 */
function handleSelectMouseMove(e) {
  if (!isSelectMode) return;

  // If locked, prevent hovering other links
  if (isSelectionLocked) return;

  const element = document.elementFromPoint(e.clientX, e.clientY);

  // Optimize: prevent re-processing if still on the same link
  const link = element?.tagName === 'A' ? element : element?.closest('a');
  if (link && link === highlightedLink) return;

  if (element && !selectTooltip?.contains(element)) {
    highlightLink(element);
  }
}

/**
 * Check if event source is internal (our UI)
 */
function checkIsInternal(e) {
  try {
    const path = e.composedPath();
    return path.some(el => {
      // Check for our specific elements
      if (el === selectTooltip) return true;
      if (el instanceof Element && el.id === 'cooldesk-floating-button') return true;

      // Check containment if tooltip exists
      if (selectTooltip && el instanceof Node && selectTooltip.contains(el)) return true;

      return false;
    });
  } catch (err) {
    return false; // Fail safe: assume external if check fails
  }
}

/**
 * Blocking handler for non-click mouse events
 */
function handleBlocker(e) {
  if (!isSelectMode) return;

  if (checkIsInternal(e)) return;

  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
}

/**
 * Handle click in select mode
 */
function handleSelectClick(e) {
  if (!isSelectMode) return;

  // 1. Check if internal UI click (allow default behavior like checkboxes)
  if (checkIsInternal(e)) return;

  // 2. Prevent Navigation/Action absolutely
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();

  // 3. Locked Logic (return after blocking)
  if (isSelectionLocked) {
    if (selectTooltip) {
      // Visual pulse
      selectTooltip.style.transition = 'transform 0.1s';
      selectTooltip.style.transform = 'translateX(-50%) scale(1.02)';
      setTimeout(() => selectTooltip.style.transform = 'translateX(-50%) scale(1)', 100);
    }
    return;
  }

  const element = document.elementFromPoint(e.clientX, e.clientY);
  const link = element?.tagName === 'A' ? element : element?.closest('a');

  if (!link) {
    // Just block clicks on non-links silently
    return;
  }

  // LOCK SELECTION
  isSelectionLocked = true;
  highlightLink(link); // Re-render in locked state

  if (currentShowNotification) {
    currentShowNotification('Selection Locked. Review & Confirm.', '#10b981', 3000);
  }
}

/**
 * Handle keydown in select mode
 */
function handleSelectKeyDown(e) {
  if (!isSelectMode) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    exitLinkSelectMode();
  }
}

/**
 * Send scraped links to background
 */
/**
 * Send scraped links to background
 */
async function sendScrapedLinks(links, selectorInfo) {
  try {
    await chrome.runtime.sendMessage({
      type: 'SCRAPED_LINKS',
      data: {
        success: true,
        platform: detectPlatformName(),
        hostname: getHostKey(),
        links,
        selector: selectorInfo,
        scrapedAt: Date.now(),
      }
    });
    console.log(`[CoolDesk Scraper] Sent ${links.length} links to background`);
  } catch (error) {
    console.error('[CoolDesk Scraper] Failed to send links:', error);

    // Handle context invalidation (common during dev/updates)
    const isInvalidated = error.message && error.message.includes('Extension context invalidated');

    if (isInvalidated) {
      const msg = 'Extension updated. Please refresh the page.';
      if (currentShowNotification) {
        currentShowNotification(msg, '#ef4444', 0); // 0 or long duration
      } else {
        // Fallback for auto-scrape or missing notifier
        console.warn('[CoolDesk] ' + msg);
      }
    } else {
      if (currentShowNotification) {
        currentShowNotification('Failed to send data. Check console.', '#ef4444');
      }
    }
  }
}

/**
 * Enter link select mode
 */
function enterLinkSelectMode(shadowRoot, showNotification) {
  if (isSelectMode) return;

  isSelectMode = true;
  currentShadowRoot = shadowRoot;
  currentShowNotification = showNotification;

  createSelectOverlay(shadowRoot);

  // Add event listeners to document (capture phase for maximum priority)
  document.addEventListener('mousemove', handleSelectMouseMove, true);
  document.addEventListener('click', handleSelectClick, true);
  document.addEventListener('mousedown', handleBlocker, true);
  document.addEventListener('mouseup', handleBlocker, true);
  document.addEventListener('keydown', handleSelectKeyDown, true);

  console.log('[CoolDesk Scraper] Select mode activated');
}

/**
 * Exit link select mode
 */
function exitLinkSelectMode() {
  if (!isSelectMode) return;

  isSelectMode = false;
  isSelectionLocked = false;
  isTableVisible = false;
  excludedPatterns.clear();
  includedPatterns.clear();
  manuallyExcludedUrls.clear();
  unhighlightLink();
  removeSelectOverlay();

  document.removeEventListener('mousemove', handleSelectMouseMove, true);
  document.removeEventListener('click', handleSelectClick, true);
  document.removeEventListener('mousedown', handleBlocker, true);
  document.removeEventListener('mouseup', handleBlocker, true);
  document.removeEventListener('keydown', handleSelectKeyDown, true);

  currentShadowRoot = null;
  currentShowNotification = null;
  pendingSelectorInfo = null;
  excludedDomains.clear();

  console.log('[CoolDesk Scraper] Select mode deactivated');
}

/**
 * Auto-scrape if saved selector exists or predefined config matches
 */
async function autoScrapeIfConfigured() {
  try {
    const hostKey = getHostKey();

    // 1. Check Saved Configs (Higher priority)
    const result = await chrome.storage.local.get('domainSelectors');
    const selectors = result.domainSelectors || {};
    let config = selectors[hostKey];
    let source = 'saved';

    // 2. Check Predefined Configs (Fallback)
    if (!config) {
      // Check exact match or loop for partial match logic if needed
      // For now, strict domain matching
      const predefinedEntry = Object.entries(PREDEFINED_SELECTORS).find(([domain]) => hostKey.endsWith(domain));
      if (predefinedEntry) {
        // Use the first predefined selector for this domain
        config = predefinedEntry[1][0];
        source = 'predefined';
      }
    }

    if (!config) return null;

    console.log(`[CoolDesk Scraper] Auto-scraping ${hostKey} using ${source} config`, config);

    // Wait for page to load dynamic content
    await new Promise(resolve => setTimeout(resolve, 2500));

    // Scrape raw
    const rawLinks = scrapeWithSelector(config.selector);

    if (rawLinks.length === 0) {
      console.log('[CoolDesk Scraper] No links found with auto-config');
      return null;
    }

    // Apply Filters (Saved or Default)
    const processed = processScrapedLinks(rawLinks, {
      excludedDomains: config.excludedDomains || [],
      excludedPatterns: config.excludedPatterns || [],
      includedPatterns: config.includedPatterns || [],
      scrapeLimit: config.scrapeLimit || 0
    });

    const links = processed.links;

    if (links.length > 0) {
      console.log(`[CoolDesk Scraper] Auto-scraped ${links.length} links (${processed.totalAvailable} raw)`);

      // If using predefined, we might want to save it? 
      // Maybe not, let user decide to customize.

      sendScrapedLinks(links, config);
    }

    // Setup persistent observers for SPA navigation and dynamic updates
    if (!isObserverActive) {
      setupAutoScrapeObservers(config);
    }

    return links;
  } catch (error) {
    console.error('[CoolDesk Scraper] Auto-scrape failed:', error);
    return null;
  }
}

/**
 * Setup observers for dynamic content changes
 */
function setupAutoScrapeObservers(config) {
  if (isObserverActive) return;
  isObserverActive = true;
  lastAutoScrapeUrl = window.location.href;

  console.log('[CoolDesk Scraper] Setting up dynamic observers for', config.container || 'document');

  const debouncedScrape = () => {
    if (autoScrapeTimeout) clearTimeout(autoScrapeTimeout);
    autoScrapeTimeout = setTimeout(() => {
      console.log('[CoolDesk Scraper] Dynamic update detected, re-scraping...');
      autoScrapeIfConfigured();
    }, 4000); // 4s debounce to allow titles to settle
  };

  // 1. URL Change Polling (reliable for SPAs)
  setInterval(() => {
    if (window.location.href !== lastAutoScrapeUrl) {
      lastAutoScrapeUrl = window.location.href;
      console.log('[CoolDesk Scraper] URL changed, triggering scrape...');
      debouncedScrape();
    }
  }, 2000);

  // 2. DOM Mutation Observer (for sidebar updates/renames)
  if (config.container || config.selector) {
    try {
      // Use container if available, else try to find common parent of selector
      const targetSelector = config.container || 'body';
      const targetNode = document.querySelector(targetSelector) || document.body;

      autoScrapeObserver = new MutationObserver((mutations) => {
        // Filter for meaningful changes (text updates or added nodes)
        const meaningful = mutations.some(m =>
          m.type === 'childList' ||
          (m.type === 'characterData' && m.target.parentNode.tagName !== 'STYLE' && m.target.parentNode.tagName !== 'SCRIPT')
        );

        if (meaningful) {
          debouncedScrape();
        }
      });

      autoScrapeObserver.observe(targetNode, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: false
      });
      console.log('[CoolDesk Scraper] DOM Observer attached to', targetSelector);
    } catch (e) {
      console.warn('[CoolDesk Scraper] Failed to attach DOM observer:', e);
    }
  }
}

// Auto-scrape on page load (after a delay)
if (typeof window !== 'undefined') {
  const initAutoScrape = () => {
    if ('requestIdleCallback' in window) {
      // Wait for idle time, with a max timeout
      requestIdleCallback(() => {
        // Still keep a small delay to ensure rendering is settled
        setTimeout(autoScrapeIfConfigured, 3000);
      }, { timeout: 10000 });
    } else {
      // Fallback
      setTimeout(autoScrapeIfConfigured, 4000);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAutoScrape);
  } else {
    initAutoScrape();
  }
}

export default injectFooterBar;
