// خمّن اللاعب — المالك الرئيسي: سامح حماده
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {WebSocketServer}=require('ws');
const PORT=process.env.PORT||3000;
const WELCOME=process.env.WELCOME_POINTS!==undefined?(+process.env.WELCOME_POINTS||0):10;
let ADMIN_KEY=process.env.ADMIN_KEY;
if(!ADMIN_KEY){ADMIN_KEY=crypto.randomBytes(6).toString('hex');console.log('ADMIN_KEY غير مضبوط — مفتاح مؤقت: '+ADMIN_KEY)}
const DBF=path.join(process.env.DATA_DIR||__dirname,'data.json');
const MATCHES=JSON.parse(fs.readFileSync(path.join(__dirname,'matches.json'),'utf8'));
let db={users:{},tx:[]},dirty=false;
try{db=JSON.parse(fs.readFileSync(DBF,'utf8'))}catch(e){}
const save=()=>{dirty=true};
function flush(){if(!dirty)return;dirty=false;try{fs.writeFileSync(DBF+'.tmp',JSON.stringify(db));fs.renameSync(DBF+'.tmp',DBF)}catch(e){console.error('save failed:',e.message)}}
setInterval(flush,2000);['SIGTERM','SIGINT'].forEach(s=>process.on(s,()=>{flush();process.exit(0)}));
const sha=s=>crypto.createHash('sha256').update(String(s)).digest();
const J=(r,c,o)=>{r.writeHead(c,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});r.end(JSON.stringify(o))};
const rl=new Map();
function hit(k,max){const n=Date.now(),e=rl.get(k);if(!e||e.r<n){rl.set(k,{c:1,r:n+36e5});return false}return ++e.c>max}
setInterval(()=>{const n=Date.now();rl.forEach((v,k)=>{if(v.r<n)rl.delete(k)})},6e5);
function isAdmin(q,ip){const e=rl.get('a'+ip);if(e&&e.r>Date.now()&&e.c>20)return false;const ok=crypto.timingSafeEqual(sha(q.headers['x-admin-key']||''),sha(ADMIN_KEY));if(!ok)hit('a'+ip,20);return ok}
function log(id,a,w,b){db.tx.push({t:Date.now(),id,a,w,b});if(db.tx.length>5000)db.tx.splice(0,db.tx.length-5000);save()}
function auth(o){const u=db.users[String(o.id||'')];return u&&crypto.timingSafeEqual(sha(o.key||''),Buffer.from(u.kh,'hex'))?u:null}
function body(q,cb){let d='';q.on('data',c=>{d+=c;if(d.length>4096)q.destroy()});q.on('end',()=>{let o={};try{o=JSON.parse(d||'{}')}catch(e){}cb(o&&typeof o==='object'?o:{})})}
function newId(){let i;do{i='P-'+Math.floor(10000+Math.random()*90000)}while(db.users[i]);return i}
const FILES={'/':['index.html','text/html; charset=utf-8'],'/index.html':['index.html','text/html; charset=utf-8'],'/admin':['admin.html','text/html; charset=utf-8'],'/manifest.json':['manifest.json','application/manifest+json'],'/sw.js':['sw.js','application/javascript'],'/icon-192.png':['icon-192.png','image/png'],'/icon-512.png':['icon-512.png','image/png']};
const srv=http.createServer((q,r)=>{
  const u=q.url.split('?')[0],ip=(q.headers['x-forwarded-for']||q.socket.remoteAddress||'').split(',')[0].trim();
  if(u==='/health'){r.end('ok');return}
  if(u==='/api/matches'&&q.method==='GET')return J(r,200,MATCHES.map(m=>({id:m.id,comp:m.comp,year:m.year,home:m.home,away:m.away,hs:m.hs,as:m.as,cost:m.cost})));
  if(u==='/api/admin/data'&&q.method==='GET'){
    if(!isAdmin(q,ip))return J(r,401,{ok:false,err:'auth'});
    const us=Object.keys(db.users).map(k=>({id:k,name:db.users[k].name||'',points:db.users[k].points,t:db.users[k].t}));us.sort((a,b)=>b.t-a.t);
    return J(r,200,{ok:true,users:us.slice(0,200),tx:db.tx.slice(-50).reverse()});
  }
  if(u.startsWith('/api/')&&q.method==='POST')return body(q,o=>{
    if(u==='/api/register'){
      if(hit('r'+ip,60))return J(r,429,{ok:false,err:'limit'});
      const id=newId(),key=crypto.randomBytes(16).toString('hex');
      db.users[id]={kh:sha(key).toString('hex'),name:'',points:WELCOME,t:Date.now()};
      if(WELCOME)log(id,WELCOME,'welcome',WELCOME);save();return J(r,200,{ok:true,id,key,points:WELCOME});
    }
    if(u==='/api/me'){const x=auth(o);return J(r,200,x?{ok:true,points:x.points}:{ok:false,err:'nouser'})}
    if(u==='/api/play'){
      const x=auth(o);if(!x)return J(r,200,{ok:false,err:'nouser'});
      const m=MATCHES.find(z=>z.id===o.match);if(!m)return J(r,200,{ok:false,err:'nomatch'});
      if(x.points<m.cost)return J(r,200,{ok:false,err:'funds',points:x.points});
      x.points-=m.cost;if(typeof o.name==='string')x.name=o.name.slice(0,20);
      log(o.id,-m.cost,'match:'+m.id,x.points);return J(r,200,{ok:true,points:x.points,match:m});
    }
    if(u==='/api/admin/topup'){
      if(!isAdmin(q,ip))return J(r,401,{ok:false,err:'auth'});
      const id=String(o.id||'').trim().toUpperCase(),x=db.users[id],a=+o.amount;
      if(!x)return J(r,200,{ok:false,err:'nouser'});
      if(!Number.isInteger(a)||!a||Math.abs(a)>1e5)return J(r,200,{ok:false,err:'amount'});
      if(x.points+a<0)return J(r,200,{ok:false,err:'neg'});
      x.points+=a;log(id,a,'admin:'+String(o.note||'').slice(0,40),x.points);
      return J(r,200,{ok:true,id,name:x.name,points:x.points});
    }
    return J(r,404,{ok:false});
  });
  if(/^\/[a-z-]+\.mp3$/.test(u)){return fs.readFile(path.join(__dirname,u),(e,d)=>{if(e){r.writeHead(404);r.end();return}r.writeHead(200,{'Content-Type':'audio/mpeg','Cache-Control':'public, max-age=86400'});r.end(d)})}
  const f=FILES[u]||FILES['/'];
  fs.readFile(path.join(__dirname,f[0]),(e,d)=>{
    if(e){r.writeHead(500);r.end('error');return}
    r.writeHead(200,{'Content-Type':f[1],'Cache-Control':f[0]==='sw.js'||f[0]==='admin.html'?'no-cache':'public, max-age=300'});r.end(d);
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
    if(['start','hint','wrong','done','next','qa'].includes(m.t))tx(ws.role==='host'?r.guest:r.host,m);
  });
  ws.on('close',()=>{
    const r=rooms.get(ws.room);if(!r)return;
    tx(ws.role==='host'?r.guest:r.host,{t:'left'});rooms.delete(ws.room);
  });
});
setInterval(()=>wss.clients.forEach(w=>{if(!w.alive)return w.terminate();w.alive=false;w.ping()}),30000);
srv.listen(PORT,()=>console.log('Running on http://localhost:'+PORT));
