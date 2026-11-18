import {metrics,reading,trends,importReadings,decodeHeartRate,safety} from './engine.mjs';

const $ = selector=>document.querySelector(selector);
const messages = $('#messages');
const model = $('#model');
const metric = $('#metric');
const share = $('#share');
const draft = $('#message');
const records = [];
const conversation = [];
const sourceNames = {manual:'Manual',bluetooth:'Bluetooth',import:'CSV'};
const date = new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'});
let pending = false;
let device, characteristic;
let lastSample = 0;

function navigate() {
  const hash = location.hash || '#home';
  if (hash === '#main') return;
  const pages = [...document.querySelectorAll('.page')];
  const target = pages.find(page=>hash==='#'+page.id) ?? pages[0];
  for (const page of pages) page.hidden = page !== target;
  for (const link of document.querySelectorAll('nav a')) {
    if (link.hash === '#'+target.id) {
      link.setAttribute('aria-current','page');
      $('#breadcrumb').textContent = link.lastChild.textContent.trim();
    } else link.removeAttribute('aria-current');
  }
  if (target.id === 'talk') messages.scrollTop = messages.scrollHeight;
}

function bubble(role,text,urgent=false) {
  const item = document.createElement('div');
  item.className = role==='user' ? 'bubble mine' : urgent ? 'bubble urgent' : 'bubble';
  const name = document.createElement('strong');
  name.textContent = role==='user' ? 'You' : 'Aviceena';
  item.append(name,document.createTextNode(text));
  messages.append(item);
  messages.scrollTop = messages.scrollHeight;
  return item;
}

function resetChat() {
  conversation.length = 0;
  messages.replaceChildren();
  draft.value = '';
  share.checked = false;
  $('#chat-feedback').textContent = '';
  bubble('assistant','Hi, I’m Aviceena. What would you like to talk about today?');
}

async function models() {
  if (location.hostname !== '127.0.0.1') {
    model.replaceChildren(new Option('Available in the local app',''));
    $('#model-status').textContent = 'Web edition';
    $('#model-detail').textContent = 'Run the local edition with Ollama to enable AI chat.';
    $('#hosted-chat').hidden = false;
    $('#refresh-models').disabled = true;
    $('#send').disabled = true;
    draft.disabled = true;
    for (const button of document.querySelectorAll('[data-prompt]')) button.disabled = true;
    return;
  }
  const chosen = model.value;
  const refresh = $('#refresh-models');
  refresh.disabled = true;
  try {
    const response = await fetch('/api/models');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    model.replaceChildren(...data.models.map(name=>new Option(name,name)));
    model.disabled = !data.models.length;
    if (data.models.includes(chosen)) model.value=chosen;
    else if (data.models.includes('qwen2.5:3b')) model.value='qwen2.5:3b';
    $('#model-status').textContent = data.models.length ? '✦ Local AI ready' : 'No local model installed';
    $('#model-detail').textContent = data.models.length ? 'Responses are generated on this device.' : 'Install a model with ollama pull qwen2.5:3b, then refresh.';
    if (!data.models.length) model.add(new Option('No installed model',''));
  } catch (error) {
    model.replaceChildren(new Option('Ollama unavailable',''));
    model.disabled = true;
    $('#model-status').textContent = 'Ollama offline';
    $('#model-detail').textContent = error.message;
  } finally {
    refresh.disabled = false;
  }
}

function setPending(value) {
  pending = value;
  $('#send').disabled = value;
  $('#send').textContent = value ? 'Thinking…' : 'Send';
  $('#clear-chat').disabled = value;
  draft.disabled = value;
  share.disabled = value || !records.length;
  for (const button of document.querySelectorAll('[data-prompt]')) button.disabled = value;
  $('#discuss').disabled = value || !records.length;
}

async function send() {
  const text = draft.value.trim();
  if (!text || pending || location.hostname !== '127.0.0.1') return;
  const emergency = safety(text);
  if (emergency) {
    bubble('user',text);
    bubble('assistant',emergency,true);
    draft.value = '';
    share.checked = false;
    $('#chat-feedback').textContent = '';
    return;
  }
  if (model.disabled) {
    $('#chat-feedback').textContent = 'Open Model settings to connect a local Ollama model. Your message is still here.';
    return;
  }
  const attached = share.checked ? records.slice().sort((a,b)=>b.time.localeCompare(a.time)).slice(0,300) : [];
  const userMessage = {role:'user',content:text};
  const sent = bubble('user',text);
  $('#chat-feedback').textContent = 'Aviceena is thinking. The first reply may take a moment.';
  setPending(true);
  try {
    const response = await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({model:model.value,messages:[...conversation.slice(-14),userMessage],records:attached})});
    const output = await response.json();
    if (!response.ok) throw new Error(output.error);
    if (!output.urgent) conversation.push(userMessage,{role:'assistant',content:output.text.slice(0,4000)});
    if (conversation.length > 16) conversation.splice(0,conversation.length-16);
    bubble('assistant',output.text,output.urgent);
    draft.value = '';
    share.checked = false;
    $('#chat-feedback').textContent = '';
  } catch (error) {
    sent.remove();
    $('#chat-feedback').textContent = error.message+' Your message is still here.';
  } finally {
    setPending(false);
    if (!$('#talk').hidden) draft.focus();
  }
}

function fillDraft(text) {
  draft.value = text;
  draft.focus();
}

function trendChart(values,label) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns,'svg');
  const path = document.createElementNS(ns,'polyline');
  const low = Math.min(...values), high = Math.max(...values);
  const points = values.map((value,index)=>[(index/(values.length-1))*280+3, high===low ? 20 : 37-(value-low)/(high-low)*33].join(','));
  svg.setAttribute('viewBox','0 0 286 42');
  svg.setAttribute('preserveAspectRatio','none');
  svg.setAttribute('class','chart');
  svg.setAttribute('role','img');
  svg.setAttribute('aria-label',label+' trend from '+values[0]+' to '+values.at(-1));
  path.setAttribute('points',points.join(' '));
  path.setAttribute('fill','none');
  path.setAttribute('stroke','#7653a4');
  path.setAttribute('stroke-width','2');
  path.setAttribute('vector-effect','non-scaling-stroke');
  svg.append(path);
  return svg;
}

function renderReadings() {
  const descending = records.slice().sort((a,b)=>b.time.localeCompare(a.time));
  const patterns = $('#patterns');
  patterns.replaceChildren();
  for (const trend of trends(records)) {
    const tile = document.createElement('div');
    tile.className = 'pattern';
    const label = document.createElement('strong');
    label.textContent = trend.label+' · '+trend.latest.value+' '+trend.unit;
    const detail = document.createElement('span');
    detail.textContent = trend.count===1 ? 'One reading. Add another to see a change.' :
      trend.count+' readings · '+(trend.change>0?'+':'')+trend.change+' '+trend.unit+' from first to latest';
    tile.append(label,detail);
    const values = descending.filter(item=>item.metric===trend.metric).slice(0,24).reverse().map(item=>item.value);
    if (values.length > 1) tile.append(trendChart(values,trend.label));
    patterns.append(tile);
  }
  const history = $('#records');
  history.replaceChildren();
  if (!records.length) {
    patterns.append(document.createTextNode('Your trends will appear when you add readings.'));
    history.append(document.createTextNode('You haven’t added any readings yet.'));
  } else {
    const list = document.createElement('ul');
    for (const item of descending.slice(0,30)) {
      const row = document.createElement('li');
      const value = document.createElement('strong');
      const detail = document.createElement('span');
      value.textContent = metrics[item.metric].label+' · '+item.value+' '+metrics[item.metric].unit;
      detail.textContent = sourceNames[item.source]+' · '+date.format(new Date(item.time));
      row.append(value,detail);
      list.append(row);
    }
    history.append(list);
  }
  $('#export').disabled = !records.length;
  $('#clear-records').disabled = !records.length;
  share.disabled = pending || !records.length || location.hostname !== '127.0.0.1';
  $('#discuss').disabled = pending || !records.length;
  if (!records.length) share.checked = false;
}

function addRecords(items) {
  if (records.length+items.length > 5000) throw new Error('This session is full. Download the summary before clearing readings.');
  records.push(...items);
  renderReadings();
}

function updateMetric() {
  const item = metrics[metric.value];
  $('#value-label').textContent = 'Value ('+item.unit+')';
  $('#reading-value').min = item.min;
  $('#reading-value').max = item.max;
}
function setTime() {
  const now = new Date();
  $('#reading-time').value = new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,16);
}

for (const [key,value] of Object.entries(metrics)) metric.add(new Option(value.label,key));
metric.addEventListener('change',updateMetric);
$('#reading-form').addEventListener('submit',event=>{
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  try {
    const timestamp = new Date(data.get('time')).toISOString();
    addRecords([reading(data.get('metric'),data.get('value'),timestamp,'manual')]);
    $('#reading-feedback').textContent = 'Reading saved for this session.';
    $('#reading-value').value = '';
    setTime();
  } catch (error) { $('#reading-feedback').textContent = error.message; }
});

$('#import').addEventListener('change',async event=>{
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 350000) throw new Error('Choose a CSV smaller than 350 KB.');
    const items = importReadings(await file.text());
    addRecords(items);
    $('#import-status').textContent = items.length+' readings imported. View them under My readings.';
  } catch (error) { $('#import-status').textContent = error.message; }
  finally { event.target.value = ''; }
});

function onHeartRate(event) {
  const bpm = decodeHeartRate(event.target.value);
  if (bpm===null || Date.now()-lastSample < 15000) return;
  try {
    addRecords([reading('heart',bpm,new Date().toISOString(),'bluetooth')]);
    lastSample = Date.now();
    $('#device-status').textContent = 'Connected · latest reading: '+bpm+' bpm';
  } catch (error) {
    disconnect();
    $('#device-status').textContent = error.message;
  }
}

function disconnect() {
  characteristic?.removeEventListener('characteristicvaluechanged',onHeartRate);
  device?.removeEventListener('gattserverdisconnected',disconnect);
  if (device?.gatt.connected) device.gatt.disconnect();
  characteristic = undefined;
  device = undefined;
  lastSample = 0;
  $('#connect').disabled = false;
  $('#disconnect').disabled = true;
  $('#device-status').textContent = 'Sensor disconnected.';
}

$('#connect').addEventListener('click',async()=>{
  if (!navigator.bluetooth) {
    $('#device-status').textContent = 'Bluetooth pairing is unavailable in this browser. Try Chrome or Edge, or import a CSV.';
    return;
  }
  $('#connect').disabled = true;
  $('#device-status').textContent = 'Choose your heart-rate sensor.';
  try {
    device = await navigator.bluetooth.requestDevice({filters:[{services:['heart_rate']}]});
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService('heart_rate');
    characteristic = await service.getCharacteristic('heart_rate_measurement');
    await characteristic.startNotifications();
    characteristic.addEventListener('characteristicvaluechanged',onHeartRate);
    device.addEventListener('gattserverdisconnected',disconnect);
    $('#disconnect').disabled = false;
    $('#device-status').textContent = 'Sensor connected. Waiting for a reading.';
  } catch (error) {
    disconnect();
    $('#device-status').textContent = error.name==='NotFoundError' ? 'No sensor selected.' : 'Could not connect. Check that your sensor is on and advertising the Heart Rate service.';
  }
});
$('#disconnect').addEventListener('click',disconnect);

$('#clear-records').addEventListener('click',()=>{
  if (!confirm('Clear all readings for this tab?')) return;
  records.length = 0;
  renderReadings();
  $('#reading-feedback').textContent = 'Readings cleared.';
});

$('#export').addEventListener('click',()=>{
  const lines = ['Aviceena · Reading summary','Descriptive trends from user-provided readings.',''];
  for (const t of trends(records)) {
    lines.push(t.label+' · '+t.count+' readings · '+t.first.time+' to '+t.latest.time,
      'First '+t.first.value+' / latest '+t.latest.value+' '+t.unit+' · range '+t.minValue+'–'+t.maxValue+' '+t.unit,'');
  }
  const url = URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/plain;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'aviceena-readings-summary.txt';
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
});

$('#chat-form').addEventListener('submit',event=>{event.preventDefault();void send();});
draft.addEventListener('keydown',event=>{
  if (event.key==='Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $('#chat-form').requestSubmit();
  }
});
for (const button of document.querySelectorAll('[data-prompt]')) {
  button.addEventListener('click',()=>fillDraft(button.dataset.prompt));
}
$('#discuss').addEventListener('click',()=>{
  share.checked = true;
  fillDraft('Can you help me understand the trends in these readings?');
});
$('#clear-chat').addEventListener('click',resetChat);
$('#refresh-models').addEventListener('click',models);
window.addEventListener('hashchange',navigate);
resetChat();
updateMetric();
setTime();
renderReadings();
navigate();
void models();
