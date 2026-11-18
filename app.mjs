import {metrics,reading,trends,importReadings,decodeHeartRate,safety,checkIn,sleepReview} from './engine.mjs';

const $ = selector=>document.querySelector(selector);
const messages = $('#messages');
const model = $('#model');
const metric = $('#metric');
const share = $('#share');
const draft = $('#message');
const records = [];
const checkIns = [];
const journalKey = 'aviceena-journal-v1';
let reviewAttachment;
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
  attachReview(undefined);
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
      body:JSON.stringify({model:model.value,messages:[...conversation.slice(-14),userMessage],records:attached,review:reviewAttachment})});
    const output = await response.json();
    if (!response.ok) throw new Error(output.error);
    if (!output.urgent) conversation.push(userMessage,{role:'assistant',content:output.text.slice(0,4000)});
    if (conversation.length > 16) conversation.splice(0,conversation.length-16);
    bubble('assistant',output.text,output.urgent);
    attachReview(undefined);
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
  renderRecovery();
}

function addRecords(items) {
  if (records.length+items.length > 5000) throw new Error('This session is full. Download the summary before clearing readings.');
  records.push(...items);
  saveJournal();
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
  attachReview(undefined);
  saveJournal();
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


function localDay(value = new Date()) {
  const time = new Date(value);
  return new Date(time.getTime()-time.getTimezoneOffset()*60000).toISOString().slice(0,10);
}

function labeledElement(tag,text) {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}

function reviewFor(end) {
  const sleep = records.filter(item=>item.metric==='sleep').map(item=>({...item,day:localDay(item.time)}));
  return sleepReview(sleep,checkIns,end);
}

function evidence(label, entries, describe, dayOf) {
  const details = document.createElement('details');
  details.className = 'review-evidence';
  details.append(labeledElement('summary',label));
  const list = document.createElement('ul');
  for (const entry of entries) {
    const day = dayOf(entry);
    const row = document.createElement('li');
    const jump = labeledElement('button',day);
    jump.className = 'secondary compact';
    jump.addEventListener('click',()=>{
      $('#timeline-day').value = day;
      renderRecovery();
      const timeline = $('#recovery-timeline');
      timeline.focus();
      timeline.scrollIntoView({block:'nearest'});
    });
    row.append(jump,document.createTextNode(' '+describe(entry)));
    list.append(row);
  }
  details.append(list);
  return details;
}

const sleepLabel = item=>item.value+' h · '+sourceNames[item.source]+' · '+date.format(new Date(item.time));
const energyLabel = item=>item.energy+' energy'+(item.note ? ' · '+item.note : '');

function renderRecovery() {
  const reviewBox = $('#weekly-review');
  const end = $('#review-end').value;
  reviewBox.replaceChildren();
  $('#review-chat').disabled = true;
  const local = location.hostname === '127.0.0.1';
  $('#review-chat-note').textContent = local
    ? 'Discussing a review attaches its sleep readings and energy levels to your next message. Check-in notes stay in the journal.'
    : 'Discussion is available in the local Ollama app.';
  if (end && $('#review-end').validity.valid) {
    const review = reviewFor(end);
    const coverage = review.current.length+' of 7 days logged';
    reviewBox.append(labeledElement('p',review.start+' to '+review.end+' · '+coverage));
    if (review.average === null) {
      reviewBox.append(labeledElement('p','Log sleep on at least three days in this window to see a weekly average.'));
    } else {
      reviewBox.append(labeledElement('h3','Average sleep · '+review.average+' hours'));
    }
    if (review.current.length) {
      reviewBox.append(evidence('See current-week entries',review.current,sleepLabel,item=>item.day));
    }
    if (review.difference !== null) {
      const change = review.difference === 0 ? 'No change in average sleep' :
        Math.abs(review.difference)+' hours '+(review.difference>0?'more':'less')+' on average';
      reviewBox.append(labeledElement('h3',change));
      reviewBox.append(labeledElement('p','Previous week: '+review.previousAverage+' hours across '+review.prior.length+' logged days.'));
      reviewBox.append(evidence('See previous-week entries',review.prior,sleepLabel,item=>item.day));
    } else if (review.average !== null) {
      reviewBox.append(labeledElement('p','The previous week has '+review.prior.length+' logged days. A comparison needs at least three.'));
      if (review.prior.length) reviewBox.append(evidence('See previous-week entries',review.prior,sleepLabel,item=>item.day));
    }
    if (review.context.length) {
      reviewBox.append(evidence('See '+review.context.length+' energy '+(review.context.length===1?'check-in':'check-ins'),review.context,energyLabel,item=>item.date));
    }
    reviewBox.append(labeledElement('p','Averages use the latest sleep entry per local day and divide the total by the number of days logged. Days without an entry are left out.'));
    $('#review-chat').disabled = !local || !(review.current.length || review.context.length);
  } else {
    reviewBox.append(labeledElement('p','Choose a valid week-ending date.'));
  }
  const timeline = $('#recovery-timeline');
  const day = $('#timeline-day').value;
  const entries = [];
  for (const item of records) {
    if (item.metric==='sleep' && localDay(item.time)===day) {
      entries.push({day,label:sleepLabel(item)});
    }
  }
  for (const item of checkIns) {
    if (item.date===day) entries.push({day,label:energyLabel(item)});
  }
  timeline.replaceChildren();
  if (!entries.length) {
    timeline.append(labeledElement('p','No sleep entries or check-ins for this day.'));
    return;
  }
  const list = document.createElement('ul');
  for (const item of entries) list.append(labeledElement('li',item.day+' · '+item.label));
  timeline.append(list);
}

function attachReview(attachment) {
  reviewAttachment = attachment;
  const notice = $('#review-attachment');
  notice.replaceChildren();
  notice.hidden = !attachment;
  if (attachment) {
    notice.append(document.createTextNode('Weekly review ending '+attachment.end+' attached. '));
    const remove = labeledElement('button','Remove');
    remove.className = 'secondary compact';
    remove.addEventListener('click',()=>attachReview(undefined));
    notice.append(remove);
  }
}

function saveJournal() {
  const remember = $('#remember-journal').checked;
  try {
    if (remember) localStorage.setItem(journalKey,JSON.stringify({records,checkIns}));
    else localStorage.removeItem(journalKey);
    $('#journal-status').textContent = remember ? 'Journal saved in this browser.' : 'Journal is kept in this tab.';
  } catch {
    $('#journal-status').textContent = 'Could not update browser storage. Check your browser storage settings.';
  }
}

function initializeRecovery() {
  const today = localDay();
  for (const selector of ['#review-end','#checkin-day','#timeline-day']) {
    $(selector).value = today;
    $(selector).max = today;
    $(selector).min = '1900-01-01';
  }
  try {
    const saved = localStorage.getItem(journalKey);
    if (saved) {
      const data = JSON.parse(saved);
      const restored = data.records.slice(0,5000).map(item=>reading(item.metric,item.value,item.time,item.source));
      const savedCheckIns = data.checkIns.slice(0,5000).map(item=>checkIn(item.date,item.energy,item.note));
      records.push(...restored);
      checkIns.push(...savedCheckIns);
      $('#remember-journal').checked = true;
      $('#journal-status').textContent = 'Journal restored from this browser.';
    }
  } catch {
    $('#journal-status').textContent = 'The saved journal could not be restored.';
  }
  $('#review-end').addEventListener('change',renderRecovery);
  $('#timeline-day').addEventListener('change',renderRecovery);
  $('#checkin-form').addEventListener('submit',event=>{
    event.preventDefault();
    const form = event.currentTarget;
    const input = new FormData(form);
    try {
      const item = checkIn(input.get('day'),input.get('energy'),input.get('note'));
      const existing = checkIns.findIndex(entry=>entry.date===item.date);
      if (existing>=0) checkIns[existing] = item;
      else checkIns.push(item);
      $('#timeline-day').value = item.date;
      $('#checkin-status').textContent = 'Check-in saved for '+item.date+'.';
      form.elements.note.value = '';
      saveJournal();
      renderRecovery();
    } catch (error) {
      $('#checkin-status').textContent = error.message;
    }
  });
  $('#review-chat').addEventListener('click',()=>{
    if (pending) {
      location.hash = '#talk';
      return;
    }
    const review = reviewFor($('#review-end').value);
    attachReview({end:review.end,sleep:[...review.current,...review.prior],
      energy:review.context.map(({date,energy})=>({date,energy}))});
    share.checked = false;
    location.hash = '#talk';
    draft.value = 'What stands out in my weekly sleep and recovery review? Please use the logged dates.';
  });
  $('#remember-journal').addEventListener('change',saveJournal);
  $('#export-journal').addEventListener('click',()=>{
    const payload = JSON.stringify({records,checkIns},null,2);
    const url = URL.createObjectURL(new Blob([payload],{type:'application/json'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'aviceena-journal.json';
    link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  $('#delete-journal').addEventListener('click',()=>{
    if (!confirm('Delete all readings and check-ins and remove the saved journal from this browser?')) return;
    records.length = 0;
    checkIns.length = 0;
    $('#remember-journal').checked = false;
    attachReview(undefined);
    saveJournal();
    renderReadings();
    $('#checkin-status').textContent = '';
  });
}

initializeRecovery();
resetChat();
updateMetric();
setTime();
renderReadings();
navigate();
void models();
