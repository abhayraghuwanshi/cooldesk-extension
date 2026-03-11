import NanoAIService from './src/services/nanoAIService.js';

const mockTabs = [
    { url: 'https://youtube.com/watch?v=123', title: 'Funny Cats' },
    { url: 'https://github.com/facebook/react', title: 'facebook/react' },
    { url: 'https://react.dev/reference', title: 'React Reference' },
    { url: 'https://wikipedia.org/wiki/Cat', title: 'Cat - Wikipedia' },
    { url: 'https://twitter.com/devs', title: 'X (Twitter)' },
];

async function runTest() {
    console.log('Initializing NanoAI...');
    await NanoAIService.init();
    const isAvailable = NanoAIService.isAvailable();
    console.log('Available:', isAvailable);
    if (!isAvailable) return;

    const prompt = 'keep only react and programming links';
    console.log(`\nTesting natural language search against prompt: "${prompt}"`);

    const results = await NanoAIService.naturalLanguageSearch(prompt, mockTabs, 10);
    console.log('\nResults (AI Matched only):');
    results.filter(r => r._aiMatched).forEach(r => {
        console.log(`- ${r.title} (${r.url})`);
    });

    console.log('\nDone.');
    NanoAIService.destroy();
}

runTest().catch(console.error);
