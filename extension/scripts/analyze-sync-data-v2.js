
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const DATA_FILE = path.join(process.cwd(), 'sync-data', 'sync-data.json');

try {
    const stats = fs.statSync(DATA_FILE);
    const fileSizeMB = stats.size / 1024 / 1024;
    console.log(`File Size on Disk: ${fileSizeMB.toFixed(2)} MB`);

    const content = fs.readFileSync(DATA_FILE, 'utf-8');
    const data = JSON.parse(content);

    let calculatedSize = 0;
    const sizes = [];

    const keys = Object.keys(data);
    console.log(`Top-level keys found: ${keys.length}`);

    for (const key of keys) {
        const val = data[key];
        const str = JSON.stringify(val);
        const sizeBytes = Buffer.byteLength(str, 'utf8');
        const sizeMB = sizeBytes / 1024 / 1024;

        sizes.push({ key, sizeMB });
        calculatedSize += sizeMB + (key.length / 1024 / 1024); // Add key overhead
    }

    console.log(`Total Calculated Data Size: ${calculatedSize.toFixed(2)} MB`);
    console.log(`Whitespace/Formatting Difference: ${(fileSizeMB - calculatedSize).toFixed(2)} MB`);

    sizes.sort((a, b) => b.sizeMB - a.sizeMB);

    console.log('\n--- Key Sizes ---');
    sizes.forEach(s => console.log(`${s.key}: ${s.sizeMB.toFixed(2)} MB`));

    // Inspect dashboard specifically
    if (data.dashboard) {
        console.log('\n--- Dashboard Analysis ---');
        const dashKeys = Object.keys(data.dashboard);
        dashKeys.forEach(k => {
            const subVal = JSON.stringify(data.dashboard[Object.keys(data.dashboard).find(dk => dk === k)]);
            const subSize = Buffer.byteLength(subVal, 'utf8') / 1024 / 1024;
            console.log(`dashboard.${k}: ${subSize.toFixed(2)} MB`);
        });
    }

} catch (e) {
    console.error(e);
}
