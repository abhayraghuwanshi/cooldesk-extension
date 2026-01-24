import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const filePath = path.join(__dirname, 'src/data/appstore.json');
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');


const appstoreData = JSON.parse(content);
const socialDomains = appstoreData.social || [];
const target = 'netflix.com';
const fullUrl = 'https://www.netflix.com/';

console.log('Checking for substring matches in Social...');
socialDomains.forEach(domain => {
    if (fullUrl.includes(domain)) {
        console.log(`MATCH FOUND! Social domain "${domain}" matches target "${fullUrl}"`);
    }
});
