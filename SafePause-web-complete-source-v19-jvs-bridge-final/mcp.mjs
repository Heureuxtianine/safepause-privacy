import crypto from 'node:crypto';

const endpoint = process.env.SAFEPAUSE_MCP_URL || '';
const bearer = process.env.SAFEPAUSE_MCP_TOKEN || '';
let sessionId = '';
let initialized = false;
let requestId = 0;

export const TOOL_POLICY = {
  safepause_device_status: 'read',
  messaging_read_latest_message: 'read', messaging_search_messages: 'read', messaging_get_conversation: 'read',
  dialer_search_call_logs: 'read', dialer_search_contacts: 'read', dialer_get_contact: 'read',
  dialer_list_blocked_numbers: 'read', deskclock_list_alarms: 'read', notes_get_note: 'read', notes_get_todo: 'read',
  messaging_send_message: 'write', dialer_place_call: 'write', dialer_block_number: 'write', dialer_unblock_number: 'write',
  deskclock_create_timer: 'write', deskclock_create_alarm: 'write', notes_create_note: 'write', notes_create_todo: 'write',
  filemanager_create_text_file: 'write'
};

export function configured() { return Boolean(endpoint); }
export function fingerprint(name, args) {
  return crypto.createHash('sha256').update(JSON.stringify([name, args])).digest('hex');
}

function decodeSse(raw) {
  const messages = raw.split(/\r?\n\r?\n/);
  for (const block of messages) {
    const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
    if (!data) continue;
    try { const parsed = JSON.parse(data); if (parsed.result || parsed.error) return parsed; } catch { /* continue */ }
  }
  throw new Error('MCP 服务返回的事件流没有 JSON-RPC 结果');
}

async function post(method, params = {}, notification = false) {
  if (!endpoint) throw new Error('尚未配置 MCP 服务地址');
  const headers = {'content-type':'application/json','accept':'application/json, text/event-stream'};
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  if (sessionId) headers['mcp-session-id'] = sessionId;
  if (initialized) headers['mcp-protocol-version'] = '2025-03-26';
  const body = notification ? {jsonrpc:'2.0', method, params} : {jsonrpc:'2.0', id:++requestId, method, params};
  const response = await fetch(endpoint, {method:'POST', headers, body:JSON.stringify(body), signal:AbortSignal.timeout(50000), redirect:'error'});
  if (!response.ok) throw new Error(`MCP 服务返回 HTTP ${response.status}`);
  sessionId = response.headers.get('mcp-session-id') || sessionId;
  if (notification || response.status === 202) return {};
  const raw = await response.text();
  const parsed = response.headers.get('content-type')?.includes('text/event-stream') ? decodeSse(raw) : JSON.parse(raw);
  if (parsed.error) throw new Error(`MCP 错误 ${parsed.error.code}: ${parsed.error.message}`);
  return parsed.result;
}

async function initialize() {
  if (initialized) return;
  await post('initialize', {protocolVersion:'2025-03-26', capabilities:{}, clientInfo:{name:'SafePause web',version:'0.1.0'}});
  await post('notifications/initialized', {}, true);
  initialized = true;
}

export async function listTools() {
  await initialize();
  const tools = [];
  let cursor;
  do {
    const page = await post('tools/list', cursor ? {cursor} : {});
    tools.push(...(page.tools || []));
    cursor = page.nextCursor;
  } while (cursor);
  return tools.filter(t => TOOL_POLICY[t.name]).map(t => ({name:t.name, description:t.description || '', inputSchema:t.inputSchema || {type:'object',properties:{}}, mode:TOOL_POLICY[t.name]}));
}

export async function callTool(name, args) {
  if (!TOOL_POLICY[name]) throw new Error('该工具不在 SafePause 允许列表');
  const result = await post('tools/call', {name, arguments:args});
  if (result?.isError) throw new Error('设备工具返回失败：' + JSON.stringify(result.content || []).slice(0, 300));
  return result;
}
