/**
 * AI Categorizer - Intelligent URL categorization using Gemini AI
 * Uses appstore.json as knowledge base and project context for accurate categorization
 */

import { projectDetector } from './projectDetector.js';
import { getSettings } from '../db/index.js';
import appstoreData from '../data/appstore.json';

/**
 * Result structure:
 * {
 *   category: string,
 *   subcategory: string|null,
 *   confidence: number,
 *   isNewCategory: boolean,
 *   projectId: string|null,
 *   environment: string,
 *   reasoning: string
 * }
 */

class Categorizer {
  constructor() {
    this.appstore = appstoreData;
    this.categories = Object.keys(this.appstore);
    this.cache = new Map();
    this.CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
  }

  /**
   * Get category examples from appstore.json
   * @param {string} category
   * @returns {Array<string>}
   */
  _getCategoryExamples(category) {
    return this.appstore[category]?.slice(0, 10) || [];
  }

  /**
   * Build prompt for AI categorization
   * @param {string} url
   * @param {string} title
   * @param {Object} context - Project and session context
   * @returns {string}
   */
  _buildPrompt(url, title, context) {
    const { project, session, environment } = context;

    // Build category knowledge base
    const categoryInfo = this.categories.map(cat => {
      const examples = this._getCategoryExamples(cat);
      return `- ${cat}: ${examples.slice(0, 5).join(', ')}`;
    }).join('\n');

    const prompt = `You are an intelligent URL categorizer for a developer's productivity extension.

URL: ${url}
Page Title: ${title || 'Unknown'}
Environment: ${environment}

${project ? `Current Project: ${project.name}
Project Categories: ${project.categories.join(', ') || 'None yet'}
` : ''}

${session && session.recentTabs.length > 0 ? `Recent Session Context:
${session.recentTabs.map(t => `- ${t.url} (${t.title})`).join('\n')}
` : ''}

Known Categories with Examples:
${categoryInfo}

Task: Categorize this URL into the most appropriate category.

Instructions:
1. If the URL domain matches examples in a known category, use that category
2. If it's related to the current project's work, consider the project categories
3. If it's a research/documentation URL in the same session as project URLs, associate it with the project's primary category
4. If no existing category fits well (confidence < 0.7), suggest a NEW category name
5. Detect if this is a dev/staging/production environment

Return ONLY valid JSON (no markdown fences):
{
  "category": "category_name",
  "subcategory": "optional_subcategory",
  "confidence": 0.0-1.0,
  "isNewCategory": boolean,
  "reasoning": "brief explanation"
}`;

    return prompt;
  }

  /**
   * Categorize URL using AI
   * @param {string} url
   * @param {string} title
   * @param {string} apiKey
   * @returns {Promise<Object>} Categorization result
   */
  async categorize(url, title = '', apiKey = null) {
    // Check cache first
    const cacheKey = `${url}|${title}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      console.log('[Categorizer] Cache hit:', url);
      return cached.result;
    }

    // Get API key
    if (!apiKey) {
      const { geminiApiKey } = await chrome.storage.local.get(['geminiApiKey']);
      apiKey = geminiApiKey;
    }

    if (!apiKey) {
      throw new Error('Gemini API key not configured');
    }

    // Get project context
    const context = projectDetector.getProjectContext(url);

    // Build prompt
    const prompt = this._buildPrompt(url, title, context);

    // Call Gemini API
    const settings = await getSettings();
    const model = (settings?.modelName || 'gemini-1.5-flash').trim();
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;

    console.log('[Categorizer] Calling Gemini API for:', url);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Gemini API error ${response.status}: ${errorText.slice(0, 200)}`);
      }

      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

      // Parse JSON response
      const jsonText = text.replace(/```json|```/g, '').trim();
      const aiResult = JSON.parse(jsonText);

      // Build result
      const result = {
        category: aiResult.category || 'uncategorized',
        subcategory: aiResult.subcategory || null,
        confidence: Number(aiResult.confidence) || 0.5,
        isNewCategory: Boolean(aiResult.isNewCategory),
        projectId: context.project?.id || null,
        projectName: context.project?.name || null,
        environment: context.environment,
        reasoning: aiResult.reasoning || 'AI categorization',
        timestamp: Date.now()
      };

      // Cache result
      this.cache.set(cacheKey, {
        result,
        timestamp: Date.now()
      });

      // If new category suggested with high confidence, create it
      if (result.isNewCategory && result.confidence >= 0.8) {
        await this._createNewCategory(result.category);
      }

      console.log('[Categorizer] Result:', result);
      return result;

    } catch (error) {
      clearTimeout(timeoutId);

      if (error?.name === 'AbortError') {
        throw new Error('Categorization timeout');
      }

      console.error('[Categorizer] Error:', error);
      throw error;
    }
  }

  /**
   * Create new category in appstore
   * @param {string} categoryName
   */
  async _createNewCategory(categoryName) {
    try {
      // Check if category already exists
      if (this.categories.includes(categoryName.toLowerCase())) {
        return;
      }

      // Add to local appstore copy
      this.appstore[categoryName.toLowerCase()] = [];
      this.categories = Object.keys(this.appstore);

      // Store in chrome.storage for persistence
      const { customCategories = [] } = await chrome.storage.local.get(['customCategories']);
      if (!customCategories.includes(categoryName)) {
        customCategories.push(categoryName);
        await chrome.storage.local.set({ customCategories });
      }

      console.log('[Categorizer] Created new category:', categoryName);

      // Broadcast category creation
      chrome.runtime.sendMessage({
        action: 'categoryCreated',
        category: categoryName
      }).catch(() => {});

    } catch (error) {
      console.error('[Categorizer] Failed to create category:', error);
    }
  }

  /**
   * Add domain to category in appstore
   * @param {string} category
   * @param {string} url
   */
  async addToCategory(category, url) {
    try {
      const hostname = new URL(url).hostname;

      if (!this.appstore[category]) {
        this.appstore[category] = [];
      }

      if (!this.appstore[category].includes(hostname)) {
        this.appstore[category].push(hostname);

        // Store in chrome.storage
        const { customCategoryDomains = {} } = await chrome.storage.local.get(['customCategoryDomains']);
        if (!customCategoryDomains[category]) {
          customCategoryDomains[category] = [];
        }
        if (!customCategoryDomains[category].includes(hostname)) {
          customCategoryDomains[category].push(hostname);
          await chrome.storage.local.set({ customCategoryDomains });
        }

        console.log('[Categorizer] Added domain to category:', hostname, '→', category);
      }
    } catch (error) {
      console.error('[Categorizer] Failed to add domain to category:', error);
    }
  }

  /**
   * Get categorization from cache
   * @param {string} url
   * @param {string} title
   * @returns {Object|null}
   */
  getCached(url, title = '') {
    const cacheKey = `${url}|${title}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.result;
    }

    return null;
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
    console.log('[Categorizer] Cache cleared');
  }

  /**
   * Get all categories
   * @returns {Array<string>}
   */
  getCategories() {
    return this.categories;
  }

  /**
   * Quick domain-based categorization (fallback when API fails)
   * @param {string} url
   * @returns {string|null}
   */
  quickCategorize(url) {
    try {
      const hostname = new URL(url).hostname;

      // Search through appstore for matching domain
      for (const [category, domains] of Object.entries(this.appstore)) {
        if (domains.some(domain => hostname.includes(domain) || domain.includes(hostname))) {
          return category;
        }
      }

      // Check custom category domains
      chrome.storage.local.get(['customCategoryDomains']).then(({ customCategoryDomains = {} }) => {
        for (const [category, domains] of Object.entries(customCategoryDomains)) {
          if (domains.some(domain => hostname.includes(domain))) {
            return category;
          }
        }
      });

      return null;
    } catch (error) {
      return null;
    }
  }
}

// Export singleton instance
export const categorizer = new Categorizer();
