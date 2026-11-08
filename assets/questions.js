/* ORION comparison questions: local text generation only, no network or persistence. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ORIONQuestions=api;})(globalThis,function(){
'use strict';
function clean(x){return String(x??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').trim();}
function build(rows,observedAt,options={}){
 if(!Array.isArray(rows)||!rows.length||rows.length>3)throw Error('Choose between one and three departures');
 const money=n=>new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',minimumFractionDigits:2}).format(n/100),now=Date.now(),hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
 const parts=rows.map(r=>{
  if(!r||typeof r.id!=='string'||!r.id||!/^\d{4}-\d{2}-\d{2}$/.test(r.departure))throw Error('Missing exact departure identity');
  const fares=Array.isArray(r.fares)?r.fares.filter(x=>Array.isArray(x)&&typeof x[0]==='string'&&Number.isSafeInteger(x[1])&&x[1]>0):[];
  const preferred=typeof options.category==='string'?options.category:'',eligible=preferred?fares.filter(x=>x[0]===preferred):fares;
  const cell=eligible.slice().sort((a,b)=>a[1]-b[1]||a[0].localeCompare(b[0]))[0],retired=['not_in_latest_feed','past_departure','departed','historical'].includes(r.catalogue_status);
  let guide=!retired&&cell?{source:'supplier',column:cell[0],amount:cell[1],pair_amount:cell[1]*2}:null;
  const offers=!retired&&!preferred?(r.agent_offers||[]).filter(a=>{
   const age=now-Date.parse(a.observed_at);let safe=false;try{const u=new URL(a.url);safe=u.protocol==='https:'&&!u.username&&!u.password}catch{}
   return safe&&hash(a.id)&&hash(a.attribution?.observation_id)&&hash(a.attribution?.evidence_sha256)&&a.attribution?.state==='validated'&&['bounded_catalogue_card','wexas_primary_category','pure_card_primary_price','reviewed_publisher_page'].includes(a.attribution.method)&&a.currency==='GBP'&&a.unit==='per_person_advertised'&&a.availability_verified===false&&a.costs_verified===false&&typeof a.provider==='string'&&a.provider&&typeof a.cabin==='string'&&a.cabin&&typeof a.basis==='string'&&a.basis&&Number.isSafeInteger(a.amount_pence)&&a.amount_pence>0&&(a.pair_total_pence==null||(Number.isSafeInteger(a.pair_total_pence)&&a.pair_total_pence>0))&&Number.isFinite(age)&&age>=0&&age<=24*3600e3;
  }).sort((a,b)=>(a.pair_total_pence??a.amount_pence*2)-(b.pair_total_pence??b.amount_pence*2)||b.observed_at.localeCompare(a.observed_at)||a.provider.localeCompare(b.provider)||a.id.localeCompare(b.id)):[];
  const offer=offers[0];if(offer&&(!guide||(offer.pair_total_pence??offer.amount_pence*2)<guide.pair_amount))guide={source:'agent',offer,amount:offer.amount_pence,pair_amount:offer.pair_total_pence??offer.amount_pence*2};
  if(options.guides&&Object.hasOwn(options.guides,r.id)){
   const supplied=options.guides[r.id];
   if(supplied===null)guide=null;
   else if(supplied?.source==='supplier'){const chosen=eligible.find(x=>x[0]===supplied.column&&x[1]===supplied.amount);if(!chosen)throw Error('Selected supplier guide does not match this departure');guide={source:'supplier',column:chosen[0],amount:chosen[1],pair_amount:chosen[1]*2};}
   else if(supplied?.source==='agent'){const chosen=offers.find(x=>x.id===supplied.offer?.id&&x.amount_pence===supplied.amount&&(x.pair_total_pence??x.amount_pence*2)===supplied.pair_amount);if(!chosen)throw Error('Selected agent guide is not current validated evidence for this departure');guide={source:'agent',offer:chosen,amount:chosen.amount_pence,pair_amount:chosen.pair_total_pence??chosen.amount_pence*2};}
   else throw Error('Unknown selected guide source');
  }
  const agent=guide?.source==='agent'?guide.offer:null,source=agent?agent.provider:guide?'Supplier '+guide.column:'No current price source';
  const category=agent?agent.cabin+' (seller wording; supplier category equivalence unknown)':guide?guide.column:'No observed category';
  const basis=agent?(agent.pair_total_pence?'Seller supplied an explicit two-person amount. ':'Estimated for two by doubling the advertised per-person amount. ')+'Advert basis: '+agent.basis+'. Cabin equivalence, full package contents, availability and final costs require confirmation.':'Twice an assumed-per-person supplier value. Confirm its occupancy basis and final payable total.';
  const duration=String(r.duration)+(r.source_kind==='supplemental_advertisement'?' advertised nights':' published days');
  return [clean(r.ship)+' / '+clean(r.itinerary),(r.end_date_basis==='unverified_package_dates'?'Advertised start: ':'Departure: ')+r.departure+'; '+duration,'Route: '+clean(r.from_port)+' to '+clean(r.to_port),'Product: '+clean(r.kind),'Record: '+clean(r.id),'Published guide for two: '+(guide?money(guide.pair_amount):'No published fare'),'Price source: '+clean(source),'Observed category: '+clean(category),'Original amount per person: '+(guide?money(guide.amount):'Unknown'),'Guide basis: '+clean(basis),'Price observation: '+clean(agent?agent.observed_at:guide?observedAt:'Not recorded'),agent?'Source: '+clean(agent.url):'',agent&&cell?'Separate supplier reference: '+clean(cell[0])+', '+money(cell[1]*2)+' for two. No mapping to the seller category is assumed.':'',r.end_date_basis==='unverified_package_dates'?'The full package end date is unverified.':'','Please confirm the exact category, current availability for two adults, final GBP total, mandatory charges, flights/transfers and package inclusions.',r.kind!=='Cruise'?'Please clarify the components and starting location of this combined or packaged journey.':'Please confirm the cruise-only inclusions and any optional extras.'].filter(Boolean).join('\n');
 });
 return 'Comparison questions / prepared locally in ORION\nDifferent voyages and packages are different purchases. This draft makes no claim of like-for-like savings.\n\n'+parts.join('\n\n')+'\n\nPlease itemise the quote and its terms. Nothing has been sent by ORION.';
}
return Object.freeze({build});
});
