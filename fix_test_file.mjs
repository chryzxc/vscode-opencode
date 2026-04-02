import fs from 'fs';
const content = fs.readFileSync('tests/components/plan-detection.test.mjs', 'utf8');
const fixed = content.replace(/extractFunctionBody\(([^,]+),\s*'([^']+)',\s*\);/g, 'extractFunctionBody($1, \'$2\');');
fs.writeFileSync('tests/components/plan-detection.test.mjs', fixed);
