import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.SAFEPAUSE_BRIDGE_POLL_MS='50';
process.env.SAFEPAUSE_BRIDGE_SECRET='bridge-test-secret-that-is-at-least-32-bytes-long';
const {handleDeviceBridge}=await import('./device-bridge.mjs?test='+Date.now());
const adminKey='admin-test-key';

function request(base,path,{method='POST',headers={},body={}}={}) {
  return new Promise((resolve,reject)=>{
    const data=JSON.stringify(body);
    const req=http.request(base+path,{method,headers:{'content-type':'application/json','content-length':Buffer.byteLength(data),...headers}},res=>{
      let raw='';res.setEncoding('utf8');res.on('data',chunk=>raw+=chunk);res.on('end',()=>resolve({status:res.statusCode,body:raw?JSON.parse(raw):{}}));
    });
    req.on('error',reject);req.end(data);
  });
}

test('device bridge pairs, scopes MCP credentials and relays a confirmed phone result',async t=>{
  const server=http.createServer(async(req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(!await handleDeviceBridge(req,res,pathname,adminKey)) {res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const id='4cc7cb77-f026-4f1f-8fa3-516b6de194f2';
  assert.equal((await request(base,'/bridge/pair',{headers:{'x-safepause-key':'wrong'},body:{deviceId:id}})).status,401);
  const paired=await request(base,'/bridge/pair',{headers:{'x-safepause-key':adminKey},body:{deviceId:id}});
  assert.equal(paired.status,200);
  const phoneAuth={authorization:`Bearer ${paired.body.deviceToken}`};
  const mcpAuth={authorization:`Bearer ${paired.body.mcpToken}`};
  assert.notEqual(paired.body.deviceToken,paired.body.mcpToken);
  const tool={name:'messaging_send_message',description:'send',inputSchema:{type:'object',properties:{recipient:{type:'string'},text:{type:'string'}},required:['recipient','text'],additionalProperties:false}};
  const firstPoll=await request(base,`/bridge/${id}/poll`,{headers:phoneAuth,body:{tools:[tool],status:{device:'Test Android'}}});
  assert.equal(firstPoll.body.job,null);
  const listed=await request(base,`/bridge/${id}/mcp`,{headers:mcpAuth,body:{jsonrpc:'2.0',id:1,method:'tools/list',params:{}}});
  assert.deepEqual(listed.body.result.tools.map(x=>x.name),['messaging_send_message']);
  const wrongDevice=await request(base,`/bridge/${id}/mcp`,{headers:{authorization:'Bearer wrong'},body:{jsonrpc:'2.0',id:2,method:'ping'}});
  assert.equal(wrongDevice.status,401);

  const nextPoll=request(base,`/bridge/${id}/poll`,{headers:phoneAuth,body:{tools:[tool],status:{device:'Test Android'}}});
  await new Promise(resolve=>setTimeout(resolve,5));
  const call=request(base,`/bridge/${id}/mcp`,{headers:mcpAuth,body:{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:tool.name,arguments:{recipient:'10086',text:'test'}}}});
  const delivered=await nextPoll;
  assert.equal(delivered.body.job.name,tool.name);
  assert.equal(delivered.body.job.args.text,'test');
  const outcome={isError:false,structuredContent:{name:tool.name,status:'Requested',verified:false}};
  const accepted=await request(base,`/bridge/${id}/result`,{headers:phoneAuth,body:{jobId:delivered.body.job.id,outcome}});
  assert.equal(accepted.status,200);
  const returned=await call;
  assert.equal(returned.body.result.structuredContent.status,'Requested');
});
