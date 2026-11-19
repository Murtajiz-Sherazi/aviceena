import {reading,trends,sleepReview} from './engine.mjs';

const prompt = `You are Aviceena, a warm, grounded AI companion for everyday wellbeing. Respond naturally to the user's latest message in the language they use, drawing on the recent conversation. Acknowledge specifics rather than repeating a generic greeting. Ask at most one relevant follow-up. Keep replies concise. You can listen, suggest gentle everyday wellbeing practices, or explain descriptive trends in explicitly shared records. Treat those records as user-reported and potentially incomplete. Never invent values, infer causes from trends, diagnose, triage based on readings, recommend medication or dosage changes, or claim to be a clinician. For health decisions encourage a qualified professional. If the person describes an emergency or immediate danger, tell them to contact local emergency services. You cannot call for help or monitor anyone in the background. Do not imply a human or romantic relationship. Reply in plain text.`;

export function prepareChat(input) {
  let messages, records, review;
  if (!Array.isArray(input.messages) || !input.messages.length || input.messages.length > 16 ||
      !Array.isArray(input.records) || input.records.length > 300) throw new Error();
  messages = input.messages.map(({role,content})=>{
    if (!['user','assistant'].includes(role) || typeof content!=='string'||!content.trim()||content.length>4000) throw new Error();
    return {role,content};
  });
  if (messages.at(-1).role !== 'user') throw new Error();
  records = input.records.map(item=>reading(item.metric,item.value,item.time,item.source));
  if (input.review !== undefined) {
    const {sleep, energy, end} = input.review;
    if (!Array.isArray(sleep) || sleep.length > 14 || !Array.isArray(energy) || energy.length > 7)
      throw new Error();
    review = sleepReview(sleep,energy.map(item=>({...item,note:''})),end);
  }
  let context = records.length ? 'The user chose to share these descriptive summaries: '+JSON.stringify(trends(records)) : 'No readings were shared with you.';
  if (review) context += '\nThe user attached a weekly recovery review. Treat these computed statistics as the only source for weekly calculations. A null average means fewer than three nights. Never infer causes from energy check-ins. Evidence IDs refer to the dates shown in the app. '+JSON.stringify(review);
  return {messages:[{role:'system',content:prompt+'\n'+context},...messages], latest:messages.at(-1).content};
}
