/* ORION public catalogue contract. Pure functions shared by browser and Node tests. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ORIONCatalogue=api;})(globalThis,function(){
'use strict';
const LIMIT=6*60*60*1000;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function timestamp(x){
 if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(x)||!date(x.slice(0,10)))return null;
 if(Number(x.slice(11,13))>23||Number(x.slice(14,16))>59||Number(x.slice(17,19))>59)return null;
 return Number.isFinite(Date.parse(x))?Date.parse(x):null;
}
const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x+'T12:00:00Z'))&&new Date(x+'T12:00:00Z').toISOString().slice(0,10)===x;
const dataPath=x=>typeof x==='string'&&/^data\/[a-z0-9-]+\.[a-f0-9]{14,64}\.json$/.test(x);
function age(value,now){const t=timestamp(value);return t===null||t>now?null:now-t;}
function freshness(data,now=Date.now()){
 const feed=object(data?.feed)?data.feed:{};
 const editionAge=age(data?.built_at,now),observedAge=age(feed.observed_at,now);
 const hasConfirmation=Object.prototype.hasOwnProperty.call(feed,'last_confirmed_at');
 const checkedAge=hasConfirmation?age(feed.last_confirmed_at,now):null;
 const attemptAge=age(feed.last_attempt_at,now);
 const chronology=checkedAge!==null&&observedAge!==null&&attemptAge!==null&&attemptAge<=checkedAge&&timestamp(feed.last_confirmed_at)>=timestamp(feed.observed_at);
 const sourceSucceeded=['success','not_modified'].includes(feed.last_attempt_status);
 const confirmed=chronology&&sourceSucceeded;
 return {editionAge,observedAge,checkedAge,confirmed,
  editionFresh:editionAge!==null&&editionAge<=LIMIT,
  feedFresh:confirmed&&checkedAge<=LIMIT,
  legacyFallback:!hasConfirmation&&observedAge!==null,
  confirmationAt:confirmed?feed.last_confirmed_at:null,
  unchangedBytes:feed.last_attempt_status==='not_modified'};
}
function validate(data){
 if(!object(data)||data.schema_version!==2||!Array.isArray(data.products)||data.products.length<100||!object(data.feed)||!object(data.detail_files))throw Error('Unexpected catalogue format');
 if(!Array.isArray(data.offers)||!object(data.families)||!object(data.archive))throw Error('Invalid catalogue supporting evidence');
 for(const offer of data.offers){if(!object(offer)||!Array.isArray(offer.sources)||offer.sources.some(x=>!object(x)||typeof x.url!=='string'))throw Error('Invalid offer evidence');}
 const ids=new Set();
 for(const p of data.products){
  if(!object(p)||typeof p.id!=='string'||!p.id||ids.has(p.id)||typeof p.ship!=='string'||!p.ship||!date(p.departure)||!Array.isArray(p.fares))throw Error('Invalid or duplicated voyage');
  for(const key of ['itinerary','region','from_port','to_port','cruise_id','voyage_id','kind','family_id'])if(typeof p[key]!=='string')throw Error('Invalid voyage description');
  if(!Number.isSafeInteger(p.duration)||p.duration<1||!object(p.changes)||!Number.isSafeInteger(p.archive_count)||p.archive_count<0)throw Error('Invalid voyage dimensions');
  ids.add(p.id);
  if(!dataPath(data.detail_files[p.ship]))throw Error('Missing or invalid ship evidence file');
  const columns=new Set();
  for(const cell of p.fares){if(!Array.isArray(cell)||cell.length!==2||typeof cell[0]!=='string'||!cell[0]||columns.has(cell[0])||!Number.isSafeInteger(cell[1])||cell[1]<=0)throw Error('Invalid or conflicting fare category');columns.add(cell[0]);}
  const low=p.fares.length?Math.min(...p.fares.map(x=>x[1])):null;
  if(p.low_pence!==low)throw Error('Price summary does not match published categories');
 }
 return data;
}
function matchesManifest(data,manifest){return !manifest||(data.release===manifest.release&&data.built_at===manifest.built_at&&dataPath(manifest.data_file));}
return Object.freeze({timestamp,date,dataPath,freshness,validate,matchesManifest,LIMIT});
});
