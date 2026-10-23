/* ORION filters: one definition for URL state, draft previews and applied results. */
(function(root){'use strict';
 const scalarDefaults={q:'',from:'',to:'',minDays:'',maxDays:'',minBudget:'',budget:'',kind:'',cabin:'',view:'all',evidence:'all',sort:'date',group:'departures',page:1};
 const empty=()=>({...scalarDefaults,ships:[],regions:[]});
 const date=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')&&Number.isFinite(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
 const numbers=(v,max=10000000,whole=false)=>{if(v===null||v===undefined||String(v).trim()==='')return '';const s=String(v).trim();if(!/^(?:\d+)(?:\.\d{1,2})?$/.test(s))return '';const n=Number(s);return Number.isFinite(n)&&n>=0&&n<=max&&(!whole||(Number.isInteger(n)&&n>=1))?String(n):'';};
 const choices=v=>[...new Set((Array.isArray(v)?v:[v]).filter(x=>typeof x==='string').map(x=>x.trim()).filter(x=>x&&x.length<=120))].sort().slice(0,50);
 function normalise(raw={}){const s=empty();for(const k of Object.keys(scalarDefaults)){if(raw[k]!==undefined&&raw[k]!==null)s[k]=String(raw[k]).slice(0,800)}
  s.ships=choices(raw.ships||raw.ship||[]);s.regions=choices(raw.regions||raw.region||[]);
  for(const k of ['from','to'])if(!date(s[k]))s[k]='';
  s.minDays=numbers(s.minDays,365,true);s.maxDays=numbers(s.maxDays,365,true);s.minBudget=numbers(s.minBudget);s.budget=numbers(s.budget);
  if(!s.minDays&&!s.maxDays){const old={short:['1','7'],medium:['8','14'],mid:['8','14'],long:['15','']}[raw.duration];if(old)[s.minDays,s.maxDays]=old;}
  if(s.view==='agency'){s.view='all';s.evidence='agency'}if(s.view==='verified'){s.view='all';s.evidence='verified'}
  if(!['all','drops','archive','saved','offers'].includes(s.view))s.view='all';
  if(!['all','agency','verified'].includes(s.evidence))s.evidence='all';if(!['departures','itineraries'].includes(s.group))s.group='departures';
  if(!['date','price','drop','daily','latest','history','oldest'].includes(s.sort))s.sort='date';
  s.page=Math.min(999,Math.max(1,parseInt(s.page,10)||1));return s;
 }
 function fromParams(p){const raw={};for(const k of Object.keys(scalarDefaults))if(p.has(k))raw[k]=p.get(k);for(const [plural,singular] of [['ships','ship'],['regions','region']]){const a=p.getAll(plural).flatMap(x=>x.split(','));if(p.has(singular))a.push(p.get(singular));raw[plural]=a;}if(p.has('duration'))raw.duration=p.get('duration');if(raw.view==='archive'&&!p.has('sort'))raw.sort='history';return normalise(raw);}
 function toParams(raw){const s=normalise(raw),p=new URLSearchParams();for(const k of Object.keys(scalarDefaults)){if(s[k]!==scalarDefaults[k]&&s[k]!=='')p.set(k,String(s[k]));}for(const k of ['ships','regions'])for(const value of s[k])p.append(k,value);return p;}
 function rangeErrors(s){const errors={};if(s.from&&s.to&&s.from>s.to)errors.to='Choose an end date on or after the start date.';if(s.minDays&&s.maxDays&&Number(s.minDays)>Number(s.maxDays))errors.maxDays='Maximum length must be at least the minimum.';if(s.minBudget&&s.budget&&Number(s.minBudget)>Number(s.budget))errors.budget='Maximum budget must be at least the minimum.';return errors;}
 function fare(r,s){const fs=Array.isArray(r.fares)?r.fares:[];const found=s.cabin?fs.find(f=>f[0]===s.cabin):fs.reduce((a,b)=>!a||b[1]<a[1]?b:a,null);return found?{column:found[0],amount:found[1]}:null;}
 function matches(r,s){if(s.ships.length&&!s.ships.includes(r.ship))return false;if(s.regions.length&&!s.regions.includes(r.region))return false;if(s.kind&&s.kind!==r.kind)return false;if(s.from&&r.departure<s.from||s.to&&r.departure>s.to)return false;
  const n=Number(r.duration);if(s.minDays&&n<Number(s.minDays)||s.maxDays&&n>Number(s.maxDays))return false;
  const f=fare(r,s);if(!f&&(s.cabin||s.minBudget!==''||s.budget!==''))return false;
  if(f){const pair=f.amount*2;if(s.minBudget!==''&&pair<Math.round(Number(s.minBudget)*100))return false;if(s.budget!==''&&pair>Math.round(Number(s.budget)*100))return false;}
  return true;
 }
 root.ORIONFilters={empty,normalise,fromParams,toParams,rangeErrors,matches,fare,choices,date};
})(globalThis);
