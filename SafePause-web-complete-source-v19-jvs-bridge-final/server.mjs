import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {configured, listTools, callTool, fingerprint, TOOL_POLICY} from './mcp.mjs';
import {aiStatus,transcribe,chat} from './ai.mjs';
import {handleDeviceBridge} from './device-bridge.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const host = process.env.SAFEPAUSE_HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4173);
const accessKey = process.env.SAFEPAUSE_ACCESS_KEY || '';
const publicAi = /^(1|true|yes)$/i.test(process.env.SAFEPAUSE_PUBLIC_AI || '');
const allowedOrigins=new Set((process.env.SAFEPAUSE_ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean));
if(publicAi&&!accessKey)throw new Error('公开 AI 模式仍需 SAFEPAUSE_ACCESS_KEY 保护设备接口');
if(allowedOrigins.size&&!accessKey&&!publicAi)throw new Error('允许公网网页来源时必须设置访问密钥，或明确启用 SAFEPAUSE_PUBLIC_AI');
if (host !== '127.0.0.1' && host !== 'localhost' && !accessKey && !publicAi) throw new Error('局域网访问必须配置 SAFEPAUSE_ACCESS_KEY，或明确启用 SAFEPAUSE_PUBLIC_AI');
if(aiStatus().agent&&!accessKey&&!publicAi)throw new Error('模型接口必须配置 SAFEPAUSE_ACCESS_KEY，或明确启用 SAFEPAUSE_PUBLIC_AI');
const pending = new Map();
const companionTools = {
  messaging_send_message:{description:'向用户核对的单一号码发送短信；仅提出建议，不直接发送',inputSchema:{type:'object',properties:{recipient:{type:'string',description:'独立核对的收件人号码'},text:{type:'string',description:'短信完整正文'}},required:['recipient','text'],additionalProperties:false}},
  dialer_place_call:{description:'向独立核对的号码直接拨号；仅提出建议',inputSchema:{type:'object',properties:{number:{type:'string',description:'独立核对的号码'}},required:['number'],additionalProperties:false}},
  deskclock_create_timer:{description:'创建本机倒计时提醒；仅提出建议',inputSchema:{type:'object',properties:{duration_seconds:{type:'integer',description:'秒，10至86400'},label:{type:'string',description:'提醒标题'}},required:['duration_seconds'],additionalProperties:false}},
  deskclock_create_alarm:{description:'创建下一次指定时间的本机提醒；仅提出建议',inputSchema:{type:'object',properties:{hour:{type:'integer',description:'0至23'},minute:{type:'integer',description:'0至59'},label:{type:'string',description:'提醒标题'}},required:['hour','minute'],additionalProperties:false}}
};
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8'};

function reply(res, code, data, cors={}) {
  res.writeHead(code, {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...cors});
  res.end(JSON.stringify(data));
}
function standaloneCors(req) {
  const origin=req.headers.origin;
  if ((!accessKey&&!publicAi) || !(origin && allowedOrigins.has(origin))) return {};
  return {'access-control-allow-origin':origin,'access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'content-type, x-safepause-key','vary':'Origin'};
}
function allowed(req, publicEndpoint=false) {
  const origin = req.headers.origin;
  if(publicEndpoint&&publicAi){
    if(!origin)return true;
    if(allowedOrigins.has(origin))return true;
    try{return new URL(origin).host===req.headers.host;}catch{return false;}
  }
  if (origin === 'null') return Boolean(accessKey) && req.headers['x-safepause-key'] === accessKey;
  if (allowedOrigins.has(origin)) return Boolean(accessKey) && req.headers['x-safepause-key'] === accessKey;
  if(origin){try{if(new URL(origin).host!==req.headers.host)return false;}catch{return false;}}
  return !accessKey || req.headers['x-safepause-key'] === accessKey;
}
const publicRate=new Map();
function publicRateAllowed(req,pathname){
  const address=String(req.socket.remoteAddress||'unknown');
  const now=Date.now(),windowMs=60000,max=pathname==='/api/transcribe'?8:30;
  const previous=publicRate.get(address);if(!previous||now-previous.started>=windowMs){publicRate.set(address,{started:now,count:1});return true;}
  if(previous.count>=max)return false;previous.count++;return true;
}
async function input(req,limit=32768) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw new Error('请求内容过长');
  }
  return raw ? JSON.parse(raw) : {};
}
function validateArgs(schema, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('工具参数必须是对象');
  const properties = schema.properties || {};
  for (const key of schema.required || []) if (!(key in args) || args[key] === '') throw new Error(`缺少必填参数：${key}`);
  for (const [key, value] of Object.entries(args)) {
    if (!(key in properties) && schema.additionalProperties === false) throw new Error(`不支持的参数：${key}`);
    const type = properties[key]?.type;
    if (type === 'string' && typeof value !== 'string') throw new Error(`${key} 应为文字`);
    if (type === 'integer' && !Number.isInteger(value)) throw new Error(`${key} 应为整数`);
    if (type === 'number' && typeof value !== 'number') throw new Error(`${key} 应为数字`);
    if (type === 'boolean' && typeof value !== 'boolean') throw new Error(`${key} 应为开关`);
    if (properties[key]?.enum && !properties[key].enum.includes(value)) throw new Error(`${key} 不在允许选项中`);
  }
}
async function handleApi(req, res, pathname) {
  const cors=standaloneCors(req);
  for (const [key,value] of Object.entries(cors)) res.setHeader(key,value);
  if (req.method === 'OPTIONS') {res.writeHead(Object.keys(cors).length ? 204 : 403,cors);return res.end();}
  const publicEndpoint=publicAi&&['/api/status','/api/chat','/api/transcribe'].includes(pathname);
  if (publicEndpoint&&!publicRateAllowed(req,pathname)) return reply(res,429,{error:'请求过于频繁，请稍后再试'},cors);
  if (!allowed(req,publicEndpoint)) return reply(res, 403, {error:publicEndpoint?'网页来源未获允许':'访问密钥或来源无效'},cors);
  if (req.method === 'GET' && pathname === '/api/status') return reply(res, 200, {configured:configured(), connected:false, publicAi, ...aiStatus(),mode:host === '127.0.0.1' ? '本机' : '局域网'});
  if(req.method==='POST'&&pathname==='/api/transcribe'){
    try{return reply(res,200,await transcribe(await input(req,3100000)));}catch(error){return reply(res,400,{error:error.message});}
  }
  if(req.method==='POST'&&pathname==='/api/chat'){
    try{
      const payload=await input(req);let tools=[];
      const adminDeviceChat=pathname==='/api/chat'&&payload.operationMode==='device'&&Boolean(accessKey)&&req.headers['x-safepause-key']===accessKey;
      if((!publicEndpoint||adminDeviceChat)&&payload.operationMode==='device'){
        if(Array.isArray(payload.deviceCapabilities)){
          const requested=new Set(payload.deviceCapabilities.filter(name=>typeof name==='string'));
          if(configured())tools=(await listTools()).filter(tool=>requested.has(tool.name)&&TOOL_POLICY[tool.name]).slice(0,8);
          else tools=[...new Set([...requested].filter(name=>companionTools[name]))].slice(0,4).map(name=>({name,...companionTools[name]}));
        }
        else if(configured()){try{tools=await listTools();}catch{/* 模型可交谈，但不提供不可用的设备工具 */}}
      }
      return reply(res,200,await chat(payload,tools));
    }catch(error){return reply(res,400,{error:error.message});}
  }
  if (req.method === 'GET' && pathname === '/api/tools') {
    try { const tools = configured() ? await listTools() : []; return reply(res, 200, {connected:configured(), tools}); }
    catch (error) { return reply(res, 503, {connected:false,error:error.message}); }
  }
  if (req.method === 'POST' && pathname === '/api/prepare') {
    try {
      const {name,args,purpose} = await input(req);
      if (!TOOL_POLICY[name]) throw new Error('不允许调用该工具');
      if (typeof purpose !== 'string' || purpose.trim().length < 3) throw new Error('请说明本次用途');
      const tool = (await listTools()).find(t => t.name === name);
      if (!tool) throw new Error('当前 MCP 服务没有发现这个工具');
      validateArgs(tool.inputSchema, args);
      const ticket = crypto.randomUUID();
      pending.set(ticket, {name,args,hash:fingerprint(name,args),purpose,expires:Date.now()+60000});
      return reply(res, 200, {ticket,name,args,mode:TOOL_POLICY[name],purpose,expiresIn:60});
    } catch(error) { return reply(res, 400, {error:error.message}); }
  }
  if (req.method === 'POST' && pathname === '/api/execute') {
    try {
      const {ticket,confirmed} = await input(req);
      const item = pending.get(ticket);
      pending.delete(ticket);
      if (!item || Date.now() > item.expires || confirmed !== true) throw new Error('确认已过期或已取消，请重新预览');
      if (fingerprint(item.name,item.args) !== item.hash) throw new Error('待执行内容已变化');
      if (!(await listTools()).some(t=>t.name===item.name)) throw new Error('工具已不可用');
      const result = await callTool(item.name,item.args);
      const reported=result?.structuredContent?.status;
      const status=['Requested','Executed','Failed','Cancelled'].includes(reported)?reported:'Requested';
      return reply(res, 200, {status,name:item.name,mode:TOOL_POLICY[item.name],result:result.structuredContent?.result||result,verified:false});
    } catch(error) { return reply(res, 502, {status:'Failed',error:error.message}); }
  }
  reply(res,404,{error:'接口不存在'});
}

http.createServer(async(req,res)=>{
  let pathname;
  try { pathname = new URL(req.url,'http://localhost').pathname; } catch { return reply(res,400,{error:'请求地址无效'}); }
  if(await handleDeviceBridge(req,res,pathname,accessKey))return;
  if (req.method === 'GET' && pathname === '/healthz') { res.writeHead(200, {'content-type':'text/plain; charset=utf-8','cache-control':'no-store'}); return res.end('ok'); }
  if (pathname.startsWith('/api/')) return handleApi(req,res,pathname);
  const files = {'/':'index.html','/index.html':'index.html','/styles.css':'styles.css','/app.js':'app.js'};
  const file = files[pathname];
  if (!file) return reply(res,404,{error:'页面不存在'});
  try {
    const content = await fs.readFile(path.join(root,file));
    res.writeHead(200, {'content-type':mime[path.extname(file)],'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});
    res.end(content);
  } catch { reply(res,500,{error:'页面读取失败'}); }
}).listen(port,host,()=>console.log(`SafePause http://${host}:${port}`));
