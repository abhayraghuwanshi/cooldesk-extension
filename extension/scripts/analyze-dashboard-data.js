
import fs from 'fs';
import path from 'path';

const DATA_FILE = path.join(process.cwd(), 'sync-data', 'sync-data.json');
const content = fs.readFileSync(DATA_FILE, 'utf-8');
const data = JSON.parse(content);

if (data.dashboard && data.dashboard.data) {
    const d = data.dashboard.data;
    console.log('--- Inspector for dashboard.data ---');
    console.log(`Type: ${Array.isArray(d) ? 'Array' : typeof d}`);

    if (Array.isArray(d)) {
        console.log(`Length: ${d.length}`);
        if (d.length > 0) {
            console.log('Sample item keys:', Object.keys(d[0]));
            // Check for large fields in first item
            const item = d[0];
            for (const k in item) {
                const len = JSON.stringify(item[k]).length;
                if (len > 1000) console.log(`Field '${k}' length: ${len}`);
            }
        }
    } else if (typeof d === 'object') {
        const keys = Object.keys(d);
        console.log(`Key count: ${keys.length}`);
        // Log top 10 keys by size
        const keySizes = keys.map(k => ({
            key: k,
            size: JSON.stringify(d[k]).length
        })).sort((a, b) => b.size - a.size).slice(0, 10);

        console.log('Largest keys in dashboard.data:', keySizes);
    }
}
