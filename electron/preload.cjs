const {contextBridge,ipcRenderer}=require("electron");
contextBridge.exposeInMainWorld("desktopAPI",{
 local:q=>ipcRenderer.invoke("live:local",q),
 global:()=>ipcRenderer.invoke("live:global"),
 history:(hex,date)=>ipcRenderer.invoke("history:track",{hex,date}),
 route:c=>ipcRenderer.invoke("route:lookup",c),
 aircraft:(id,callsign)=>ipcRenderer.invoke("aircraft:lookup",{id,callsign})
});