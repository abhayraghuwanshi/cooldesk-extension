// import React, { useState } from 'react';
// import { getFaviconUrl } from '../../utils/helpers';

// export function AddLinkFlow({ allItems, savedItems = [], currentWorkspace, onAdd, onAddSaved, onCancel }) {
//   const [search, setSearch] = useState('');
//   // Debounce the search input to avoid filtering on every keystroke
//   const [debouncedSearch, setDebouncedSearch] = useState('');

//   React.useEffect(() => {
//     try {
//       console.log('[AddLinkFlow] mount', {
//         allItems: Array.isArray(allItems) ? allItems.length : 0,
//         savedItems: Array.isArray(savedItems) ? savedItems.length : 0,
//         workspace: currentWorkspace,
//       });
//     } catch { }
//   }, [allItems, savedItems, currentWorkspace]);

//   React.useEffect(() => {
//     const id = setTimeout(() => setDebouncedSearch(search.trim().toLowerCase()), 200);
//     return () => clearTimeout(id);
//   }, [search]);

//   const handleAddItem = (item) => {
//     onAdd(item, currentWorkspace);
//   };

//   const looksLikeUrl = React.useMemo(() => {
//     const s = search.trim();
//     if (!s) return null;
//     try {
//       const u = new URL(s.includes('://') ? s : `https://${s}`);
//       // Only accept hostname presence
//       return u.protocol.startsWith('http') ? u.toString() : null;
//     } catch {
//       return null;
//     }
//   }, [search]);

//   const filteredItems = React.useMemo(() => {
//     const q = debouncedSearch;
//     // Build source list: history/bookmarks items not yet categorized + all saved items from DB
//     const baseItems = allItems.filter(item => !item.workspaceGroup);
//     // Insert saved first so they are retained on dedupe and appear first when no query
//     const merged = [...savedItems, ...baseItems];

//     // Dedupe by URL, prefer saved item for metadata if present
//     const byUrl = new Map();
//     for (const it of merged) {
//       const url = it?.url;
//       if (!url) continue;
//       // Because saved are inserted first, keep first occurrence.
//       if (!byUrl.has(url)) byUrl.set(url, it);
//     }
//     const items = Array.from(byUrl.values());

//     if (!q) return items.slice(0, 200);

//     const tokens = q.split(/\s+/).filter(Boolean);

//     const isSubsequence = (needle, hay) => {
//       let i = 0; for (let c of hay) { if (c === needle[i]) { i++; if (i === needle.length) return true; } }
//       return needle.length === 0;
//     };

//     const safeDomain = (u) => {
//       try { return new URL(u).hostname.toLowerCase(); } catch { return ''; }
//     };

//     const now = Date.now();
//     const scoreItem = (it) => {
//       const title = (it.title || '').toLowerCase();
//       const url = (it.url || '').toLowerCase();
//       const desc = (it.description || '').toLowerCase();
//       const domain = safeDomain(url);

//       let score = 0;
//       // Boost saved workspace items so they rank higher
//       if (it.workspaceGroup) score += 35;
//       // Primary includes
//       if (title.includes(q)) score += 60;
//       if (url.includes(q)) score += 45;
//       if (domain && domain.includes(q)) score += 40;

//       // Starts-with boosts
//       if (title.startsWith(q)) score += 15;
//       if (domain && domain.startsWith(q)) score += 12;

//       // Token-based scoring
//       for (const t of tokens) {
//         if (t.length < 2) continue;
//         if (title.includes(t)) score += 8;
//         if (domain.includes(t)) score += 6;
//         if (url.includes(t)) score += 4;
//         // word-start boost
//         if (new RegExp(`(^|[^a-z0-9])${t}`).test(title)) score += 4;
//       }

//       // Simple fuzzy subsequence
//       if (!title.includes(q) && isSubsequence(q, title)) score += 6;

//       // Recency and popularity boosts
//       const vc = it.visitCount || 0;
//       if (vc) score += Math.min(20, Math.log10(vc + 1) * 8);
//       const t = it.lastVisitTime || it.dateAdded || 0;
//       if (t) {
//         const ageDays = Math.max(0, (now - t) / (1000 * 60 * 60 * 24));
//         const recency = Math.max(0, 18 - Math.log2(1 + ageDays)); // decays with age
//         score += recency;
//       }

//       // Prefer shorter URLs a bit (cleanup factor)
//       score += Math.max(0, 6 - Math.min(6, Math.floor(url.length / 100)));

//       return score;
//     };

//     return items
//       .map(it => ({ it, score: scoreItem(it) }))
//       .filter(x => x.score > 0)
//       .sort((a, b) => b.score - a.score)
//       .slice(0, 200)
//       .map(x => x.it);
//   }, [allItems, savedItems, debouncedSearch]);

//   return (
//     <div style={{
//       fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
//       height: '100%',
//       display: 'flex',
//       flexDirection: 'column'
//     }}>
//       {/* Search Input */}
//       <div style={{
//         padding: '20px',
//         borderBottom: '1px solid var(--border-primary)',
//         display: 'flex',
//         alignItems: 'center',
//         gap: '16px',
//         background: 'var(--surface-0)'
//       }}>
//         <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--text-secondary)">
//           <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
//         </svg>
//         <input
//           type="text"
//           placeholder="Search existing items or paste a new link..."
//           value={search}
//           onChange={(e) => setSearch(e.target.value)}
//           style={{
//             flex: 1,
//             background: 'transparent',
//             border: 'transparent',
//             outline: 'none',
//             fontSize: '16px',
//             color: 'var(--text)',
//             fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
//             fontWeight: '400'
//           }}
//         />
//       </div>

//       {/* Content */}
//       <div style={{
//         flex: 1,
//         overflowY: 'auto',
//         background: 'var(--surface-1)'
//       }}>
//         {/* No matches message */}
//         {filteredItems.length === 0 && !looksLikeUrl && (
//           <div style={{
//             padding: '40px 20px',
//             textAlign: 'center',
//             color: 'var(--text-muted)',
//             fontSize: '16px'
//           }}>
//             <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔗</div>
//             <div>No matches found</div>
//             <div style={{ fontSize: '14px', marginTop: '8px' }}>
//               Saved URLs available: {Array.isArray(savedItems) ? savedItems.length : 0}
//             </div>
//           </div>
//         )}

//         {/* Add URL Button */}
//         {looksLikeUrl && (
//           <div style={{ padding: '20px', borderBottom: '1px solid var(--border-primary)' }}>
//             <button
//               onClick={() => {
//                 try { console.log('[AddLinkFlow] onAddSaved click', { url: looksLikeUrl, workspace: currentWorkspace }); } catch { }
//                 onAddSaved && onAddSaved(looksLikeUrl, currentWorkspace)
//               }}
//               style={{
//                 width: '100%',
//                 padding: '16px 20px',
//                 borderRadius: '12px',
//                 border: '1px solid var(--accent-primary)',
//                 background: 'rgba(52, 199, 89, 0.1)',
//                 color: 'var(--accent-primary)',
//                 fontSize: '16px',
//                 fontWeight: '600',
//                 cursor: 'pointer',
//                 transition: 'all 0.2s ease',
//                 display: 'flex',
//                 alignItems: 'center',
//                 justifyContent: 'center',
//                 gap: '12px'
//               }}
//               onMouseEnter={(e) => {
//                 e.target.style.background = 'rgba(52, 199, 89, 0.15)';
//               }}
//               onMouseLeave={(e) => {
//                 e.target.style.background = 'rgba(52, 199, 89, 0.1)';
//               }}
//               title={`Add ${looksLikeUrl} to ${currentWorkspace}`}
//             >
//               <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
//                 <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
//               </svg>
//               Add this URL → {currentWorkspace}
//             </button>
//           </div>
//         )}

//         {/* Items List */}
//         {filteredItems.length > 0 && (
//           <div style={{ padding: '0 20px' }}>
//             <div style={{
//               fontSize: '12px',
//               color: 'var(--text-muted)',
//               padding: '16px 0 12px 0',
//               fontWeight: '600',
//               textTransform: 'uppercase',
//               letterSpacing: '1px'
//             }}>
//               Available Items ({filteredItems.length})
//             </div>

//             {filteredItems.map((item) => {
//               const base = item.url;
//               const favicon = getFaviconUrl(base);
//               return (
//                 <div
//                   key={item.id}
//                   style={{
//                     padding: '12px',
//                     marginBottom: '8px',
//                     borderRadius: '8px',
//                     border: '1px solid var(--border-secondary)',
//                     background: 'var(--surface-2)',
//                     transition: 'all 0.2s ease',
//                     cursor: 'pointer'
//                   }}
//                   onMouseEnter={(e) => {
//                     e.target.style.background = 'var(--interactive-hover)';
//                     e.target.style.borderColor = 'var(--border-primary)';
//                   }}
//                   onMouseLeave={(e) => {
//                     e.target.style.background = 'var(--surface-2)';
//                     e.target.style.borderColor = 'var(--border-secondary)';
//                   }}
//                 >
//                   <div style={{
//                     display: 'flex',
//                     alignItems: 'center',
//                     gap: '12px',
//                     marginBottom: '8px'
//                   }}>
//                     <img
//                       src={favicon}
//                       alt=""
//                       style={{
//                         width: '20px',
//                         height: '20px',
//                         borderRadius: '4px',
//                         flexShrink: 0
//                       }}
//                       onError={(e) => {
//                         e.target.style.opacity = '0.3';
//                       }}
//                     />
//                     <div style={{ flex: 1, minWidth: 0 }}>
//                       <div style={{
//                         fontSize: '14px',
//                         fontWeight: '500',
//                         color: 'var(--text)',
//                         overflow: 'hidden',
//                         textOverflow: 'ellipsis',
//                         whiteSpace: 'nowrap',
//                         display: 'flex',
//                         alignItems: 'center',
//                         gap: '8px'
//                       }}>
//                         {item.title || base}
//                         {item.workspaceGroup && (
//                           <span style={{
//                             fontSize: '10px',
//                             padding: '2px 6px',
//                             borderRadius: '4px',
//                             fontWeight: '600',
//                             textTransform: 'uppercase',
//                             background: 'rgba(52, 199, 89, 0.2)',
//                             color: 'var(--accent-primary)'
//                           }}>
//                             SAVED
//                           </span>
//                         )}
//                       </div>
//                       <div style={{
//                         fontSize: '12px',
//                         color: 'var(--text-muted)',
//                         overflow: 'hidden',
//                         textOverflow: 'ellipsis',
//                         whiteSpace: 'nowrap',
//                         marginTop: '2px'
//                       }}>
//                         {base}
//                       </div>
//                     </div>
//                   </div>

//                   <div style={{
//                     display: 'flex',
//                     gap: '8px',
//                     justifyContent: 'flex-end'
//                   }}>
//                     <button
//                       onClick={(e) => {
//                         e.stopPropagation();
//                         window.open(base, '_blank');
//                       }}
//                       style={{
//                         padding: '6px 12px',
//                         borderRadius: '6px',
//                         border: '1px solid var(--border-secondary)',
//                         background: 'var(--surface-3)',
//                         color: 'var(--text-secondary)',
//                         fontSize: '12px',
//                         fontWeight: '500',
//                         cursor: 'pointer',
//                         transition: 'all 0.2s ease'
//                       }}
//                       onMouseEnter={(e) => {
//                         e.target.style.background = 'var(--surface-4)';
//                         e.target.style.borderColor = 'var(--border-primary)';
//                       }}
//                       onMouseLeave={(e) => {
//                         e.target.style.background = 'var(--surface-3)';
//                         e.target.style.borderColor = 'var(--border-secondary)';
//                       }}
//                     >
//                       Open
//                     </button>
//                     <button
//                       onClick={(e) => {
//                         e.stopPropagation();
//                         try { console.log('[AddLinkFlow] onAdd item click', { itemId: item.id, url: item.url, workspace: currentWorkspace, isSaved: !!item.workspaceGroup }); } catch { }
//                         if (item.workspaceGroup) {
//                           onAddSaved && onAddSaved(item.url, currentWorkspace);
//                         } else {
//                           handleAddItem(item);
//                         }
//                       }}
//                       style={{
//                         padding: '6px 12px',
//                         borderRadius: '6px',
//                         border: '1px solid var(--accent-primary)',
//                         background: 'var(--accent-primary)',
//                         color: 'white',
//                         fontSize: '12px',
//                         fontWeight: '600',
//                         cursor: 'pointer',
//                         transition: 'all 0.2s ease'
//                       }}
//                       onMouseEnter={(e) => {
//                         e.target.style.opacity = '0.9';
//                       }}
//                       onMouseLeave={(e) => {
//                         e.target.style.opacity = '1';
//                       }}
//                       title="Add this link to the workspace"
//                     >
//                       Add to {currentWorkspace}
//                     </button>
//                   </div>
//                 </div>
//               );
//             })}
//           </div>
//         )}
//       </div>
//     </div>
//   );
// }
