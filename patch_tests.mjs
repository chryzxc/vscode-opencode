import fs from 'fs';
import path from 'path';

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(path.join(dir, f));
  });
}

walkDir('./tests', (filePath) => {
  if (filePath.endsWith('.mjs')) {
    let content = fs.readFileSync(filePath, 'utf8');
    let changed = false;
    
    // Some general regexes to relax extraction
    const replacer = (match, p1, p2) => {
      changed = true;
      return `extractFunctionBody(${p1}, "${p2}"`;
    };

    // Replace `extractFunctionBody(src, "private functionName(` with `extractFunctionBody(src, "functionName("`
    // but some are async functions
    content = content.replace(/extractFunctionBody\(\s*([^,]+),\s*"private\s+async\s+([a-zA-Z0-9_]+\()/g, replacer);
    content = content.replace(/extractFunctionBody\(\s*([^,]+),\s*"private\s+([a-zA-Z0-9_]+\()/g, replacer);
    content = content.replace(/extractFunctionBody\(\s*([^,]+),\s*'private\s+async\s+([a-zA-Z0-9_]+\()/g, (m, p1, p2) => { changed = true; return `extractFunctionBody(${p1}, '${p2}'`; });
    content = content.replace(/extractFunctionBody\(\s*([^,]+),\s*'private\s+([a-zA-Z0-9_]+\()/g, (m, p1, p2) => { changed = true; return `extractFunctionBody(${p1}, '${p2}'`; });
    
    // also replace "public processSystemMessage("
    content = content.replace(/extractFunctionBody\(\s*([^,]+),\s*"public\s+([a-zA-Z0-9_]+\()/g, replacer);

    if (changed) {
      fs.writeFileSync(filePath, content);
      console.log(`Updated ${filePath}`);
    }
  }
});
