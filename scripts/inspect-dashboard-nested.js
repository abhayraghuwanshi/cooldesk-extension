
import fs from 'fs';
import path from 'path';

const DATA_FILE = path.join(process.cwd(), 'sync-data', 'sync-data.json');
const content = fs.readFileSync(DATA_FILE, 'utf-8');
const data = JSON.parse(content);

if (data.dashboard && data.dashboard.data && data.dashboard.data.data) {
    const d = data.dashboard.data.data;
    console.log('--- Inspector for dashboard.data.data ---');
    console.log(`Type: ${Array.isArray(d) ? 'Array' : typeof d}`);

    if (Array.isArray(d)) {
        console.log(`Length: ${d.length}`);
        if (d.length > 0) {
            const sample = d[0];
            console.log('Sample keys:', Object.keys(sample));
        }
    } else {
        console.log('Keys:', Object.keys(d));
    }
} else {
    console.log('Path dashboard.data.data does not exist.');
}
