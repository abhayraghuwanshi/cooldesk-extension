
function matchesUrl(categoryUrl, url) {
    if (categoryUrl.includes('/')) {
        return url.includes(categoryUrl);
    }

    try {
        const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
        const hostname = urlObj.hostname.toLowerCase();
        const target = categoryUrl.toLowerCase();

        return hostname === target || hostname.endsWith('.' + target);
    } catch (e) {
        return url.includes(categoryUrl);
    }
}

const tests = [
    { cat: 'x.com', url: 'https://www.netflix.com/', expected: false },
    { cat: 'x.com', url: 'https://x.com/home', expected: true },
    { cat: 'x.com', url: 'https://twitter.x.com', expected: true },
    { cat: 'netflix.com', url: 'https://www.netflix.com/watch', expected: true },
    { cat: 'google.com/drive', url: 'https://google.com/drive/my-file', expected: true }
];

let failed = false;
tests.forEach(t => {
    const result = matchesUrl(t.cat, t.url);
    if (result !== t.expected) {
        console.error(`FAIL: Category "${t.cat}" vs URL "${t.url}" -> Got ${result}, Expected ${t.expected}`);
        failed = true;
    } else {
        console.log(`PASS: "${t.cat}" vs "${t.url}" -> ${result}`);
    }
});

if (!failed) console.log('All tests passed!');
