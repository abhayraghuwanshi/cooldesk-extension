// // Content script to inject URL notes functionality into web pages
// (function injectUrlNotes() {
//   // Prevent multiple injections
//   if (document.getElementById('cooldesk-url-notes-button')) return;
  
//   // Check if footer bar is already injected to avoid conflicts
//   const footerBarExists = document.getElementById('cooldesk-floating-bar-root');
//   if (footerBarExists) {
//     // Footer bar handles URL notes, so we don't need the separate button
//     return;
//   }
//   window.urlNotesInjected = true;

//   let urlNotesButton = null;
//   let isNotesOpen = false;

//   // Create and inject the URL notes button
//   function createUrlNotesButton() {
//     if (urlNotesButton) return;

//     const button = document.createElement('div');
//     button.id = 'url-notes-button';
//     button.innerHTML = `
//       <div style="
//         position: fixed;
//         bottom: 20px;
//         right: 20px;
//         width: 56px;
//         height: 56px;
//         border-radius: 50%;
//         background: #3b82f6;
//         border: none;
//         color: white;
//         cursor: pointer;
//         box-shadow: 0 4px 12px rgba(0,0,0,0.15);
//         z-index: 999999;
//         display: flex;
//         align-items: center;
//         justify-content: center;
//         font-size: 18px;
//         transition: all 0.2s ease;
//         font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
//       " title="Add notes to this page">
//         📝
//         <span id="notes-count" style="
//           position: absolute;
//           top: -2px;
//           right: -2px;
//           background: #dc2626;
//           color: white;
//           border-radius: 50%;
//           width: 20px;
//           height: 20px;
//           font-size: 10px;
//           display: none;
//           align-items: center;
//           justify-content: center;
//           font-weight: bold;
//         "></span>
//       </div>
//     `;

//     // Add hover effects
//     const buttonElement = button.firstElementChild;
//     buttonElement.addEventListener('mouseenter', () => {
//       buttonElement.style.transform = 'scale(1.1)';
//     });
//     buttonElement.addEventListener('mouseleave', () => {
//       buttonElement.style.transform = 'scale(1)';
//     });

//     // Add click handler
//     buttonElement.addEventListener('click', toggleNotesPanel);

//     document.body.appendChild(button);
//     urlNotesButton = button;

//     // Load notes count
//     loadNotesCount();
//   }

//   // Load and display notes count for current URL
//   async function loadNotesCount() {
//     try {
//       const response = await chrome.runtime.sendMessage({
//         action: 'getUrlNotesCount',
//         url: window.location.href
//       });

//       if (response && response.count > 0) {
//         const countElement = document.getElementById('notes-count');
//         if (countElement) {
//           countElement.textContent = response.count > 99 ? '99+' : response.count;
//           countElement.style.display = 'flex';
          
//           // Change button color to indicate notes exist
//           const buttonElement = urlNotesButton.firstElementChild;
//           buttonElement.style.background = '#10b981';
//         }
//       }
//     } catch (error) {
//       console.error('Failed to load notes count:', error);
//     }
//   }

//   // Toggle the notes panel
//   function toggleNotesPanel() {
//     if (isNotesOpen) {
//       closeNotesPanel();
//     } else {
//       openNotesPanel();
//     }
//   }

//   // Open notes panel
//   function openNotesPanel() {
//     chrome.runtime.sendMessage({
//       action: 'openUrlNotes',
//       url: window.location.href,
//       title: document.title,
//       selectedText: getSelectedText()
//     });
//     isNotesOpen = true;
//   }

//   // Close notes panel
//   function closeNotesPanel() {
//     chrome.runtime.sendMessage({
//       action: 'closeUrlNotes'
//     });
//     isNotesOpen = false;
//     loadNotesCount(); // Refresh count
//   }

//   // Get currently selected text
//   function getSelectedText() {
//     const selection = window.getSelection();
//     const selectedText = selection.toString().trim();
    
//     if (!selectedText) return null;

//     // Get context around selection
//     let context = '';
//     if (selection.rangeCount > 0) {
//       const range = selection.getRangeAt(0);
//       const container = range.commonAncestorContainer;
//       const parentElement = container.nodeType === Node.TEXT_NODE ? 
//         container.parentElement : container;
//       context = parentElement ? parentElement.textContent.trim() : '';
//     }

//     return {
//       text: selectedText,
//       context: context.substring(0, 300),
//       url: window.location.href,
//       title: document.title
//     };
//   }

//   // Listen for messages from extension
//   chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
//     switch (message.action) {
//       case 'getSelectedText':
//         sendResponse(getSelectedText());
//         break;
//       case 'closeNotesPanel':
//         closeNotesPanel();
//         break;
//       case 'refreshNotesCount':
//         loadNotesCount();
//         break;
//     }
//   });

//   // Initialize when DOM is ready
//   if (document.readyState === 'loading') {
//     document.addEventListener('DOMContentLoaded', createUrlNotesButton);
//   } else {
//     createUrlNotesButton();
//   }

//   // Handle navigation changes (for SPAs)
//   let lastUrl = window.location.href;
//   const observer = new MutationObserver(() => {
//     if (window.location.href !== lastUrl) {
//       lastUrl = window.location.href;
//       loadNotesCount();
//     }
//   });

//   observer.observe(document.body, {
//     childList: true,
//     subtree: true
//   });

// })();
