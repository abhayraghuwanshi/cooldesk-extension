// Import appstore.json data
import appstoreData from './appstore.json';

class URLCategory {
  constructor(name, urls = [], patterns = []) {
    this.name = name;
    this.urls = urls;
    this.patterns = patterns;
  }

  addUrl(url) {
    if (!this.urls.includes(url)) {
      this.urls.push(url);
    }
  }

  addPattern(pattern) {
    if (!this.patterns.includes(pattern)) {
      this.patterns.push(pattern);
    }
  }

  matchesUrl(url) {
    // Direct URL match
    if (this.urls.some(categoryUrl => url.includes(categoryUrl))) {
      return true;
    }

    // Pattern match
    return this.patterns.some(pattern => {
      const regex = new RegExp(pattern, 'i');
      return regex.test(url);
    });
  }
}

class CategoryManager {
  constructor() {
    this.categories = new Map();
    this.initializeDefaultCategories();
  }

  initializeDefaultCategories() {
    // Load categories from appstore.json data
    for (const [categoryName, domains] of Object.entries(appstoreData)) {
      const category = new URLCategory(categoryName, domains, []);
      this.categories.set(categoryName, category);
    }
  }

  addCategory(category) {
    this.categories.set(category.name, category);
  }

  getCategory(name) {
    return this.categories.get(name);
  }

  categorizeUrl(url) {
    for (const [name, category] of this.categories) {
      if (category.matchesUrl(url)) {
        return name;
      }
    }
    return 'uncategorized';
  }

  leftJoinWithHistory(historyData) {
    const categorizedHistory = historyData.map(historyItem => {
      const category = this.categorizeUrl(historyItem.url);
      return {
        ...historyItem,
        category: category,
        categoryData: this.categories.get(category) || null
      };
    });

    // Group by category
    const groupedByCategory = {};
    categorizedHistory.forEach(item => {
      if (!groupedByCategory[item.category]) {
        groupedByCategory[item.category] = [];
      }
      groupedByCategory[item.category].push(item);
    });

    return {
      categorizedHistory,
      groupedByCategory,
      summary: this.generateCategorySummary(groupedByCategory)
    };
  }

  generateCategorySummary(groupedData) {
    const summary = {};
    for (const [category, items] of Object.entries(groupedData)) {
      summary[category] = {
        count: items.length,
        uniqueUrls: [...new Set(items.map(item => item.url))].length,
        totalTimeSpent: items.reduce((acc, item) => acc + (item.timeSpent || 0), 0),
        lastVisited: Math.max(...items.map(item => new Date(item.visitTime || 0).getTime()))
      };
    }
    return summary;
  }

  getAllCategories() {
    return Array.from(this.categories.keys());
  }

  getCategoryUrls(categoryName) {
    const category = this.categories.get(categoryName);
    return category ? category.urls : [];
  }
}

// Export singleton instance
const categoryManager = new CategoryManager();

export { URLCategory, CategoryManager, categoryManager };
export default categoryManager;