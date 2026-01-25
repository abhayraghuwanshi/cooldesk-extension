import { faTimes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';
import '../../../styles/theme.css';
import { scoreAndSortTabs } from '../../../utils/tabScoring.js';

export function SidebarTabs() {
    const [tabs, setTabs] = useState([]);

    useEffect(() => {
        // Load initial tabs with smart sorting
        chrome.tabs.query({}, async (result) => {
            const sorted = await scoreAndSortTabs(result);
            setTabs(sorted);
        });

        // Listen for updates
        const handleUpdated = (tabId, changeInfo, tab) => {
            setTabs(prev => {
                const idx = prev.findIndex(t => t.id === tabId);
                if (idx === -1) return [...prev, tab];
                const newTabs = [...prev];
                newTabs[idx] = tab;
                return newTabs;
            });
        };

        const handleRemoved = (tabId) => {
            setTabs(prev => prev.filter(t => t.id !== tabId));
        };

        const handleActivated = (activeInfo) => {
            // Force re-render to update active highlight
            chrome.tabs.get(activeInfo.tabId, (tab) => {
                setTabs(prev => prev.map(t => t.id === tab.id ? { ...t, active: true } : { ...t, active: false }));
            });
        };

        chrome.tabs.onUpdated.addListener(handleUpdated);
        chrome.tabs.onRemoved.addListener(handleRemoved);
        chrome.tabs.onActivated.addListener(handleActivated);

        return () => {
            chrome.tabs.onUpdated.removeListener(handleUpdated);
            chrome.tabs.onRemoved.removeListener(handleRemoved);
            chrome.tabs.onActivated.removeListener(handleActivated);
        };
    }, []);

    const activateTab = (tabId) => {
        chrome.tabs.update(tabId, { active: true });
    };

    const closeTab = (e, tabId) => {
        e.stopPropagation();
        chrome.tabs.remove(tabId);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '16px' }}>
            <h2 style={{ fontSize: 'var(--font-xl)', marginBottom: '16px', color: 'var(--text)' }}>
                Tabs ({tabs.length})
            </h2>
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {tabs.map(tab => (
                    <div
                        key={tab.id}
                        className="glass-card"
                        onClick={() => activateTab(tab.id)}
                        style={{
                            padding: '12px',
                            display: 'flex', alignItems: 'center', gap: '12px',
                            cursor: 'pointer',
                            borderLeft: tab.active ? '3px solid var(--accent-primary)' : '1px solid var(--glass-border)',
                            background: tab.active ? 'var(--interactive-active)' : 'var(--glass-bg)'
                        }}
                    >
                        {tab.favIconUrl ? (
                            <img src={tab.favIconUrl} alt="" style={{ width: '16px', height: '16px' }} />
                        ) : (
                            <div style={{ width: '16px', height: '16px', borderRadius: '50%', background: 'var(--surface-3)' }} />
                        )}
                        <span style={{
                            flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                            fontSize: 'var(--font-base)', color: 'var(--text)'
                        }}>
                            {tab.title}
                        </span>
                        <button
                            onClick={(e) => closeTab(e, tab.id)}
                            className="btn-ghost"
                            style={{ padding: '4px', width: '24px', height: '24px' }}
                        >
                            <FontAwesomeIcon icon={faTimes} size="xs" />
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}
