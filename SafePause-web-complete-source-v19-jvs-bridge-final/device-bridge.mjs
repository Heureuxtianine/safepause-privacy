import crypto from 'node:crypto';

const allowedTools = new Set([
  'safepause_device_status', 'messaging_read_latest_message',
  'messaging_send_message', 'dialer_place_call',
  'deskclock_create_timer', 'deskclock_create_alarm'
]);
const onlineMs = 20000;
const pollWaitMs = Math.min(10000,Math.max(50,Number(process.env.SAFEPAUSE_BRIDGE_POLL_MS)||10000));
const devices = new Map();
const secret = process.env.SAFEPAUSE_BRIDGE_SECRET || '';

function send(res, code, body) {
  res.writeHead(code, {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(JSON.stringify(body));
}
function token(id, role) {
  return crypto.createHmac('sha256', secret).update(`${role}:${id}`).digest('hex');
}
function equal(a, b) {
  const left=Buffer.from(String(a||'')), right=Buffer.from(String(b||''));
  return left.length===right.length && crypto.timingSafeEqual(left,right);
}
function authorized(req, expected) { return equal(req.headers.authorization, `Bearer ${expected}`); }
async function body(req) {
  if (!String(req.headers['content-type']||'').startsWith('application/json')) throw new Error('需要 JSON 请求');
  let raw='';
  for await (const chunk of req) { raw+=chunk; if(raw.length>32768)throw new Error('请求过长'); }
  return JSON.parse(raw||'{}');
}
function record(id) {
  if(!devices.has(id))devices.set(id,{seen:0,tools:[],status:null,job:null,poll:null});
  return devices.get(id);
}
function online(device) { return Date.now()-device.seen<onlineMs; }
function result(id, value) { return {jsonrpc:'2.0',id,result:value}; }
function error(id, code, message) { return {jsonrpc:'2.0',id,error:{code,message}}; }
function finish(job, value) {
  if(!job || job.done)return;
  job.done=true;clearTimeout(job.timer);job.resolve(value);
}

export async function handleDeviceBridge(req,res,pathname,adminKey) {
  if(!pathname.startsWith('/bridge/'))return false;
  if(!secret || secret.length<32 || !adminKey) {send(res,503,{error:'设备桥接未配置'});return true;}
  if(req.headers.origin){send(res,403,{error:'此接口仅供受控客户端使用'});return true;}
  if(pathname==='/bridge/pair' && req.method==='POST') {
    if(!equal(req.headers['x-safepause-key'],adminKey)){send(res,401,{error:'管理员密钥无效'});return true;}
    try {
      const {deviceId}=await body(req);
      if(typeof deviceId!=='string'||!/^[a-f0-9-]{36}$/.test(deviceId))throw new Error('设备标识无效');
      send(res,200,{deviceId,deviceToken:token(deviceId,'phone'),mcpToken:token(deviceId,'mcp'),mcpPath:`/bridge/${deviceId}/mcp`});
    } catch(e){send(res,400,{error:e.message});}
    return true;
  }
  const match=/^\/bridge\/([a-f0-9-]{36})\/(poll|result|mcp)$/.exec(pathname);
  if(!match){send(res,404,{error:'接口不存在'});return true;}
  const [,id,action]=match;
  if(action==='poll' || action==='result') {
    if(!authorized(req,token(id,'phone'))){send(res,401,{error:'设备凭据无效'});return true;}
    if(req.method!=='POST'){send(res,405,{error:'只接受 POST'});return true;}
    const device=record(id);
    try {
      const data=await body(req);
      if(action==='result') {
        const job=device.job;
        if(!job||job.id!==data.jobId){send(res,409,{error:'请求已失效'});return true;}
        device.job=null;
        finish(job,typeof data.outcome==='object' && data.outcome!==null ? data.outcome : {isError:true,content:[{type:'text',text:'手机未返回有效结果'}]});
        send(res,200,{accepted:true});return true;
      }
      device.seen=Date.now();
      device.tools=Array.isArray(data.tools)?data.tools.filter(t=>t&&allowedTools.has(t.name)).slice(0,6):[];
      device.status=data.status && typeof data.status==='object' ? data.status:null;
      if(device.poll) { clearTimeout(device.poll.timer);device.poll.resolve(); }
      if(device.job&&!device.job.delivered) {device.job.delivered=true;send(res,200,{job:{id:device.job.id,name:device.job.name,args:device.job.args}});return true;}
      await new Promise(resolve=>{const timer=setTimeout(resolve,pollWaitMs);device.poll={resolve,timer};res.on('close',resolve);});
      device.poll=null;
      if(device.job&&!device.job.delivered){device.job.delivered=true;send(res,200,{job:{id:device.job.id,name:device.job.name,args:device.job.args}});}
      else if(!res.destroyed)send(res,200,{job:null});
    }catch(e){if(!res.destroyed)send(res,400,{error:e.message});}
    return true;
  }
  if(req.method!=='POST'){send(res,405,{error:'只接受 POST'});return true;}
  if(!authorized(req,token(id,'mcp'))){send(res,401,{error:'MCP 凭据无效'});return true;}
  const device=record(id);
  try {
    const rpc=await body(req), requestId=rpc.id;
    if(rpc.jsonrpc!=='2.0'||typeof rpc.method!=='string'){send(res,200,error(requestId??null,-32600,'JSON-RPC 请求无效'));return true;}
    if(requestId===undefined){send(res,202,{});return true;}
    if(rpc.method==='initialize') {send(res,200,result(requestId,{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'SafePause device bridge',version:'0.1.0'},instructions:'先核对设备型号。私人读取和写入均须在手机前台由本人确认。'}));return true;}
    if(rpc.method==='ping'){send(res,200,result(requestId,{}));return true;}
    if(rpc.method==='tools/list') {send(res,200,result(requestId,{tools:online(device)?device.tools:[]}));return true;}
    if(rpc.method!=='tools/call'){send(res,200,error(requestId,-32601,'方法不可用'));return true;}
    if(!online(device)){send(res,200,error(requestId,-32001,'目标手机不在线或应用未处于前台'));return true;}
    const name=rpc.params?.name, args=rpc.params?.arguments||{};
    if(!device.tools.some(t=>t.name===name)||!args||typeof args!=='object'||Array.isArray(args)){send(res,200,error(requestId,-32602,'工具或参数不可用'));return true;}
    if(name==='safepause_device_status') {send(res,200,result(requestId,{content:[{type:'text',text:JSON.stringify(device.status)}],structuredContent:device.status,isError:false}));return true;}
    if(device.job){send(res,200,error(requestId,-32000,'这台手机已有待确认请求'));return true;}
    const outcome=await new Promise(resolve=>{
      const job={id:crypto.randomUUID(),name,args,resolve,done:false,delivered:false};
      job.timer=setTimeout(()=>{if(device.job===job)device.job=null;finish(job,{isError:true,content:[{type:'text',text:'手机确认超时或已离线'}]});},55000);
      device.job=job;
      if(device.poll){clearTimeout(device.poll.timer);device.poll.resolve();}
    });
    send(res,200,result(requestId,outcome));
  } catch(e){if(!res.destroyed)send(res,400,{error:e.message});}
  return true;
}
