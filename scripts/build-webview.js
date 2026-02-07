const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

async function build() {
  const vendorEntry = 'webview/chat/vendor-entry.js';
  const vendorOutput = 'webview/chat/lib/vendor.js';
  
  // Ensure directory exists
  if (!fs.existsSync('webview/chat/lib')) {
    fs.mkdirSync('webview/chat/lib', { recursive: true });
  }

  // Create temporary entry file
  fs.writeFileSync(vendorEntry, `
    import { marked } from 'marked';
    import hljs from 'highlight.js/lib/core';
    import javascript from 'highlight.js/lib/languages/javascript';
    import typescript from 'highlight.js/lib/languages/typescript';
    import python from 'highlight.js/lib/languages/python';
    import bash from 'highlight.js/lib/languages/bash';
    import json from 'highlight.js/lib/languages/json';
    import css from 'highlight.js/lib/languages/css';
    import xml from 'highlight.js/lib/languages/xml'; // for html
    import markdown from 'highlight.js/lib/languages/markdown';

    // Register languages
    hljs.registerLanguage('javascript', javascript);
    hljs.registerLanguage('typescript', typescript);
    hljs.registerLanguage('js', javascript);
    hljs.registerLanguage('ts', typescript);
    hljs.registerLanguage('python', python);
    hljs.registerLanguage('py', python);
    hljs.registerLanguage('bash', bash);
    hljs.registerLanguage('sh', bash);
    hljs.registerLanguage('json', json);
    hljs.registerLanguage('css', css);
    hljs.registerLanguage('html', xml);
    hljs.registerLanguage('xml', xml);
    hljs.registerLanguage('markdown', markdown);
    hljs.registerLanguage('md', markdown);

    window.marked = marked;
    window.hljs = hljs;
  `);

  try {
    await esbuild.build({
      entryPoints: [vendorEntry],
      bundle: true,
      outfile: vendorOutput,
      format: 'iife',
      minify: true,
      sourcemap: false,
    });
    console.log('Webview vendor build complete.');
  } catch (e) {
    console.error('Webview vendor build failed:', e);
    process.exit(1);
  } finally {
    // cleanup
    if (fs.existsSync(vendorEntry)) {
      fs.unlinkSync(vendorEntry);
    }
  }
}

build();
