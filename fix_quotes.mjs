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
    
    // Find mixed quotes:
    // extractFunctionBody(src, 'func('something', ...
    // or extractFunctionBody(src, "func("something", ...
    
    // Actually, I can just use a regex to fix `extractFunctionBody(src, 'func('` to `extractFunctionBody(src, 'func(' + ... 
    // No, wait, if the original was `'private func(params)',` and it became `'func('params)',`
    
    content = content.replace(/extractFunctionBody\(([^,]+),\s*'([a-zA-Z0-9_]+)\(\'/g, 'extractFunctionBody($1, \'$2(\'');
    content = content.replace(/extractFunctionBody\(([^,]+),\s*"([a-zA-Z0-9_]+)\(\"/g, 'extractFunctionBody($1, "$2("');

    // Wait, the syntax error is `extractFunctionBody(chatProviderSource, 'enrichMessageWithPlan('message: any): any',`
    // It's ` 'enrichMessageWithPlan('message: ... `
    // Let's just fix it by matching the exact bad pattern.
    content = content.replace(/'([a-zA-Z0-9_]+)\('([^']*)',/g, "'$1($2',");
    content = content.replace(/"([a-zA-Z0-9_]+)\("([^"]*)",/g, '"$1($2",');

    if (content !== fs.readFileSync(filePath, 'utf8')) {
      fs.writeFileSync(filePath, content);
      console.log(`Updated ${filePath}`);
    }
  }
});
