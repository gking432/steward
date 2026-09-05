/** Conservative per-process backstop. Multi-instance spend control belongs in
 * the deployment gateway; paid public generation is disabled by default. */
const counters = new Map<string,{window:number;count:number}>();
export function requestAllowed(key: string, now=Date.now()) {
  const minute = Math.floor(now / 60000);
  const entry = counters.get(key);
  if (!entry || entry.window !== minute) { if(counters.size>10000)counters.clear(); counters.set(key,{window:minute,count:1});return true; }
  return ++entry.count <= 20;
}
export async function boundedJson(request: Request, maxBytes: number) {
  const reader=request.body?.getReader(); if(!reader) return null;
  let size=0; const chunks:Uint8Array[]=[];
  while(true) {const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw new Error('Request too large');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
let active=0, daily=0, day='';
/** Hard per-process call/token ceilings; default disabled until an operator
 * supplies a shared gateway budget for multi-instance deployments. */
export function acquireGeneration(enabled: boolean, now=new Date()) {
  if(!enabled)return null;
  const today=now.toISOString().slice(0,10);if(day!==today){day=today;daily=0;}
  if(active>=2 || daily>=50)return null;
  active++;daily++;let released=false;
  return ()=>{if(!released){active--;released=true;}};
}
