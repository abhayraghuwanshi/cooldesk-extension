// Helper functions that will be injected into the page
export const findAndClickLink = (searchText) => {
  const searchLower = searchText.toLowerCase();

  // Strategy 1: Find by exact text match
  let elements = Array.from(document.querySelectorAll('a, button, [role="button"], [onclick], input[type="submit"], input[type="button"]'));

  // Add clickable elements with common classes
  elements = elements.concat(Array.from(document.querySelectorAll('[class*="btn"], [class*="button"], [class*="link"], [class*="click"]')));

  // Find best match
  let bestMatch = null;
  let bestScore = 0;

  for (const element of elements) {
    if (!element.offsetParent && element.style.display !== 'none') continue; // Skip hidden elements

    const texts = [
      element.textContent || '',
      element.innerText || '',
      element.getAttribute('title') || '',
      element.getAttribute('aria-label') || '',
      element.getAttribute('alt') || '',
      element.getAttribute('value') || ''
    ];

    for (const text of texts) {
      if (!text) continue;
      const textLower = text.toLowerCase().trim();

      // Exact match gets highest score
      if (textLower === searchLower) {
        bestMatch = element;
        bestScore = 100;
        break;
      }

      // Word boundary match
      if (new RegExp(`\\b${searchLower}\\b`).test(textLower)) {
        const score = 80;
        if (score > bestScore) {
          bestMatch = element;
          bestScore = score;
        }
      }

      // Starts with match
      if (textLower.startsWith(searchLower)) {
        const score = 60;
        if (score > bestScore) {
          bestMatch = element;
          bestScore = score;
        }
      }

      // Contains match
      if (textLower.includes(searchLower)) {
        const score = 40;
        if (score > bestScore) {
          bestMatch = element;
          bestScore = score;
        }
      }
    }

    if (bestScore === 100) break; // Stop if we found exact match
  }

  if (bestMatch) {
    // Scroll element into view
    bestMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Highlight the element briefly
    const originalStyle = bestMatch.style.cssText;
    bestMatch.style.outline = '3px solid #ff4444';
    bestMatch.style.outlineOffset = '2px';

    setTimeout(() => {
      bestMatch.style.cssText = originalStyle;
    }, 1000);

    // Click the element
    setTimeout(() => {
      bestMatch.click();
    }, 200);

    return {
      success: true,
      elementText: bestMatch.textContent?.trim() || bestMatch.getAttribute('title') || bestMatch.getAttribute('aria-label')
    };
  } else {
    // Find suggestions for similar elements
    const suggestions = elements
      .filter(el => el.offsetParent || el.style.display !== 'none')
      .map(el => el.textContent?.trim() || el.getAttribute('title') || el.getAttribute('aria-label'))
      .filter(text => text && text.toLowerCase().includes(searchLower.substring(0, 3)))
      .slice(0, 3);

    return {
      success: false,
      suggestions: suggestions.length > 0 ? `Try: ${suggestions.join(', ')}` : ''
    };
  }
};

export const scrollPageFunction = (direction) => {
  const scrollAmount = window.innerHeight * 0.8;
  window.scrollBy({
    top: direction === 'down' ? scrollAmount : -scrollAmount,
    behavior: 'smooth'
  });
};

// Helper functions for numbered clicking
export const addNumbersToElements = () => {
  // Remove existing numbers first
  const existingNumbers = document.querySelectorAll('.voice-nav-number');
  existingNumbers.forEach(el => el.remove());

  // Remove existing scroll listener
  if (window.voiceNavScrollHandler) {
    window.removeEventListener('scroll', window.voiceNavScrollHandler, true);
    delete window.voiceNavScrollHandler;
  }

  // Remove existing mutation observer
  if (window.voiceNavMutationObserver) {
    window.voiceNavMutationObserver.disconnect();
    delete window.voiceNavMutationObserver;
  }

  // Find all clickable elements with improved selectors
  const selectors = [
    // Basic interactive elements
    'a:not([style*="display: none"]):not([hidden])', 
    'button:not([disabled]):not([style*="display: none"]):not([hidden])', 
    '[role="button"]:not([aria-hidden="true"]):not([style*="display: none"])',
    '[onclick]:not([style*="display: none"]):not([hidden])',
    'input[type="submit"]:not([disabled]):not([style*="display: none"])', 
    'input[type="button"]:not([disabled]):not([style*="display: none"])',
    
    // UI component patterns
    '[class*="btn"]:not([disabled]):not([style*="display: none"]):not([hidden])', 
    '[class*="button"]:not([disabled]):not([style*="display: none"]):not([hidden])', 
    '[class*="link"]:not([style*="display: none"]):not([hidden])',
    '[tabindex="0"]:not([aria-hidden="true"]):not([style*="display: none"])',
    
    // Collapsible and expandable elements
    '[aria-expanded]', '[data-toggle]', '[data-collapse]',
    '[class*="collapse"]:not(.collapsed)', '[class*="expand"]',
    '[class*="toggle"]:not([disabled]):not([hidden])',
    '[class*="dropdown"]:not([style*="display: none"])',
    '[class*="accordion"]:not([disabled])' ,
    
    // Icon-only elements and interactive containers  
    '[class*="icon"]:not([aria-hidden="true"])', 
    '[class*="hamburger"]', '[class*="menu-toggle"]',
    '[class*="nav-toggle"]', '[class*="sidebar-toggle"]',
    'svg[role="button"]', 'svg[onclick]', 'svg[class*="clickable"]',
    
    // Form controls and interactive elements
    'select:not([disabled])', 'input[type="checkbox"]', 'input[type="radio"]',
    '[role="tab"]:not([aria-hidden="true"])', '[role="menuitem"]',
    '[role="option"]', '[role="treeitem"]',
    
    // GitHub-specific selectors
    '[class*="js-"]:not([disabled]):not([hidden])', // GitHub JS hooks
    '[data-hydro-click]', // GitHub analytics tracking
    'button[name="button"]', // GitHub button name attribute
    '.btn-block:not([disabled])', // GitHub block buttons
    '.octicon-button:not([disabled])', // GitHub icon buttons
  ];

  let elements = [];
  selectors.forEach(selector => {
    try {
      const found = document.querySelectorAll(selector);
      elements.push(...Array.from(found));
    } catch (e) {
      console.warn('Invalid selector:', selector, e);
    }
  });

  // Debug logging for GitHub buttons specifically
  const debugButtons = document.querySelectorAll('button[class*="btn"]');
  console.log(`🔍 Found ${debugButtons.length} buttons with 'btn' class:`, 
    Array.from(debugButtons).map(btn => ({
      text: btn.textContent?.trim(),
      classes: btn.className,
      visible: btn.offsetParent !== null,
      rect: btn.getBoundingClientRect()
    }))
  );

  // Enhanced visibility filtering
  const visibleElements = elements.filter((el, index, arr) => {
    // Remove duplicates
    if (arr.indexOf(el) !== index) return false;

    // Debug specific GitHub buttons
    const isGitHubEditButton = el.textContent?.trim().includes('Edit profile') || 
                              el.classList.contains('js-profile-editable-edit-button');
    if (isGitHubEditButton) {
      console.log('🎯 GitHub Edit Profile Button Analysis:', {
        text: el.textContent?.trim(),
        classes: el.className,
        disabled: el.disabled,
        hidden: el.hidden,
        offsetParent: el.offsetParent,
        computedStyle: {
          display: window.getComputedStyle(el).display,
          visibility: window.getComputedStyle(el).visibility,
          opacity: window.getComputedStyle(el).opacity
        },
        rect: el.getBoundingClientRect(),
        parentHidden: el.parentElement ? window.getComputedStyle(el.parentElement).display : 'none'
      });
    }

    // Skip if parent is hidden
    let parent = el.parentElement;
    while (parent) {
      const parentStyle = window.getComputedStyle(parent);
      if (parentStyle.display === 'none' || 
          parentStyle.visibility === 'hidden' || 
          parentStyle.opacity === '0') {
        return false;
      }
      parent = parent.parentElement;
    }

    // Special handling for scrollable containers (Gmail, etc.)
    let scrollableParent = el.parentElement;
    while (scrollableParent) {
      const scrollStyle = window.getComputedStyle(scrollableParent);
      if (scrollStyle.overflow === 'auto' || 
          scrollStyle.overflow === 'scroll' || 
          scrollStyle.overflowY === 'auto' || 
          scrollStyle.overflowY === 'scroll') {
        
        const parentRect = scrollableParent.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        
        // Element should be within scrollable container bounds
        if (elRect.top < parentRect.top - 50 || 
            elRect.bottom > parentRect.bottom + 50) {
          return false; // Element is outside visible scroll area
        }
        break;
      }
      scrollableParent = scrollableParent.parentElement;
    }

    // Get computed styles
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();

    // Enhanced visibility checks
    const isDisplayVisible = style.display !== 'none';
    const isVisibilityVisible = style.visibility !== 'hidden';
    const hasOpacity = parseFloat(style.opacity) > 0.1;
    const hasSize = rect.width > 5 && rect.height > 5;
    const notBehindOtherElements = !style.pointerEvents || style.pointerEvents !== 'none';

    // Check if element is actually in viewport
    const isInViewport = rect.top < window.innerHeight + 100 && 
                        rect.bottom > -100 && 
                        rect.left < window.innerWidth + 100 && 
                        rect.right > -100;

    // Enhanced content detection for icon-only and collapsible elements
    const hasContent = el.textContent?.trim().length > 0 || 
                      el.getAttribute('aria-label') || 
                      el.getAttribute('title') ||
                      el.getAttribute('data-tooltip') ||
                      el.getAttribute('data-title') ||
                      el.tagName.toLowerCase() === 'button' ||
                      el.tagName.toLowerCase() === 'a' ||
                      el.tagName.toLowerCase() === 'select' ||
                      el.tagName.toLowerCase() === 'input' ||
                      // Icon-only elements
                      el.querySelector('svg, i, [class*="icon"], [class*="fa-"]') ||
                      // Collapsible elements
                      el.hasAttribute('aria-expanded') ||
                      el.hasAttribute('data-toggle') ||
                      el.hasAttribute('data-collapse') ||
                      // Interactive roles
                      ['tab', 'menuitem', 'option', 'treeitem'].includes(el.getAttribute('role'));

    // Enhanced decorative element detection
    const isNotDecorative = !el.classList.contains('overlay') &&
                           !el.classList.contains('backdrop') &&
                           !el.classList.contains('mask') &&
                           !el.classList.contains('decoration') &&
                           !el.classList.contains('spacer') &&
                           !el.getAttribute('aria-hidden') &&
                           // Allow elements with interactive indicators
                           (el.style.cursor === 'pointer' || 
                            window.getComputedStyle(el).cursor === 'pointer' ||
                            hasContent);

    return isDisplayVisible && 
           isVisibilityVisible && 
           hasOpacity && 
           hasSize && 
           notBehindOtherElements && 
           isInViewport && 
           hasContent && 
           isNotDecorative;
  });

  // Sort elements by importance and position
  const sortedElements = visibleElements.sort((a, b) => {
    const aRect = a.getBoundingClientRect();
    const bRect = b.getBoundingClientRect();
    
    // Priority scoring system
    let aScore = 0, bScore = 0;
    
    // Higher priority for interactive elements
    if (a.tagName.toLowerCase() === 'button') aScore += 10;
    if (b.tagName.toLowerCase() === 'button') bScore += 10;
    if (a.tagName.toLowerCase() === 'a') aScore += 8;
    if (b.tagName.toLowerCase() === 'a') bScore += 8;
    
    // Priority for elements with clear text or interactive indicators
    if (a.textContent?.trim().length > 0) aScore += 5;
    if (b.textContent?.trim().length > 0) bScore += 5;
    
    // Priority for collapsible/expandable elements (often important UI controls)
    if (a.hasAttribute('aria-expanded') || a.hasAttribute('data-toggle')) aScore += 7;
    if (b.hasAttribute('aria-expanded') || b.hasAttribute('data-toggle')) bScore += 7;
    
    // Priority for icon-only interactive elements
    if (a.querySelector('svg, i, [class*="icon"], [class*="fa-"]') && 
        (a.style.cursor === 'pointer' || window.getComputedStyle(a).cursor === 'pointer')) aScore += 6;
    if (b.querySelector('svg, i, [class*="icon"], [class*="fa-"]') && 
        (b.style.cursor === 'pointer' || window.getComputedStyle(b).cursor === 'pointer')) bScore += 6;
    
    // Priority for dropdown/menu elements
    if (a.getAttribute('role') === 'menuitem' || a.classList.contains('dropdown')) aScore += 4;
    if (b.getAttribute('role') === 'menuitem' || b.classList.contains('dropdown')) bScore += 4;
    
    // Priority for elements closer to top and left (reading order)
    aScore += Math.max(0, 10 - Math.floor(aRect.top / 100));
    bScore += Math.max(0, 10 - Math.floor(bRect.top / 100));
    
    // Priority for larger elements (likely more important)
    const aArea = aRect.width * aRect.height;
    const bArea = bRect.width * bRect.height;
    if (aArea > 1000) aScore += 3;
    if (bArea > 1000) bScore += 3;
    
    // Bonus for elements that might reveal hidden content
    if (a.classList.contains('toggle') || a.classList.contains('hamburger') || 
        a.classList.contains('menu-toggle')) aScore += 5;
    if (b.classList.contains('toggle') || b.classList.contains('hamburger') || 
        b.classList.contains('menu-toggle')) bScore += 5;
    
    return bScore - aScore;
  });

  // Debug: Log how many elements we found vs. will show
  console.log(`📊 Element Detection Summary:
  - Total found: ${elements.length}
  - After visibility filter: ${visibleElements.length}  
  - After sorting: ${sortedElements.length}
  - Will show: ${Math.min(20, sortedElements.length)}`);

  // Limit to top 20 elements to avoid clutter (increased from 15)
  const limitedElements = sortedElements.slice(0, 20);

  // Create container for all numbers
  const numberContainer = document.createElement('div');
  numberContainer.className = 'voice-nav-container';
  numberContainer.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 10000;
  `;
  document.body.appendChild(numberContainer);

  // Add numbers to elements
  const numberedElements = [];
  limitedElements.forEach((element, index) => {
    const number = index + 1;

    // Create number overlay with absolute positioning relative to document
    const numberEl = document.createElement('div');
    numberEl.className = 'voice-nav-number';
    numberEl.textContent = number;
    numberEl.setAttribute('data-element-index', number);
    numberEl.setAttribute('data-target-element', number);

    // Style the number with absolute positioning
    Object.assign(numberEl.style, {
      position: 'absolute',
      width: '22px',
      height: '22px',
      borderRadius: '50%',
      backgroundColor: '#ff4444',
      color: 'white',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '11px',
      fontWeight: 'bold',
      border: '2px solid white',
      boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
      fontFamily: 'Arial, sans-serif',
      pointerEvents: 'none',
      transition: 'opacity 0.2s ease',
      zIndex: '10001'
    });

    numberContainer.appendChild(numberEl);

    // Store element reference
    element.setAttribute('data-voice-nav-number', number);
    numberedElements.push({
      number: number,
      element: element,
      numberEl: numberEl,
      text: element.textContent?.trim() || element.getAttribute('title') || element.getAttribute('aria-label') || `Element ${number}`
    });
  });

  // Function to update positions with smart placement
  const updateNumberPositions = () => {
    const usedPositions = new Set();
    
    numberedElements.forEach(item => {
      const rect = item.element.getBoundingClientRect();
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

      // Check if element is still visible in viewport
      const isVisible = rect.top < window.innerHeight && rect.bottom > 0 &&
        rect.left < window.innerWidth && rect.right > 0;

      if (isVisible && rect.width > 0 && rect.height > 0) {
        // Try different positioning strategies to avoid overlaps
        const positions = [
          { top: rect.top + scrollTop - 12, left: rect.left + scrollLeft - 12 }, // Top-left (default)
          { top: rect.top + scrollTop - 12, left: rect.right + scrollLeft - 10 }, // Top-right
          { top: rect.bottom + scrollTop - 10, left: rect.left + scrollLeft - 12 }, // Bottom-left
          { top: rect.top + scrollTop + rect.height / 2 - 11, left: rect.left + scrollLeft - 12 }, // Middle-left
          { top: rect.top + scrollTop - 12, left: rect.left + scrollLeft + rect.width / 2 - 11 } // Top-center
        ];

        let bestPosition = positions[0];
        let positionFound = false;

        // Find a position that doesn't overlap with existing numbers
        for (const pos of positions) {
          const posKey = `${Math.floor(pos.top/25)}-${Math.floor(pos.left/25)}`;
          if (!usedPositions.has(posKey)) {
            bestPosition = pos;
            usedPositions.add(posKey);
            positionFound = true;
            break;
          }
        }

        // If all positions are taken, use default but with slight offset
        if (!positionFound) {
          bestPosition.top += (item.number % 3) * 5;
          bestPosition.left += (item.number % 3) * 5;
        }

        item.numberEl.style.top = `${bestPosition.top}px`;
        item.numberEl.style.left = `${bestPosition.left}px`;
        item.numberEl.style.opacity = '1';
      } else {
        // Hide numbers for elements not in viewport
        item.numberEl.style.opacity = '0.3';
      }
    });
  };

  // Initial positioning
  updateNumberPositions();

  // Add scroll listener with throttling
  let scrollTimeout;
  const scrollHandler = () => {
    if (scrollTimeout) {
      clearTimeout(scrollTimeout);
    }
    scrollTimeout = setTimeout(updateNumberPositions, 16); // ~60fps
  };

  // Store handler for cleanup
  window.voiceNavScrollHandler = scrollHandler;

  // Listen to scroll events on window and all scrollable elements
  window.addEventListener('scroll', scrollHandler, true);

  // Find and listen to scrollable containers specifically
  const scrollableContainers = document.querySelectorAll('[style*="overflow"], [style*="scroll"]');
  const autoScrollContainers = Array.from(document.querySelectorAll('*')).filter(el => {
    const style = window.getComputedStyle(el);
    return style.overflow === 'auto' || style.overflow === 'scroll' || 
           style.overflowY === 'auto' || style.overflowY === 'scroll';
  });
  
  [...scrollableContainers, ...autoScrollContainers].forEach(container => {
    container.addEventListener('scroll', scrollHandler, { passive: true });
  });

  // Also listen for resize events
  window.addEventListener('resize', scrollHandler);

  // Set up mutation observer for dynamic content changes
  const mutationObserver = new MutationObserver((mutations) => {
    let shouldRefresh = false;
    
    mutations.forEach((mutation) => {
      // Check for added nodes that might be interactive
      if (mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if added node or its children contain interactive elements
            const interactiveSelectors = 'a, button, [role="button"], [onclick], input[type="submit"], input[type="button"], [class*="btn"], select, [role="tab"], [role="menuitem"]';
            
            if (node.matches && node.matches(interactiveSelectors)) {
              shouldRefresh = true;
              break;
            } else if (node.querySelector && node.querySelector(interactiveSelectors)) {
              shouldRefresh = true;
              break;
            }
          }
        }
      }
      
      // Check for attribute changes that might affect visibility
      if (mutation.type === 'attributes') {
        const target = mutation.target;
        if (mutation.attributeName === 'class' || 
            mutation.attributeName === 'style' ||
            mutation.attributeName === 'aria-expanded' ||
            mutation.attributeName === 'aria-hidden') {
          
          // Check if this affects interactive elements
          const interactiveSelectors = 'a, button, [role="button"], [onclick], input[type="submit"], input[type="button"], [class*="btn"], select';
          if (target.matches && target.matches(interactiveSelectors)) {
            shouldRefresh = true;
          } else if (target.querySelector && target.querySelector(interactiveSelectors)) {
            shouldRefresh = true;
          }
        }
      }
    });

    // Throttled refresh to avoid excessive updates
    if (shouldRefresh && !window.voiceNavRefreshPending) {
      window.voiceNavRefreshPending = true;
      setTimeout(() => {
        // Re-run the numbering if numbers are currently shown
        if (document.querySelector('.voice-nav-container')) {
          console.log('🔄 Auto-refreshing numbers due to DOM changes');
          
          // Clean up current numbers
          const currentNumbers = document.querySelectorAll('.voice-nav-number');
          currentNumbers.forEach(el => el.remove());
          const currentContainer = document.querySelector('.voice-nav-container');
          if (currentContainer) currentContainer.remove();
          
          // Re-add numbers with current function context
          try {
            const result = addNumbersToElements();
            // Signal that numbers were refreshed
            if (window.voiceNavRefreshCallback) {
              window.voiceNavRefreshCallback(result.count);
            }
          } catch (e) {
            console.error('Error refreshing numbers:', e);
          }
        }
        window.voiceNavRefreshPending = false;
      }, 1000); // Wait 1 second to batch multiple changes
    }
  });

  // Observe the entire document for changes
  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'aria-expanded', 'aria-hidden', 'hidden']
  });

  // Store observer for cleanup
  window.voiceNavMutationObserver = mutationObserver;

  return {
    count: limitedElements.length,
    elements: numberedElements.map(item => ({
      number: item.number,
      text: item.text
    }))
  };
};

export const removeNumbersFromElements = () => {
  // Remove number elements and container
  const numberContainer = document.querySelector('.voice-nav-container');
  if (numberContainer) {
    numberContainer.remove();
  }

  const numberElements = document.querySelectorAll('.voice-nav-number');
  numberElements.forEach(el => el.remove());

  // Remove scroll listener
  if (window.voiceNavScrollHandler) {
    window.removeEventListener('scroll', window.voiceNavScrollHandler, true);
    window.removeEventListener('resize', window.voiceNavScrollHandler);
    delete window.voiceNavScrollHandler;
  }

  // Clean up element attributes
  const numberedElements = document.querySelectorAll('[data-voice-nav-number]');
  numberedElements.forEach(el => el.removeAttribute('data-voice-nav-number'));
};

export const clickElementByNumber = (number) => {
  const element = document.querySelector(`[data-voice-nav-number="${number}"]`);

  if (!element) {
    const maxNumber = document.querySelectorAll('[data-voice-nav-number]').length;
    return {
      success: false,
      maxNumber: maxNumber > 0 ? maxNumber : null
    };
  }

  // Scroll element into view
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Highlight the element briefly
  const originalStyle = element.style.cssText;
  element.style.outline = '3px solid #00ff00';
  element.style.outlineOffset = '2px';

  setTimeout(() => {
    element.style.cssText = originalStyle;
  }, 1000);

  // Enhanced click handling for collapsible elements
  setTimeout(() => {
    element.click();
    
    // For collapsible elements, wait and refresh numbers if content is revealed
    if (element.hasAttribute('aria-expanded') || 
        element.hasAttribute('data-toggle') ||
        element.classList.contains('dropdown') ||
        element.classList.contains('collapse') ||
        element.classList.contains('toggle') ||
        element.classList.contains('hamburger') ||
        element.classList.contains('menu-toggle')) {
      
      // Wait for potential DOM changes
      setTimeout(() => {
        // Check if new content appeared
        const newElements = document.querySelectorAll('a, button, [role="button"], [onclick], input[type="submit"], input[type="button"]');
        const currentCount = document.querySelectorAll('[data-voice-nav-number]').length;
        
        if (newElements.length > currentCount) {
          // Auto-refresh numbers if new interactive content appeared
          setTimeout(() => {
            if (window.voiceNavAutoRefresh) {
              // Remove old numbers
              const oldNumbers = document.querySelectorAll('.voice-nav-number');
              oldNumbers.forEach(el => el.remove());
              const oldContainer = document.querySelector('.voice-nav-container');
              if (oldContainer) oldContainer.remove();
              
              // Add fresh numbers (this would need to be called from the React component)
              console.log('New interactive content detected - consider refreshing numbers');
            }
          }, 500);
        }
      }, 300);
    }
  }, 200);

  return {
    success: true,
    elementText: element.textContent?.trim() || 
                element.getAttribute('title') || 
                element.getAttribute('aria-label') ||
                element.getAttribute('data-tooltip') ||
                `Element ${number}`
  };
};

// Content marking function (injected into page)
export const addNumbersToContentElements = () => {
  // Remove existing numbers first
  const existingNumbers = document.querySelectorAll('.voice-nav-number');
  existingNumbers.forEach(el => el.remove());

  // Remove existing container
  const existingContainer = document.querySelector('.voice-nav-container');
  if (existingContainer) existingContainer.remove();

  // Content element selectors with semantic meaning
  const contentSelectors = [
    // Primary content structures
    'article', 'section', 'main', '[role="main"]',
    
    // Headings (high priority)
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    
    // Content blocks
    'p:not(:empty)', 'blockquote', 'pre', 'code',
    
    // Lists and structured content  
    'ul:not(:empty)', 'ol:not(:empty)', 'dl:not(:empty)',
    'li:not(:empty)', 'dt', 'dd',
    
    // Rich content
    'figure', 'figcaption', 'table', 'thead', 'tbody',
    
    // Semantic content
    '[role="article"]', '[role="region"]', '[role="complementary"]',
    '.content', '.post', '.article', '.section',
    '.paragraph', '.text-block', '.description',
    
    // Forms as content
    'fieldset', 'legend', 'label:not(:empty)',
    
    // Navigation content
    'nav:not(:empty)', '[role="navigation"]:not(:empty)',
    
    // Media with captions
    'video + p', 'img + p', 'iframe + p'
  ];

  let contentElements = [];
  contentSelectors.forEach(selector => {
    try {
      const found = document.querySelectorAll(selector);
      contentElements.push(...Array.from(found));
    } catch (e) {
      console.warn('Invalid content selector:', selector, e);
    }
  });

  // Enhanced content filtering and prioritization
  const validContent = contentElements.filter((el, index, arr) => {
    // Remove duplicates
    if (arr.indexOf(el) !== index) return false;

    // Skip if parent is hidden
    let parent = el.parentElement;
    while (parent) {
      const parentStyle = window.getComputedStyle(parent);
      if (parentStyle.display === 'none' || 
          parentStyle.visibility === 'hidden' || 
          parentStyle.opacity === '0') {
        return false;
      }
      parent = parent.parentElement;
    }

    // Basic visibility checks
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    
    const isVisible = style.display !== 'none' &&
                     style.visibility !== 'hidden' &&
                     parseFloat(style.opacity) > 0.1 &&
                     rect.width > 10 && rect.height > 10;

    // Content quality checks
    const textContent = el.textContent?.trim() || '';
    const hasSubstantialContent = textContent.length > 10; // At least 10 characters
    
    // Skip navigation-only elements in content mode
    const isNavigationOnly = el.tagName.toLowerCase() === 'nav' &&
                            el.querySelectorAll('a, button').length > textContent.split(' ').length;

    // Skip if it's just a container with no direct text content
    const hasDirectText = textContent.length > 0 && 
                         (el.children.length === 0 || 
                          textContent.length > Array.from(el.children).reduce((sum, child) => 
                            sum + (child.textContent?.length || 0), 0) * 0.3);

    return isVisible && hasSubstantialContent && !isNavigationOnly && hasDirectText;
  });

  // Smart content prioritization
  const prioritizedContent = validContent.sort((a, b) => {
    let aScore = 0, bScore = 0;
    
    // Heading hierarchy (highest priority)
    const headingScores = { h1: 100, h2: 90, h3: 80, h4: 70, h5: 60, h6: 50 };
    aScore += headingScores[a.tagName.toLowerCase()] || 0;
    bScore += headingScores[b.tagName.toLowerCase()] || 0;
    
    // Main content areas
    if (a.tagName.toLowerCase() === 'main' || a.getAttribute('role') === 'main') aScore += 95;
    if (b.tagName.toLowerCase() === 'main' || b.getAttribute('role') === 'main') bScore += 95;
    
    // Articles and sections
    if (a.tagName.toLowerCase() === 'article') aScore += 85;
    if (b.tagName.toLowerCase() === 'article') bScore += 85;
    if (a.tagName.toLowerCase() === 'section') aScore += 75;
    if (b.tagName.toLowerCase() === 'section') bScore += 75;
    
    // Content length (substantial content gets priority)
    const aLength = a.textContent?.trim().length || 0;
    const bLength = b.textContent?.trim().length || 0;
    if (aLength > 100) aScore += Math.min(20, Math.floor(aLength / 100));
    if (bLength > 100) bScore += Math.min(20, Math.floor(bLength / 100));
    
    // Semantic classes
    const contentClasses = ['content', 'post', 'article', 'main-text', 'description'];
    contentClasses.forEach(cls => {
      if (a.classList.contains(cls)) aScore += 15;
      if (b.classList.contains(cls)) bScore += 15;
    });
    
    // Reading order (top to bottom)
    const aRect = a.getBoundingClientRect();
    const bRect = b.getBoundingClientRect();
    aScore += Math.max(0, 10 - Math.floor(aRect.top / 100));
    bScore += Math.max(0, 10 - Math.floor(bRect.top / 100));
    
    return bScore - aScore;
  });

  // Limit to top 15 content elements
  const limitedContent = prioritizedContent.slice(0, 15);

  // Create container for numbers
  const numberContainer = document.createElement('div');
  numberContainer.className = 'voice-nav-container';
  numberContainer.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 10000;
  `;
  document.body.appendChild(numberContainer);

  // Add numbers to content elements
  const numberedContent = [];
  limitedContent.forEach((element, index) => {
    const number = index + 1;

    // Create number overlay
    const numberEl = document.createElement('div');
    numberEl.className = 'voice-nav-number voice-nav-content';
    numberEl.textContent = number;
    numberEl.setAttribute('data-content-number', number);

    // Style for content numbers (different color)
    Object.assign(numberEl.style, {
      position: 'absolute',
      width: '24px',
      height: '24px',
      borderRadius: '50%',
      backgroundColor: '#2196F3', // Blue for content
      color: 'white',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '11px',
      fontWeight: 'bold',
      border: '2px solid white',
      boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
      fontFamily: 'Arial, sans-serif',
      pointerEvents: 'none',
      zIndex: '10001'
    });

    numberContainer.appendChild(numberEl);

    // Position the number
    const rect = element.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
    
    numberEl.style.top = `${rect.top + scrollTop - 12}px`;
    numberEl.style.left = `${rect.left + scrollLeft - 12}px`;

    // Store element reference
    element.setAttribute('data-voice-content-number', number);
    numberedContent.push({
      number: number,
      element: element,
      title: element.tagName.toLowerCase() === 'h1' || element.tagName.toLowerCase() === 'h2' || 
             element.tagName.toLowerCase() === 'h3' || element.tagName.toLowerCase() === 'h4' ||
             element.tagName.toLowerCase() === 'h5' || element.tagName.toLowerCase() === 'h6' ?
             element.textContent?.trim().substring(0, 50) : 
             element.tagName.toLowerCase() + ' content',
      content: element.textContent?.trim().substring(0, 500) || ''
    });
  });

  return {
    count: limitedContent.length,
    elements: numberedContent
  };
};

// Read content by number function (injected into page)
export const readContentElementByNumber = (number) => {
  const element = document.querySelector(`[data-voice-content-number="${number}"]`);
  
  if (!element) {
    return { success: false };
  }

  // Scroll element into view
  element.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Highlight the content briefly
  const originalStyle = element.style.cssText;
  element.style.outline = '3px solid #2196F3';
  element.style.outlineOffset = '2px';
  element.style.backgroundColor = 'rgba(33, 150, 243, 0.1)';

  setTimeout(() => {
    element.style.cssText = originalStyle;
  }, 2000);

  const title = element.tagName.match(/h[1-6]/i) ? 
               element.textContent?.trim().substring(0, 50) :
               `${element.tagName.toLowerCase()} content`;

  return {
    success: true,
    title: title,
    content: element.textContent?.trim() || ''
  };
};