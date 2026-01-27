// import React, { useEffect, useMemo, useState } from 'react';
// import { formatTime, getDomainFromUrl, getFaviconUrl, getUrlParts } from '../utils';
// import { createLinkActionHandlers, isUrlPinned } from '../utils/linkActionHandlers.js';
// import { ContextMenu } from './common/ContextMenu.jsx';
// import { WorkspaceSelectionModal } from './popups/WorkspaceSelectionModal.jsx';

// export const WorkspaceItem = React.forwardRef(function WorkspaceItem({ base, values, onAddRelated, timeSpentMs, onDelete, onAddToWorkspace, tabs = [] }, ref) {
//   const [showDetails, setShowDetails] = useState(false);
//   const [hovered, setHovered] = useState(false);
//   const [fallbackTimeMs, setFallbackTimeMs] = useState(0);
//   const [isPinned, setIsPinned] = useState(false);
//   const [showContextMenu, setShowContextMenu] = useState(false);
//   const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
//   const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);
//   const favicon = getFaviconUrl(base);
//   const cleanedBase = getUrlParts(base).key;
//   const timeString = formatTime(timeSpentMs || fallbackTimeMs);


//   useEffect(() => {
//     // Defer fetching per-item timeSpent until interaction to reduce initial load
//     if (timeSpentMs) return; // parent provided
//     if (!(showDetails || hovered)) return; // only fetch when needed
//     let mounted = true;
//     const timer = setTimeout(() => {
//       (async () => {
//         try {
//           const hasRuntime = typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage;
//           if (!hasRuntime) return;
//           const resp = await new Promise((resolve) => {
//             try {
//               chrome.runtime.sendMessage({ action: 'getTimeSpent' }, (res) => {
//                 const lastErr = chrome.runtime?.lastError;
//                 if (lastErr) return resolve({ ok: false, error: lastErr.message });
//                 resolve(res);
//               });
//             } catch (e) { resolve({ ok: false, error: String(e) }); }
//           });
//           if (mounted && resp?.ok) {
//             const ms = resp.timeSpent?.[cleanedBase] || 0;
//             setFallbackTimeMs(ms);
//           }
//         } catch (e) {
//           // non-fatal
//         }
//       })();
//     }, 300); // small delay to avoid blocking immediate interactions
//     return () => { mounted = false; clearTimeout(timer); };
//   }, [cleanedBase, timeSpentMs, showDetails, hovered]);

//   // Load pin status
//   useEffect(() => {
//     const loadPinStatus = async () => {
//       try {
//         const pinned = await isUrlPinned(base);
//         setIsPinned(pinned);
//       } catch (error) {
//         console.warn('Failed to check pin status:', error);
//       }
//     };
//     loadPinStatus();
//   }, [base]);

//   // Create action handlers
//   const actionHandlers = useMemo(() => {
//     return createLinkActionHandlers({
//       tabs,
//       onWorkspaceModalOpen: (url, title) => {
//         setShowWorkspaceModal(true);
//       },
//       onDeleteConfirm: (url) => {
//         try {
//           const hostname = new URL(url).hostname;
//           return confirm(`Remove ${hostname} from this workspace?`);
//         } catch {
//           return confirm('Remove this item from workspace?');
//         }
//       },
//       onDeleteAction: async (url) => {
//         if (onDelete) {
//           await onDelete(base, values);
//         }
//       },
//       onSuccess: (result) => {
//         if (result.action === 'pinned') {
//           setIsPinned(true);
//         } else if (result.action === 'unpinned') {
//           setIsPinned(false);
//         }
//       },
//       onError: (error) => {
//         console.error('Action error:', error);
//       }
//     });
//   }, [tabs, onDelete, base, values]);

//   // Get unique tags from all items in the workspace
//   const tags = useMemo(() => {
//     const allTags = values.flatMap(item => item.tags || []);
//     return [...new Set(allTags)];
//   }, [values]);

//   // Get workspace title
//   const workspaceTitle = useMemo(() => {
//     if (values && values.length > 0 && values[0].extractedData && values[0].extractedData.workspace) {
//       return values[0].extractedData.workspace;
//     }
//     try {
//       return new URL(base).hostname;
//     } catch {
//       return base.length > 40 ? base.slice(0, 37) + '…' : base;
//     }
//   }, [base, values]);

//   const handleItemClick = () => {
//     window.location.href = base;
//   };

//   const handleRightClick = (e) => {
//     e.preventDefault();
//     e.stopPropagation();

//     // Get click position for context menu placement
//     setContextMenuPosition({
//       x: e.clientX,
//       y: e.clientY
//     });

//     setShowContextMenu(true);
//   };

//   const toggleDetails = (e) => {
//     e.stopPropagation();
//     setShowDetails(!showDetails);
//   };

//   const handleGetRelated = (e) => {
//     e.stopPropagation();
//     onAddRelated(base, getDomainFromUrl(base));
//   };


//   // Utility function to truncate long titles
//   const truncateTitle = (title, maxLength = 35) => {
//     if (!title || title.length <= maxLength) return title;
//     return title.slice(0, maxLength).trim() + '…';
//   };

//   return (
//     <div
//       className="workspace-item"
//       tabIndex={0}
//       ref={ref}
//       onMouseEnter={() => setHovered(true)}
//       onMouseLeave={() => setHovered(false)}
//       onContextMenu={handleRightClick}
//       onKeyDown={(e) => {
//         if (e.key === 'Enter' || e.key === ' ') {
//           e.preventDefault();
//           handleItemClick();
//         }
//       }}
//       style={{
//         background: 'var(--glass-bg, rgba(255, 255, 255, 0.05))',
//         borderRadius: '12px',
//         marginBottom: '12px',
//         backdropFilter: 'blur(10px)',
//         transition: 'all 0.2s ease',
//         cursor: 'pointer',
//         transform: hovered ? 'translateY(-1px)' : 'translateY(0)',
//         position: 'relative'
//       }}
//       title="Right-click for options"
//     >
//       {/* Main clickable area */}
//       <div onClick={handleItemClick} style={{
//         padding: '16px',
//         display: 'flex',
//         alignItems: 'center',
//         gap: '12px',
//         flex: 1
//       }}>
//         {favicon && (
//           <div style={{
//             width: 48,
//             height: 48,
//             borderRadius: 10,
//             display: 'flex',
//             alignItems: 'center',
//             justifyContent: 'center',
//             flexShrink: 0
//           }}>
//             <img
//               src={favicon}
//               alt=""
//               width={32}
//               height={32}
//               style={{ borderRadius: 6 }}
//             />
//           </div>
//         )}
//         <div style={{ flex: 1, minWidth: 0 }}>
//           {/* Workspace Title */}
//           <div style={{
//             fontSize: 'var(--font-xl)',
//             color: 'var(--text, #ffffff)',
//             lineHeight: 1.4,
//             marginBottom: 2,
//             fontWeight: 600,
//             whiteSpace: 'nowrap',
//             overflow: 'hidden',
//             textOverflow: 'ellipsis'
//           }}
//             title={workspaceTitle}
//           >
//             {truncateTitle(workspaceTitle, 40)}
//           </div>

//           {/* Time spent display */}
//           {timeString && timeString !== '0s' && (
//             <div style={{
//               fontSize: 'var(--font-sm)',
//               color: 'var(--accent-color, #3b82f6)',
//               lineHeight: 1.3,
//               marginTop: 2,
//               fontWeight: 500
//             }}>
//               {timeString}
//             </div>
//           )}
//         </div>

//         {/* Three-dot menu icon */}
//         <div
//           onClick={(e) => {
//             e.stopPropagation();
//             setContextMenuPosition({
//               x: e.clientX,
//               y: e.clientY
//             });
//             setShowContextMenu(true);
//           }}
//           style={{
//             opacity: hovered ? 1 : 0,
//             transition: 'opacity 0.2s ease',
//             padding: '8px',
//             borderRadius: '6px',
//             cursor: 'pointer',
//             display: 'flex',
//             alignItems: 'center',
//             justifyContent: 'center',
//             color: 'var(--text-secondary, rgba(255, 255, 255, 0.6))',
//             fontSize: 'var(--font-xl)',
//             fontWeight: 'bold',
//             lineHeight: 1,
//             transform: 'rotate(90deg)',
//             flexShrink: 0
//           }}
//           onMouseEnter={(e) => {
//             e.target.style.background = 'var(--hover-bg, rgba(255, 255, 255, 0.1))';
//             e.target.style.color = 'var(--text-primary, #ffffff)';
//           }}
//           onMouseLeave={(e) => {
//             e.target.style.background = 'transparent';
//             e.target.style.color = 'var(--text-secondary, rgba(255, 255, 255, 0.6))';
//           }}
//           title="More options"
//         >
//           ⋯
//         </div>
//       </div>

//       {/* Context Menu - Right-click (Pin + Workspace only) */}
//       <ContextMenu
//         show={showContextMenu}
//         onClose={() => setShowContextMenu(false)}
//         url={base}
//         title={workspaceTitle}
//         onPin={actionHandlers.handlePin}
//         onDelete={actionHandlers.handleDelete}
//         onOpen={actionHandlers.handleOpen}
//         onAddToBookmarks={actionHandlers.handleAddToBookmarks}
//         onAddToWorkspace={onAddToWorkspace}
//         isPinned={isPinned}
//         position={contextMenuPosition}
//       />

//       {/* Workspace Selection Modal - From three-dot menu */}
//       <WorkspaceSelectionModal
//         show={showWorkspaceModal}
//         onClose={() => setShowWorkspaceModal(false)}
//         url={base}
//         title={workspaceTitle}
//       />
//     </div>
//   );
// });
