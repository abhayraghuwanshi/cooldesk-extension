
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(process.cwd(), 'sync-data', 'sync-data.json');

if (!fs.existsSync(DATA_FILE)) {
    console.error(`File not found: ${DATA_FILE}`);
    process.exit(1);
}

try {
    const stats = fs.statSync(DATA_FILE);
    console.log(`File Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

    console.log('Reading file...');
    const content = fs.readFileSync(DATA_FILE, 'utf-8');

    console.log('Parsing JSON...');
    const data = JSON.parse(content);

    console.log('\n--- Size Analysis ---');
    const sizes = [];

    for (const key in data) {
        if (!Object.prototype.hasOwnProperty.call(data, key)) continue;

        try {
            const str = JSON.stringify(data[key]);
            const sizeBytes = Buffer.byteLength(str, 'utf8');
            const sizeMB = sizeBytes / 1024 / 1024;
            const count = Array.isArray(data[key]) ? data[key].length : (typeof data[key] === 'object' && data[key] !== null ? Object.keys(data[key]).length : 1);

            sizes.push({ key, sizeMB, count });
        } catch (e) {
            console.error(`Error stringifying key: ${key}`);
        }
    }

    // Sort by size desc
    sizes.sort((a, b) => b.sizeMB - a.sizeMB);

    sizes.forEach(item => {
        console.log(`${item.key}: ${item.sizeMB.toFixed(2)} MB (${item.count} items)`);
    });

    // Detailed check for 'activity' if it's large
    if (data.activity && Array.isArray(data.activity) && data.activity.length > 0) {
        console.log('\n--- Activity Analysis (First Item) ---');
        // Check first few items for large fields
        const sample = data.activity[0];
        if (sample) {
            for (const k in sample) {
                if (!Object.prototype.hasOwnProperty.call(sample, k)) continue;
                try {
                    const val = JSON.stringify(sample[k]);
                    if (val && val.length > 1000) {
                        console.log(`Field '${k}' in activity items seems large (approx ${(val.length / 1024).toFixed(2)} KB)`);
                    }
                } catch (e) { }
            }
        }
    } else {
        console.log('\nActivity is empty or not an array.');
    }

} catch (e) {
    console.error('Error analyzing file:', e);
}
