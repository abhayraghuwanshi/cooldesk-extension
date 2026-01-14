import React, { useCallback, useState } from 'react';
import { formatTime, getDomainFromUrl, getFaviconUrl } from '../utils';
import { ProjectSublinks } from './ProjectSublinks';

export function WorkspaceProject({
  workspace,
  timeSpentMs,
  onAddRelated,
  onAddLink,
  onDelete,
  onItemClick
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const { key, values, workspace: workspaceInfo, favicon, info } = workspace;

  const primaryUrl = values?.[0]?.url || key;
  const displayFavicon = favicon || getFaviconUrl(primaryUrl);
  const timeString = formatTime(timeSpentMs || 0);

  // Get workspace display information
  const getWorkspaceDisplay = useCallback(() => {
    // Try to get workspace name from extracted data
    if (values && values.length > 0 && values[0].extractedData && values[0].extractedData.workspace) {
      return {
        title: values[0].extractedData.workspace,
        subtitle: getWorkspaceSubtitle()
      };
    }

    // Use workspace info if available
    if (info?.displayName) {
      return {
        title: info.displayName,
        subtitle: getWorkspaceSubtitle()
      };
    }

    // Fallback to hostname
    try {
      return {
        title: new URL(primaryUrl).hostname,
        subtitle: getWorkspaceSubtitle()
      };
    } catch {
      const displayKey = key.length > 40 ? key.slice(0, 37) + '…' : key;
      return {
        title: displayKey,
        subtitle: getWorkspaceSubtitle()
      };
    }
  }, [values, info, key, primaryUrl]);

  const getWorkspaceSubtitle = useCallback(() => {
    if (!values || values.length <= 1) {
      // Single item - show title or hostname
      if (values?.[0]?.extractedData?.title) {
        return values[0].extractedData.title;
      }
      try {
        return new URL(primaryUrl).hostname;
      } catch {
        return primaryUrl;
      }
    }

    // Multiple items - show count and type
    const hasConversations = values.some(item =>
      item.extractedData?.details?.type === 'conversation'
    );

    if (hasConversations) {
      const conversationCount = values.filter(item =>
        item.extractedData?.details?.type === 'conversation'
      ).length;
      return `${conversationCount} conversation${conversationCount !== 1 ? 's' : ''}`;
    } else {
      return `${values.length} URLs`;
    }
  }, [values, primaryUrl]);

  const handleWorkspaceClick = useCallback(() => {
    if (onItemClick) {
      onItemClick(primaryUrl);
    } else {
      window.open(primaryUrl, '_blank');
    }
  }, [primaryUrl, onItemClick]);

  const handleExpandClick = useCallback((e) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  }, [isExpanded]);

  const handleGetRelated = useCallback((e) => {
    e.stopPropagation();
    if (onAddRelated) {
      onAddRelated(primaryUrl, getDomainFromUrl(primaryUrl));
    }
  }, [primaryUrl, onAddRelated]);

  const handleAddLink = useCallback((e) => {
    e.stopPropagation();
    if (onAddLink) {
      onAddLink(workspaceInfo);
    }
  }, [workspaceInfo, onAddLink]);

  const handleDelete = useCallback((e) => {
    e.stopPropagation();
    if (onDelete) {
      onDelete(key, values);
    }
  }, [key, values, onDelete]);

  const display = getWorkspaceDisplay();

  // Dynamic gradient generation based on domain
  const getDomainColor = (url) => {
    let hostname = '';
    try {
      hostname = new URL(url || '').hostname.toLowerCase();
    } catch {
      return {
        bg: 'linear-gradient(135deg, rgba(15, 23, 36, 0.8) 0%, rgba(27, 35, 49, 0.8) 100%)',
        border: '#273043',
        accent: '#4a5568'
      };
    }

    // Accent colors for variety
    const accentColors = [
      '#3b82f6', // Blue
      '#6b7280', // Gray
      '#4b5563', // Slate
      '#22c55e', // Green
      '#ea580c', // Orange
      '#a855f7', // Purple
      '#f43f5e', // Rose
      '#0891b2', // Cyan
    ];

    // Simple hash function for consistent color selection
    let hash = 0;
    for (let i = 0; i < hostname.length; i++) {
      hash = ((hash << 5) - hash) + hostname.charCodeAt(i);
      hash = hash & hash;
    }

    const colorIndex = Math.abs(hash) % accentColors.length;
    const accent = accentColors[colorIndex];

    return {
      bg: `linear-gradient(135deg, rgba(15, 23, 36, 0.8) 0%, rgba(27, 35, 49, 0.8) 100%)`,
      border: accent,
      accent: accent
    };
  };

  return (
    <div
      tabIndex={0}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleWorkspaceClick();
        }
      }}
    >
      {/* ProjectSublinks - expandable section */}
      {values && values.length > 1 && (
        <div style={{
          width: '100%',
          flex: 1,
          marginTop: '16px'
        }}>
          <div>
            <ProjectSublinks
              values={values}
              onDelete={onDelete}
              onAddToWorkspace={undefined}
              tabs={[]}
            />
          </div>
        </div>
      )}
    </div>
  );
}