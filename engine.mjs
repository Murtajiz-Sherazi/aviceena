export const metrics = {
  heart: { label:'Heart rate', unit:'bpm', min:1, max:400 },
  glucose: { label:'Blood glucose', unit:'mg/dL', min:1, max:1500 },
  temperature: { label:'Temperature', unit:'°C', min:20, max:50 },
  sleep: { label:'Sleep', unit:'hours', min:0, max:24 },
  oxygen: { label:'Oxygen saturation', unit:'%', min:0, max:100 }
};

export function reading(metric, value, time, source) {
  const definition = Object.hasOwn(metrics,metric) && metrics[metric];
  const number = typeof value === 'number' || (typeof value === 'string' && value.trim()) ? Number(value) : NaN;
  const date = new Date(typeof time === 'string' ? time : NaN);
  if (!definition || !Number.isFinite(number) || number < definition.min || number > definition.max ||
      !Number.isFinite(date.getTime()) || !['manual','bluetooth','import'].includes(source)) {
    throw new Error('Check the reading, its timestamp, and the displayed unit.');
  }
  return { metric, value:number, time:date.toISOString(), source };
}

export function trends(records) {
  return Object.entries(metrics).flatMap(([metric, definition]) => {
    const items = records.filter(item => item.metric === metric).sort((a,b)=>a.time.localeCompare(b.time));
    if (!items.length) return [];
    const first = items[0];
    const latest = items.at(-1);
    return [{ metric, ...definition, count:items.length, first, latest,
      minValue:Math.min(...items.map(item=>item.value)), maxValue:Math.max(...items.map(item=>item.value)),
      change:Number((latest.value-first.value).toFixed(2)) }];
  });
}

export function importReadings(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.shift()?.toLowerCase().trim() !== 'timestamp,metric,value' || !lines.length || lines.length > 2000)
    throw new Error('Use a CSV with the header timestamp,metric,value and 1 to 2,000 rows.');
  return lines.map((line,index)=>{
    const [time,metric,value,...extra] = line.split(',').map(item=>item.trim());
    try {
      if (extra.length || !/^\d{4}-\d\d-\d\dT.+(?:Z|[+-]\d\d:\d\d)$/i.test(time))
        throw new Error();
      return reading(metric,value,time,'import');
    } catch {
      throw new Error('Check the timestamp, metric, or value on CSV row '+(index+2)+'.');
    }
  });
}

export function decodeHeartRate(data) {
  if (data.byteLength < 2) return null;
  const flags = data.getUint8(0);
  if ((flags & 0b110) === 0b100) return null;
  const wide = Boolean(flags & 1);
  if (wide && data.byteLength < 3) return null;
  const bpm = wide ? data.getUint16(1,true) : data.getUint8(1);
  return bpm > 0 && bpm <= metrics.heart.max ? bpm : null;
}

export function safety(text) {
  if (/kill myself|end my life|take my own life|suicid|hurt myself|self[- ]?harm|harm myself|want to die|can.t keep myself safe|overdos|chest (?:pain|pressure)|can.t breathe|cannot breathe|passed out|unconscious|severe (?:shortness of breath|bleeding)/i.test(text))
    return 'If someone may be in immediate danger, contact local emergency services now. If you can, ask someone nearby you trust to stay with you. Aviceena cannot send help.';
  return null;
}

export function checkIn(date, energy, note) {
  if (typeof date !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(date) ||
      !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date ||
      !['low','steady','high'].includes(energy) || typeof note !== 'string' || note.length > 280)
    throw new Error('Choose a valid date and energy level. Notes can be up to 280 characters.');
  return {date,energy,note:note.trim()};
}

const shiftDay = (day,offset) => new Date(Date.parse(day)+offset*86400000).toISOString().slice(0,10);

export function sleepReview(sleep, checkIns, end) {
  checkIn(end,'steady','');
  const start = shiftDay(end,-6);
  const previousStart = shiftDay(end,-13);
  const nights = new Map();
  for (const item of sleep) {
    checkIn(item.day,'steady','');
    const entry = reading('sleep',item.value,item.time,item.source);
    if (item.day < previousStart || item.day > end) continue;
    const existing = nights.get(item.day);
    if (!existing || existing.time <= entry.time) nights.set(item.day,{...entry,day:item.day});
  }
  const sorted = [...nights.values()].sort((a,b)=>a.day.localeCompare(b.day));
  const current = sorted.filter(item=>item.day>=start);
  const prior = sorted.filter(item=>item.day<start);
  const context = checkIns.map(item=>checkIn(item.date,item.energy,item.note))
    .filter(item=>item.date>=start && item.date<=end).sort((a,b)=>a.date.localeCompare(b.date));
  const mean = items => items.reduce((sum,item)=>sum+item.value,0)/items.length;
  const round = value => Number(value.toFixed(2));
  const enough = current.length>=3;
  const compare = enough && prior.length>=3;
  return {start,end,previousStart,previousEnd:shiftDay(start,-1),current,prior,context,
    average:enough ? round(mean(current)) : null,
    previousAverage:compare ? round(mean(prior)) : null,
    difference:compare ? round(mean(current)-mean(prior)) : null};
}
