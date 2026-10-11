import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const root=path.dirname(fileURLToPath(import.meta.url));
const [html,css,js]=await Promise.all(['index.html','styles.css','app.js'].map(name=>fs.readFile(path.join(root,name),'utf8')));
new vm.Script(js);
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
if(new Set(ids).size!==ids.length)throw new Error('HTML 有重复元素 ID');
for(const match of js.matchAll(/\$\('([^']+)'\)/g))if(!ids.includes(match[1]))throw new Error('缺少页面元素：'+match[1]);
const bundled=html
  .replace('<link rel="stylesheet" href="/styles.css">',()=>`<style data-safepause-bundle="styles">${css}</style>`)
  .replace('<script type="module" src="/app.js"></script>','')
  .replace('</body>',()=>`<script data-safepause-bundle="app">\nwindow.SAFEPAUSE_STANDALONE = true;\n${js.replace(/<\/script/gi,'<\\/script')}\n</script>\n</body>`);
await fs.writeFile(path.join(root,'SafePause-standalone.html'),bundled);
console.log('已生成 SafePause-standalone.html');
