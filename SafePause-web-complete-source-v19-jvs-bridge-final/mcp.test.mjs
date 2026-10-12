import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

test('discovers allowlisted MCP tools and performs a real JSON-RPC tool call', async () => {
  const seen=[];
  const mock=http.createServer(async(req,res)=>{
    const body=JSON.parse(await new Promise((resolve,reject)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>resolve(raw));req.on('error',reject);}));
    seen.push(body.method);
    if(body.method==='initialize') {res.writeHead(200,{'content-type':'application/json','mcp-session-id':'test-session'});return res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result:{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'test',version:'1'}}}));}
    if(body.method==='notifications/initialized') {res.writeHead(202);return res.end();}
    if(body.method==='tools/list') {res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result:{tools:[{name:'messaging_send_message',inputSchema:{type:'object',properties:{phone:{type:'string'},message:{type:'string'}},required:['phone','message']}},{name:'unknown_dangerous_tool',inputSchema:{type:'object'}}]}}));}
    if(body.method==='tools/call') {res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result:{content:[{type:'text',text:'sent'}]}}));}
    res.writeHead(400);res.end();
  });
  await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
  const oldUrl=process.env.SAFEPAUSE_MCP_URL;process.env.SAFEPAUSE_MCP_URL=`http://127.0.0.1:${mock.address().port}/mcp`;
  try {
    const bridge=await import(`./mcp.mjs?test=${Date.now()}`);
    const tools=await bridge.listTools();
    assert.deepEqual(tools.map(t=>t.name),['messaging_send_message']);
    assert.equal(tools[0].mode,'write');
    const result=await bridge.callTool('messaging_send_message',{phone:'13800000000',message:'核验消息'});
    assert.equal(result.content[0].text,'sent');
    assert.ok(seen.includes('notifications/initialized'));
    assert.ok(seen.includes('tools/call'));
    await assert.rejects(()=>bridge.callTool('unknown_dangerous_tool',{}),/允许列表/);
  } finally {
    if(oldUrl===undefined)delete process.env.SAFEPAUSE_MCP_URL;else process.env.SAFEPAUSE_MCP_URL=oldUrl;
    await new Promise(resolve=>mock.close(resolve));
  }
});
