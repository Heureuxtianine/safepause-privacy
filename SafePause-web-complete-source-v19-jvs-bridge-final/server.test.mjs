import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';

async function freePort(){
  const server=createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  await new Promise(resolve=>server.close(resolve));
  return port;
}

test('public AI needs no visitor key while device routes stay private',async()=>{
  const port=await freePort();
  const child=spawn(process.execPath,['server.mjs'],{
    cwd:fileURLToPath(new URL('.',import.meta.url)),
    env:{...process.env,PORT:String(port),SAFEPAUSE_PUBLIC_AI:'true',SAFEPAUSE_ACCESS_KEY:'offline-admin-key',SAFEPAUSE_ALLOWED_ORIGINS:'https://example.test',HUNYUAN_API_KEY:'offline-test-key'},
    stdio:'ignore'
  });
  const base=`http://127.0.0.1:${port}`;
  try{
    let ready=false;
    for(let i=0;i<50;i++){
      if(child.exitCode!==null)throw new Error('SafePause server exited before startup');
      try{const response=await fetch(base+'/healthz');if(response.ok){ready=true;break;}}catch{}
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.equal(ready,true);
    const status=await fetch(base+'/api/status',{headers:{Origin:'https://example.test'}});
    assert.equal(status.status,200);
    assert.equal((await status.json()).publicAi,true);
    const device=await fetch(base+'/api/tools',{headers:{Origin:'https://example.test'}});
    assert.equal(device.status,403);
    const foreign=await fetch(base+'/api/status',{headers:{Origin:'https://other.test'}});
    assert.equal(foreign.status,403);
    const chat=await fetch(base+'/api/chat',{method:'POST',headers:{Origin:'https://example.test','content-type':'application/json'},body:JSON.stringify({text:'测试',consented:false})});
    assert.equal(chat.status,400);
  }finally{child.kill();}
});
