const http=require('http'),fs=require('fs'),path=require('path');
const {WebSocketServer}=require('ws');
const PORT=process.env.PORT||3000;
const page=path.join(__dirname,'index.html');
const srv=http.createServer((q,r)=>{
  if(q.url==='/health'){r.end('ok');return}
  fs.readFile(page,(e,d)=>{
    if(e){r.writeHead(500);r.end('error');return}
    r.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});r.end(d);
  });
});
const wss=new WebSocketServer({server:srv,maxPayload:8192});
const rooms=new Map();
const A='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode(){let c;do{c='';for(let i=0;i<4;i++)c+=A[Math.floor(Math.random()*A.length)]}while(rooms.has(c));return c}
const tx=(w,o)=>{if(w&&w.readyState===1)w.send(JSON.stringify(o))};
wss.on('connection',ws=>{
  ws.alive=true;ws.on('pong',()=>{ws.alive=true});
  ws.on('message',raw=>{
    let m;try{m=JSON.parse(raw)}catch{return}
    if(!m||typeof m.t!=='string')return;
    if(m.t==='create'&&!ws.room){
      const c=newCode();rooms.set(c,{host:ws,guest:null});ws.room=c;ws.role='host';tx(ws,{t:'room',code:c});return;
    }
    if(m.t==='join'&&!ws.room){
      const c=String(m.code||'').toUpperCase(),r=rooms.get(c);
      if(!r||r.guest){tx(ws,{t:'err',m:'الغرفة مش موجودة أو ممتلئة'});return}
      r.guest=ws;ws.room=c;ws.role='guest';
      tx(ws,{t:'joined'});tx(r.host,{t:'peer',name:String(m.name||'').slice(0,20)});return;
    }
    const r=rooms.get(ws.room);if(!r)return;
    if(m.t==='start'&&ws.role!=='host')return;
    if(['start','hint','wrong','done','next'].includes(m.t))tx(ws.role==='host'?r.guest:r.host,m);
  });
  ws.on('close',()=>{
    const r=rooms.get(ws.room);if(!r)return;
    tx(ws.role==='host'?r.guest:r.host,{t:'left'});rooms.delete(ws.room);
  });
});
setInterval(()=>wss.clients.forEach(w=>{if(!w.alive)return w.terminate();w.alive=false;w.ping()}),30000);
srv.listen(PORT,()=>console.log('Running on http://localhost:'+PORT));
