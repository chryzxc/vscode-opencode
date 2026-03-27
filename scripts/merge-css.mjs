import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '../webview/shared/dist');

// Find all CSS files
const files = fs.readdirSync(distDir);
const cssFiles = files.filter(f => f.endsWith('.css')).sort();

if (cssFiles.length === 0) {
  console.log('No CSS files found');
  process.exit(0);
}

// Read and merge all CSS
let merged = '';
for (const file of cssFiles) {
  const content = fs.readFileSync(path.join(distDir, file), 'utf-8');
  merged += content + '\n';
}

// Write merged CSS to chat.css
const outputPath = path.join(distDir, 'chat.css');
fs.writeFileSync(outputPath, merged);

// Remove other CSS files
for (const file of cssFiles) {
  if (file !== 'chat.css') {
    fs.unlinkSync(path.join(distDir, file));
  }
}

console.log(`Merged ${cssFiles.length} CSS files into chat.css`);
