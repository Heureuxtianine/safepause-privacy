import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const [html,css]=await Promise.all([
  fs.readFile(new URL('./index.html',import.meta.url),'utf8'),
  fs.readFile(new URL('./styles.css',import.meta.url),'utf8')
]);

test('settings expose five selectable text sizes',()=>{
  const options=[...html.matchAll(/<option value="(standard|large|xlarge|xxlarge|xxxlarge)">/g)].map(match=>match[1]);
  assert.deepEqual(options,['standard','large','xlarge','xxlarge','xxxlarge']);
});

test('settings inputs stay full-width and stacked at larger text sizes',()=>{
  assert.match(css,/\.settings-card input:not\(\[type=checkbox\]\),\.settings-card textarea,\.settings-card select\{display:block;width:100%;max-width:100%;min-width:0/);
  for(const size of ['large','xlarge','xxlarge','xxxlarge']){
    assert.match(css,new RegExp(`body\\[data-text-size="${size}"\\] \\.settings-grid`));
  }
});
