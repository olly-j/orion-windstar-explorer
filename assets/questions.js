/* ORION comparison questions: local text generation only, no network or persistence. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ORIONQuestions=api;})(globalThis,function(){
'use strict';
function clean(x){return String(x??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').trim();}
function build(rows,observedAt,options={}){
 if(!Array.isArray(rows)||!rows.length||rows.length>3)throw Error('Choose between one and three departures');
 const money=n=>new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',minimumFractionDigits:2}).format(n/100);
 const parts=rows.map(r=>{
  if(!r||typeof r.id!=='string'||!r.id||!/^\d{4}-\d{2}-\d{2}$/.test(r.departure))throw Error('Missing exact departure identity');
  const fares=Array.isArray(r.fares)?r.fares.filter(x=>Array.isArray(x)&&typeof x[0]==='string'&&Number.isSafeInteger(x[1])&&x[1]>0):[];
  const preferred=typeof options.category==='string'?options.category:'',eligible=preferred?fares.filter(x=>x[0]===preferred):fares;const low=eligible.length?Math.min(...eligible.map(x=>x[1])):null,categories=low===null?'No observed category':eligible.filter(x=>x[1]===low).map(x=>clean(x[0])).join(' / ');
  return [clean(r.ship)+' / '+clean(r.itinerary),'Departure: '+r.departure+'; '+clean(r.duration)+' published days','Route: '+clean(r.from_port)+' to '+clean(r.to_port),'Product: '+clean(r.kind),'Record: '+clean(r.id),'Published guide for two: '+(low===null?'No published fare':money(low*2)),'Observed category: '+categories,'Guide basis: twice an assumed-per-person supplier value. This is not a final quote.','Price observation: '+clean(observedAt),'Please confirm the exact category, current availability for two adults, final GBP total, mandatory charges, flights/transfers and package inclusions.',r.kind!=='Cruise'?'Please clarify the components and starting location of this combined or packaged journey.':'Please confirm the cruise-only inclusions and any optional extras.'].join('\n');
 });
 return 'Comparison questions / prepared locally in ORION\nDifferent voyages and packages are different purchases. This draft makes no claim of like-for-like savings.\n\n'+parts.join('\n\n')+'\n\nPlease itemise the quote and its terms. Nothing has been sent by ORION.';
}
return Object.freeze({build});
});
