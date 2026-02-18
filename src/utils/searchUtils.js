import Fuse from 'fuse.js';

/**
 * Performs a fuzzy search on the provided data using Fuse.js.
 * @param {Array} data - The array of objects to search through.
 * @param {string} query - The search query.
 * @param {Array<string>} keys - The keys of the objects to search in.
 * @param {Object} options - Additional Fuse.js options.
 * @returns {Array} - The filtered results based on the search query.
 */
export const fuzzySearch = (data, query, keys, options = {}) => {
    if (!query || query.trim() === '') {
        return data;
    }

    // If data is already a Fuse instance, use it directly
    if (data instanceof Fuse) {
        const result = data.search(query);
        return result.map(r => r.item);
    }

    const defaultOptions = {
        includeScore: true,
        shouldSort: true,
        threshold: 0.3,
        location: 0,
        distance: 100,
        maxPatternLength: 32,
        minMatchCharLength: 1,
        ...options,
        keys
    };

    const fuse = new Fuse(data, defaultOptions);
    const result = fuse.search(query);

    // Return the original item from the search result
    return result.map(r => r.item);
};
