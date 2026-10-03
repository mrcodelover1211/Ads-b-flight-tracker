const map=L.map("map",{zoomControl:false,preferCanvas:true}).setView([36.8065,10.1815],5);
L.control.zoom({position:"bottomright"}).addTo(map);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:18,attribution:"© OpenStreetMap contributors"}).addTo(map);

const S={planes:new Map(),markers:new Map(),trails:new Map(),history:new Map(),airports:[],loaded:false,selected:null,replay:null,replayMarker:null,request:0,busy:false};
const $=id=>document.getElementById(id),desktop=window.desktopAPI;
const esc=x=>String(x??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const alt=v=>v==null||!Number.isFinite(Number(v))?"-":Math.round(Number(v)).toLocaleString()+" ft";
const spd=v=>v==null||!Number.isFinite(Number(v))?"-":Math.round(Number(v))+" kt";
const num=(v,min,max)=>Number.isFinite(Number(v))&&Number(v)>=min&&Number(v)<=max?Number(v):null;

function norm(a){
  const lat=Number(a.lat),lon=Number(a.lon);
  return {hex:String(a.hex||a.icao||"").trim().toUpperCase(),callsign:String(a.flight||a.callsign||"").trim(),
    reg:String(a.r||a.registration||"").trim(),type:String(a.t||a.type||a.icao_type||"").trim(),
    lat,lon,alt:a.alt_baro??a.alt_geom??a.altitude,gs:a.gs??a.speed,track:a.track??a.heading,
    vr:a.baro_rate??a.vert_rate,squawk:String(a.squawk||"").trim()};
}
function ico(p){const heading=Number.isFinite(Number(p.track))?Number(p.track):0;
  const svg="<svg viewBox='0 0 24 24' width='24' height='24' aria-hidden='true'><path d='M12 1 15 9l6 3v2l-6-1v8l3 2v1H6v-1l3-2v-8l-6 1v-2l6-3z'/></svg>";
  return L.divIcon({className:"planeMarker",html:"<div class='planeIcon' style='transform:rotate("+heading+"deg)'>"+svg+"</div>",iconSize:[24,24],iconAnchor:[12,12]});
}
function validQuery(){
  const lat=num($("lat").value,-90,90),lon=num($("lon").value,-180,180),dist=num($("dist").value,1,250);
  if(lat===null||lon===null||dist===null)throw Error("Enter a valid latitude, longitude and radius (1–250 NM).");
  return {lat,lon,dist};
}
async function live(){
  if(S.busy)return;
  let q;try{q=validQuery()}catch(e){setStatus(e.message,false);return}
  const request=++S.request;S.busy=true;$("refresh").disabled=true;$("status").textContent="Updating…";
  try{
    let d;
    if(desktop)d=await desktop.nearby(q);
    else{const r=await fetch("https://api.adsb.lol/v2/lat/"+q.lat+"/lon/"+q.lon+"/dist/"+q.dist,{cache:"no-store"});if(!r.ok)throw Error("ADS-B service returned HTTP "+r.status);d=await r.json()}
    if(request!==S.request)return;
    render(Array.isArray(d.aircraft)?d.aircraft.map(norm).filter(p=>p.hex&&Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&Math.abs(p.lat)<=90&&Math.abs(p.lon)<=180):[]);
    setStatus("LIVE · "+new Date().toLocaleTimeString(),true);
  }catch(e){if(request===S.request)setStatus("Data error: "+(e.message||"unknown error"),false)}
  finally{if(request===S.request){S.busy=false;$("refresh").disabled=false}}
}
function setStatus(text,ok){$("status").textContent=text;$("statusDot").style.background=ok?"#43d98c":"#e65f67"}
function render(ps){
  const seen=new Set();
  ps.forEach(p=>{
    seen.add(p.hex);S.planes.set(p.hex,p);
    let m=S.markers.get(p.hex);
    if(!m){m=L.marker([p.lat,p.lon],{icon:ico(p)}).addTo(map);m.on("click",()=>details(p.hex));S.markers.set(p.hex,m)}
    else{m.setLatLng([p.lat,p.lon]);m.setIcon(ico(p))}
    const previous=S.history.get(p.hex)||[],last=previous[previous.length-1];
    const moved=!last||Math.abs(last.lat-p.lat)>0.00001||Math.abs(last.lon-p.lon)>0.00001||last.alt!==p.alt;
    if(moved){previous.push({t:Date.now(),lat:p.lat,lon:p.lon,alt:p.alt});if(previous.length>300)previous.shift();S.history.set(p.hex,previous)}
    if(previous.length>1){let line=S.trails.get(p.hex);if(!line){line=L.polyline(previous.map(x=>[x.lat,x.lon]),{color:"#42a5ff",weight:2,opacity:.45}).addTo(map);S.trails.set(p.hex,line)}else line.setLatLngs(previous.map(x=>[x.lat,x.lon]))}
  });
  S.markers.forEach((m,h)=>{if(!seen.has(h)){map.removeLayer(m);S.markers.delete(h);S.planes.delete(h);const line=S.trails.get(h);if(line){map.removeLayer(line);S.trails.delete(h)}}});
  list();$("count").textContent=ps.length+" aircraft";
}
function list(){
  const q=$("search").value.trim().toLowerCase();
  const a=[...S.planes.values()].filter(p=>(p.callsign+" "+p.reg+" "+p.type+" "+p.hex).toLowerCase().includes(q))
    .sort((x,y)=>(Number(y.alt)||0)-(Number(x.alt)||0));
  $("list").innerHTML=a.map(p=>"<div class='card' data-hex='"+esc(p.hex)+"'><div class='row'><b>"+esc(p.callsign||p.reg||p.hex)+"</b><span class='pill'>"+esc(p.type||"-")+"</span></div><div class='row muted'><span>"+esc(p.reg||p.hex)+"</span><span>"+alt(p.alt)+" · "+spd(p.gs)+"</span></div></div>").join("")||"<div class='card muted'>No aircraft match.</div>";
  document.querySelectorAll(".card[data-hex]").forEach(e=>e.onclick=()=>details(e.dataset.hex));
}
async function details(hex){
  const p=S.planes.get(hex);if(!p)return;S.selected=hex;$("details").classList.remove("hidden");
  $("detailContent").innerHTML="<h2>"+esc(p.callsign||"Unknown flight")+"</h2><div class='muted'>"+esc(p.reg)+" · "+esc(p.type||"Unknown type")+" · "+esc(p.hex)+"</div><div id='photoBox'></div><div class='route' id='routeBox'><span>Route</span><strong>Loading…</strong></div><div class='detailGrid'><div class='stat'><small>Altitude</small><b>"+alt(p.alt)+"</b></div><div class='stat'><small>Ground speed</small><b>"+spd(p.gs)+"</b></div><div class='stat'><small>Track</small><b>"+(Number.isFinite(Number(p.track))?Math.round(Number(p.track)):"-")+"°</b></div><div class='stat'><small>Vertical rate</small><b>"+(p.vr??"-")+" fpm</b></div><div class='stat'><small>Squawk</small><b>"+esc(p.squawk||"-")+"</b></div><div class='stat'><small>Position</small><b>"+p.lat.toFixed(4)+", "+p.lon.toFixed(4)+"</b></div></div><p class='muted'>Session track points: "+(S.history.get(hex)||[]).length+"</p>";
  try{
    const key=encodeURIComponent(p.hex||p.reg);
    const d=desktop?await desktop.aircraft(p.hex||p.reg):await fetch("https://api.adsbdb.com/v0/aircraft/"+key+"?callsign="+encodeURIComponent(p.callsign||"")).then(r=>r.ok?r.json():null);
    if(S.selected!==hex)return;
    const ac=d?.response?.aircraft;
    if(ac?.url_photo_thumbnail){const src=ac.url_photo||ac.url_photo_thumbnail;$("photoBox").innerHTML="<img class='hero' src='"+esc(src)+"' alt='Aircraft photo' referrerpolicy='no-referrer'><div class='muted'>Photo: Planespotters.net</div>"}
    if(S.selected!==hex)return;
    const rt=d?.response?.flightroute;
    const box=$("routeBox");
    if(!box)return;
    if(rt)box.innerHTML="<span>"+esc(rt.origin?.iata_code||rt.origin?.icao_code||"?")+"</span><strong>→</strong><span>"+esc(rt.destination?.iata_code||rt.destination?.icao_code||"?")+"</span>";
    else box.innerHTML="<span>"+(p.callsign?"Route unavailable":"No callsign")+"</span>";
  }catch{
    const box=$("routeBox");
    if(box)box.innerHTML="<span>Metadata unavailable</span>";
  }
}
async function airports(){
  if(S.loaded)return;
  try{const r=await fetch("https://davidmegginson.github.io/ourairports-data/airports.csv",{cache:"no-store"});if(!r.ok)throw Error("HTTP "+r.status);S.airports=parseCSV(await r.text());S.loaded=true}
  catch{$("airportResults").innerHTML="<div class='airportResult'>Airport database unavailable.</div>"}
}
function parseCSV(t){
  const lines=t.split(/\r?\n/);if(!lines.length)return[];const h=lines[0].split(",").map(x=>x.replace(/^"|"$/g,""));
  return lines.slice(1).map(line=>{let v=[],c="",q=false;for(let i=0;i<line.length;i++){const x=line[i];if(x==='"'){if(q&&line[i+1]==='"'){c+='"';i++}else q=!q}else if(x===","&&!q){v.push(c);c=""}else c+=x}v.push(c);const o={};h.forEach((k,i)=>o[k]=v[i]||"");return o})
    .filter(x=>x.ident&&Number.isFinite(Number(x.latitude_deg))&&Number.isFinite(Number(x.longitude_deg)));
}
function airportResults(){
  const q=$("airportSearch").value.trim().toLowerCase();if(!q){$("airportResults").innerHTML="";return}
  const a=S.airports.filter(x=>(x.ident+" "+x.iata_code+" "+x.name+" "+x.municipality).toLowerCase().includes(q)).slice(0,30);
  $("airportResults").innerHTML=a.map(x=>"<div class='airportResult' data-lat='"+esc(x.latitude_deg)+"' data-lon='"+esc(x.longitude_deg)+"'><b>"+esc(x.ident)+"</b> · "+esc(x.iata_code||"-")+"<br><span class='muted'>"+esc(x.name)+" · "+esc(x.municipality||"")+"</span></div>").join("")||"<div class='airportResult'>No airports found.</div>";
  document.querySelectorAll(".airportResult[data-lat]").forEach(e=>e.onclick=()=>selectAirport(e.dataset.lat,e.dataset.lon));
}
function selectAirport(lat,lon){$("lat").value=Number(lat).toFixed(4);$("lon").value=Number(lon).toFixed(4);map.setView([lat,lon],9);live()}
function replay(){
  const h=S.history.get(S.selected)||[];if(h.length<2){alert("Select an aircraft and let the tracker collect a few points first.");return}
  S.replay=h.slice();$("replay").classList.remove("hidden");$("replaySlider").max=h.length-1;$("replaySlider").value=0;drawReplay();
}
function drawReplay(){const x=S.replay?.[Number($("replaySlider").value)];if(!x)return;map.setView([x.lat,x.lon],map.getZoom());$("replayTime").textContent=new Date(x.t).toLocaleTimeString()+" · "+alt(x.alt);if(S.replayMarker)S.replayMarker.setLatLng([x.lat,x.lon]);else S.replayMarker=L.marker([x.lat,x.lon],{icon:ico({track:0})}).addTo(map)}
$("refresh").onclick=live;$("search").oninput=list;$("closeDetails").onclick=()=>{$("details").classList.add("hidden");S.selected=null};$("replayBtn").onclick=replay;$("replaySlider").oninput=drawReplay;
$("clearReplay").onclick=()=>{$("replay").classList.add("hidden");S.replay=null;if(S.replayMarker){map.removeLayer(S.replayMarker);S.replayMarker=null}};
$("airportsBtn").onclick=async()=>{$("airportPanel").classList.toggle("hidden");if(!$("airportPanel").classList.contains("hidden")){await airports();$("airportSearch").focus()}};
$("airportSearch").oninput=airportResults;
$("locBtn").onclick=()=>navigator.geolocation?.getCurrentPosition(p=>{$("lat").value=p.coords.latitude.toFixed(4);$("lon").value=p.coords.longitude.toFixed(4);map.setView([p.coords.latitude,p.coords.longitude],7);live()},()=>setStatus("Location permission unavailable",false));
setInterval(()=>{if(!S.busy)live()},15000);
window.addEventListener("error",e=>setStatus("UI error: "+e.message,false));
window.addEventListener("unhandledrejection",e=>setStatus("Background error",false));
live();