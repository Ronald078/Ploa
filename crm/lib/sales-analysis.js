'use strict';
const {uniqueConversationEvents}=require('./conversation-events');
const {confirmedPayments,roundMoney}=require('./commercial-records');
const stamp=value=>Date.parse(value)||0;
const percent=(part,total)=>total?Math.round(part/total*1000)/10:0;
const median=values=>{
 if(!values.length)return null;
 values.sort((a,b)=>a-b);const middle=Math.floor(values.length/2);
 return values.length%2?values[middle]:(values[middle-1]+values[middle])/2;
};

function approaches(history){
 const seen=new Set();
 return history.filter(event=>{
  if(event.kind!=='copy'||!event.copyId||event.direction==='in')return false;
  const key=event.messageId?'message:'+event.messageId:JSON.stringify([event.copyId,event.country||'',event.category||'',stamp(event.at)]);
  if(seen.has(key))return false;seen.add(key);return true;
 });
}

function analyzeCopies(events,records={}, {now=Date.now()}={}){
 const byContact=new Map(),groups=new Map(),approachDates=[],responseHours=[],closeDays=[];
 for(const event of uniqueConversationEvents(events)){
  if(!event.contact||!stamp(event.at)||stamp(event.at)>now)continue;
  if(!byContact.has(event.contact))byContact.set(event.contact,[]);
  byContact.get(event.contact).push(event);
 }
 for(const [contact,history] of byContact){
  history.sort((a,b)=>stamp(a.at)-stamp(b.at));
  const copies=approaches(history),record=records[contact]||{},payments=confirmedPayments(record);
  for(let index=0;index<copies.length;index++){
   const copy=copies[index],start=stamp(copy.at),end=stamp(copies[index+1]?.at)||Infinity;
   const within=value=>{const time=stamp(value);return time&&time>=start&&time<end&&time<=now;};
   const key=JSON.stringify([copy.copyId,copy.country||'',copy.category||'']);
   if(!groups.has(key))groups.set(key,{id:copy.copyId,preview:copy.copyPreview,country:copy.country,category:copy.category,sent:0,humanResponses:0,proposals:0,clients:0,received:{},contacts:new Map()});
   const row=groups.get(key);
   if(!row.contacts.has(contact)){row.contacts.set(contact,{response:false,proposal:false,client:false});row.sent++;}
   const counted=row.contacts.get(contact);approachDates.push(copy.at);
   const firstReply=history.find(event=>event.direction==='in'&&event.actor==='contact'&&String(event.text||'').trim()&&within(event.at));
   if(firstReply&&!counted.response){counted.response=true;row.humanResponses++;responseHours.push((stamp(firstReply.at)-start)/3600000);}
   if(!counted.proposal&&(record.proposals||[]).some(proposal=>within(proposal.sentAt))){counted.proposal=true;row.proposals++;}
   const accepted=(record.proposals||[]).find(proposal=>within(proposal.acceptedAt));
   if(accepted&&!counted.client){counted.client=true;row.clients++;closeDays.push((stamp(accepted.acceptedAt)-start)/86400000);}
   for(const payment of payments)if(within(payment.at))row.received[payment.currency]=roundMoney((row.received[payment.currency]||0)+payment.amount);
  }
 }
 const copies=[...groups.values()].map(({contacts,...row})=>({...row,responseRate:percent(row.humanResponses,row.sent),proposalRate:percent(row.proposals,row.sent),clientRate:percent(row.clients,row.sent)}));
 const total=field=>copies.reduce((sum,row)=>sum+row[field],0),sent=total('sent'),responses=total('humanResponses'),proposals=total('proposals'),clients=total('clients');
 approachDates.sort((a,b)=>stamp(a)-stamp(b));
 return{copies,cohort:{sent,humanResponses:responses,proposals,clients,responseRate:percent(responses,sent),
  from:approachDates[0]||null,to:approachDates.at(-1)||null,updatedAt:new Date(now).toISOString(),scope:'Contatos por variação identificada',unit:'contatos por variação de copy',
  proposalRate:percent(proposals,sent),clientRate:percent(clients,sent),medianResponseHours:median(responseHours),medianCloseDays:median(closeDays)}};
}
module.exports={analyzeCopies};
