import { saveWorkspace } from '../db/index.js';

const SEEDED_KEY = 'cooldesk_defaults_seeded';

function makeDefaultWorkspaces() {
  const ts = Date.now();
  return [
    {
      id: 'ws_demo_development',
      name: 'Development',
      description: 'Sample dev workspace — save repos, docs, and tools you use every day',
      gridType: 'ProjectGrid',
      createdAt: ts,
      updatedAt: ts,
      status: 'active',
      context: { isDemo: true },
      urls: [
        { url: 'https://github.com', title: 'GitHub', addedAt: ts },
        { url: 'https://stackoverflow.com', title: 'Stack Overflow', addedAt: ts },
        { url: 'https://developer.mozilla.org', title: 'MDN Web Docs', addedAt: ts },
        { url: 'https://npmjs.com', title: 'npm', addedAt: ts },
        { url: 'https://vercel.com', title: 'Vercel', addedAt: ts },
      ],
    },
    {
      id: 'ws_demo_design',
      name: 'Design Resources',
      description: 'Sample design workspace — collect inspiration, tools, and references',
      gridType: 'ProjectGrid',
      createdAt: ts + 1,
      updatedAt: ts + 1,
      status: 'active',
      context: { isDemo: true },
      urls: [
        { url: 'https://figma.com', title: 'Figma', addedAt: ts + 1 },
        { url: 'https://dribbble.com', title: 'Dribbble', addedAt: ts + 1 },
        { url: 'https://fonts.google.com', title: 'Google Fonts', addedAt: ts + 1 },
        { url: 'https://colorhunt.co', title: 'Color Hunt', addedAt: ts + 1 },
        { url: 'https://unsplash.com', title: 'Unsplash', addedAt: ts + 1 },
      ],
    },
  ];
}

export async function seedDefaultWorkspaces() {
  try {
    if (localStorage.getItem(SEEDED_KEY)) return false;
    for (const ws of makeDefaultWorkspaces()) {
      await saveWorkspace(ws);
    }
    localStorage.setItem(SEEDED_KEY, 'true');
    return true;
  } catch (e) {
    console.warn('[DefaultWorkspaces] Failed to seed defaults:', e);
    return false;
  }
}
