
import fs from 'fs';
import path from 'path';

const DATA_FILE = path.join(process.cwd(), 'sync-data', 'sync-data.json');

if (!fs.existsSync(DATA_FILE)) {
    console.error(`File not found: ${DATA_FILE}`);
    process.exit(1);
}

try {
    const stats = fs.statSync(DATA_FILE);
    const initialSizeMB = stats.size / 1024 / 1024;
    console.log(`Initial File Size: ${initialSizeMB.toFixed(2)} MB`);

    const content = fs.readFileSync(DATA_FILE, 'utf-8');
    const data = JSON.parse(content);

    if (data.dashboard && data.dashboard.data) {
        console.log('Found recursive dashboard.data. Removing...');
        delete data.dashboard.data;

        // Ensure bookmarks and history exist at top level (they seemed to be fine from analysis)
        if (!data.dashboard.bookmarks) data.dashboard.bookmarks = [];
        if (!data.dashboard.history) data.dashboard.history = [];

        // Save cleaned data
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

        const newStats = fs.statSync(DATA_FILE);
        const newSizeMB = newStats.size / 1024 / 1024;
        console.log(`Cleaned File Size: ${newSizeMB.toFixed(2)} MB`);
        console.log(`Reclaimed: ${(initialSizeMB - newSizeMB).toFixed(2)} MB`);
    } else {
        console.log('No recursive dashboard.data found. Nothing to clean.');
    }

} catch (e) {
    console.error('Error cleaning file:', e);
}
