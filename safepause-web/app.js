const $ = id => document.getElementById(id);
const state = {input:'sms', risk:null, tools:[], selected:null, ticket:null, revocation:0, timer:null, practice:null, turn:0, lastLine:'', recorder:null, audio:null, audioUrl:null, gateway:'',asr:false,agent:false,providerId:'',provider:'国产 AI',providers:[],proposal:null,busy:false,history:[],voiceAuto:false};
const standalone = window.SAFEPAUSE_STANDALONE === true;
const native = typeof window.SafePauseNative?.request === 'function';
const nativePending = new Map();
let nativeSequence=0;
window.safePauseNativeReply=(id,result)=>{const pending=nativePending.get(id);if(!pending)return;clearTimeout(pending.timeout);nativePending.delete(id);if(result.error)pending.reject(new Error(result.error));else pending.resolve(result);};
let speechRecognition;
let lastAssistantSpeech='您好。先不要转账或发验证码。刚才是收到短信，还是接到电话？';
let recognitionWatchdog;
let speechSequence=0;
const CASES = [
  {id:'01',level:'R3',title:'冒充公安要求转安全账户',text:'【公安机关】你涉嫌洗钱，请今天把存款转到安全账户，不要告诉家人。',note:'冒充权威、转账、保密'},
  {id:'02',level:'R3',title:'新号码冒充子女借钱',text:'妈，我换号码了。现在急需八千元，先转给同事，别打电话。',note:'新号码、转账、阻断核验'},
  {id:'03',level:'R2',title:'医保停用短信',text:'【医保局】医保卡今日停用，请点击链接填写资料及验证码。',note:'链接、凭证、时间压力'},
  {id:'04',level:'R3',title:'假冒客服索取验证码',text:'【客服】航班改签，请马上填写银行卡号和验证码，逾期失效。',note:'冒充客服、凭证索取'},
  {id:'05',level:'R1',title:'积分兑换链接',text:'积分即将清零，点击链接兑换礼品。',note:'营销诱导、链接'},
  {id:'06',level:'R2',title:'中奖先交运费',text:'恭喜中奖，请先支付99元运费再领取。',note:'奖励诱导、提前付款'},
  {id:'07',level:'R0',title:'普通快递取件提醒',text:'您的包裹已到站，请凭取件码到驿站领取。',note:'未见明显高风险指令'},
  {id:'08',level:'R0',title:'社区活动提醒',text:'社区周六上午举办健康讲座，欢迎参加。',note:'未见明显高风险指令'},
  {id:'09',level:'R3',title:'银行风控电话',text:'银行风控中心说账户异常，要求保持通话并把钱转到安全账户。',note:'冒充机构、资金转移、限制挂断'},
  {id:'10',level:'R2',title:'伪造公文截图',text:'截图写着国家机关通知，要求扫描二维码添加办案人员。',note:'权威样式不能证明真实身份'},
  {id:'11',level:'R2',title:'ETC 过期补录',text:'ETC服务中心说24小时内点击陌生链接补录信息，否则不能通行。',note:'时间压力、陌生链接'},
  {id:'12',level:'R3',title:'医院紧急缴费电话',text:'有人自称医院说女儿出事，要求马上给个人账户转账，不许联系家人。',note:'亲属危机、资金要求、隔离'},
  {id:'13',level:'R3',title:'屏幕共享与远程协助',text:'自称客服的人让我下载远程控制软件并共享屏幕，马上操作退款。',note:'设备控制、时间压力'},
  {id:'14',level:'R2',title:'收到 12381 预警',text:'我收到一条自称12381的涉诈预警短信，想知道该怎么处理。',note:'先核验渠道，保留未知项'},
  {id:'15',level:'R2',title:'接到 96110 劝阻电话',text:'刚才有个自称96110的电话提醒我停止转账，我不确定该怎么办。',note:'不凭来电显示直接认定身份'},
  {id:'16',level:'R0',title:'信息不足的陌生来电',text:'刚才有个陌生电话，我没有听清具体内容。',note:'证据不足，继续询问'}
];
const RULES = [
  {label:'要求转账或付款',pattern:/转账|汇款|安全账户|个人账户|付款|支付|缴费|运费|保证金|收款/},
  {label:'索取凭证',pattern:/验证码|银行卡号|支付密码|身份证号|支付码/},
  {label:'远程控制或屏幕共享',pattern:/远程控制|共享屏幕|屏幕共享|无障碍|下载.*软件/},
  {label:'阻断独立核验',pattern:/不要告诉|别告诉|不许联系|别打电话|不要挂断|保持通话|保密/},
  {label:'限时施压',pattern:/马上|立即|今天|今日|24小时|逾期|冻结|停用|急需/},
  {label:'机构或亲属身份声称',pattern:/公安|警察|法院|医保|银行|客服|医院|我是你|女儿|儿子|国家机关|96110|12381/},
  {label:'可疑链接或二维码',pattern:/https?:\/\/|链接|二维码|扫码|t\.cn/},
  {label:'奖励或返利诱导',pattern:/中奖|积分|兑换|奖励|退款|返利/}
];

function toast(message) { const el=$('toast'); el.textContent=message; el.classList.add('show'); clearTimeout(el.timer); el.timer=setTimeout(()=>el.classList.remove('show'),3000); }
function list(el,items) { el.replaceChildren(...(items.length?items:['暂无']).map(text=>{const li=document.createElement('li');li.textContent=text;return li;})); }
function setFlow(step) { ['flowPlanned','flowConfirm','flowExecuted','flowVerified'].forEach((id,index)=>$(id).classList.toggle('active',index<=step)); }
function mask(text) { return String(text).replace(/\b\d{7,}\b/g,v=>`尾号${v.slice(-4)}`).replace(/\b\d{4,6}\b/g,'[数字已遮盖]'); }
function addChat(text,role='assistant',audioUrl=null) {
  const bubble=document.createElement('div');bubble.className=`chat-bubble ${role}`;
  if(text){const p=document.createElement('p');p.textContent=text;bubble.append(p);}
  if(audioUrl){const player=document.createElement('audio');player.controls=true;player.src=audioUrl;bubble.append(player);}
  $('chatMessages').append(bubble);$('chatMessages').scrollTop=$('chatMessages').scrollHeight;
}
function speak(text) {
  lastAssistantSpeech=text;
  if(native){window.SafePauseNative.speak(text);return true;}
  if(!('speechSynthesis' in window)) { $('voiceDiagnostic').textContent='此浏览器没有语音朗读，请查看文字回复。';return false; }
  const sequence=++speechSequence;
  speechSynthesis.cancel(); const utter=new SpeechSynthesisUtterance(text); utter.lang='zh-CN'; utter.rate=.88;
  utter.onstart=()=>{ if(sequence!==speechSequence)return;$('voiceState').textContent='正在用声音回复'; $('assistantAvatar').classList.add('speaking'); };
  utter.onend=()=>{ if(sequence!==speechSequence)return;$('voiceState').textContent='可以点“继续说”开始下一轮';$('voiceStart').textContent='继续说'; $('assistantAvatar').classList.remove('speaking'); };
  utter.onerror=event=>{ if(sequence!==speechSequence||['canceled','interrupted'].includes(event.error))return;$('assistantAvatar').classList.remove('speaking');$('voiceDiagnostic').textContent='语音朗读失败；可以重试或查看文字回复。'; };
  speechSynthesis.speak(utter); return true;
}
function voiceFailure(message) {
  state.voiceAuto=false;$('voiceStart').textContent='开始语音聊天';$('voiceState').textContent=message;$('voiceDiagnostic').textContent=message;
  $('voiceRecordFallback').hidden=false;toast(message);
}
function startVoiceChat() {
  if(state.recorder?.state==='recording'){$('voiceState').textContent=state.voiceAuto?'正在整理本次语音…':'正在结束录音；本次录音只保留在本页';state.recorder.stop();return;}
  const cloudReady=state.agent&&$('cloudConsent').checked;
  if(state.agent&&!$('cloudConsent').checked){$('voiceState').textContent='请先同意本次会话处理文字';$('voiceDiagnostic').textContent='勾选“同意本次会话文字交给国产 AI 处理”后，语音识别文字才能发送给所选模型。';$('cloudConsent').focus();return;}
  if(!state.agent&&$('voiceMode').value==='record'){$('voiceMode').value='browser';$('voiceDiagnostic').textContent='国产 AI 尚未连接，已切换为本机语音对话：语音只在手机或浏览器识别，回复使用 SafePause 本地安全规则。连接豆包或混元后可升级为模型对话。';}
  state.voiceAuto=true;$('voiceStart').textContent='结束并发送';
  if($('voiceMode').value==='record'){
    if(!state.asr){state.voiceAuto=false;$('voiceStart').textContent='开始语音聊天';$('voiceDiagnostic').textContent='服务端尚未配置语音转写。请改选“手机或浏览器语音识别”，或在服务端配置百炼语音识别。';return;}
    if(!$('voiceCloudConsent').checked){state.voiceAuto=false;$('voiceStart').textContent='开始语音聊天';$('voiceDiagnostic').textContent='请另行勾选语音授权，允许本次录音发送至百炼语音识别；不勾选时录音只留在本页。';$('voiceCloudConsent').focus();return;}
    $('audioConsent').checked=true;$('voiceState').textContent='正在听，请说一件想核对的事';$('voiceDiagnostic').textContent='录音结束后自动转写，并交给'+state.provider+'回复；请不要说验证码、密码或银行卡信息。';startRecording();return;
  }
  $('voiceState').textContent=cloudReady?'正在打开语音识别':'正在打开本机语音识别';toggleVoice();
}
function toggleVoice() {
  if(native){$('voiceDiagnostic').textContent='使用系统语音输入；识别后请核对文字再发送。语音处理方式取决于系统组件。';window.SafePauseNative.voice();return;}
  const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!window.isSecureContext)return voiceFailure('当前页面不是安全连接，请使用 HTTPS 网址，或改用文字。');
  if(!Recognition) return voiceFailure('此浏览器不支持实时语音识别。可改用录音或键盘语音输入，再发送文字。');
  if(speechRecognition) { speechRecognition.stop(); return; }
  window.speechSynthesis?.cancel();
  let failed=false,received=false;
  speechRecognition=new Recognition(); speechRecognition.lang='zh-CN'; speechRecognition.interimResults=false; speechRecognition.continuous=false;
  $('voiceState').textContent='正在启动语音，请允许麦克风访问…';
  const recognizer=speechRecognition;
  speechRecognition.onstart=()=>{clearTimeout(recognitionWatchdog);$('voiceStart').textContent='结束语音对话';$('voiceDiagnostic').textContent='浏览器正在识别；音频处理位置由浏览器决定。';$('voiceState').textContent='正在听，请说对方让您做什么';$('assistantAvatar').classList.add('listening');};
  speechRecognition.onerror=event=>{if(event.error==='aborted')return;failed=true;const reasons={'not-allowed':'没有麦克风权限，请在浏览器网站权限中允许麦克风。','service-not-allowed':'浏览器禁止语音服务，请使用文字或键盘语音输入。',network:'浏览器语音服务连接失败；请切换录音输入。','audio-capture':'没有可用麦克风，请检查手机权限。','no-speech':'没有识别到声音，请重试或输入文字。'};voiceFailure(reasons[event.error]||`识别失败：${event.error}。请改用文字或录音。`);};
  speechRecognition.onresult=event=>{received=true;const text=Array.from(event.results).map(result=>result[0].transcript).join('');$('eventText').value=text;const auto=state.voiceAuto;$('voiceDiagnostic').textContent=auto?(state.agent&&$('cloudConsent').checked?'已识别文字，正在交给安心小助手回复。':'已识别文字，正在使用本地安全规则回复。'):'已识别到文字，请先核对，再点击发送。';if(auto)setTimeout(()=>{state.voiceAuto=false;analyze();},180);};
  speechRecognition.onend=()=>{clearTimeout(recognitionWatchdog);speechRecognition=null;if(!failed&&!received){state.voiceAuto=false;$('voiceStart').textContent='开始语音聊天';$('voiceState').textContent='本次未识别到内容，请再试一次';}$('assistantAvatar').classList.remove('listening');};
  try {speechRecognition.start();recognitionWatchdog=setTimeout(()=>{failed=true;voiceFailure('语音启动超时，请检查麦克风权限；也可改用录音或文字。');recognizer.abort();},12000);} catch {speechRecognition=null;voiceFailure('语音对话启动失败，请改用文字或录音。');}
}
function skillWorkflow(text) {
  if(/^(你好|您好|开始|开始对话)[。！!？?]*$/.test(text)){const reply='您好。先不要转账或发验证码。刚才是收到短信，还是接到电话？';addChat(reply);speak(reply);return true;}
  if(/^(我(很|有点)?(害怕|紧张|慌|担心)|怎么办|你能帮我吗)[。！!？?]*$/.test(text)){const reply='我在这里。先停下手里的操作，不要给对方转账或验证码。请告诉我：对方让您做什么？';addChat(reply);speak(reply);return true;}
  if(/^(谢谢|谢谢你|好的|知道了)[。！!]*$/.test(text)){const reply='好的。需要核实短信、电话或联系家人时，继续告诉我。';addChat(reply);speak(reply);return true;}
  if(/^(暂停|暂停五分钟|暂停5分钟|冷静五分钟)[。！!]*$/.test(text)){$('timerBtn').click();const reply=toolOption('deskclock_create_timer')?'请核对并确认五分钟提醒。提醒尚未创建。':'网页已开始五分钟暂停，请保持页面打开。';addChat(reply);speak(reply);return true;}
  if(/^(读取|查看|分析)(手机)?(最新|最近)(一条)?短信[。！!]*$/.test(text)){
    if(redirectTool('messaging_read_latest_message',{},'读取24小时内最新一条短信，遮盖数字后在本机核验')){addChat('请先确认读取最新一条短信，读取完成后核对内容，再发送分析。');}
    else addChat('短信读取权限尚不可用。请在手机端权限页检查，或粘贴您愿意提供的短信内容。');return true;
  }
  const reminder=text.match(/^提醒我(?:在)?(\d{1,2})[:：点时](\d{1,2})?分?(?:\s+|，|,)?(.{0,80})$/);
  if(reminder&&Number(reminder[1])<24&&Number(reminder[2]||0)<60){
    if(toolOption('deskclock_create_alarm')){$('toolSelect').value='deskclock_create_alarm';renderToolFields({hour:Number(reminder[1]),minute:Number(reminder[2]||0),label:reminder[3]||'安心停一下：核实信息'});$('toolPurpose').value='按用户要求创建下一次指定时刻的本机提醒';location.hash='#device';addChat('提醒尚未创建，请核对时间和内容，再预览并确认。');}else addChat('本机提醒能力尚不可用，请在手机端权限页允许通知。');return true;
  }
  if(/^(联系家人|给家人打电话|给家人发短信)[。！!]*$/.test(text)){
    const reply='请先核对家庭共核卡里的原通讯录号码。随后我会展示本次联系的确认卡。';addChat(reply);speak(reply);
    if(trustedNumber())familyAction(text.includes('短信')?'sms':'call');else {location.hash='#check';$('familyPhone').focus();$('familyPhone').scrollIntoView({block:'center'});}return true;
  }
  return false;
}
async function analyze() {
  const text=$('eventText').value.trim(); if (!text) return toast('请先填写这次要核对的内容');
  if(state.busy)return toast('正在处理上一条内容');
  addChat(text,'user');
  const cloudAllowed=state.agent&&$('cloudConsent').checked;
  if(!cloudAllowed&&skillWorkflow(text)){$('eventText').value='';return;}
  const hits=RULES.filter(rule=>rule.pattern.test(text)).map(rule=>rule.label);
  const critical=hits.some(x=>['要求转账或付款','索取凭证','远程控制或屏幕共享'].includes(x));
  const level=critical&&(hits.length>=3||hits.includes('阻断独立核验'))?'R3':critical||hits.length>=3?'R2':hits.length?'R1':'R0';
  state.risk={level,hits,text,source:state.input,at:new Date(),loss:$('lossCheck').checked};
  const labels={R0:'未见明显高风险信号',R1:'需要谨慎核实',R2:'风险信号较多',R3:'高风险，先停止操作'};
  $('riskBadge').className=`badge ${level}`; $('riskBadge').textContent=level+' · '+labels[level];
  $('riskSummary').textContent=level==='R0'?'暂未发现明显高风险指令；来源真实性仍需独立核验。':'已识别需要核实的风险信号。规则提示不能证明对方真实身份，也不能独立认定诈骗。';
  $('urgent').hidden=!state.risk.loss;
  const appearance=state.risk.loss?'loss':level;
  $('riskActionCard').hidden=false;$('riskActionCard').dataset.level=appearance;$('assistantAvatar').dataset.risk=appearance;
  $('riskActionTitle').textContent=state.risk.loss?'已报告损失或信息泄露':labels[level];
  $('riskActionText').textContent=state.risk.loss?'立即停止继续操作，联系银行官方客服；紧急情况拨打 110。':level==='R3'?'先停止操作。不要转账，不要发送验证码，再从原通讯录联系家人。':level==='R2'?'先不付款、不点陌生链接，从可信渠道核实。':level==='R1'?'先不着急操作，确认消息来源。':'暂未发现明显风险指令，仍需核实来源。';
  list($('observedList'),[`来源：${{sms:'用户输入短信',call:'用户描述来电',image:'用户核对截图文字'}[state.input]}`,`内容摘要：${mask(text.slice(0,75))}`]);
  list($('verifiedList'),[]); list($('signalList'),hits);
  list($('unknownList'),['对方真实身份和所在机构','消息或来电是否来自可信渠道','家人或官方渠道的独立答复']);
  setFlow(0); updateFeedback();
  const next=state.risk.loss?'如果已经转账或泄露验证码，请停止继续操作，尽快联系银行官方客服和 110。':level==='R0'?'目前信息不足以判断来源。请从原通讯录或机构官方渠道确认。':'先不要转账、发验证码或点链接。请从原通讯录联系家人，或从官方公开渠道核实。';
  const reply=`${level}：${hits.length?hits.join('、'):'暂未发现明显风险指令'}。${next}`;
  if(!cloudAllowed){addChat(reply);speak(reply);}
  $('eventText').value='';
  if(cloudAllowed){
    state.busy=true;$('analyzeBtn').disabled=true;state.proposal=null;$('agentProposal').hidden=true;
    const generation=state.revocation;
    try{const result=await api('/api/chat',{text,consented:true,history:state.history,provider:state.providerId});if(generation!==state.revocation)return;addChat(result.reply);speak(result.reply);state.history.push({role:'user',content:text.slice(0,600)},{role:'assistant',content:result.reply.slice(0,600)});state.history=state.history.slice(-8);if(result.proposal){state.proposal=result.proposal;$('agentProposalText').textContent='待核对建议：'+result.proposal.name+'。尚未调用设备。';$('agentProposal').hidden=false;}}
    catch(error){addChat('智能体未完成回复：'+error.message+'。'+reply);speak(reply);}
    finally{state.busy=false;$('analyzeBtn').disabled=false;}
  }
}
function updateFeedback() {
  if (!state.risk) return;
  const r=state.risk;
  $('feedbackDraft').value=[`SafePause 本机复盘摘要`,`时间：${r.at.toLocaleDateString('zh-CN')}`,`事件类型：${{sms:'短信',call:'来电',image:'截图'}[r.source]}`,`规则等级：${r.level}（非诈骗认定）`,`涉及风险动作：${r.hits.join('、')||'暂未识别'}`,`已造成损失/泄露：${r.loss?'用户表示是':'用户未勾选'}`,`独立核验：${$('verifiedList').textContent.trim()==='暂无'?'尚未完成':'已有用户记录，请另附来源'}`,`仍未知：对方真实身份、机构真实性`,`说明：本摘要未包含号码、验证码、账户或录音原文。`].join('\n');
  $('feedbackStatus').textContent='本机草稿';
}
function cases() {
  const query=$('caseQuery').value.trim().toLowerCase(), filter=$('caseFilter').value;
  $('caseGrid').replaceChildren(...CASES.filter(c=>(filter==='all'||c.level===filter)&&(`${c.title}${c.text}${c.note}`.toLowerCase().includes(query))).map(c=>{
    const b=document.createElement('button');b.type='button';b.className='case-card';
    const tag=document.createElement('span');tag.className=`badge ${c.level}`;tag.textContent=c.level;
    const title=document.createElement('strong');title.textContent=c.title;
    const note=document.createElement('small');note.textContent=c.note;
    b.append(tag,title,note);b.addEventListener('click',()=>{$('eventText').value=c.text;state.input='sms';updateInputTabs();window.location.hash='#check';toast('已载入演示案例');});return b;
  }));
}
function updateInputTabs() { document.querySelectorAll('[data-input]').forEach(b=>{const on=b.dataset.input===state.input;b.classList.toggle('selected',on);b.setAttribute('aria-selected',String(on));});$('inputLabel').textContent={sms:'可疑消息的内容',call:'刚才来电说了什么',image:'截图中你核对过的文字'}[state.input]; }
function showView() {
  const allowed=['check','device','cases','practice','feedback'];
  const route=location.hash.slice(1);document.body.dataset.view=allowed.includes(route)?route:'check';
  document.querySelectorAll('[data-view]').forEach(link=>link.classList.toggle('current',link.dataset.view===document.body.dataset.view));
  window.scrollTo({top:0,behavior:'instant'});
}

async function api(url,body) {
  if(native)return new Promise((resolve,reject)=>{const id='native_'+(++nativeSequence);const timeout=setTimeout(()=>{nativePending.delete(id);window.SafePauseNative.revoke();reject(new Error('手机确认或系统操作超时，请核对实际状态后重试'));},52000);nativePending.set(id,{resolve,reject,timeout});try{window.SafePauseNative.request(url,body?JSON.stringify(body):'',id);}catch(error){clearTimeout(timeout);nativePending.delete(id);reject(error);}});
  if (standalone && !state.gateway) throw new Error('请先填写受控设备网关地址；本地 HTML 不自带 MCP 服务');
  const headers={'x-safepause-key':$('accessKey').value};
  if (body) headers['content-type']='application/json';
  const response=await fetch((standalone?state.gateway:'')+url,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(55000)});
  let data;try{data=await response.json();}catch{throw new Error('地址未返回设备网关接口；请勿填写静态网页网址');}if (!response.ok) throw new Error(data.error||`请求失败 ${response.status}`); return data;
}
function toolOption(name) { return state.tools.find(tool=>tool.name===name); }
function capability(label,names) {const available=names.some(toolOption);const div=document.createElement('div');div.className='capability'+(available?' available':'');const b=document.createElement('b');b.textContent=label;const s=document.createElement('span');s.textContent=available?'发现设备工具':'需手动操作';div.append(b,s);return div;}
function applyProvider(id) {
  const provider=state.providers.find(item=>item.id===id);if(!provider)return;
  state.providerId=provider.id;state.provider=provider.label;
  $('cloudConsentText').textContent=`我同意本次会话中主动发送的文字经受控服务交给${state.provider}处理；不要输入验证码、密码。取消勾选会清除此页暂存的对话上下文。`;
  $('voiceCloudConsentText').textContent=`如果选择“受控语音转写”，我同意本次会话录音发送至阿里云百炼语音识别，再把识别文字发送给${state.provider}。可随时取消。`;
  $('providerNote').textContent=`本次对话将使用${state.provider}。模型密钥只保存在受控服务端；录音转写使用百炼语音识别，需另行授权。`;
  if(state.agent)$('voiceState').textContent=`已连接${state.provider}，可开始语音聊天`;
}
function populateProviders(status) {
  const providers=Array.isArray(status.providers)?status.providers.filter(item=>item&&['qwen','doubao','hunyuan'].includes(item.id)&&typeof item.label==='string'):[];
  if(!providers.length&&status.agent&&status.provider&&status.providerLabel)providers.push({id:status.provider,label:status.providerLabel});
  state.providers=providers;
  const preferred=providers.some(item=>item.id===state.providerId)?state.providerId:(providers.some(item=>item.id===status.provider)?status.provider:(providers[0]?.id||''));
  $('aiProviderSelect').replaceChildren(...(providers.length?providers.map(item=>new Option(item.label,item.id)): [new Option('尚未连接 AI 服务','')]));
  $('aiProviderSelect').disabled=providers.length<2;
  if(preferred){$('aiProviderSelect').value=preferred;applyProvider(preferred);}else{state.providerId='';$('providerNote').textContent='尚无可选模型。请在受控服务端配置至少一个国产模型 API Key。';}
}
async function refreshTools() {
  state.asr=false;state.agent=false;state.proposal=null;$('agentProposal').hidden=true;
  $('serviceStatus').textContent='ⓘ 语音转写和智能体服务未连接。';
  if (standalone && !native) {
    $('gatewayWrap').hidden=false;$('keyWrap').hidden=false;
    state.revocation++;state.ticket=null;state.tools=[];$('confirmDialog').close();
    $('toolFields').replaceChildren();$('toolSelect').replaceChildren(new Option('请探测设备',''));$('prepareBtn').disabled=true;
    $('connection').classList.remove('on');
    const entered=$('gatewayUrl').value.trim().replace(/\/$/,'');
    if (entered) {
      try {const parsed=new URL(entered);if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.search||parsed.hash)throw new Error();state.gateway=parsed.href.replace(/\/$/,'');}
      catch {state.gateway='';$('deviceInfo').textContent='网关地址无效，请填写 http:// 或 https:// 开头的服务地址。';return;}
    } else state.gateway='';
    if (!state.gateway) {
      state.tools=[];$('deviceBadge').textContent='网关未配置';$('connection').textContent='设备未连接';
      $('deviceInfo').textContent='尚未配置目标设备网关。此按钮只检查网关，不会自动配对手机。不同设备可连接各自的网关；实际系统权限与工具以探测为准。静态网页本身未运行手机智能体。';
      $('capabilityGrid').replaceChildren(capability('短信读取',[]),capability('短信发送',[]),capability('来电与联系人',[]),capability('拨号与拉黑',[]),capability('计时与提醒',[]),capability('脱敏留存',[]));
      return;
    }
    if(location.protocol==='https:'&&new URL(state.gateway).protocol!=='https:'){$('deviceInfo').textContent='当前网页是 HTTPS，请使用受控 HTTPS 网关。不能用普通 HTTP 局域网地址完成此公网连接。';return;}
  }
  $('deviceInfo').textContent='正在向 MCP 服务探测工具…';
  try{const status=await api('/api/status');state.asr=status.asr===true;state.agent=status.agent===true;populateProviders(status);state.provider=state.provider||status.providerLabel||'国产 AI';
    const provider=state.provider;
    const audioText=$('audioConsentText');if(audioText)audioText.textContent=`我同意仅本次所选录音经受控语音服务转写；先试听，避免包含敏感信息。`;
    $('serviceStatus').textContent=`${state.agent?`✓ ${provider}模型已连接`:'⚠ 国产 AI 模型未连接'} · ${state.asr?'✓ 录音转写已连接':'⚠ 录音转写未连接'}。语音识别和模型对话是两项服务；设备能力另行探测。`;
    if(state.agent){$('voiceState').textContent=`已连接${provider}，可开始语音聊天`;if(state.asr)$('voiceDiagnostic').textContent='勾选模型文字授权和语音授权后，点“开始语音聊天”即可自动转写、回复并朗读。';}
  }catch(error){$('serviceStatus').textContent='⚠ 服务连接未完成：'+error.message;}
  try {
    const data=await api('/api/tools');state.tools=data.tools;
    const connectedLabel=native?'本机接口已连接':'MCP 已连接';
    $('deviceBadge').textContent=data.connected?connectedLabel:'操作未启用';$('deviceBadge').className='badge '+(data.connected?'R0':'neutral');
    $('connection').textContent=data.connected?connectedLabel:'设备未连接';$('connection').classList.toggle('on',data.connected);
    $('deviceInfo').textContent=data.connected?(native?`当前手机：${data.device}。已发现 ${state.tools.length} 项实际获准能力。请在上方“权限”逐项授权，每次私人读取或执行另需手机确认。`:`已发现 ${state.tools.length} 项可用的白名单工具。调用目标是网关连接的设备，不一定是当前浏览手机。请核对目标设备、权限和本次授权。`):'未启用设备服务。仍可使用手动输入、案例、练习和系统短信/拨号界面。';
    const titles={safepause_device_status:'查看本机型号和权限',messaging_send_message:'直接发送短信',messaging_read_latest_message:'读取最新一条短信',dialer_place_call:'直接打电话',deskclock_create_timer:'创建倒计时提醒',deskclock_create_alarm:'创建指定时间提醒'};
    $('toolSelect').replaceChildren(new Option(state.tools.length?'请选择一项设备功能':'当前无设备工具',''),...state.tools.map(t=>new Option((titles[t.name]||t.name)+(t.mode==='write'?' · 需确认':' · 读取'),t.name)));
    $('capabilityGrid').replaceChildren(capability('短信读取',['messaging_read_latest_message','messaging_search_messages','messaging_get_conversation']),capability('短信发送',['messaging_send_message']),capability('来电与联系人',['dialer_search_call_logs','dialer_search_contacts']),capability('拨号与拉黑',['dialer_place_call','dialer_block_number']),capability('计时与提醒',['deskclock_create_timer','deskclock_create_alarm']),capability('脱敏留存',['notes_create_note','filemanager_create_text_file']));
    $('prepareBtn').disabled=true;
  } catch(error) {
    state.tools=[];$('prepareBtn').disabled=true;$('connection').textContent='设备未连接';$('connection').classList.remove('on');$('deviceBadge').textContent='连接失败';$('deviceBadge').className='badge R2';$('deviceInfo').textContent=error.message;
    if (error.message.includes('密钥')) $('keyWrap').hidden=false;
    if (standalone && error instanceof TypeError) $('deviceInfo').textContent='无法连接设备网关。请检查 HTTPS、服务是否运行、访问密钥及网关允许的网页来源。此错误不代表手机已经配对。';
  }
}
function renderToolFields(prefill={}) {
  const tool=toolOption($('toolSelect').value);$('toolFields').replaceChildren();$('prepareBtn').disabled=!tool;
  if (!tool) return;
  const schema=tool.inputSchema;const props=schema.properties||{};
  if (!Object.keys(props).length) {const p=document.createElement('p');p.className='tiny';p.textContent='该工具没有公开参数。';$('toolFields').append(p);}
  for (const [key,def] of Object.entries(props)) {
    const label=document.createElement('label');label.textContent=key+(schema.required?.includes(key)?' *':'');
    const hint=document.createElement('small');hint.textContent=def.description||'';label.append(hint);
    let field;
    if (def.enum) {field=document.createElement('select');field.append(new Option('请选择',''),...def.enum.map(v=>new Option(String(v),String(v))));}
    else if (def.type==='boolean') {field=document.createElement('select');field.append(new Option('请选择',''),new Option('是','true'),new Option('否','false'));}
    else if (def.type==='object'||def.type==='array') {field=document.createElement('textarea');field.rows=3;field.placeholder='JSON 格式';}
    else {field=document.createElement('input');field.type=def.type==='integer'||def.type==='number'?'number':'text';field.placeholder=def.description||key;}
    field.dataset.arg=key;field.dataset.type=def.type||'string';
    if (prefill[key]!==undefined) field.value=typeof prefill[key]==='object'?JSON.stringify(prefill[key]):String(prefill[key]);label.append(field);$('toolFields').append(label);
  }
}
function toolArgs() {
  const args={};for (const field of $('toolFields').querySelectorAll('[data-arg]')) {
    if (field.value==='') continue;
    const type=field.dataset.type;
    args[field.dataset.arg]=type==='integer'||type==='number'?Number(field.value):type==='boolean'?field.value==='true':type==='object'||type==='array'?JSON.parse(field.value):field.value;
  }return args;
}
function addDetail(key,value) {const div=document.createElement('div');div.className='confirm-row';const b=document.createElement('b');b.textContent=key;const span=document.createElement('span');span.textContent=typeof value==='string'?value:JSON.stringify(value);div.append(b,span);$('confirmDetails').append(div);}
async function prepareCall() {
  const tool=toolOption($('toolSelect').value);if (!tool) return toast('请先选择可用工具');
  const purpose=$('toolPurpose').value.trim();let args;try{args=toolArgs();}catch{return toast('参数中的 JSON 格式有误');}
  try {
    const prepared=await api('/api/prepare',{name:tool.name,args,purpose});state.ticket=prepared.ticket;state.revocationAtPrepare=state.revocation;
    $('confirmDetails').replaceChildren();addDetail('本次用途',purpose);addDetail('设备工具',tool.name);addDetail('操作类型',tool.mode==='write'?'修改设备状态 / 对外联系':'读取设备信息');for(const [key,value] of Object.entries(args))addDetail(key,value);
    setFlow(1);$('confirmDialog').showModal();
  } catch(error) { $('toolResult').textContent='未调用：'+error.message;toast(error.message); }
}
async function executeCall() {
  const ticket=state.ticket;state.ticket=null;
  if (!ticket||state.revocationAtPrepare!==state.revocation) return toast('本次授权已撤销');
  $('toolResult').textContent='正在等待设备真实返回…';
  try {
    const result=await api('/api/execute',{ticket,confirmed:true});
    $('toolResult').textContent=`${result.status} · ${result.name}\n设备返回：${JSON.stringify(result.result,null,2)}\n未独立验证：请根据真实回读或家人答复另行核实。`;
    setFlow(result.status==='Executed'?2:1);$('familyStatus').textContent=result.status==='Requested'?'请求已提交系统，发送或接通仍待核对。':`设备报告 ${result.status}，还需核对实际状态。`;
    state.smsOperation=result.name==='messaging_send_message'?result.result?.data?.operation:null;
    const detail=result.result?.data;
    if(result.name==='messaging_read_latest_message'&&detail?.body){$('eventText').value=detail.body;state.input='sms';updateInputTabs();addChat('已读取获准的最新一条短信并遮盖数字。请核对输入内容，再点击发送分析。');location.hash='#check';}
  } catch(error) { $('toolResult').textContent='Failed · '+error.message;toast('设备调用未完成'); }
}
function redirectTool(name,hints,purpose) {
  const tool=toolOption(name);if(!tool)return false;
  $('toolSelect').value=name;const props=tool.inputSchema.properties||{};const prefill={};
  for(const key of Object.keys(props)) {
    const lower=key.toLowerCase();
    if(/phone|number|recipient|to$|contact/.test(lower)&&hints.phone)prefill[key]=hints.phone;
    if(/message|body|content|text/.test(lower)&&hints.message)prefill[key]=hints.message;
    if(/duration|minute|seconds/.test(lower)&&hints.duration)prefill[key]=hints.duration;
  }
  renderToolFields(prefill);$('toolPurpose').value=purpose;window.location.hash='#device';$('toolSelect').focus();toast('已填入设备工具，请核对参数并预览调用');return true;
}
function trustedNumber() {const phone=$('familyPhone').value.trim();if(!/^\+?[0-9\s-]{6,20}$/.test(phone)){toast('请先填写并核对原通讯录号码');return null;}return phone.replace(/[\s-]/g,'');}
function manualExternal(kind,phone,message) {
  $('confirmDetails').replaceChildren();addDetail('对象',$('familyName').value.trim()||'可信家人');addDetail('号码',phone);if(message)addDetail('内容',message);addDetail('结果边界',kind==='sms'?'只打开系统短信编辑器，不代表已发送':'只打开系统拨号盘，不代表已拨通');
  $('confirmDialog').dataset.manual=kind;$('confirmDialog').dataset.phone=phone;$('confirmDialog').dataset.message=message||'';$('confirmDialog').showModal();setFlow(1);
}
function manualOpen() {
  const dialog=$('confirmDialog'),kind=dialog.dataset.manual,phone=dialog.dataset.phone,message=dialog.dataset.message;
  if (!kind)return;
  delete dialog.dataset.manual;
  const link=document.createElement('a');link.href=kind==='sms'?`sms:${phone}?body=${encodeURIComponent(message)}`:`tel:${phone}`;
  link.click();$('familyStatus').textContent=kind==='sms'?'EditorOpened：已请求打开短信编辑器；是否发送需你在系统界面确认。':'EditorOpened：已请求打开拨号盘；是否拨通需你在系统界面确认。';
}
function familyAction(kind) {
  const phone=trustedNumber();if(!phone)return;const message=$('familyMessage').value.trim();if(kind==='sms'&&!message)return toast('请先填写发送内容');
  const toolName=kind==='sms'?'messaging_send_message':'dialer_place_call';
  if(!redirectTool(toolName,{phone,message},kind==='sms'?'给原通讯录中的一位可信家人发送核验短信':'拨打原通讯录中可信家人的电话进行核验')) manualExternal(kind,phone,message);
}
function recordReply() {
  const text=$('familyReply').value.trim();if(!text)return toast('请先填写实际收到的回复');
  if(!state.risk)return toast('请先分析这次事件');
  list($('observedList'),[`来源：${{sms:'用户输入短信',call:'用户描述来电',image:'用户核对截图文字'}[state.input]}`,`内容摘要：${mask(state.risk.text.slice(0,75))}`,`用户记录的回复（来源未验证）：${mask(text.slice(0,90))}`]);
  $('familyStatus').textContent='已记录家人回复；回复来源仍需从原通讯录独立核验。';setFlow(0);updateFeedback();
}
const ROUTES={
  android:'可主动粘贴文字或选择截图；联系家人时打开系统短信编辑器或拨号盘。只有安装并授权了实际设备服务，才能探测 MCP 工具。',
  harmony:'可主动粘贴文字或选择截图；系统分享与短信/拨号界面是否可打开，以当前浏览器和系统实际结果为准。',
  ios:'可主动粘贴文字或选择截图；短信和电话仅尝试打开系统界面，由本人决定是否发送或拨号。',
  other:'使用手动输入或截图预览。若系统不支持短信或拨号链接，请自行打开原通讯录及系统应用完成核验。',
  feature:'可让可信家人在自己的设备打开本页，长辈口述关键句。由长辈从原通讯录或纸质电话簿自行核对号码并拨打。'
};
function routeAdvice(){
  let route=$('deviceRoute').value;
  if(route==='auto')route=/iPhone|iPad|iPod/i.test(navigator.userAgent)?'ios':/Android/i.test(navigator.userAgent)?'android':'other';
  $('routeAdvice').textContent=ROUTES[route];
}
let previewUrl;
function showEvidence(){
  if(previewUrl)URL.revokeObjectURL(previewUrl);
  const image=$('evidenceImage').files[0],preview=$('evidencePreview');
  preview.hidden=true;preview.removeAttribute('src');
  if(!image){$('imageStatus').textContent='图片只在本页预览，不上传或自动识别。';return;}
  if(!image.type.startsWith('image/')||image.size>10*1024*1024){$('evidenceImage').value='';$('imageStatus').textContent='请选择小于 10 MB 的图片。';return;}
  previewUrl=URL.createObjectURL(image);preview.src=previewUrl;preview.hidden=false;
  $('imageStatus').textContent='已在本页打开截图。请核对文字后手动输入；页面不会上传或自动识别图片。';
  state.input='image';updateInputTabs();
}
function clearAudio() {
  if(state.recorder?.state==='recording'){state.recorder.onstop=null;state.recorder.stop();state.recorder.stream.getTracks().forEach(track=>track.stop());$('recordStart').disabled=false;$('recordStop').disabled=true;$('voiceStart').textContent='开始语音对话';$('assistantAvatar').classList.remove('listening');$('voiceState').textContent='录音已删除';}
  if(state.audioUrl)URL.revokeObjectURL(state.audioUrl);
  state.audio=null;state.audioUrl=null;$('audioFile').value='';$('audioPreview').removeAttribute('src');$('audioTray').hidden=true;
  $('audioStatus').textContent='录音已从本页移除。';
}
function setAudio(file) {
  if(!file||!file.type.startsWith('audio/')||file.size>10*1024*1024){$('audioStatus').textContent='请选择小于 10 MB 的音频文件。';return;}
  if(state.audioUrl)URL.revokeObjectURL(state.audioUrl);
  state.audio=file;state.audioUrl=URL.createObjectURL(file);$('audioPreview').src=state.audioUrl;$('audioTray').hidden=false;
  $('audioStatus').textContent='录音可试听。加入对话只保存于当前页面；分享前请核对内容及接收人。';
}
async function startRecording() {
  if(state.recorder?.state==='recording')return;
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)return toast('此浏览器不支持录音，或页面没有 HTTPS 安全连接');
  speechSequence++;window.speechSynthesis?.cancel();$('assistantAvatar').classList.remove('speaking');
  let stream;
  try {stream=await navigator.mediaDevices.getUserMedia({audio:true});}
  catch {return toast('未获得麦克风授权；可以改用已有录音文件');}
  const chunks=[];let recorder;
  try{recorder=new MediaRecorder(stream);}catch{stream.getTracks().forEach(track=>track.stop());return voiceFailure('录音格式不受支持，请选择已有录音或输入文字。');}state.recorder=recorder;
  recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  recorder.onstop=()=>{stream.getTracks().forEach(track=>track.stop());state.recorder=null;$('recordStart').disabled=false;$('recordStop').disabled=true;$('voiceStart').textContent='开始语音对话';$('assistantAvatar').classList.remove('listening');$('voiceState').textContent='录音结束，请试听；已连接语音服务时可转成文字';
    const blob=new Blob(chunks,{type:recorder.mimeType||'audio/webm'});
    if(blob.size){setAudio(new File([blob],`SafePause-录音-${Date.now()}.${blob.type.includes('mp4')?'m4a':'webm'}`,{type:blob.type}));if(state.voiceAuto&&state.asr&&$('voiceCloudConsent').checked){$('audioConsent').checked=true;setTimeout(()=>transcribeAudio(),0);}}
  };
  try{recorder.start();}catch{stream.getTracks().forEach(track=>track.stop());return voiceFailure('录音无法启动，请选择已有录音或输入文字。');}
  $('recordStart').disabled=true;$('recordStop').disabled=false;$('voiceStart').textContent=state.voiceAuto?'结束并发送':'结束录音';$('assistantAvatar').classList.add('listening');$('voiceState').textContent='正在录音，结束后可试听和转写';$('audioStatus').textContent='正在录音。请只录您愿意提供的内容，不要录制他人通话。';
  setTimeout(()=>{if(recorder.state==='recording')recorder.stop();},60000);
}
async function audioToWav(file) {
  const Context=window.AudioContext||window.webkitAudioContext;
  if(!Context)throw new Error('浏览器不能转换录音格式，请选择 WAV 文件');
  const context=new Context();
  try{
    const decoded=await context.decodeAudioData(await file.arrayBuffer());
    if(decoded.duration>60)throw new Error('请选择不超过一分钟的录音');
    const rate=16000,count=Math.ceil(decoded.duration*rate);const buffer=new ArrayBuffer(44+count*2),view=new DataView(buffer);
    const put=(at,text)=>{for(let i=0;i<text.length;i++)view.setUint8(at+i,text.charCodeAt(i));};
    put(0,'RIFF');view.setUint32(4,36+count*2,true);put(8,'WAVE');put(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);put(36,'data');view.setUint32(40,count*2,true);
    const channels=Array.from({length:decoded.numberOfChannels},(_,i)=>decoded.getChannelData(i));
    for(let i=0;i<count;i++){const offset=Math.min(decoded.length-1,i*decoded.sampleRate/rate),a=Math.floor(offset),b=Math.min(decoded.length-1,a+1),fraction=offset-a;let sample=0;for(const channel of channels)sample+=channel[a]*(1-fraction)+channel[b]*fraction;sample=Math.max(-1,Math.min(1,sample/channels.length));view.setInt16(44+i*2,sample*(sample<0?32768:32767),true);}
    return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('音频读取失败'));reader.readAsDataURL(new Blob([buffer],{type:'audio/wav'}));});
  }finally{await context.close();}
}
async function transcribeAudio() {
  if(!state.audio)return toast('请先录制或选择录音');
  if(!state.asr){$('audioStatus').textContent='⚠ 语音服务尚未连接。请在设备与服务页配置已运行的网关；上传静态网页不能启用转写。';return;}
  if(!$('audioConsent').checked)return toast('请试听后同意本次音频上传');
  $('audioTranscribe').disabled=true;const generation=state.revocation;
    try{const audio=await audioToWav(state.audio);if(state.voiceAuto&&(!$('voiceCloudConsent').checked||!$('cloudConsent').checked))throw new Error('语音或模型授权已取消，录音未上传');$('audioStatus').textContent='正在上传本次录音并转写…';const result=await api('/api/transcribe',{audio,consented:true});if(generation!==state.revocation)return;$('eventText').value=result.text;$('audioStatus').textContent=state.voiceAuto?'✓ 已转写，安心小助手正在回复。':'✓ 已转写，请核对文字再发送。识别结果不证明内容真实。';$('eventText').focus();if(state.voiceAuto){state.voiceAuto=false;$('voiceStart').textContent='开始语音聊天';setTimeout(()=>analyze(),180);}}
  catch(error){state.voiceAuto=false;$('voiceStart').textContent='开始语音聊天';$('audioStatus').textContent='⚠ 转写未完成：'+error.message;}
  finally{$('audioTranscribe').disabled=false;$('audioConsent').checked=false;}
}
async function shareAudio() {
  if(!state.audio)return toast('请先录制或选择音频');
  if(!navigator.share||!navigator.canShare?.({files:[state.audio]}))return toast('此设备不支持音频系统分享；可先下载后自行发送');
  try {await navigator.share({files:[state.audio],title:'SafePause 录音'});$('audioStatus').textContent='已打开系统分享；请在目标应用核对接收人和发送状态。';}
  catch(error){if(error.name!=='AbortError')toast('系统分享未完成');}
}
const SCENARIOS={
  family:{caller:'陌生号码',lines:['妈，我换号了。现在出事了，快转八千元给我同事。','我现在不能接电话，你别跟别人说。']},
  bank:{caller:'自称银行风控',lines:['你的账户有风险，马上把存款转到安全账户。','不要挂电话，否则账户会被冻结。']},
  medical:{caller:'自称医院人员',lines:['你家人正在急救，请立刻给这个个人账户转账。','不要先联系家人，时间来不及了。']}
};
function practiceLine(text,mine=false){const p=document.createElement('p');p.textContent=text;if(mine)p.className='mine';$('practiceLines').append(p);$('practiceLines').scrollTop=$('practiceLines').scrollHeight;}
function practiceChoices() {
  $('practiceChoices').replaceChildren();
  for(const [label,good] of [['先挂断，再用原通讯录联系家人',true],['按对方给的号码回拨',false],['继续听并准备转账',false]]){
    const b=document.createElement('button');b.textContent=label;b.addEventListener('click',()=>{b.classList.add(good?'good':'bad');practiceLine(label,true);$('practicePrompt').textContent=good?'这一步安全：你独立选择核验渠道，没有按陌生人的指令转账。':'这一步有风险。停止当前通话，改用原通讯录或官方公开电话核实。';$('practiceChoices').replaceChildren();if(state.turn===0){state.turn=1;setTimeout(()=>{state.lastLine=state.practice.lines[1];practiceLine(state.lastLine);practiceChoices();},500);}else{$('endPractice').textContent='结束练习';}});$('practiceChoices').append(b);
  }
}
function startPractice() {state.practice=SCENARIOS[$('practiceScenario').value];state.turn=0;state.lastLine=state.practice.lines[0];$('practiceCaller').textContent=state.practice.caller;$('practiceTime').textContent='模拟';$('practiceLines').replaceChildren();practiceLine(state.lastLine);$('practicePrompt').textContent='你现在会怎么回应？';practiceChoices();$('speakBtn').disabled=false;$('endPractice').disabled=false;}
function endPractice() {if('speechSynthesis' in window)window.speechSynthesis.cancel();state.practice=null;$('practiceChoices').replaceChildren();practiceLine('练习已结束。遇到真实来电请先停下，再用独立渠道核实。');$('speakBtn').disabled=true;$('endPractice').disabled=true;}

document.querySelectorAll('[data-input]').forEach(b=>b.addEventListener('click',()=>{state.input=b.dataset.input;updateInputTabs();}));
window.addEventListener('hashchange',showView);
$('deviceRoute').addEventListener('change',routeAdvice);
$('evidenceImage').addEventListener('change',showEvidence);
$('audioFile').addEventListener('change',()=>setAudio($('audioFile').files[0]));
$('recordStart').addEventListener('click',startRecording);
$('recordStop').addEventListener('click',()=>{if(state.recorder?.state==='recording')state.recorder.stop();});
  $('audioToChat').addEventListener('click',()=>{if(!state.audio)return;addChat('已加入录音附件（本页保存，未自动识别或上传）。','user',state.audioUrl);addChat(state.asr?'您可试听并同意本次上传，点击“转成文字”后核对内容再发送。':'语音转写服务未连接。请补充对方要求您做什么，我会继续核对。');});
$('audioShare').addEventListener('click',shareAudio);
$('audioDownload').addEventListener('click',()=>{if(!state.audio)return;const link=document.createElement('a');link.href=state.audioUrl;link.download=state.audio.name;link.click();});
$('audioClear').addEventListener('click',clearAudio);
$('voiceStart').addEventListener('click',startVoiceChat);
$('aiProviderSelect').addEventListener('change',()=>{applyProvider($('aiProviderSelect').value);});
$('voiceReplay').addEventListener('click',()=>speak(lastAssistantSpeech));
$('voiceRecordFallback').addEventListener('click',startRecording);
$('audioTranscribe').addEventListener('click',transcribeAudio);
$('reviewProposal').addEventListener('click',()=>{const proposal=state.proposal;if(!proposal||!toolOption(proposal.name))return toast('建议已失效或设备工具未发现');$('toolSelect').value=proposal.name;renderToolFields(proposal.args);$('toolPurpose').value='核对智能体针对本次可疑信息提出的设备操作';location.hash='#device';});
$('connection').setAttribute('role','button');$('connection').tabIndex=0;
$('connection').addEventListener('click',()=>{location.hash='#device';});
$('connection').addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();location.hash='#device';}});
$('largeToggle').addEventListener('click',()=>{const large=document.body.classList.toggle('large');$('largeToggle').setAttribute('aria-pressed',String(large));$('largeToggle').textContent=large?'退出大字模式':'大字模式';try{localStorage.setItem('safepause-large',large?'1':'0');}catch{}});
  $('cloudConsent').addEventListener('change',()=>{if(!$('cloudConsent').checked){state.revocation++;state.history=[];state.voiceAuto=false;if(speechRecognition)speechRecognition.abort();if(state.recorder?.state==='recording')state.recorder.stop();$('voiceStart').textContent='开始语音聊天';$('voiceState').textContent='本次 AI 会话授权已取消';$('voiceDiagnostic').textContent='已清除此页暂存的对话上下文；未完成录音会留在本页，不再上传。';}});
  $('voiceCloudConsent').addEventListener('change',()=>{if(!$('voiceCloudConsent').checked){state.revocation++;state.voiceAuto=false;if(state.recorder?.state==='recording'){state.recorder.stop();$('voiceStart').textContent='开始语音聊天';$('voiceState').textContent='语音上传授权已取消';$('voiceDiagnostic').textContent='本次录音将在本页结束并保留，不会发送到语音识别服务。';}}});
try{const saved=localStorage.getItem('safepause-large');if(saved==='1'||(native&&saved===null))$('largeToggle').click();}catch{if(native)$('largeToggle').click();}
$('analyzeBtn').addEventListener('click',analyze);
$('timerBtn').addEventListener('click',()=>{if(redirectTool('deskclock_create_timer',{duration:300},'创建五分钟暂停提醒，稍后通过可信渠道核实')){$('timerStatus').textContent='设备提醒尚未创建，请在设备调用中预览并确认。';return;}if(state.timer)clearTimeout(state.timer);$('timerStatus').textContent='5 分钟暂停已开始。计时仅在本网页保持打开时有效。';state.timer=setTimeout(()=>{$('timerStatus').textContent='5 分钟已到。继续从可信渠道核实。';toast('暂停计时结束');},300000);});
$('summaryBtn').addEventListener('click',()=>{if(!state.risk)return toast('请先分析一条信息');updateFeedback();window.location.hash='#feedback';});
$('familySms').addEventListener('click',()=>familyAction('sms'));
$('familyCall').addEventListener('click',()=>familyAction('call'));
$('recordReply').addEventListener('click',recordReply);
$('caseQuery').addEventListener('input',cases);$('caseFilter').addEventListener('change',cases);
$('refreshTools').addEventListener('click',refreshTools);$('accessKey').addEventListener('change',refreshTools);
if (standalone) $('gatewayUrl').addEventListener('change',refreshTools);
$('revokeBtn').addEventListener('click',()=>{state.revocation++;state.ticket=null;if(native)window.SafePauseNative.revoke();$('confirmDialog').close();$('toolResult').textContent='本页待确认的调用已撤销。已执行的设备动作不能由此撤回。';toast('已撤销本页待确认授权');});
$('toolSelect').addEventListener('change',()=>renderToolFields());$('prepareBtn').addEventListener('click',prepareCall);
$('confirmDialog').addEventListener('close',()=>{if($('confirmDialog').returnValue==='confirm'){if($('confirmDialog').dataset.manual)manualOpen();else executeCall();}else{state.ticket=null;delete $('confirmDialog').dataset.manual;}});
$('startPractice').addEventListener('click',startPractice);$('endPractice').addEventListener('click',endPractice);
$('speakBtn').addEventListener('click',()=>{if(state.lastLine)speak(state.lastLine);});
$('copySummary').addEventListener('click',async()=>{if(!$('feedbackDraft').value)return toast('请先生成摘要');try{await navigator.clipboard.writeText($('feedbackDraft').value);toast('已复制脱敏摘要');}catch{toast('复制失败，请手动选择文本');}});
$('reportCall').addEventListener('click',()=>{const link=document.createElement('a');link.href='tel:96110';link.click();$('feedbackStatus').textContent='拨号界面已打开';});
window.addEventListener('safepause-native-refresh',()=>{state.ticket=null;state.revocation++;if($('confirmDialog').open)$('confirmDialog').close();refreshTools();});
window.addEventListener('safepause-native-speech',event=>{$('assistantAvatar').classList.toggle('speaking',event.detail==='speaking');if(event.detail==='speaking')$('voiceState').textContent='安心小助手正在用声音回复';else if(event.detail==='done'){$('voiceState').textContent='可以点“继续说”开始下一轮';$('voiceStart').textContent='继续说';}else if(event.detail==='error')$('voiceState').textContent='系统中文朗读不可用，请查看文字或检查系统设置';});
window.addEventListener('safepause-speech-unavailable',()=>{if(state.asr&&navigator.mediaDevices?.getUserMedia&&window.MediaRecorder){$('voiceMode').value='record';$('voiceDiagnostic').textContent='系统语音识别不可用。请点“开始语音聊天”，录音经单独授权后可转写并自动回复。';state.voiceAuto=false;$('eventText').focus();return;}$('voiceState').textContent='请点键盘上的话筒说话，或直接打字';$('voiceDiagnostic').textContent='这台手机没有可供本应用调用的系统语音识别组件。可用键盘语音输入；核对文字后再发送。';state.voiceAuto=false;$('eventText').focus();});
window.addEventListener('safepause-speech-result',()=>{if(state.voiceAuto){$('voiceState').textContent=state.agent&&$('cloudConsent').checked?'识别完成，安心小助手正在回复':'识别完成，正在使用本地安全规则回复';$('voiceDiagnostic').textContent='识别文字只代表输入结果，不证明消息内容真实。';setTimeout(()=>{state.voiceAuto=false;analyze();},180);}else{$('voiceState').textContent='语音已转成文字，请核对后发送';$('voiceDiagnostic').textContent='识别内容尚未发送。核对输入框文字后，点“发送”继续。';$('eventText').focus();}});
window.addEventListener('safepause-sms-result',event=>{if(event.detail.operation!==state.smsOperation)return;$('toolResult').textContent=event.detail.status+' · '+event.detail.message;$('familyStatus').textContent=event.detail.message;setFlow(event.detail.status==='Executed'?2:1);});
if(native){$('gatewayWrap').hidden=true;$('keyWrap').hidden=true;$('voiceMode').querySelector('[value="browser"]').textContent='手机系统语音识别（识别文字送国产 AI）';}
cases();routeAdvice();showView();refreshTools();
