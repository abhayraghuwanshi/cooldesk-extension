import React, { useEffect, useState } from 'react';
import { listUrlsByWorkspace } from '../db';
import { getFaviconUrl } from '../utils';
import { ItemGrid } from './ItemGrid';

export function ProjectUrls({ selectedWorkspace, onUrlClick }) {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);

    // Load URLs for the selected workspace
    useEffect(() => {
        const loadUrls = async () => {
            if (!selectedWorkspace) {
                setItems([]);
                setLoading(false);
                return;
            }

            try {
                setLoading(true);
                const workspaceUrls = await listUrlsByWorkspace(selectedWorkspace.id);

                // Transform URLs to ItemGrid format
                const transformedItems = workspaceUrls.map(url => ({
                    url: url.url,
                    title: url.title || new URL(url.url).hostname,
                    lastVisitTime: url.addedAt || Date.now(),
                    dateAdded: url.addedAt || Date.now(),
                    workspaceId: selectedWorkspace.id,
                    favicon: url.favicon || getFaviconUrl(url.url, 32)
                }));

                setItems(transformedItems);
            } catch (error) {
                console.error('Failed to load workspace URLs:', error);
                setItems([]);
            } finally {
                setLoading(false);
            }
        };

        loadUrls();
    }, [selectedWorkspace]);

    const handleUrlClick = (url) => {
        try {
            if (onUrlClick) {
                onUrlClick(url);
            } else if (chrome?.tabs?.create) {
                chrome.tabs.create({ url: url.url });
            } else {
                window.open(url.url, '_blank');
            }
        } catch (error) {
            console.error('Failed to open URL:', error);
        }
    };

    if (!selectedWorkspace) {
        return (
            <div style={{
                padding: '20px',
                textAlign: 'center',
                color: 'rgba(255, 255, 255, 0.7)',
                fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
            }}>
                Select a workspace to view URLs
            </div>
        );
    }

    if (loading) {
        return (
            <div style={{
                padding: '20px',
                textAlign: 'center',
                color: 'rgba(255, 255, 255, 0.7)',
                fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
            }}>
                Loading workspace URLs...
            </div>
        );
    }

    return (
        <div style={{
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
            color: '#ffffff',
            marginTop: '20px',
        }}>
            <ItemGrid 
                items={items}
                workspaces={[selectedWorkspace]}
                onAddRelated={() => {}}
                onAddLink={handleUrlClick}
            />
        </div>
    );
}