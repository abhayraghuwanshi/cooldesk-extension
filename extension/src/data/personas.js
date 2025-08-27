/**
 * Persona definitions for workspace creation
 * Each persona contains curated workspaces with relevant tools and URLs
 */

import { faCode, faPalette, faChartLine, faVideo, faGraduationCap, faGlobe } from '@fortawesome/free-solid-svg-icons';

export const personas = [
  {
    icon: faCode,
    title: 'Developer',
    description: 'For software developers, programmers, and engineers',
    workspaces: [
      {
        name: 'Development',
        description: 'Core development tools and platforms',
        urls: [
          'https://github.com',
          'https://gitlab.com',
          'https://bitbucket.org',
          'https://stackoverflow.com',
          'https://getpostman.com',
          'https://insomnia.rest',
          'https://vscode.dev',
          'https://replit.com',
          'https://codesandbox.io'
        ]
      },
      {
        name: 'Cloud & DevOps',
        description: 'Cloud infrastructure and DevOps tools',
        urls: [
          'https://aws.amazon.com',
          'https://cloud.google.com',
          'https://azure.microsoft.com',
          'https://hub.docker.com',
          'https://kubernetes.io',
          'https://grafana.com',
          'https://prometheus.io',
          'https://jenkins.io',
          'https://circleci.com'
        ]
      },
      {
        name: 'Learning',
        description: 'Educational resources for developers',
        urls: [
          'https://w3schools.com',
          'https://geeksforgeeks.org',
          'https://developer.mozilla.org',
          'https://freecodecamp.org',
          'https://roadmap.sh'
        ]
      },
      {
        name: 'Productivity',
        description: 'Keep projects organized and track tasks',
        urls: [
          'https://trello.com',
          'https://clickup.com',
          'https://notion.so',
          'https://linear.app'
        ]
      }
    ]
  },
  {
    icon: faPalette,
    title: 'Designer',
    description: 'For UI/UX designers, graphic designers, and creative professionals',
    workspaces: [
      {
        name: 'Design & Creativity',
        description: 'Design tools and creative platforms',
        urls: [
          'https://figma.com',
          'https://canva.com',
          'https://xd.adobe.com',
          'https://photoshop.adobe.com',
          'https://photopea.com',
          'https://dribbble.com',
          'https://behance.net'
        ]
      },
      {
        name: 'Prototyping & Collaboration',
        description: 'Collaboration tools for design teams',
        urls: [
          'https://miro.com',
          'https://zeplin.io',
          'https://invisionapp.com'
        ]
      },
      {
        name: 'Learning',
        description: 'Design inspiration and educational resources',
        urls: [
          'https://uxdesign.cc',
          'https://interaction-design.org',
          'https://adobe.com/creativecloud/learn'
        ]
      }
    ]
  },
  {
    icon: faChartLine,
    title: 'Marketer',
    description: 'For digital marketers, growth hackers, and marketing professionals',
    workspaces: [
      {
        name: 'Productivity & AI',
        description: 'AI-powered productivity and writing tools',
        urls: [
          'https://chat.openai.com',
          'https://notion.so',
          'https://perplexity.ai',
          'https://copy.ai',
          'https://jasper.ai'
        ]
      },
      {
        name: 'Communication',
        description: 'Marketing communication and collaboration platforms',
        urls: [
          'https://slack.com',
          'https://zoom.us',
          'https://teams.microsoft.com',
          'https://discord.com'
        ]
      },
      {
        name: 'Analytics & Ads',
        description: 'Track performance and manage ads',
        urls: [
          'https://analytics.google.com',
          'https://powerbi.microsoft.com',
          'https://tableau.com',
          'https://ads.google.com',
          'https://business.facebook.com'
        ]
      },
      {
        name: 'Social Media Tools',
        description: 'Manage and schedule social content',
        urls: [
          'https://buffer.com',
          'https://hootsuite.com',
          'https://later.com'
        ]
      }
    ]
  },
  {
    icon: faVideo,
    title: 'Content Creator',
    description: 'For YouTubers, podcasters, and digital content creators',
    workspaces: [
      {
        name: 'Audio & MP3 Tools',
        description: 'Audio editing and podcast platforms',
        urls: [
          'https://audacityteam.org',
          'https://bandlab.com',
          'https://podcasters.spotify.com',
          'https://soundtrap.com',
          'https://krisp.ai'
        ]
      },
      {
        name: 'Video Editing',
        description: 'Video creation and editing platforms',
        urls: [
          'https://kapwing.com',
          'https://canva.com/video',
          'https://runwayml.com',
          'https://descript.com',
          'https://filmora.wondershare.com'
        ]
      },
      {
        name: 'Social Media',
        description: 'Distribute and grow your audience',
        urls: [
          'https://youtube.com',
          'https://instagram.com',
          'https://twitter.com',
          'https://tiktok.com',
          'https://linkedin.com'
        ]
      }
    ]
  },
  {
    icon: faGraduationCap,
    title: 'Student / Researcher',
    description: 'For students, academics, and researchers',
    workspaces: [
      {
        name: 'Learning & Research',
        description: 'Educational and research platforms',
        urls: [
          'https://coursera.org',
          'https://udemy.com',
          'https://khanacademy.org',
          'https://researchgate.net',
          'https://arxiv.org',
          'https://scholar.google.com'
        ]
      },
      {
        name: 'Productivity',
        description: 'Organize notes and projects',
        urls: [
          'https://notion.so',
          'https://drive.google.com',
          'https://zotero.org',
          'https://mendeley.com'
        ]
      },
      {
        name: 'Communication',
        description: 'Stay connected with peers and professors',
        urls: [
          'https://meet.google.com',
          'https://discord.com',
          'https://teams.microsoft.com'
        ]
      }
    ]
  },
  {
    icon: faGlobe,
    title: 'General',
    description: 'For everyday users who want a balanced setup',
    workspaces: [
      {
        name: 'AI & Productivity',
        description: 'Daily productivity and AI assistants',
        urls: [
          'https://chat.openai.com',
          'https://gemini.google.com',
          'https://notion.so',
          'https://perplexity.ai'
        ]
      },
      {
        name: 'Communication',
        description: 'Stay connected with friends and colleagues',
        urls: [
          'https://mail.google.com',
          'https://slack.com',
          'https://web.whatsapp.com',
          'https://zoom.us'
        ]
      },
      {
        name: 'Social & Entertainment',
        description: 'Relax and explore online',
        urls: [
          'https://youtube.com',
          'https://reddit.com',
          'https://spotify.com',
          'https://netflix.com'
        ]
      },
      {
        name: 'Tools',
        description: 'Handy online tools and storage',
        urls: [
          'https://drive.google.com',
          'https://dropbox.com',
          'https://canva.com',
          'https://tinypng.com'
        ]
      },
      {
        name: 'Learning',
        description: 'Learn and grow every day',
        urls: [
          'https://coursera.org',
          'https://khanacademy.org',
          'https://medium.com',
          'https://wikipedia.org'
        ]
      }
    ]
  }
];


/**
 * Get persona by title
 * @param {string} title - The persona title to search for
 * @returns {Object|null} The persona object or null if not found
 */
export function getPersonaByTitle(title) {
  return personas.find(persona =>
    persona.title.toLowerCase() === title.toLowerCase()
  ) || null;
}

/**
 * Get all available persona titles
 * @returns {string[]} Array of persona titles
 */
export function getPersonaTitles() {
  return personas.map(persona => persona.title);
}

/**
 * Get total URL count across all workspaces for a persona
 * @param {Object} persona - The persona object
 * @returns {number} Total number of URLs
 */
export function getPersonaUrlCount(persona) {
  return persona.workspaces.reduce((total, workspace) =>
    total + workspace.urls.length, 0
  );
}

/**
 * Validate persona structure
 * @param {Object} persona - The persona object to validate
 * @returns {boolean} True if valid, false otherwise
 */
export function validatePersona(persona) {
  if (!persona || typeof persona !== 'object') return false;
  if (!persona.icon || !persona.title || !persona.description) return false;
  if (!Array.isArray(persona.workspaces)) return false;

  return persona.workspaces.every(workspace =>
    workspace.name &&
    workspace.description &&
    Array.isArray(workspace.urls) &&
    workspace.urls.length > 0
  );
}

export default personas;