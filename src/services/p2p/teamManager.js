import { p2pStorage } from './storageService';

const TEAMS_STORAGE_KEY = 'cooldesk_teams';
const ACTIVE_TEAM_KEY = 'cooldesk_active_team_id';

class TeamManager {
    constructor() {
        this.teams = [];
        this.activeTeamId = null;
        this.listeners = new Set();
        this.initialized = false;
    }

    async init() {
        if (this.initialized) return;

        try {
            const result = await chrome.storage.local.get([TEAMS_STORAGE_KEY, ACTIVE_TEAM_KEY]);
            this.teams = result[TEAMS_STORAGE_KEY] || [];
            this.activeTeamId = result[ACTIVE_TEAM_KEY] || null;

            // Check if default Cooldesk team exists, if not create it
            const defaultTeamName = 'Cooldesk Community';
            const defaultTeamSecret = 'cooldesk-community-default-secret';

            // Lazy load cryptoUtils
            const { cryptoUtils } = await import('./cryptoUtils');
            const { roomId: defaultTeamId } = cryptoUtils.deriveKeys(defaultTeamSecret);

            const hasDefaultTeam = this.teams.some(t => t.id === defaultTeamId);

            if (!hasDefaultTeam) {
                console.log('[Team Manager] Creating default Cooldesk team');
                // Create as Read-Only for normal users (createdByMe: false)
                // If you are the admin, you should manually update this value in storage or use a dev flag
                await this.addTeam(defaultTeamName, defaultTeamSecret, { createdByMe: false });
            }

            // Always run cleanup and ensure seed data exists for the default team
            // This handles: 1) First time setup, 2) Cleanup of old duplicates, 3) Migration from old ID formats
            try {
                await p2pStorage.initializeTeamStorage(defaultTeamId);

                // Clean up duplicate notices first (runs every init to fix existing duplicates)
                const notices = p2pStorage.getSharedNotices(defaultTeamId);
                const existingNotices = notices.toArray();

                const indicesToDelete = [];
                const seenIds = new Set();
                existingNotices.forEach((note, index) => {
                    // Remove old dynamic IDs (sticky_1_xxx, sticky_2_xxx format)
                    if (note.id && (note.id.startsWith('sticky_1_') || note.id.startsWith('sticky_2_'))) {
                        indicesToDelete.push(index);
                    } else if (note.id) {
                        // Remove duplicates of stable IDs
                        if (seenIds.has(note.id)) {
                            indicesToDelete.push(index);
                        } else {
                            seenIds.add(note.id);
                        }
                    }
                });

                if (indicesToDelete.length > 0) {
                    console.log(`[Team Manager] Cleaning up ${indicesToDelete.length} old/duplicate notices`);
                    for (let i = indicesToDelete.length - 1; i >= 0; i--) {
                        notices.delete(indicesToDelete[i], 1);
                    }
                }

                // Seed default resources if missing
                if (!hasDefaultTeam) {
                    console.log('[Team Manager] Seeding default resources...');

                    // 1. Seed Default Notes (Guides)
                    const existingItems = await p2pStorage.getTeamItems(defaultTeamId);

                    const DEFAULT_NOTES = [
                        {
                            id: 'guide_welcome',
                            title: 'Welcome to CoolDesk',
                            folder: 'Getting Started',
                            type: 'richtext',
                            text: `<p>CoolDesk is your personal productivity companion that helps you organize your browsing, take notes, and stay focused.</p>
<h2>Quick Tips</h2>
<ul>
<li><strong>Create Notes</strong> - Click the + button to create new notes</li>
<li><strong>Organize with Folders</strong> - Use folders to categorize your notes</li>
<li><strong>Rich Text Editing</strong> - Format your notes with bold, italic, headings, and lists</li>
<li><strong>Voice Input</strong> - Use the microphone button to dictate notes</li>
<li><strong>Auto-Save</strong> - Your notes are automatically saved as you type</li>
</ul>
<p>Check out the other notes in the <strong>Getting Started</strong> folder for more tips!</p>`
                        },
                        {
                            id: 'guide_workspaces',
                            title: 'Workspaces & Tab Management',
                            folder: 'Getting Started',
                            type: 'richtext',
                            text: `<p>CoolDesk helps you organize your browser tabs into workspaces for better productivity.</p>
<h2>Workspace Features</h2>
<ul>
<li><strong>Create Workspaces</strong> - Group related tabs together (Work, Research, Personal)</li>
<li><strong>Auto Tab Cleanup</strong> - Automatically close inactive tabs to reduce clutter</li>
<li><strong>Recently Closed</strong> - Easily restore tabs you accidentally closed</li>
<li><strong>Access Anywhere</strong> - Use <code>/w</code> in CoolSearch to switch workspaces instantly</li>
</ul>
<h2>Protected Tabs</h2>
<p>The following tabs are never auto-closed:</p>
<ul>
<li>Pinned tabs</li>
<li>Active/current tab</li>
<li>Tabs playing audio/video</li>
<li>Important domains (Gmail, GitHub, etc.)</li>
</ul>`
                        },
                        {
                            id: 'guide_shortcuts',
                            title: 'Keyboard Shortcuts & Tips',
                            type: 'richtext',
                            folder: 'Getting Started',
                            text: `<p>Speed up your workflow with these shortcuts:</p>
<h2>CoolSearch (Alt+K)</h2>
<ul>
<li><code>/n</code> - Create a new note instantly</li>
<li><code>/w</code> - Switch workspaces</li>
<li><code>/add</code> - Bookmark current tab</li>
<li><code>/share</code> - Share current tab to team</li>
</ul>
<h2>Navigation</h2>
<ul>
<li><strong>Ctrl + 1-6</strong> - Switch between sidebar tabs (Home, Notes, Chat, etc.)</li>
<li><strong>Ctrl + Arrow Keys</strong> - Navigate the spatial canvas</li>
<li><strong>Two Finger Scroll</strong> - Pan around the spatial view</li>
</ul>
<h2>Note Editor</h2>
<ul>
<li><strong>Ctrl+B</strong> - Bold text</li>
<li><strong>Ctrl+I</strong> - Italic text</li>
<li><strong>Tab</strong> - Insert indent</li>
</ul>`
                        },
                        {
                            id: 'guide_community',
                            title: 'Community & Sharing',
                            folder: 'Getting Started',
                            type: 'richtext',
                            text: `<p>Connect with your team and the broader CoolDesk community!</p>
<h2>Team Features</h2>
<ul>
<li><strong>Shared Notes</strong> - Collaborate on notes in real-time</li>
<li><strong>Shared Links</strong> - Share important URLs with your team</li>
<li><strong>Chat</strong> - Discuss ideas in the team chat</li>
</ul>
<h2>Community</h2>
<ul>
<li><strong>Import Templates</strong> - Click the "Community" button to import templates from the web</li>
<li><strong>Share Templates</strong> - Export your best notes as templates for others</li>
</ul>`
                        }
                    ];

                    for (const note of DEFAULT_NOTES) {
                        const noteExists = existingItems.some(item =>
                            item.type === 'NOTE_SHARE' && item.payload?.id === note.id
                        );
                        if (!noteExists) {
                            await p2pStorage.addItemToTeam(defaultTeamId, {
                                type: 'NOTE_SHARE',
                                payload: {
                                    ...note,
                                    createdAt: Date.now(),
                                    updatedAt: Date.now()
                                },
                                timestamp: Date.now()
                            });
                        }
                    }

                    // 2. Seed Shared Context
                    const contextMap = p2pStorage.getSharedContext(defaultTeamId);
                    if (contextMap) {
                        contextMap.set('communityGoal', 'Build a supportive productivity community!');
                        contextMap.set('importantNotice', '🎉 Welcome to the new Cooldesk Community Space!');
                        contextMap.set('todaysFocus', 'Explore the new features and share your feedback.');
                        contextMap.set('communityAlert', false);
                    }

                    // 3. Seed URLs
                    const seedUrls = [
                        {
                            id: 'url_reddit',
                            title: 'Join the Reddit Community',
                            url: 'https://www.reddit.com/r/cooldesk/',
                            addedBy: 'Cooldesk Team',
                            addedAt: Date.now(),
                            type: 'link'
                        },
                        {
                            id: 'url_website',
                            title: 'Official Website',
                            url: 'https://cool-desk.com/',
                            addedBy: 'Cooldesk Team',
                            addedAt: Date.now(),
                            type: 'link'
                        },
                        {
                            id: 'url_search',
                            title: 'Search CoolDesk',
                            url: 'https://cool-desk.com/search',
                            addedBy: 'Cooldesk Team',
                            addedAt: Date.now(),
                            type: 'link'
                        }
                    ];

                    for (const urlItem of seedUrls) {
                        const exists = existingItems.some(item =>
                            item.id === urlItem.id || item.url === urlItem.url
                        );
                        if (!exists) {
                            await p2pStorage.addItemToTeam(defaultTeamId, urlItem);
                        }
                    }

                    console.log('[Team Manager] Default resources seeded successfully');
                }

                // 4. Ensure default sticky notes exist (after cleanup)
                const cleanedNotices = notices.toArray();
                const stickyNotes = [
                    {
                        id: 'sticky_welcome',
                        text: 'Welcome to the Cooldesk Community Space! 🚀\n\nThis is a shared space for all CoolDesk users.',
                        styleIndex: 0,
                        pinIndex: 0,
                        rotation: -1.5,
                        createdAt: Date.now()
                    },
                    {
                        id: 'sticky_explore',
                        text: 'Feel free to explore shared resources and connect with others.',
                        styleIndex: 2,
                        pinIndex: 1,
                        rotation: 1.2,
                        createdAt: Date.now()
                    }
                ];

                for (const stickyNote of stickyNotes) {
                    const exists = cleanedNotices.some(n => n.id === stickyNote.id);
                    if (!exists) {
                        notices.push([stickyNote]);
                    }
                }
            } catch (seedError) {
                console.error('[Team Manager] Failed to initialize default team storage:', seedError);
            }

            // ── Additional default community teams ──────────────────────────

            const EXTRA_DEFAULT_TEAMS = [
                {
                    name: 'AI Tools',
                    secret: 'cooldesk-ai-tools-community-2024',
                    stickyNotes: [
                        {
                            id: 'sticky_ai_welcome',
                            text: 'Welcome to AI Tools! 🤖\n\nDiscover the best AI assistants and productivity tools.',
                            styleIndex: 1,
                            pinIndex: 0,
                            rotation: -1.2,
                            createdAt: Date.now()
                        },
                        {
                            id: 'sticky_ai_tip',
                            text: 'Tip: Combine multiple AI tools for the best results — ChatGPT for writing, Claude for reasoning, Perplexity for research.',
                            styleIndex: 3,
                            pinIndex: 1,
                            rotation: 1.0,
                            createdAt: Date.now()
                        }
                    ],
                    seedNotes: [
                        {
                            id: 'guide_ai_assistants',
                            title: 'Top AI Assistants Guide',
                            folder: 'AI Tools',
                            type: 'richtext',
                            text: `<p>A curated guide to the best AI assistants available today.</p>
<h2>Conversational AI</h2>
<ul>
<li><strong>ChatGPT (OpenAI)</strong> - Best for writing, coding, and general tasks</li>
<li><strong>Claude (Anthropic)</strong> - Best for reasoning, analysis, and long documents</li>
<li><strong>Gemini (Google)</strong> - Best for Google Workspace integration</li>
<li><strong>Copilot (Microsoft)</strong> - Best for Office 365 and Windows users</li>
</ul>
<h2>Research & Search</h2>
<ul>
<li><strong>Perplexity AI</strong> - AI-powered search with citations</li>
<li><strong>You.com</strong> - Search + AI assistant combined</li>
</ul>
<h2>Coding</h2>
<ul>
<li><strong>GitHub Copilot</strong> - AI pair programmer in your IDE</li>
<li><strong>Cursor</strong> - AI-first code editor</li>
<li><strong>Codeium</strong> - Free AI code completion</li>
</ul>`
                        },
                        {
                            id: 'guide_ai_prompting',
                            title: 'Prompt Engineering Tips',
                            folder: 'AI Tools',
                            type: 'richtext',
                            text: `<p>Get better results from AI tools with these prompting strategies.</p>
<h2>Core Principles</h2>
<ul>
<li><strong>Be Specific</strong> - Give context, constraints, and expected output format</li>
<li><strong>Use Role Prompting</strong> - "Act as a senior developer..." for expert-level answers</li>
<li><strong>Chain of Thought</strong> - Ask it to "think step by step" for complex problems</li>
<li><strong>Iterate</strong> - Refine your prompt based on the output</li>
</ul>
<h2>Templates</h2>
<ul>
<li><code>Summarize this in 3 bullet points: [text]</code></li>
<li><code>Review this code for bugs and suggest improvements: [code]</code></li>
<li><code>Write a [tone] email to [recipient] about [topic]</code></li>
</ul>`
                        }
                    ],
                    seedUrls: [
                        { id: 'url_chatgpt', title: 'ChatGPT', url: 'https://chat.openai.com/', addedBy: 'Cooldesk Team', addedAt: Date.now(), type: 'link' },
                        { id: 'url_claude', title: 'Claude by Anthropic', url: 'https://claude.ai/', addedBy: 'Cooldesk Team', addedAt: Date.now(), type: 'link' },
                        { id: 'url_perplexity', title: 'Perplexity AI', url: 'https://www.perplexity.ai/', addedBy: 'Cooldesk Team', addedAt: Date.now(), type: 'link' },
                        { id: 'url_gemini', title: 'Google Gemini', url: 'https://gemini.google.com/', addedBy: 'Cooldesk Team', addedAt: Date.now(), type: 'link' },
                        { id: 'url_copilot', title: 'Microsoft Copilot', url: 'https://copilot.microsoft.com/', addedBy: 'Cooldesk Team', addedAt: Date.now(), type: 'link' },
                        { id: 'url_cursor', title: 'Cursor AI Editor', url: 'https://www.cursor.com/', addedBy: 'Cooldesk Team', addedAt: Date.now(), type: 'link' }
                    ]
                },
                {
                    name: 'Design Tools',
                    secret: 'cooldesk-design-tools-community-2024',
                    stickyNotes: [
                        {
                            id: 'sticky_design_welcome',
                            text: 'Welcome to Design Tools! 🎨\n\nLogos, icons, images — free and paid tools all in one place.',
                            styleIndex: 4,
                            pinIndex: 0,
                            rotation: -1.0,
                            createdAt: Date.now()
                        },
                        {
                            id: 'sticky_design_tip',
                            text: 'Pro tip: Figma (free tier) + Unsplash + Iconify covers 90% of design needs at zero cost.',
                            styleIndex: 2,
                            pinIndex: 1,
                            rotation: 1.5,
                            createdAt: Date.now()
                        }
                    ],
                    seedNotes: [
                        {
                            id: 'guide_design_logos',
                            title: 'Logo & Icon Tools',
                            folder: 'Design Tools',
                            type: 'richtext',
                            text: `<p>The best tools for creating logos and icons.</p>
<h2>Logo Design</h2>
<ul>
<li><strong>Figma</strong> (Free/Paid) - Industry-standard vector design tool</li>
<li><strong>Canva</strong> (Free/Paid) - Drag-and-drop logo templates</li>
<li><strong>Adobe Express</strong> (Free/Paid) - Quick logo maker with AI</li>
<li><strong>Looka</strong> (Paid) - AI-powered logo generation</li>
<li><strong>Hatchful by Shopify</strong> (Free) - Simple logo creator</li>
</ul>
<h2>Icon Resources</h2>
<ul>
<li><strong>Iconify</strong> (Free) - 200,000+ open-source icons</li>
<li><strong>Heroicons</strong> (Free) - Beautiful SVG icons by Tailwind team</li>
<li><strong>Phosphor Icons</strong> (Free) - Flexible icon family</li>
<li><strong>Font Awesome</strong> (Free/Paid) - Classic icon library</li>
<li><strong>Flaticon</strong> (Free/Paid) - Millions of vector icons</li>
</ul>`
                        },
                        {
                            id: 'guide_design_images',
                            title: 'Image Tools — Free & Paid',
                            folder: 'Design Tools',
                            type: 'richtext',
                            text: `<p>Find and edit images for any project.</p>
<h2>Free Stock Images</h2>
<ul>
<li><strong>Unsplash</strong> - High-quality photography, free for commercial use</li>
<li><strong>Pexels</strong> - Free photos and videos</li>
<li><strong>Pixabay</strong> - Free images, videos, and music</li>
</ul>
<h2>Image Editing</h2>
<ul>
<li><strong>Photopea</strong> (Free) - Photoshop in the browser</li>
<li><strong>GIMP</strong> (Free) - Powerful open-source image editor</li>
<li><strong>Adobe Photoshop</strong> (Paid) - Industry standard</li>
<li><strong>Affinity Photo</strong> (One-time paid) - Great Photoshop alternative</li>
</ul>
<h2>Background Removal</h2>
<ul>
<li><strong>Remove.bg</strong> (Free/Paid) - One-click background removal</li>
<li><strong>Cleanup.pictures</strong> (Free) - Remove objects from photos</li>
</ul>`
                        }
                    ],
                    seedUrls: [
                        { id: 'url_figma', title: 'Figma', url: 'https://www.figma.com/', addedBy: 'Cooldesk Team', addedAt: Date.now(), type: 'link' },
                        { id: 'url_canva', title: 'Canva', url: 'https://www.canva.com/', addedBy: 'Cooldesk Team', addedAt: Date.now(), type: 'link' },
                        { id: 'url_unsplash', title: 'Unsplash (Free Photos)', url: 'https://unsplash.com/', addedBy: 'Cooldesk Team', addedAt: Date.now(), type: 'link' },
                        { id: 'url_iconify', title: 'Iconify (Free Icons)', url: 'https://icon-sets.iconify.design/', addedBy: 'Cooldesk Team', addedAt: Date.now(), type: 'link' },
                        { id: 'url_photopea', title: 'Photopea (Free Editor)', url: 'https://www.photopea.com/', addedBy: 'Cooldesk Team', addedAt: Date.now(), type: 'link' },
                        { id: 'url_removebg', title: 'Remove.bg', url: 'https://www.remove.bg/', addedBy: 'Cooldesk Team', addedAt: Date.now(), type: 'link' },
                        { id: 'url_pexels', title: 'Pexels (Free Photos)', url: 'https://www.pexels.com/', addedBy: 'Cooldesk Team', addedAt: Date.now(), type: 'link' }
                    ]
                },
                {
                    name: 'Edit & Recording',
                    secret: 'cooldesk-edit-recording-tools-2024',
                    stickyNotes: [
                        {
                            id: 'sticky_edit_welcome',
                            text: 'Welcome to Edit & Recording! 🎬\n\nAudio, video, screen recording — everything you need to create.',
                            styleIndex: 0,
                            pinIndex: 0,
                            rotation: 1.3,
                            createdAt: Date.now()
                        },
                        {
                            id: 'sticky_edit_tip',
                            text: 'Free stack: OBS for recording → DaVinci Resolve for video editing → Audacity for audio. All free, all professional.',
                            styleIndex: 1,
                            pinIndex: 1,
                            rotation: -1.1,
                            createdAt: Date.now()
                        }
                    ],
                    seedNotes: [
                        {
                            id: 'guide_obs_studio',
                            title: 'OBS Studio — Recording & Streaming',
                            folder: 'Edit & Recording',
                            type: 'richtext',
                            text: `<p>OBS Studio is the go-to free tool for screen recording and live streaming.</p>
<h2>Key Features</h2>
<ul>
<li><strong>Scene Switching</strong> - Create multiple layouts and switch between them</li>
<li><strong>Source Capture</strong> - Capture screen, window, webcam, or game</li>
<li><strong>Audio Mixer</strong> - Mix microphone, desktop audio, and more</li>
<li><strong>Streaming</strong> - Stream directly to Twitch, YouTube, and others</li>
<li><strong>Local Recording</strong> - Record in MKV or MP4 at high quality</li>
</ul>
<h2>Quick Setup for Screen Recording</h2>
<ul>
<li>Add a <strong>Display Capture</strong> or <strong>Window Capture</strong> source</li>
<li>Set output to <strong>MP4</strong> in Settings → Output</li>
<li>Use <strong>Ctrl+Alt+R</strong> (custom hotkey) to start/stop recording</li>
</ul>
<h2>Useful Plugins</h2>
<ul>
<li><strong>obs-backgroundremoval</strong> - Virtual green screen</li>
<li><strong>Advanced Scene Switcher</strong> - Auto scene rules</li>
</ul>`
                        },
                        {
                            id: 'guide_video_editing',
                            title: 'Video Editing Tools',
                            folder: 'Edit & Recording',
                            type: 'richtext',
                            text: `<p>From quick clips to professional productions.</p>
<h2>Free Video Editors</h2>
<ul>
<li><strong>DaVinci Resolve</strong> - Professional-grade, completely free. Best for serious editing.</li>
<li><strong>CapCut</strong> - Fast and easy, great for social media content</li>
<li><strong>Kdenlive</strong> - Open-source, Linux/Windows/Mac</li>
<li><strong>Shotcut</strong> - Lightweight open-source editor</li>
</ul>
<h2>Paid Video Editors</h2>
<ul>
<li><strong>Adobe Premiere Pro</strong> - Industry standard, subscription</li>
<li><strong>Final Cut Pro</strong> - Mac only, one-time purchase</li>
<li><strong>Camtasia</strong> - Great for tutorials and screen recordings</li>
</ul>
<h2>Online / Quick Editors</h2>
<ul>
<li><strong>Clipchamp</strong> (Free, built into Windows) - Quick edits in browser</li>
<li><strong>Clideo</strong> - Simple browser-based editing</li>
</ul>`
                        },
                        {
                            id: 'guide_audio_editing',
                            title: 'Audio Editing Tools',
                            folder: 'Edit & Recording',
                            type: 'richtext',
                            text: `<p>Record, edit, and enhance audio like a professional.</p>
<h2>Free Audio Editors</h2>
<ul>
<li><strong>Audacity</strong> - The classic free audio editor. Noise removal, equalization, effects.</li>
<li><strong>Ocenaudio</strong> - Easier alternative to Audacity</li>
<li><strong>GarageBand</strong> (Mac only) - Free professional DAW</li>
</ul>
<h2>Paid DAWs</h2>
<ul>
<li><strong>Adobe Audition</strong> - Professional audio workstation</li>
<li><strong>FL Studio</strong> - Music production powerhouse</li>
<li><strong>Reaper</strong> - Affordable professional DAW (~$60)</li>
</ul>
<h2>Noise Reduction & Enhancement</h2>
<ul>
<li><strong>NVIDIA RTX Voice</strong> (Free, RTX GPU needed) - Real-time noise removal</li>
<li><strong>Krisp</strong> (Free/Paid) - AI noise cancellation for calls</li>
<li><strong>Adobe Podcast Enhance</strong> (Free) - AI audio cleanup online</li>
</ul>`
                        }
                    ],
                    seedUrls: [
                        { id: 'url_obs', title: 'OBS Studio', url: 'https://obsproject.com/', addedBy: 'Cooldesk Team', addedAt: Date.now(), type: 'link' },
                        { id: 'url_davinci', title: 'DaVinci Resolve (Free)', url: 'https://www.blackmagicdesign.com/products/davinciresolve', addedBy: 'Cooldesk Team', addedAt: Date.now(), type: 'link' },
                        { id: 'url_capcut', title: 'CapCut', url: 'https://www.capcut.com/', addedBy: 'Cooldesk Team', addedAt: Date.now(), type: 'link' },
                        { id: 'url_audacity', title: 'Audacity (Free Audio Editor)', url: 'https://www.audacityteam.org/', addedBy: 'Cooldesk Team', addedAt: Date.now(), type: 'link' },
                        { id: 'url_krisp', title: 'Krisp AI Noise Cancellation', url: 'https://krisp.ai/', addedBy: 'Cooldesk Team', addedAt: Date.now(), type: 'link' },
                        { id: 'url_adobe_podcast', title: 'Adobe Podcast Enhance', url: 'https://podcast.adobe.com/enhance', addedBy: 'Cooldesk Team', addedAt: Date.now(), type: 'link' }
                    ]
                },
                {
                    name: 'AI Generation',
                    secret: 'cooldesk-ai-generation-tools-2024',
                    stickyNotes: [
                        {
                            id: 'sticky_aigen_welcome',
                            text: 'Welcome to AI Generation! ✨\n\nGenerate text, images, audio, and video with AI.',
                            styleIndex: 2,
                            pinIndex: 0,
                            rotation: -1.3,
                            createdAt: Date.now()
                        },
                        {
                            id: 'sticky_aigen_tip',
                            text: 'AI generation is moving fast — bookmark this space for the latest tools and prompts!',
                            styleIndex: 0,
                            pinIndex: 1,
                            rotation: 1.4,
                            createdAt: Date.now()
                        }
                    ],
                    seedNotes: [
                        {
                            id: 'guide_aigen_image',
                            title: 'AI Image Generation',
                            folder: 'AI Generation',
                            type: 'richtext',
                            text: `<p>Create stunning images from text prompts.</p>
<h2>Top Tools</h2>
<ul>
<li><strong>Midjourney</strong> (Paid) - Best overall quality, Discord-based</li>
<li><strong>DALL-E 3</strong> (Free via Copilot / Paid via API) - Great prompt adherence</li>
<li><strong>Stable Diffusion</strong> (Free, self-hosted) - Maximum control and customization</li>
<li><strong>Adobe Firefly</strong> (Free/Paid) - Commercially safe images</li>
<li><strong>Leonardo.ai</strong> (Free/Paid) - Great for game assets and characters</li>
<li><strong>Ideogram</strong> (Free/Paid) - Best for text in images</li>
</ul>
<h2>Prompt Tips</h2>
<ul>
<li>Specify style: <code>photorealistic, cinematic, anime, watercolor</code></li>
<li>Specify lighting: <code>golden hour, studio lighting, neon</code></li>
<li>Specify camera: <code>wide angle, macro, 85mm portrait lens</code></li>
</ul>`
                        },
                        {
                            id: 'guide_aigen_audio',
                            title: 'AI Audio Generation',
                            folder: 'AI Generation',
                            type: 'richtext',
                            text: `<p>Generate music, voice, and sound effects with AI.</p>
<h2>Music Generation</h2>
<ul>
<li><strong>Suno</strong> (Free/Paid) - Generate full songs from a text prompt</li>
<li><strong>Udio</strong> (Free/Paid) - High-quality AI music generation</li>
<li><strong>Stable Audio</strong> (Free/Paid) - By Stability AI</li>
</ul>
<h2>Voice & Text-to-Speech</h2>
<ul>
<li><strong>ElevenLabs</strong> (Free/Paid) - Most realistic AI voices, voice cloning</li>
<li><strong>PlayHT</strong> (Free/Paid) - Wide voice library</li>
<li><strong>Murf</strong> (Paid) - Professional voiceover AI</li>
</ul>
<h2>Sound Effects</h2>
<ul>
<li><strong>ElevenLabs Sound Effects</strong> - Generate any sound effect from text</li>
<li><strong>Freesound.org</strong> (Free, community) - Huge library of free sounds</li>
</ul>`
                        },
                        {
                            id: 'guide_aigen_video',
                            title: 'AI Video Generation',
                            folder: 'AI Generation',
                            type: 'richtext',
                            text: `<p>Generate and edit video with AI — the fastest-growing category.</p>
<h2>Text-to-Video</h2>
<ul>
<li><strong>Sora (OpenAI)</strong> (Paid) - Highest quality video generation</li>
<li><strong>Runway Gen-3</strong> (Free/Paid) - Great for short clips and effects</li>
<li><strong>Pika</strong> (Free/Paid) - Easy text and image to video</li>
<li><strong>Kling</strong> (Free/Paid) - High quality, 1080p support</li>
<li><strong>Hailuo</strong> (Free/Paid) - Fast and free tier available</li>
</ul>
<h2>Image/Video Enhancement</h2>
<ul>
<li><strong>Topaz Video AI</strong> (Paid) - Upscale and enhance videos</li>
<li><strong>Runway Inpainting</strong> - Remove objects from video</li>
</ul>
<h2>Avatar & Talking Head</h2>
<ul>
<li><strong>HeyGen</strong> (Free/Paid) - AI avatar videos from script</li>
<li><strong>D-ID</strong> (Free/Paid) - Animate photos to speaking avatars</li>
</ul>`
                        },
                        {
                            id: 'guide_aigen_text',
                            title: 'AI Text Generation',
                            folder: 'AI Generation',
                            type: 'richtext',
                            text: `<p>Generate articles, copy, code, and creative writing with AI.</p>
<h2>General Writing</h2>
<ul>
<li><strong>ChatGPT</strong> - Versatile, great for drafts and rewrites</li>
<li><strong>Claude</strong> - Excellent for long-form and nuanced writing</li>
<li><strong>Gemini</strong> - Strong with factual and research writing</li>
</ul>
<h2>Specialized Writing Tools</h2>
<ul>
<li><strong>Jasper</strong> (Paid) - Marketing copy and blog posts</li>
<li><strong>Copy.ai</strong> (Free/Paid) - Sales and marketing copy</li>
<li><strong>Sudowrite</strong> (Paid) - Fiction and creative writing</li>
</ul>
<h2>Code Generation</h2>
<ul>
<li><strong>GitHub Copilot</strong> - In-IDE code completion</li>
<li><strong>v0 by Vercel</strong> - Generate UI components from prompts</li>
<li><strong>Bolt.new</strong> - Full-stack app generation in browser</li>
</ul>`
                        }
                    ],
                    seedUrls: [
                        { id: 'url_suno', title: 'Suno AI Music', url: 'https://suno.com/', addedBy: 'Cooldesk Team', addedAt: Date.now(), type: 'link' },
                        { id: 'url_elevenlabs', title: 'ElevenLabs Voice AI', url: 'https://elevenlabs.io/', addedBy: 'Cooldesk Team', addedAt: Date.now(), type: 'link' },
                        { id: 'url_runway', title: 'Runway AI Video', url: 'https://runwayml.com/', addedBy: 'Cooldesk Team', addedAt: Date.now(), type: 'link' },
                        { id: 'url_pika', title: 'Pika Video Generation', url: 'https://pika.art/', addedBy: 'Cooldesk Team', addedAt: Date.now(), type: 'link' },
                        { id: 'url_midjourney', title: 'Midjourney Image AI', url: 'https://www.midjourney.com/', addedBy: 'Cooldesk Team', addedAt: Date.now(), type: 'link' },
                        { id: 'url_heygen', title: 'HeyGen Avatar Videos', url: 'https://www.heygen.com/', addedBy: 'Cooldesk Team', addedAt: Date.now(), type: 'link' },
                        { id: 'url_v0', title: 'v0 by Vercel (UI Gen)', url: 'https://v0.dev/', addedBy: 'Cooldesk Team', addedAt: Date.now(), type: 'link' }
                    ]
                }
            ];

            for (const teamConfig of EXTRA_DEFAULT_TEAMS) {
                const { roomId: extraTeamId } = cryptoUtils.deriveKeys(teamConfig.secret);
                const hasExtraTeam = this.teams.some(t => t.id === extraTeamId);

                if (!hasExtraTeam) {
                    console.log(`[Team Manager] Creating default team: ${teamConfig.name}`);
                    await this.addTeam(teamConfig.name, teamConfig.secret, { createdByMe: false });
                }

                try {
                    await p2pStorage.initializeTeamStorage(extraTeamId);

                    // Clean up duplicate notices
                    const extraNotices = p2pStorage.getSharedNotices(extraTeamId);
                    const existingExtraNotices = extraNotices.toArray();
                    const extraIndicesToDelete = [];
                    const extraSeenIds = new Set();
                    existingExtraNotices.forEach((note, index) => {
                        if (note.id && (note.id.startsWith('sticky_1_') || note.id.startsWith('sticky_2_'))) {
                            extraIndicesToDelete.push(index);
                        } else if (note.id) {
                            if (extraSeenIds.has(note.id)) {
                                extraIndicesToDelete.push(index);
                            } else {
                                extraSeenIds.add(note.id);
                            }
                        }
                    });
                    if (extraIndicesToDelete.length > 0) {
                        for (let i = extraIndicesToDelete.length - 1; i >= 0; i--) {
                            extraNotices.delete(extraIndicesToDelete[i], 1);
                        }
                    }

                    // Seed notes and URLs on first creation
                    if (!hasExtraTeam) {
                        const existingExtraItems = await p2pStorage.getTeamItems(extraTeamId);

                        for (const note of teamConfig.seedNotes) {
                            const noteExists = existingExtraItems.some(item =>
                                item.type === 'NOTE_SHARE' && item.payload?.id === note.id
                            );
                            if (!noteExists) {
                                await p2pStorage.addItemToTeam(extraTeamId, {
                                    type: 'NOTE_SHARE',
                                    payload: { ...note, createdAt: Date.now(), updatedAt: Date.now() },
                                    timestamp: Date.now()
                                });
                            }
                        }

                        for (const urlItem of teamConfig.seedUrls) {
                            const exists = existingExtraItems.some(item =>
                                item.id === urlItem.id || item.url === urlItem.url
                            );
                            if (!exists) {
                                await p2pStorage.addItemToTeam(extraTeamId, urlItem);
                            }
                        }

                        console.log(`[Team Manager] Seeded resources for: ${teamConfig.name}`);
                    }

                    // Ensure sticky notes exist
                    const cleanedExtraNotices = extraNotices.toArray();
                    for (const stickyNote of teamConfig.stickyNotes) {
                        const exists = cleanedExtraNotices.some(n => n.id === stickyNote.id);
                        if (!exists) {
                            extraNotices.push([stickyNote]);
                        }
                    }
                } catch (seedError) {
                    console.error(`[Team Manager] Failed to initialize ${teamConfig.name} storage:`, seedError);
                }
            }

            this.initialized = true;
            console.log('[Team Manager] Initialized with teams:', this.teams.length);
        } catch (e) {
            console.error('[Team Manager] Failed to initialize:', e);
            // Non-blocking error, allow retries
        }
    }

    /**
     * Add a new team
     * @param {string} name - User friendly name
     * @param {string} secretPhrase - The 4-word secret
     * @returns {Promise<Object>} The created team object
     */
    async addTeam(name, secretPhrase, options = {}) {
        if (!name || !secretPhrase) {
            throw new Error('Name and secret phrase are required');
        }

        // Lazy load cryptoUtils
        const { cryptoUtils } = await import('./cryptoUtils');

        // Derive keys
        const { roomId, encryptionKey } = cryptoUtils.deriveKeys(secretPhrase);

        // Check duplicates
        const existingTeam = this.teams.find(t => t.id === roomId);
        if (existingTeam) {
            // If team exists but wasn't created by this user, just return it
            return existingTeam;
        }

        const newTeam = {
            id: roomId, // The derived Room ID acts as the unique Team ID
            name,
            secretPhrase, // We store this locally for convenience
            encryptionKey, // Derived and cached
            createdAt: Date.now(),
            createdByMe: options.createdByMe !== undefined ? options.createdByMe : true, // Default to true unless specified
            lastSync: null,
            adminPrivateKey: null,
            adminPublicKey: null
        };

        // SECURITY: Admin Keys
        // If we created this team OR are importing a recovery kit, we set the keys.
        if (options.importedKeys) {
            // Restore from Recovery Kit
            newTeam.adminPrivateKey = options.importedKeys.privateKey;
            newTeam.adminPublicKey = options.importedKeys.publicKey;
            newTeam.createdByMe = true; // Implicitly true if we have keys
            console.log('[TeamManager] Restored Admin Keys from import');
        } else if (newTeam.createdByMe) {
            // New Team Creation
            const keys = cryptoUtils.generateAdminKeys();
            newTeam.adminPrivateKey = keys.privateKey;
            newTeam.adminPublicKey = keys.publicKey;
            console.log('[TeamManager] Generated Admin Keys for new team');
        }

        this.teams.push(newTeam);
        await this._saveTeams();

        // Auto-select if first team
        if (this.teams.length === 1) {
            await this.setActiveTeam(newTeam.id);
        }

        return newTeam;
    }

    async removeTeam(teamId) {
        this.teams = this.teams.filter(t => t.id !== teamId);
        await this._saveTeams();

        if (this.activeTeamId === teamId) {
            await this.setActiveTeam(null);
        }

        this._notifyListeners();
    }

    /**
     * Rename a team (admin only)
     * @param {string} teamId - The team ID to rename
     * @param {string} newName - The new name for the team
     * @returns {Promise<Object>} The updated team object
     */
    async renameTeam(teamId, newName) {
        if (!newName || !newName.trim()) {
            throw new Error('Team name is required');
        }

        const team = this.teams.find(t => t.id === teamId);
        if (!team) {
            throw new Error('Team not found');
        }

        if (!team.createdByMe) {
            throw new Error('Only team admins can rename the team');
        }

        team.name = newName.trim();
        await this._saveTeams();
        this._notifyListeners();
        return team;
    }

    async setActiveTeam(teamId) {
        this.activeTeamId = teamId;
        await chrome.storage.local.set({ [ACTIVE_TEAM_KEY]: teamId });
        this._notifyListeners();
    }

    getActiveTeam() {
        return this.teams.find(t => t.id === this.activeTeamId);
    }

    getTeam(teamId) {
        return this.teams.find(t => t.id === teamId);
    }

    getTeams() {
        return this.teams;
    }

    subscribe(callback) {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    async _saveTeams() {
        await chrome.storage.local.set({ [TEAMS_STORAGE_KEY]: this.teams });
    }

    _notifyListeners() {
        this.listeners.forEach(cb => cb({
            teams: this.teams,
            activeTeamId: this.activeTeamId
        }));
    }
}

export const teamManager = new TeamManager();
