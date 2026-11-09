import { OVERVIEW_LAYOUTS, OVERVIEW_VIBES, vibePreview } from './overviewLayouts';

// Every layout the switcher offers, as { key, label, hint, group, preview
// props }, in the picker's six groups. Shared by LayoutPicker and the
// Customize menu (which shows the current layout's thumbnail and name).

export const GROUPS = [
    { key: 'layout', label: 'Layouts' },
    { key: 'work', label: 'Workflows' },
    { key: 'vibe', label: 'Vibes' },
    { key: 'start', label: 'Start pages' },
    { key: 'fun', label: 'Fun' },
    { key: 'design', label: 'Designs' },
];

// Every option as { key, label, hint, group, preview props }.
export const ALL_OPTIONS = [
    ...OVERVIEW_LAYOUTS.map(l => ({ key: l.key, label: l.label, hint: l.hint, group: 'layout', cells: l.cells, extra: l.extra })),
    ...OVERVIEW_VIBES.map(v => ({ key: v.key, label: v.label, hint: v.hint, group: v.group || 'vibe', rects: vibePreview(v) })),
];

export const layoutOption = (key) => ALL_OPTIONS.find(o => o.key === key) || ALL_OPTIONS[0];

export const groupOf = (key) => ALL_OPTIONS.find(o => o.key === key)?.group || 'layout';

