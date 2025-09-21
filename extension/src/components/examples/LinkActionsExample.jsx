import React, { useState, useCallback } from 'react';
import { LinkActions, QuickLinkActions, MiniLinkActions } from '../common/LinkActions.jsx';
import { createLinkActionHandlers, isUrlPinned } from '../../utils/linkActionHandlers.js';
import { AddToWorkspaceModal } from '../popups/AddToWorkspaceModal.jsx';

/**
 * Example component showing how to integrate LinkActions
 * This demonstrates different use cases and configurations
 */
export function LinkActionsExample({ tabs = [] }) {
  const [selectedWorkspace, setSelectedWorkspace] = useState(null);
  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);
  const [pendingUrl, setPendingUrl] = useState(null);
  const [pendingTitle, setPendingTitle] = useState(null);
  const [pinnedUrls, setPinnedUrls] = useState(new Set());

  // Example URLs for demonstration
  const exampleLinks = [
    { url: 'https://github.com/example/repo', title: 'Example Repository' },
    { url: 'https://stackoverflow.com/questions/123', title: 'Stack Overflow Question' },
    { url: 'https://docs.example.com/guide', title: 'Documentation Guide' }
  ];

  // Load pinned status for URLs
  React.useEffect(() => {
    const loadPinnedStatus = async () => {
      const pinned = new Set();
      for (const link of exampleLinks) {
        if (await isUrlPinned(link.url)) {
          pinned.add(link.url);
        }
      }
      setPinnedUrls(pinned);
    };
    loadPinnedStatus();
  }, []);

  // Create action handlers
  const actionHandlers = createLinkActionHandlers({
    tabs,
    onWorkspaceModalOpen: (url, title) => {
      setPendingUrl(url);
      setPendingTitle(title);
      setShowWorkspaceModal(true);
    },
    onDeleteConfirm: (url) => {
      try {
        const hostname = new URL(url).hostname;
        return confirm(`Remove ${hostname} from this list?`);
      } catch {
        return confirm('Remove this link?');
      }
    },
    onDeleteAction: async (url) => {
      // Example delete action - remove from local state
      console.log('Deleting URL:', url);
      // In real implementation, this would call your delete API
    },
    onSuccess: (result) => {
      console.log('Action success:', result);
      if (result.action === 'pinned') {
        setPinnedUrls(prev => new Set([...prev, result.url]));
      } else if (result.action === 'unpinned') {
        setPinnedUrls(prev => {
          const newSet = new Set(prev);
          newSet.delete(result.url);
          return newSet;
        });
      }
    },
    onError: (error) => {
      console.error('Action error:', error);
      alert(`Error: ${error.message}`);
    }
  });

  const handleWorkspaceSave = useCallback(async (workspaceId, url) => {
    console.log('Adding to workspace:', { workspaceId, url });
    // In real implementation, this would call your workspace API
    setShowWorkspaceModal(false);
    setPendingUrl(null);
    setPendingTitle(null);
  }, []);

  return (
    <div style={{ padding: '20px', maxWidth: '800px' }}>
      <h2 style={{ color: 'var(--text-primary, #ffffff)', marginBottom: '20px' }}>
        LinkActions Component Examples
      </h2>

      {/* Full LinkActions with all options */}
      <section style={{ marginBottom: '30px' }}>
        <h3 style={{ color: 'var(--text-primary, #ffffff)', marginBottom: '15px' }}>
          Full LinkActions (All Options)
        </h3>
        <div style={{
          background: 'var(--glass-bg, rgba(255, 255, 255, 0.1))',
          borderRadius: '8px',
          padding: '15px',
          border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))'
        }}>
          {exampleLinks.map(link => (
            <div key={link.url} style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 0',
              borderBottom: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))'
            }}>
              <div>
                <div style={{ color: 'var(--text-primary, #ffffff)', fontWeight: '500' }}>
                  {link.title}
                </div>
                <div style={{ color: 'var(--text-secondary, rgba(255, 255, 255, 0.7))', fontSize: '12px' }}>
                  {link.url}
                </div>
              </div>
              <LinkActions
                url={link.url}
                title={link.title}
                onPin={actionHandlers.handlePin}
                onAddToWorkspace={actionHandlers.handleAddToWorkspace}
                onDelete={actionHandlers.handleDelete}
                onOpen={actionHandlers.handleOpen}
                onAddToBookmarks={actionHandlers.handleAddToBookmarks}
                isPinned={pinnedUrls.has(link.url)}
              />
            </div>
          ))}
        </div>
      </section>

      {/* QuickLinkActions - Common actions only */}
      <section style={{ marginBottom: '30px' }}>
        <h3 style={{ color: 'var(--text-primary, #ffffff)', marginBottom: '15px' }}>
          QuickLinkActions (Pin, Workspace, Delete)
        </h3>
        <div style={{
          background: 'var(--glass-bg, rgba(255, 255, 255, 0.1))',
          borderRadius: '8px',
          padding: '15px',
          border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))'
        }}>
          {exampleLinks.map(link => (
            <div key={link.url} style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 0',
              borderBottom: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))'
            }}>
              <div>
                <div style={{ color: 'var(--text-primary, #ffffff)', fontWeight: '500' }}>
                  {link.title}
                </div>
                <div style={{ color: 'var(--text-secondary, rgba(255, 255, 255, 0.7))', fontSize: '12px' }}>
                  {link.url}
                </div>
              </div>
              <QuickLinkActions
                url={link.url}
                title={link.title}
                onPin={actionHandlers.handlePin}
                onAddToWorkspace={actionHandlers.handleAddToWorkspace}
                onDelete={actionHandlers.handleDelete}
                isPinned={pinnedUrls.has(link.url)}
              />
            </div>
          ))}
        </div>
      </section>

      {/* MiniLinkActions - Minimal for constrained spaces */}
      <section style={{ marginBottom: '30px' }}>
        <h3 style={{ color: 'var(--text-primary, #ffffff)', marginBottom: '15px' }}>
          MiniLinkActions (Pin, Delete only)
        </h3>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          gap: '10px'
        }}>
          {exampleLinks.map(link => (
            <div key={link.url} style={{
              background: 'var(--glass-bg, rgba(255, 255, 255, 0.1))',
              borderRadius: '6px',
              padding: '10px',
              border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  color: 'var(--text-primary, #ffffff)',
                  fontWeight: '500',
                  fontSize: '14px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  {link.title}
                </div>
              </div>
              <MiniLinkActions
                url={link.url}
                onPin={actionHandlers.handlePin}
                onDelete={actionHandlers.handleDelete}
                isPinned={pinnedUrls.has(link.url)}
              />
            </div>
          ))}
        </div>
      </section>

      {/* Custom configuration example */}
      <section style={{ marginBottom: '30px' }}>
        <h3 style={{ color: 'var(--text-primary, #ffffff)', marginBottom: '15px' }}>
          Custom Configuration (Pin and Open only)
        </h3>
        <div style={{
          background: 'var(--glass-bg, rgba(255, 255, 255, 0.1))',
          borderRadius: '8px',
          padding: '15px',
          border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))'
        }}>
          {exampleLinks.map(link => (
            <div key={link.url} style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 0',
              borderBottom: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))'
            }}>
              <div>
                <div style={{ color: 'var(--text-primary, #ffffff)', fontWeight: '500' }}>
                  {link.title}
                </div>
                <div style={{ color: 'var(--text-secondary, rgba(255, 255, 255, 0.7))', fontSize: '12px' }}>
                  {link.url}
                </div>
              </div>
              <LinkActions
                url={link.url}
                title={link.title}
                onPin={actionHandlers.handlePin}
                onOpen={actionHandlers.handleOpen}
                isPinned={pinnedUrls.has(link.url)}
                showWorkspace={false}
                showDelete={false}
                showBookmarks={false}
                position="bottom-left"
              />
            </div>
          ))}
        </div>
      </section>

      {/* Workspace selection modal */}
      <AddToWorkspaceModal
        show={showWorkspaceModal}
        onClose={() => {
          setShowWorkspaceModal(false);
          setPendingUrl(null);
          setPendingTitle(null);
        }}
        onSave={handleWorkspaceSave}
        workspace={selectedWorkspace}
        suggestions={[]} // You would pass real suggestions here
      />

      <div style={{
        marginTop: '30px',
        padding: '15px',
        background: 'var(--glass-bg, rgba(255, 255, 255, 0.05))',
        borderRadius: '8px',
        border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))'
      }}>
        <h4 style={{ color: 'var(--text-primary, #ffffff)', marginBottom: '10px' }}>
          Usage Instructions:
        </h4>
        <ul style={{ color: 'var(--text-secondary, rgba(255, 255, 255, 0.7))', marginLeft: '20px' }}>
          <li>Click the three dots (⋮) next to any link to see available actions</li>
          <li>Actions include: Pin/Unpin, Add to Workspace, Delete, Open Link, Add to Bookmarks</li>
          <li>Different components show different subsets of actions based on context</li>
          <li>The dropdown closes when you click outside or press Escape</li>
          <li>Actions are handled asynchronously with success/error callbacks</li>
        </ul>
      </div>
    </div>
  );
}