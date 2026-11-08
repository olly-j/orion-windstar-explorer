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
// Discovery groups connect route variants. They never identify a price series.
function discoveryKey(p){return JSON.stringify([p.ship,p.kind,p.discovery_family_id||p.family_id||p.id]);}
function relatedProducts(products,selected){const key=discoveryKey(selected);return products.filter(p=>discoveryKey(p)===key).sort((a,b)=>a.departure.localeCompare(b.departure)||a.duration-b.duration||a.id.localeCompare(b.id));}
function sameDateComparison(a,b){return !!a.family_id&&a.family_id===b.family_id&&['ship','kind','duration','from_port','to_port'].every(k=>a[k]===b[k]);}
function historyColumns(p){return [...new Set([...(p.fares||[]).map(cell=>cell[0]),...Object.keys(p.price_history||{})])];}
function isRetired(p,today){return ['past_departure','not_in_latest_feed'].includes(p.catalogue_status)||!!today&&p.departure<today;}
function sellerPointAttribution(product,pointId){
 const map=product?.seller_history_attribution,entry=object(map?.observations)?map.observations[pointId]:null;
 const fallback={state:'unverified',reason:typeof map?.default_reason==='string'?map.default_reason:'Source attribution has not been validated',replacement_ids:[]};
 if(!object(map)||map.schema_version!==1||map.default_state!=='unverified'||!object(entry))return fallback;
 if(entry.state==='withdrawn')return {state:'withdrawn',reason:typeof entry.reason==='string'?entry.reason:'Source attribution was withdrawn',replacement_ids:Array.isArray(entry.replacement_ids)?entry.replacement_ids.filter(x=>typeof x==='string'&&/^[a-f0-9]{16}$/.test(x)):[]};
 const proof=typeof entry.proof_id==='string'&&/^[a-f0-9]{16}$/.test(entry.proof_id)&&object(map.proofs)?map.proofs[entry.proof_id]:null;
 if(entry.state==='validated'&&object(proof)&&['bounded_catalogue_card','wexas_primary_category','pure_card_primary_price','iglu_primary_category','reviewed_publisher_page'].includes(proof.method)&&/^[a-f0-9]{64}$/.test(proof.evidence_sha256||''))return {state:'validated',reason:'Exact source attribution checked',proof_id:entry.proof_id,replacement_ids:[]};
 return {...fallback,reason:typeof entry.reason==='string'?entry.reason:fallback.reason};
}
function validateAgentOffers(product){
 if(product.agent_offers===undefined)return;
 if(!Array.isArray(product.agent_offers))throw Error('Invalid agent offers');
 const ids=new Set(),url=value=>{try{const u=new URL(value);return typeof value==='string'&&u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash}catch{return false}},hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
 for(const a of product.agent_offers){
  if(!object(a)||!hash(a.id)||ids.has(a.id)||typeof a.provider!=='string'||!a.provider||typeof a.provider_group!=='string'||!a.provider_group||!url(a.url)||!url(a.evidence_url)||timestamp(a.observed_at)===null||typeof a.cabin!=='string'||typeof a.basis!=='string'||a.currency!=='GBP'||a.unit!=='per_person_advertised'||!Number.isSafeInteger(a.amount_pence)||a.amount_pence<=0||(a.pair_total_pence!=null&&(!Number.isSafeInteger(a.pair_total_pence)||a.pair_total_pence<=0))||a.availability_verified!==false||a.costs_verified!==false||!object(a.attribution)||a.attribution.state!=='validated'||typeof a.attribution.method!=='string'||!a.attribution.method||!hash(a.attribution.evidence_sha256)||!hash(a.attribution.observation_id))throw Error('Agent guide lacks validated primary source attribution');
  ids.add(a.id);
 }
 if(isRetired(product)&&product.agent_offers.length)throw Error('Retained voyage cannot publish an active agent guide');
}
function retiredProduct(p,today,observedAt=null){
 if(!isRetired(p,today))return p;
 // This is a display projection. Keep the source and observation history intact.
 return {...p,catalogue_status:today&&p.departure<today?'past_departure':p.catalogue_status,
  last_low_pence:Number.isSafeInteger(p.low_pence)&&p.low_pence>0?p.low_pence:(p.last_low_pence??null),
  last_observed_at:p.last_observed_at||p.feed_observed_at||observedAt||null,
  last_published_fares:(p.fares?.length?p.fares:p.last_published_fares||[]).map(cell=>cell.slice()),
  fares:[],low_pence:null,advertised_price:null,last_agent_offers:p.agent_offers?.length?p.agent_offers:p.last_agent_offers||[],agent_offers:[],changes:{},drop:null};
}
function partitionProducts(data,today){const current=[],retired=[];for(const p of [...data.products,...(data.retired_products||[])]){if(isRetired(p,today))retired.push(retiredProduct(p,today,data.feed?.observed_at));else current.push({...p});}return {current,retired};}
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
 if(data.retired_products!==undefined&&!Array.isArray(data.retired_products))throw Error('Invalid retained voyage archive');
 const retiredIds=new Set((data.retired_products||[]).map(p=>p?.id));
 const ids=new Set();
 for(const p of [...data.products,...(data.retired_products||[])]){
  if(!object(p)||typeof p.id!=='string'||!p.id||ids.has(p.id)||typeof p.ship!=='string'||!p.ship||!date(p.departure)||!Array.isArray(p.fares))throw Error('Invalid or duplicated voyage');
  for(const key of ['itinerary','region','from_port','to_port','cruise_id','voyage_id','kind','family_id'])if(typeof p[key]!=='string')throw Error('Invalid voyage description');
  for(const key of ['discovery_family_id','discovery_family_name'])if(p[key]!==undefined&&(typeof p[key]!=='string'||!p[key]))throw Error('Invalid discovery family');
  if(p.history_count!==undefined&&(!Number.isSafeInteger(p.history_count)||p.history_count<0))throw Error('Invalid history count');
  if(retiredIds.has(p.id)&&(!isRetired(p)||p.fares.length||p.low_pence!==null))throw Error('Retained voyage cannot publish a current fare');
  if(!Number.isSafeInteger(p.duration)||p.duration<1||!object(p.changes)||!Number.isSafeInteger(p.archive_count)||p.archive_count<0)throw Error('Invalid voyage dimensions');
  validateAgentOffers(p);
  ids.add(p.id);
  if(!dataPath(data.detail_files[p.ship]))throw Error('Missing or invalid ship evidence file');
  const columns=new Set();
  for(const cell of p.fares){if(!Array.isArray(cell)||cell.length!==2||typeof cell[0]!=='string'||!cell[0]||columns.has(cell[0])||!Number.isSafeInteger(cell[1])||cell[1]<=0)throw Error('Invalid or conflicting fare category');columns.add(cell[0]);}
  const low=p.fares.length?Math.min(...p.fares.map(x=>x[1])):null;
  if(p.low_pence!==low)throw Error('Price summary does not match published categories');
  if(p.source_kind==='supplemental_advertisement'){
   if(p.kind==='Tour or special bundle'&&(p.end_date!==null||p.end_date_basis!=='unverified_package_dates'))throw Error('Unverified full package end date');
   const e=p.supplemental_source_evidence,a=p.advertised_price;
   if(p.fares.length||p.low_pence!==null||p.drop||Object.keys(p.changes).length||!object(e)||e.voyage_id!==p.voyage_id||e.ship!==p.ship||e.departure!==p.departure||e.published_nights!==p.duration||!/^https:\/\/www\.windstarcruises\.co\.uk\/itineraries\/[a-z0-9-]+-wind[0-9]+\/?$/.test(e.url)||!e.url.replace(/\/$/,'').endsWith('-wind'+p.voyage_id)||!/^([a-f0-9]{64})$/.test(e.body_sha256)||timestamp(e.observed_at)===null||e.observed_at!==p.supplemental_observed_at)throw Error('Invalid reviewed supplemental identity');
   if(a!=null&&(!object(a)||!Number.isSafeInteger(a.amount_pence)||a.amount_pence<=0||a.currency!=='GBP'||a.unit!=='per_person_advertised'||a.url!==e.url||a.observed_at!==e.observed_at||a.availability_verified!==false||a.costs_verified!==false||retiredIds.has(p.id)))throw Error('Invalid supplemental advertised price');
  }else if(p.advertised_price!=null)throw Error('Advertised guide lacks reviewed supplemental source');
 }
 return data;
}
function matchesManifest(data,manifest){return !manifest||(data.release===manifest.release&&data.built_at===manifest.built_at&&dataPath(manifest.data_file));}
return Object.freeze({timestamp,date,dataPath,freshness,validate,matchesManifest,discoveryKey,relatedProducts,sameDateComparison,historyColumns,isRetired,retiredProduct,partitionProducts,sellerPointAttribution,validateAgentOffers,LIMIT});
});

