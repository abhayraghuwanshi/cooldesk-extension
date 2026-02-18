/**
 * CommandParser - Parses ! commands from search input
 *
 * Supports commands like:
 * - !jump github
 * - !spot react hooks
 * - !go yt
 * - !ws switch work
 */

export const COMMANDS = {
  // Core Navigation
  JUMP: 'jump',
  GO: 'go',
  BACK: 'back',
  FORWARD: 'forward',
  SPOT: 'spot',
  HISTORY: 'history',
  RECENT: 'recent',

  // Workspace
  WS: 'ws',
  SAVE: 'save',
  SNAPSHOT: 'snapshot',
  SESSION: 'session',

  // AI
  ANSWER: 'answer',
  SUMMARIZE: 'summarize',
  EXPLAIN: 'explain',
  SOLVE: 'solve',
  WRITE: 'write',
  IMPROVE: 'improve',

  // Special
  HELP: '?',
  MAGIC: 'magic',
  FLOW: 'flow',
};

// Shortcuts mapping for !go command
export const WEBSITE_SHORTCUTS = {
  'yt': 'https://youtube.com',
  'gm': 'https://mail.google.com',
  'gh': 'https://github.com',
  'fig': 'https://figma.com',
  'tw': 'https://twitter.com',
  'fb': 'https://facebook.com',
  'ig': 'https://instagram.com',
  'li': 'https://linkedin.com',
  'rd': 'https://reddit.com',
  'so': 'https://stackoverflow.com',
  'wiki': 'https://wikipedia.org',
  'amz': 'https://amazon.com',
  'nf': 'https://netflix.com',
  'spot': 'https://spotify.com',
};

export class CommandParser {
  /**
   * Check if input is a command
   * @param {string} input
   * @returns {boolean}
   */
  static isCommand(input) {
    return typeof input === 'string' && input.trim().startsWith('!');
  }

  /**
   * Parse command from input
   * @param {string} input - e.g. "!jump github" or "!ws switch work"
   * @returns {object|null} - { command, subcommand, args, raw }
   */
  static parse(input) {
    if (!this.isCommand(input)) {
      return null;
    }

    const trimmed = input.trim().slice(1); // Remove !
    const parts = trimmed.split(/\s+/);

    if (parts.length === 0) {
      return null;
    }

    const [command, ...rest] = parts;
    const normalizedCommand = command.toLowerCase();

    // Handle commands with subcommands (e.g., !ws switch)
    let subcommand = null;
    let args = rest.join(' ');

    // Special handling for commands that have subcommands
    if (['ws', 'session', 'flow'].includes(normalizedCommand) && rest.length > 0) {
      subcommand = rest[0].toLowerCase();
      args = rest.slice(1).join(' ');
    }

    return {
      command: normalizedCommand,
      subcommand,
      args: args.trim(),
      raw: input,
      parts: rest,
    };
  }

  /**
   * Get command description for help
   * @param {string} command
   * @returns {string}
   */
  static getDescription(command) {
    const descriptions = {
      [COMMANDS.JUMP]: 'Jump to an open tab by name',
      [COMMANDS.GO]: 'Open website by shortcut (e.g., !go yt)',
      [COMMANDS.BACK]: 'Go back in history',
      [COMMANDS.FORWARD]: 'Go forward in history',
      [COMMANDS.SPOT]: 'Universal search across tabs, history, bookmarks, workspaces',
      [COMMANDS.HISTORY]: 'Search your browser history',
      [COMMANDS.RECENT]: 'Show recently closed tabs',
      [COMMANDS.WS]: 'Workspace commands (switch, create, clean, focus)',
      [COMMANDS.SAVE]: 'Save all open tabs to current workspace',
      [COMMANDS.SNAPSHOT]: 'Capture full browser state',
      [COMMANDS.SESSION]: 'Session management (restore)',
      [COMMANDS.ANSWER]: 'AI answers questions about current page',
      [COMMANDS.SUMMARIZE]: 'AI summarizes current page',
      [COMMANDS.EXPLAIN]: 'AI explains current page in detail',
      [COMMANDS.SOLVE]: 'AI helps solve a problem',
      [COMMANDS.WRITE]: 'AI writes content in notes',
      [COMMANDS.IMPROVE]: 'AI improves selected text',
      [COMMANDS.HELP]: 'Show all available commands',
      [COMMANDS.MAGIC]: 'AI suggests commands based on context',
      [COMMANDS.FLOW]: 'Workflow automation (record, run)',
    };

    return descriptions[command] || 'Unknown command';
  }

  /**
   * Get all available commands with descriptions
   * @returns {Array<{command: string, description: string, category: string}>}
   */
  static getAllCommands() {
    return [
      // Core Navigation
      { command: '!jump <tab>', description: this.getDescription(COMMANDS.JUMP), category: 'Navigation' },
      { command: '!go <shortcut>', description: this.getDescription(COMMANDS.GO), category: 'Navigation' },
      { command: '!back', description: this.getDescription(COMMANDS.BACK), category: 'Navigation' },
      { command: '!spot <query>', description: this.getDescription(COMMANDS.SPOT), category: 'Navigation' },
      { command: '!history <query>', description: this.getDescription(COMMANDS.HISTORY), category: 'Navigation' },
      { command: '!recent', description: this.getDescription(COMMANDS.RECENT), category: 'Navigation' },

      // Workspace
      { command: '!ws switch <name>', description: 'Switch to workspace', category: 'Workspace' },
      { command: '!ws create <name>', description: 'Create new workspace', category: 'Workspace' },
      { command: '!ws clean', description: 'Close unused tabs', category: 'Workspace' },
      { command: '!save', description: this.getDescription(COMMANDS.SAVE), category: 'Workspace' },
      { command: '!snapshot', description: this.getDescription(COMMANDS.SNAPSHOT), category: 'Workspace' },

      // AI
      { command: '!answer <question>', description: this.getDescription(COMMANDS.ANSWER), category: 'AI' },
      { command: '!summarize', description: this.getDescription(COMMANDS.SUMMARIZE), category: 'AI' },
      { command: '!explain', description: this.getDescription(COMMANDS.EXPLAIN), category: 'AI' },
      { command: '!write <text>', description: this.getDescription(COMMANDS.WRITE), category: 'AI' },

      // Special
      { command: '!?', description: this.getDescription(COMMANDS.HELP), category: 'Help' },
      { command: '!magic', description: this.getDescription(COMMANDS.MAGIC), category: 'Magic' },
    ];
  }

  /**
   * Validate command has required arguments
   * @param {object} parsed - Parsed command
   * @returns {boolean}
   */
  static validate(parsed) {
    if (!parsed) return false;

    const requiresArgs = [
      COMMANDS.JUMP, COMMANDS.GO, COMMANDS.SPOT,
      COMMANDS.HISTORY, COMMANDS.ANSWER, COMMANDS.WRITE
    ];

    if (requiresArgs.includes(parsed.command) && !parsed.args) {
      return false;
    }

    // Workspace subcommands that require args
    if (parsed.command === COMMANDS.WS && parsed.subcommand === 'switch' && !parsed.args) {
      return false;
    }

    return true;
  }
}
