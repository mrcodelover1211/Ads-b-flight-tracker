const {app,BrowserWindow,ipcMain}=require("electron");
const path=require("path"),https=require("https"),zlib=require("zlib");
const MAX_RADIUS=250,MAX_BYTES=30*1024*1024,GLOBAL_TTL=15000;
let globalCache={at:0,data:null,busy:null};

function getJSON(url,timeout=15000){
  return new Promise((resolve,reject)=>{
    const req=https.get(url,{headers:{"User-Agent":"ADS-B-Flight-Tracker/2.0","Accept":"application/json,text/plain,*/*","Accept-Encoding":"gzip, deflate, br"}},res=>{
      if(res.statusCode<200||res.statusCode>=300){res.resume();return reject(new Error("HTTP "+res.statusCode))}
      const chunks=[];let size=0;const enc=String(res.headers["content-encoding"]||"").toLowerCase();
      res.on("data",c=>{size+=c.length;if(size>MAX_BYTES){req.destroy(new Error("Response too large"));return}chunks.push(c)});
      res.on("end",()=>{
        try{const raw=Buffer.concat(chunks);let out=raw;
          if(enc.includes("br"))out=zlib.brotliDecompressSync(raw);
          else if(enc.includes("gzip"))out=zlib.gunzipSync(raw);
          else if(enc.includes("deflate"))out=zlib.inflateSync(raw);
          resolve(JSON.parse(out.toString("utf8")));
        }catch(e){reject(new Error("Invalid JSON response"))}
      });
      res.on("error",reject);
    });
    req.on("error",reject);req.setTimeout(timeout,()=>req.destroy(new Error("Request timeout")));
  });
}
function checkBox(q){const lat=Number(q?.lat),lon=Number(q?.lon),dist=Number(q?.dist);
  if(!Number.isFinite(lat)||lat<-90||lat>90||!Number.isFinite(lon)||lon<-180||lon>180||!Number.isFinite(dist)||dist<1||dist>MAX_RADIUS)throw new Error("Invalid map query");
  return {lat,lon,dist};
}
ipcMain.handle("live:local",async(_,q)=>{const v=checkBox(q);return getJSON("https://api.airplanes.live/v2/point/"+v.lat+"/"+v.lon+"/"+v.dist)});
ipcMain.handle("live:global",async()=>{
  const now=Date.now();if(globalCache.data&&now-globalCache.at<GLOBAL_TTL)return globalCache.data;
  if(globalCache.busy)return globalCache.busy;
  globalCache.busy=getJSON("https://opensky-network.org/api/states/all",25000).then(d=>{
    globalCache.data=d;globalCache.at=Date.now();return d;
  }).finally(()=>{globalCache.busy=null});return globalCache.busy;
});
ipcMain.handle("history:track",async(_,q)=>{
  const hex=String(q?.hex||"").trim().toLowerCase(),date=String(q?.date||"").trim();
  if(!/^[0-9a-f]{6}$/.test(hex)||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date))throw new Error("Invalid replay request");
  const [y,m,d]=date.split("-");const url="https://globe.airplanes.live/globe_history/"+y+"/"+m+"/"+d+"/traces/"+hex.slice(-2)+"/trace_full_"+hex+".json";
  return getJSON(url,20000);
});
ipcMain.handle("route:lookup",async(_,c)=>{const v=String(c||"").trim();if(!v||v.length>32)return null;try{return await getJSON("https://api.adsbdb.com/v0/callsign/"+encodeURIComponent(v))}catch{return null}});
ipcMain.handle("aircraft:lookup",async(_,q)=>{const id=String(q?.id||"").trim(),callsign=String(q?.callsign||"").trim();if(!id||id.length>32||callsign.length>32)return null;try{let u="https://api.adsbdb.com/v0/aircraft/"+encodeURIComponent(id);if(callsign)u+="?callsign="+encodeURIComponent(callsign);return await getJSON(u)}catch{return null}});
function createWindow(){const w=new BrowserWindow({width:1500,height:900,minWidth:1050,minHeight:650,show:false,backgroundColor:"#07111d",webPreferences:{preload:path.join(__dirname,"preload.cjs"),contextIsolation:true,nodeIntegration:false,sandbox:true}});w.once("ready-to-show",()=>w.show());w.webContents.on("render-process-gone",(_,d)=>console.error("Renderer exited:",d.reason));w.loadFile(path.join(__dirname,"..","index.html"))}
app.whenReady().then(()=>{createWindow();app.on("activate",()=>{if(BrowserWindow.getAllWindows().length===0)createWindow()})});
app.on("window-all-closed",()=>{if(process.platform!=="darwin")app.quit()});