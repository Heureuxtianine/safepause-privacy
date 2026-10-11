import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';

const app=await fs.readFile(new URL('./app.js',import.meta.url),'utf8');
function runtime(Recognition,bridge) {
  const elements=new Map();
  const get=id=>{if(!elements.has(id))elements.set(id,{textContent:'',hidden:true,value:'',checked:false,focus(){},classList:{add(){},remove(){}}});return elements.get(id);};
  const messages=[];
  const actions={recording:0,recognition:0};
  const state={agent:true,asr:true,provider:'腾讯混元',voiceAuto:false,recorder:null};
  get('voiceMode').value='record';
  const context=vm.createContext({window:{isSecureContext:true,SpeechRecognition:Recognition,SafePauseNative:bridge},$:get,state,location:{hash:''},startRecording(){actions.recording++;},toast(message){messages.push(message);},setTimeout(){return 1;},clearTimeout(){},analyze(){actions.analyze=(actions.analyze||0)+1;}});
  vm.runInContext("const native=typeof window.SafePauseNative?.request==='function';let speechRecognition; let recognitionWatchdog;"+app.slice(app.indexOf('function voiceFailure('),app.indexOf('function skillWorkflow(')),context);
  return {context,get,messages,state,actions};
}
test('unsupported recognition offers a persistent recording fallback',()=>{
  const {context,get}=runtime();vm.runInContext('toggleVoice()',context);
  assert.match(get('voiceDiagnostic').textContent,/不支持实时语音识别/);
  assert.equal(get('voiceRecordFallback').hidden,false);
});
test('recognition network failure survives the end event',()=>{
  let instance;class Recognition{constructor(){instance=this;}start(){}stop(){}abort(){}}
  const {context,get}=runtime(Recognition);vm.runInContext('toggleVoice()',context);
  instance.onerror({error:'network'});instance.onend();
  assert.match(get('voiceState').textContent,/语音服务连接失败/);
  assert.equal(get('voiceStart').textContent,'开始语音聊天');
});
test('user stopping browser recognition does not show an error toast',()=>{
  let instance;class Recognition{constructor(){instance=this;}start(){}stop(){this.onerror({error:'aborted'});this.onend();}abort(){}}
  const {context,messages}=runtime(Recognition);
  vm.runInContext('toggleVoice();toggleVoice()',context);
  assert.deepEqual(messages,[]);
});
test('Android native speech input works without browser recognition',()=>{
  let opened=0;const {context,get,messages}=runtime(undefined,{request(){},voice(){opened++;}});
  vm.runInContext('toggleVoice()',context);assert.equal(opened,1);assert.deepEqual(messages,[]);
  assert.match(get('voiceDiagnostic').textContent,/核对文字再发送/);
});
test('voice chat requires model consent before starting any microphone path',()=>{
  const {context,get,state,actions}=runtime();
  vm.runInContext('startVoiceChat()',context);
  assert.equal(actions.recording,0);assert.equal(state.voiceAuto,false);
  assert.match(get('voiceDiagnostic').textContent,/同意本次会话/);
});
test('voice chat remains usable with local rules before a model is configured',()=>{
  let instance;class Recognition{constructor(){instance=this;}start(){this.onstart?.();}stop(){}abort(){}}
  const {context,get,state}=runtime(Recognition);state.agent=false;get('voiceMode').value='browser';
  vm.runInContext('startVoiceChat()',context);
  assert.equal(state.voiceAuto,true);
  instance.onresult({results:[[{transcript:'我有点害怕'}]]});
  assert.match(get('voiceDiagnostic').textContent,/本地安全规则/);
});
test('recorded voice chat requires separate consent for audio transcription',()=>{
  const {context,get,state,actions}=runtime();get('cloudConsent').checked=true;
  vm.runInContext('startVoiceChat()',context);
  assert.equal(actions.recording,0);assert.equal(state.voiceAuto,false);
  assert.match(get('voiceDiagnostic').textContent,/语音授权/);
});
test('authorized recorded voice starts a single recording turn for ASR and model reply',()=>{
  const {context,get,state,actions}=runtime();get('cloudConsent').checked=true;get('voiceCloudConsent').checked=true;
  vm.runInContext('startVoiceChat()',context);
  assert.equal(actions.recording,1);assert.equal(state.voiceAuto,true);
  assert.match(get('voiceDiagnostic').textContent,/腾讯混元/);
});
