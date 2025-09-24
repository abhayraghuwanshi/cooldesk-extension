// Test script for hybrid approach
import GenericUrlParser from './src/utils/GenericUrlParser.js';
import categoryManager from './src/data/categories.js';

// Test URLs
const testUrls = [
  // Platform-specific URLs (should use GenericUrlParser)
  'https://github.com/facebook/react',
  'https://chat.openai.com/c/abc123',
  'https://claude.ai/chat/xyz789',
  'https://figma.com/file/abc123/MyDesign',

  // Generic category URLs (should use categoryManager)
  'https://netflix.com/watch/12345',
  'https://facebook.com/profile/user',
  'https://amazon.com/dp/B08N5WRWNW',
  'https://cnn.com/news/article',
  'https://spotify.com/playlist/abc',
  'https://gmail.com/mail/inbox'
];

console.log('=== Testing Hybrid Approach ===\n');

testUrls.forEach(url => {
  console.log(`URL: ${url}`);

  // Check if should use generic categorization
  const useGeneric = GenericUrlParser.shouldUseGenericCategorization(url);
  console.log(`  Should use generic categorization: ${useGeneric}`);

  if (!useGeneric) {
    // Use GenericUrlParser
    const parsed = GenericUrlParser.parse(url);
    if (parsed) {
      console.log(`  GenericUrlParser result: ${parsed.workspace} (${parsed.platform.name})`);
    } else {
      console.log(`  GenericUrlParser: No match`);
    }
  } else {
    // Use categoryManager
    const category = categoryManager.categorizeUrl(url);
    console.log(`  CategoryManager result: ${category}`);
  }

  console.log('');
});

console.log('=== Category Manager Statistics ===');
console.log(`Total categories loaded: ${categoryManager.getAllCategories().length}`);
console.log('Available categories:', categoryManager.getAllCategories().slice(0, 10).join(', '), '...');