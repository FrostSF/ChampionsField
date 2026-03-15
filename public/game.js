// ═══════════════════════════════════════════════════════════════
//  ROCKET HAX — GAME.JS  (Renderer + input, P2P version)
//  Works for both HOST and CLIENT.
//  State arrives via onStateUpdate() callback.
//  Input is sent via either hostSetInput() or clientSendInput().
// ═══════════════════════════════════════════════════════════════

const canvas=document.getElementById("game")
const ctx=canvas.getContext("2d")

const W=1600,H=820
const WALL_T=55,WALL_B=H-55,WALL_L=55,WALL_R=W-55
const GOAL_W=40,GOAL_H=200,GOAL_CY=H/2
const GOAL_L={x:WALL_L-GOAL_W,y:GOAL_CY-GOAL_H/2,w:GOAL_W,h:GOAL_H}
const GOAL_R={x:WALL_R,       y:GOAL_CY-GOAL_H/2,w:GOAL_W,h:GOAL_H}
const BALL_R=24,CAR_R=22

// Physics — for client-side prediction only (mirrors host.js exactly)
const ACCEL=900,FRICTION=0.88,MAX_SPD=580
const BOOST_ACCEL=1400,BOOST_MAX=860,BOOST_DRAIN=38,BOOST_REGEN=0  // no auto-regen
const DASH_SPEED=MAX_SPD*1.3,DASH_DUR=0.16,DASH_CD=1.0

// ─── RENDER STATE ────────────────────────────────────────────────
let myId=null
let isHost=false
let ball={x:W/2,y:H/2,spin:0},ballAngle=0
let scores={blue:0,orange:0},matchTime=300,padAng=0
let gamePhase="playing",kickoffTimer=0
let settings={blueTeamName:"BLUE",orangeTeamName:"ORANGE",blueColor:"#00aaff",orangeColor:"#ff6600",seriesTitle:"FRIENDLY MATCH",gameNum:1,bestOf:7}
const particles=[]
let dimAlpha=0

const PADS_POS=[
    {x:180,y:180,type:"big"},{x:W-180,y:180,type:"big"},
    {x:180,y:H-180,type:"big"},{x:W-180,y:H-180,type:"big"},{x:W/2,y:H/2,type:"big"},
    {x:W/2,y:160,type:"small"},{x:W/2,y:H-160,type:"small"},
    {x:160,y:H/2,type:"small"},{x:W-160,y:H/2,type:"small"},
    {x:W*.3,y:H*.3,type:"small"},{x:W*.7,y:H*.3,type:"small"},
    {x:W*.3,y:H*.7,type:"small"},{x:W*.7,y:H*.7,type:"small"},
]
const boostPads=PADS_POS.map(p=>({...p,active:true}))

// ─── IMAGE CACHE ─────────────────────────────────────────────────
const imgCache={}
function loadImg(src){
    if(!src)return null; if(imgCache[src])return imgCache[src]
    const img=new Image();img.src=src;imgCache[src]=img;return img
}
for(let i=1;i<=10;i++)loadImg(`assets/decals/decal${i}.png`)
for(let i=11;i<=15;i++)loadImg(`assets/decals/decal${i}.gif`)
for(let i=1;i<=10;i++)loadImg(`assets/boost/boost${i}.png`)

// ─── PLAYER MAP ──────────────────────────────────────────────────
const playerMap={}
function getPlayers(){return Object.values(playerMap)}
function ensurePlayer(id,def={}){
    if(!playerMap[id]){
        const team=def.team||"blue"
        playerMap[id]={
            id,team,
            name:def.name||"…",title:def.title||"",titleColor:def.titleColor||"#aaa",
            pfp:def.pfp||"assets/default_pfp.png",banner:def.banner||"assets/banners/Default.png",
            decal:def.decal||null,boostTrail:def.boostTrail||null,
            x:def.x??(team==="blue"?WALL_L+160:WALL_R-160),y:def.y??(H/2),
            vx:0,vy:0,boost:33,dashing:false,dashTimer:0,dashCd:0,isBoosting:false,
            rx:def.x??(team==="blue"?WALL_L+160:WALL_R-160),ry:def.y??(H/2),
            trailPts:[]
        }
    }
    return playerMap[id]
}

// ─── LOCAL PREDICTION (client-side) ──────────────────────────────
const local={ready:false,x:0,y:0,vx:0,vy:0,boost:33,
             dashing:false,dashTimer:0,dashCd:0,dashVx:0,dashVy:0}

function physicsStep(s,inp,dt){
    const boosting=inp.shift&&s.boost>0
    if(boosting)s.boost=Math.max(0,  s.boost-BOOST_DRAIN*dt)
    else         s.boost=Math.min(100,s.boost+BOOST_REGEN*dt)
    if(s.dashCd>0)s.dashCd-=dt
    if(inp.dash&&!s.dashing&&s.dashCd<=0){
        let dx=(inp.d?1:0)-(inp.a?1:0),dy=(inp.s?1:0)-(inp.w?1:0)
        if(Math.hypot(dx,dy)<0.1){dx=s.vx;dy=s.vy}
        const dl=Math.hypot(dx,dy)||1
        s.dashVx=(dx/dl)*DASH_SPEED;s.dashVy=(dy/dl)*DASH_SPEED
        s.dashing=true;s.dashTimer=DASH_DUR;s.dashCd=DASH_CD
    }
    if(s.dashing){
        const t=s.dashTimer/DASH_DUR
        s.vx=s.dashVx*t;s.vy=s.dashVy*t
        s.dashTimer-=dt;if(s.dashTimer<=0)s.dashing=false
    } else {
        if(inp.w)s.vy-=ACCEL*dt;if(inp.s)s.vy+=ACCEL*dt
        if(inp.a)s.vx-=ACCEL*dt;if(inp.d)s.vx+=ACCEL*dt
        if(boosting){
            const mx=(inp.d?1:0)-(inp.a?1:0),my=(inp.s?1:0)-(inp.w?1:0),ml=Math.hypot(mx,my)||1
            if(ml>0.1){s.vx+=(mx/ml)*BOOST_ACCEL*dt;s.vy+=(my/ml)*BOOST_ACCEL*dt}
        }
        s.vx*=Math.pow(FRICTION,dt*60);s.vy*=Math.pow(FRICTION,dt*60)
        const maxS=boosting?BOOST_MAX:MAX_SPD,spd=Math.hypot(s.vx,s.vy)
        if(spd>maxS){s.vx=s.vx/spd*maxS;s.vy=s.vy/spd*maxS}
    }
    s.x+=s.vx*dt;s.y+=s.vy*dt
    if(s.x-CAR_R<WALL_L){s.x=WALL_L+CAR_R;s.vx=Math.abs(s.vx)*0.4}
    if(s.x+CAR_R>WALL_R){s.x=WALL_R-CAR_R;s.vx=-Math.abs(s.vx)*0.4}
    if(s.y-CAR_R<WALL_T){s.y=WALL_T+CAR_R;s.vy=Math.abs(s.vy)*0.4}
    if(s.y+CAR_R>WALL_B){s.y=WALL_B-CAR_R;s.vy=-Math.abs(s.vy)*0.4}
}

function reconcile(srv){
    // Always snap to authoritative server position, then predict ahead
    // with unacknowledged inputs. Simple and correct.
    local.x        = srv.x
    local.y        = srv.y
    local.vx       = srv.vx||0
    local.vy       = srv.vy||0
    local.boost    = srv.boost
    local.dashing  = srv.dashing||false
    local.dashTimer= srv.dashTimer||0
    local.dashCd   = srv.dashCd||0
    local.ready    = true

    // Re-simulate inputs the server hasn't acknowledged yet
    const buf = window._inputBuf || []
    buf.filter(e=>e.seq>(srv.seq||0)).forEach(e=>physicsStep(local,e.inp,e.dt))
}

// ─── STATE CALLBACK — called by host.js OR client.js ─────────────
// Declared as var so game.html bootstrap can patch them
var onStateUpdate = function(data){
    const srv=data.players.find(p=>p.id===myId)
    if(srv) reconcile(srv)

    data.players.forEach(sp=>{
        const p=ensurePlayer(sp.id,{team:sp.team})
        p.x=sp.x;p.y=sp.y;p.vx=sp.vx||0;p.vy=sp.vy||0
        p.boost=sp.boost;p.dashing=sp.dashing;p.isBoosting=sp.isBoosting;p.dashCd=sp.dashCd||0
        if(sp.decal!==undefined)p.decal=sp.decal
        if(sp.boostTrail!==undefined)p.boostTrail=sp.boostTrail
    })
    const live=new Set(data.players.map(p=>p.id))
    Object.keys(playerMap).forEach(id=>{if(!live.has(id))delete playerMap[id]})
    ball=data.ball; scores=data.scores; matchTime=data.matchTime
    gamePhase=data.phase||"playing"; kickoffTimer=data.kickoffTimer||0
    if(data.settings)settings=data.settings
    if(data.pads)data.pads.forEach((sp,i)=>boostPads[i]&&(boostPads[i].active=sp.active))
    updateHUD()
}

// Called by host.js when init packet arrives
var onGameInit = function(data){
    myId=data.myId
    data.players.forEach(sp=>{
        const p=ensurePlayer(sp.id,sp)
        p.name=sp.name;p.title=sp.title;p.titleColor=sp.titleColor
        p.pfp=sp.pfp;p.banner=sp.banner;p.team=sp.team
        p.decal=sp.decal||null;p.boostTrail=sp.boostTrail||null
    })
    if(data.settings)settings=data.settings
    updateSidePanels(Object.values(playerMap))
}

// ─── GAME EVENT CALLBACK ─────────────────────────────────────────
var onGameEvent = function(evt){
    if(evt.settings)settings=evt.settings
    switch(evt.type){
        case "goal":
            scores=evt.scores; local.ready=false; dimAlpha=1
            showGoalBanner(evt.scorer); spawnGoalExplosion(evt.scorer); updateHUD()
            break
        case "kickoff":
            scores=evt.scores; dimAlpha=0
            document.getElementById("goalBanner").classList.remove("show"); updateHUD()
            break
        case "gameOver":
            scores=evt.scores; showGameOver(evt.scores)
            break
        case "hostDisconnected":
            document.getElementById("goalWord").textContent="HOST DESCONECTADO"
            document.getElementById("goalWord").style.color="#ff4444"
            document.getElementById("goalSub").textContent="La sala se cerró"
            document.getElementById("goalBanner").classList.add("show")
            break
    }
}

// ─── INPUT ───────────────────────────────────────────────────────
const keys={}
document.addEventListener("keydown",e=>{
    const k=e.key==="Shift"?"shift":e.code==="Space"?"dash":e.key.toLowerCase()
    keys[k]=true; if(e.code==="Space")e.preventDefault()
})
document.addEventListener("keyup",e=>{
    const k=e.key==="Shift"?"shift":e.code==="Space"?"dash":e.key.toLowerCase()
    keys[k]=false
})
function getInput(){
    return{
        w:    !!(keys.w    || keys._mw),
        a:    !!(keys.a    || keys._ma),
        s:    !!(keys.s    || keys._ms),
        d:    !!(keys.d    || keys._md),
        shift:!!(keys.shift|| keys._mshift),
        dash: !!(keys.dash || keys._mdash)
    }
}

// Input loop is handled by game.html bootstrap (socket.emit "input")
// game.js only needs getInput() for local prediction in the render loop

// ─── HUD ─────────────────────────────────────────────────────────
function updateHUD(){
    const bc=settings.blueColor||"#00aaff",oc=settings.orangeColor||"#ff6600"
    const el=id=>document.getElementById(id)
    if(el("sb-blue-name"))  el("sb-blue-name").textContent=settings.blueTeamName||"BLUE"
    if(el("sb-orange-name"))el("sb-orange-name").textContent=settings.orangeTeamName||"ORANGE"
    if(el("sb-blue-score")) el("sb-blue-score").textContent=scores.blue||0
    if(el("sb-orange-score"))el("sb-orange-score").textContent=scores.orange||0
    if(el("sb-blue-block")) el("sb-blue-block").style.background=bc
    if(el("sb-orange-block"))el("sb-orange-block").style.background=oc
    if(el("sb-series-title"))el("sb-series-title").textContent=settings.seriesTitle||"FRIENDLY"
    if(el("sb-game-num"))   el("sb-game-num").textContent="GAME "+(settings.gameNum||1)
    if(el("sb-best-of"))    el("sb-best-of").textContent="BEST OF "+(settings.bestOf||7)
    const m=Math.floor(matchTime/60),s=Math.floor(matchTime%60)
    const te=el("hud-timer"); if(te){
        te.textContent=`${m}:${s.toString().padStart(2,"0")}`
        const low=matchTime>0&&matchTime<=10
        te.style.color=low?"#ff3333":"#fff";te.style.fontSize=low?"34px":"28px"
        te.style.textShadow=low?"0 0 20px #ff333388":"none"
    }
    const ke=el("kickoff-countdown"); if(ke){
        if(gamePhase==="kickoffCountdown"&&kickoffTimer>0){ke.textContent=kickoffTimer;ke.style.display="block"}
        else ke.style.display="none"
    }
    const me=playerMap[myId]; if(me){
        const b=Math.round(local.ready?local.boost:me.boost)
        const bv=el("boost-circle-val");if(bv)bv.textContent=b
        drawBoostCircle(b,me.team==="blue"?bc:oc)
    }
}
function drawBoostCircle(pct,color){
    const bc=document.getElementById("boost-canvas");if(!bc)return
    const c=bc.getContext("2d"),sz=bc.width,cx=sz/2,cy=sz/2,r=sz/2-6
    c.clearRect(0,0,sz,sz)
    c.beginPath();c.arc(cx,cy,r,0,Math.PI*2);c.strokeStyle="rgba(255,255,255,0.1)";c.lineWidth=8;c.stroke()
    const start=-Math.PI/2,end=start+Math.PI*2*(pct/100)
    c.beginPath();c.arc(cx,cy,r,start,end);c.strokeStyle=color;c.lineWidth=8
    c.shadowColor=color;c.shadowBlur=12;c.stroke();c.shadowBlur=0
}
function showGoalBanner(team){
    const color=team==="blue"?(settings.blueColor||"#00aaff"):(settings.orangeColor||"#ff6600")
    const name=team==="blue"?(settings.blueTeamName||"BLUE"):(settings.orangeTeamName||"ORANGE")
    document.getElementById("goalWord").style.color=color
    document.getElementById("goalWord").style.textShadow=`0 0 60px ${color}88`
    document.getElementById("goalWord").textContent="¡GOL!"
    document.getElementById("goalSub").textContent=name+" ANOTA"
    document.getElementById("goalBanner").classList.add("show")
}
function showGameOver(sc){
    const bn=settings.blueTeamName||"BLUE",on=settings.orangeTeamName||"ORANGE"
    const w=sc.blue>sc.orange?bn:sc.orange>sc.blue?on:"EMPATE"
    const gw=document.getElementById("goalWord")
    const gs=document.getElementById("goalSub")
    gw.textContent=w+" GANA"
    gw.style.color="#ffd700"
    gw.style.textShadow="0 0 60px #ffd70088"
    gs.textContent=`${sc.blue} — ${sc.orange}  ·  Volviendo al lobby...`
    document.getElementById("goalBanner").classList.add("show")
    // Return to lobby after 5s so players can choose teams and restart
    setTimeout(()=>{
        const params=new URLSearchParams(window.location.search)
        const room=params.get("room")
        if(room) window.location.href="lobby.html?room="+room
        else window.location.href="/"
    },5000)
}
function updateSidePanels(pList){
    const bd=document.getElementById("blueTeam"),od=document.getElementById("orangeTeam")
    if(!bd||!od)return;bd.innerHTML=od.innerHTML=""
    pList.forEach(p=>{
        const card=document.createElement("div");card.className="playerCard"
        const banner=p.banner||"assets/banners/Default.png"
        card.innerHTML=`<div class="avatar-container"><img src="${p.pfp||'assets/default_pfp.png'}" class="pfp" onerror="this.src='assets/default_pfp.png'"></div>
            <div class="info-container" style="background-image:url('${banner}')">
                <div class="name">${p.name||"Jugador"}</div>
                <div class="playerTitle" style="color:${p.titleColor||'#aaa'}">${p.title||""}</div>
            </div>`
        ;(p.team==="blue"?bd:od).appendChild(card)
    })
}

// ─── PARTICLES ───────────────────────────────────────────────────
function spawnParts(x,y,color,count,spd,life,sz=3){
    for(let i=0;i<count;i++){
        const a=Math.random()*Math.PI*2,s=spd*(0.4+Math.random()*0.8)
        particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life,maxLife:life,color,size:sz*(0.5+Math.random()),drag:0.93})
    }
}
function spawnDashParticles(x,y){
    for(let i=0;i<16;i++){
        const a=Math.random()*Math.PI*2,s=100+Math.random()*180
        particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:0.45,maxLife:0.45,
            color:`hsl(${260+Math.random()*40},100%,${65+Math.random()*20}%)`,size:3+Math.random()*4,drag:0.88})
    }
}
function spawnGoalExplosion(team){
    const c=team==="blue"?(settings.blueColor||"#00aaff"):(settings.orangeColor||"#ff6600")
    const gx=team==="blue"?GOAL_R.x+GOAL_R.w/2:GOAL_L.x+GOAL_L.w/2
    spawnParts(gx,GOAL_CY,c,70,650,1.4,6);spawnParts(gx,GOAL_CY,"#fff",25,350,0.9,3)
}
function updateParticles(dt){
    for(let i=particles.length-1;i>=0;i--){
        const p=particles[i];p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=p.drag;p.vy*=p.drag;p.life-=dt
        if(p.life<=0)particles.splice(i,1)
    }
}
function drawParticles(){
    particles.forEach(p=>{
        const t=p.life/p.maxLife;ctx.globalAlpha=t*0.9;ctx.shadowColor=p.color;ctx.shadowBlur=8
        ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.size*t,0,Math.PI*2);ctx.fill()
    });ctx.globalAlpha=1;ctx.shadowBlur=0
}

// Free play flag — set by bootstrap before game starts
let isFreePlay = (new URLSearchParams(window.location.search)).get("free") === "1"

// ─── ARENA ───────────────────────────────────────────────────────
function drawArena(){
    if(isFreePlay){ drawArenaFreePlay(); return }
    ctx.fillStyle="#0e2016";ctx.fillRect(0,0,W,H)
    for(let i=0;i<8;i++){
        const x=WALL_L+(i*(WALL_R-WALL_L)/8),w=(WALL_R-WALL_L)/8
        ctx.fillStyle=i%2===0?"rgba(255,255,255,0.012)":"rgba(0,0,0,0.015)"
        ctx.fillRect(x,WALL_T,w,WALL_B-WALL_T)
    }
    ctx.strokeStyle="rgba(255,255,255,0.025)";ctx.lineWidth=1
    for(let x=WALL_L;x<=WALL_R;x+=80){ctx.beginPath();ctx.moveTo(x,WALL_T);ctx.lineTo(x,WALL_B);ctx.stroke()}
    for(let y=WALL_T;y<=WALL_B;y+=80){ctx.beginPath();ctx.moveTo(WALL_L,y);ctx.lineTo(WALL_R,y);ctx.stroke()}
    ctx.strokeStyle="rgba(255,255,255,0.15)";ctx.lineWidth=2
    ctx.strokeRect(WALL_L,WALL_T,WALL_R-WALL_L,WALL_B-WALL_T)
    ctx.beginPath();ctx.moveTo(W/2,WALL_T);ctx.lineTo(W/2,WALL_B);ctx.stroke()
    ctx.beginPath();ctx.arc(W/2,H/2,100,0,Math.PI*2);ctx.stroke()
    ctx.beginPath();ctx.arc(W/2,H/2,6,0,Math.PI*2);ctx.fillStyle="rgba(255,255,255,0.25)";ctx.fill()
    ctx.strokeStyle="rgba(255,255,255,0.08)";ctx.lineWidth=2
    ;[[WALL_L+80,H/2],[WALL_R-80,H/2]].forEach(([cx,cy])=>{ctx.beginPath();ctx.arc(cx,cy,90,0,Math.PI*2);ctx.stroke()})
    const bh=ctx.createLinearGradient(WALL_L,0,W/2,0)
    bh.addColorStop(0,"rgba(0,100,200,0.06)");bh.addColorStop(1,"transparent")
    ctx.fillStyle=bh;ctx.fillRect(WALL_L,WALL_T,W/2-WALL_L,WALL_B-WALL_T)
    const oh=ctx.createLinearGradient(W/2,0,WALL_R,0)
    oh.addColorStop(0,"transparent");oh.addColorStop(1,"rgba(200,80,0,0.06)")
    ctx.fillStyle=oh;ctx.fillRect(W/2,WALL_T,WALL_R-W/2,WALL_B-WALL_T)
    ctx.fillStyle="#09150f"
    ctx.fillRect(0,0,WALL_L,H);ctx.fillRect(WALL_R,0,W-WALL_R,H)
    ctx.fillRect(0,0,W,WALL_T);ctx.fillRect(0,WALL_B,W,H-WALL_B)
    ;[[WALL_L-2,"rgba(80,200,80,0.25)"],[WALL_R-1,"rgba(80,200,80,0.25)"]].forEach(([wx,c])=>{
        ctx.fillStyle=c;ctx.fillRect(wx,WALL_T,3,WALL_B-WALL_T)
    })
    ;[[WALL_T-2,"rgba(80,200,80,0.25)"],[WALL_B-1,"rgba(80,200,80,0.25)"]].forEach(([wy,c])=>{
        ctx.fillStyle=c;ctx.fillRect(WALL_L,wy,WALL_R-WALL_L,3)
    })
    drawGoal(GOAL_L,settings.blueColor||"#00aaff",true)
    drawGoal(GOAL_R,settings.orangeColor||"#ff6600",false)
}
function drawGoal(g,color,isLeft){
    ctx.save()
    ctx.fillStyle="rgba(0,0,0,0.75)";ctx.fillRect(g.x,g.y,g.w,g.h)
    ctx.strokeStyle=color+"33";ctx.lineWidth=0.8
    for(let y=g.y;y<g.y+g.h;y+=16){ctx.beginPath();ctx.moveTo(g.x,y);ctx.lineTo(g.x+g.w,y);ctx.stroke()}
    for(let x=g.x;x<g.x+g.w;x+=12){ctx.beginPath();ctx.moveTo(x,g.y);ctx.lineTo(x,g.y+g.h);ctx.stroke()}
    ctx.shadowColor=color;ctx.shadowBlur=16;ctx.strokeStyle=color;ctx.lineWidth=3
    ctx.beginPath()
    if(isLeft){ctx.moveTo(g.x+g.w,g.y);ctx.lineTo(g.x,g.y);ctx.lineTo(g.x,g.y+g.h);ctx.lineTo(g.x+g.w,g.y+g.h)}
    else       {ctx.moveTo(g.x,g.y);ctx.lineTo(g.x+g.w,g.y);ctx.lineTo(g.x+g.w,g.y+g.h);ctx.lineTo(g.x,g.y+g.h)}
    ctx.stroke();ctx.restore()
}

function drawArenaFreePlay(){
    // Clean white/light grey arena — like RL training
    ctx.fillStyle="#e8e8e8"; ctx.fillRect(0,0,W,H)
    // Field surface
    ctx.fillStyle="#f4f4f4"; ctx.fillRect(WALL_L,WALL_T,WALL_R-WALL_L,WALL_B-WALL_T)
    // Field lines
    ctx.strokeStyle="rgba(180,180,180,0.8)"; ctx.lineWidth=2
    ctx.strokeRect(WALL_L,WALL_T,WALL_R-WALL_L,WALL_B-WALL_T)
    ctx.beginPath();ctx.moveTo(W/2,WALL_T);ctx.lineTo(W/2,WALL_B);ctx.stroke()
    ctx.beginPath();ctx.arc(W/2,H/2,100,0,Math.PI*2);ctx.stroke()
    ctx.beginPath();ctx.arc(W/2,H/2,6,0,Math.PI*2);ctx.fillStyle="rgba(180,180,180,0.8)";ctx.fill()
    ;[[WALL_L+80,H/2],[WALL_R-80,H/2]].forEach(([cx,cy])=>{
        ctx.beginPath();ctx.arc(cx,cy,90,0,Math.PI*2);ctx.stroke()
    })
    // Walls
    ctx.fillStyle="#d0d0d0"
    ctx.fillRect(0,0,WALL_L,H);ctx.fillRect(WALL_R,0,W-WALL_R,H)
    ctx.fillRect(0,0,W,WALL_T);ctx.fillRect(0,WALL_B,W,H-WALL_B)
    // Wall lines
    ctx.strokeStyle="rgba(150,150,150,0.5)";ctx.lineWidth=1.5
    ;[WALL_L,WALL_R].forEach(wx=>{ctx.beginPath();ctx.moveTo(wx,WALL_T);ctx.lineTo(wx,WALL_B);ctx.stroke()})
    ;[WALL_T,WALL_B].forEach(wy=>{ctx.beginPath();ctx.moveTo(WALL_L,wy);ctx.lineTo(WALL_R,wy);ctx.stroke()})
    // Goals
    drawGoal(GOAL_L,"#aaaaaa",true); drawGoal(GOAL_R,"#aaaaaa",false)
}

function drawBoostPads(){
    boostPads.forEach(pad=>{
        const r=pad.type==="big"?22:12
        ctx.save();ctx.globalAlpha=pad.active?1:0.2
        ctx.translate(pad.x,pad.y);ctx.rotate(padAng)
        ctx.shadowColor=pad.type==="big"?"#ffd700":"#00ff88"
        ctx.shadowBlur=pad.active?(pad.type==="big"?22:11):0
        ctx.beginPath()
        for(let i=0;i<6;i++){const a=(i/6)*Math.PI*2;i===0?ctx.moveTo(Math.cos(a)*r,Math.sin(a)*r):ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r)}
        ctx.closePath()
        ctx.fillStyle=pad.type==="big"?"rgba(255,215,0,0.13)":"rgba(0,255,136,0.10)";ctx.fill()
        ctx.strokeStyle=pad.type==="big"?"#ffd700":"#00ff88";ctx.lineWidth=pad.type==="big"?2.5:1.5;ctx.stroke()
        ctx.beginPath();ctx.arc(0,0,r*0.3,0,Math.PI*2);ctx.fillStyle=pad.type==="big"?"#ffd700":"#00ff88";ctx.fill()
        ctx.restore()
    })
}

// ─── CAR ─────────────────────────────────────────────────────────
function tintCanvas(src,hexColor){
    const key="tint_"+src+"_"+hexColor; if(imgCache[key])return imgCache[key]
    const si=imgCache[src]; if(!si||!si.complete||!si.naturalWidth)return null
    const oc=document.createElement("canvas"); oc.width=si.naturalWidth; oc.height=si.naturalHeight
    const c=oc.getContext("2d")
    // Draw tinted color first, then multiply original on top
    // This makes white→teamColor, black→black, grey→mid-tone
    c.fillStyle=hexColor; c.fillRect(0,0,oc.width,oc.height)
    c.globalCompositeOperation="multiply"
    c.drawImage(si,0,0)
    // Restore alpha from original (so transparent areas stay transparent)
    c.globalCompositeOperation="destination-in"
    c.drawImage(si,0,0)
    imgCache[key]=oc; return oc
}
function drawCar(p,x,y,vx,vy,dashing,isBoosting){
    const isBlue=p.team==="blue"
    // Free play: white car with grey accent
    const teamColor = isFreePlay ? "#ffffff" : (isBlue?(settings.blueColor||"#00aaff"):(settings.orangeColor||"#ff6600"))
    const r=CAR_R,spd=Math.hypot(vx,vy),angle=spd>10?Math.atan2(vy,vx):null
    ctx.save();ctx.translate(x,y)
    if(dashing){
        ctx.beginPath();ctx.arc(0,0,r+9,0,Math.PI*2)
        ctx.strokeStyle="#cc88ff";ctx.lineWidth=3;ctx.shadowColor="#aa44ff";ctx.shadowBlur=22;ctx.stroke();ctx.shadowBlur=0
    }
    if(isBoosting){ctx.shadowColor=teamColor;ctx.shadowBlur=22}
    const decalSrc=p.decal?`assets/decals/${p.decal}`:null
    if(decalSrc){
        const tinted=tintCanvas(decalSrc,teamColor)
        if(tinted){
            ctx.save();ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.clip()
            if(angle!==null)ctx.rotate(angle)
            ctx.drawImage(tinted,-r,-r,r*2,r*2);ctx.restore()
        }
    }
    const grad=ctx.createRadialGradient(-r*.3,-r*.3,0,0,0,r)
    if(decalSrc){
        // With decal: very thin overlay so decal shows through clearly
        grad.addColorStop(0,"rgba(255,255,255,0.05)")
        grad.addColorStop(0.5,"rgba(0,0,0,0)")
        grad.addColorStop(1,shadeColor(teamColor,-60)+"44")
    } else {
        grad.addColorStop(0,"rgba(255,255,255,0.22)")
        grad.addColorStop(0.5,teamColor)
        grad.addColorStop(1,shadeColor(teamColor,-45))
    }
    ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.fillStyle=grad;ctx.fill()
    ctx.strokeStyle="rgba(255,255,255,0.45)";ctx.lineWidth=2;ctx.stroke();ctx.shadowBlur=0
    if(angle!==null){
        ctx.rotate(angle);ctx.fillStyle="rgba(255,255,255,0.9)"
        ctx.beginPath();ctx.moveTo(r*.55,0);ctx.lineTo(r*.1,-r*.25);ctx.lineTo(r*.1,r*.25);ctx.closePath();ctx.fill()
    }
    if(p.id===myId){
        ctx.rotate(angle?-angle:0);ctx.beginPath();ctx.arc(0,-r-11,5,0,Math.PI*2)
        ctx.fillStyle="#ffd700";ctx.shadowColor="#ffd700";ctx.shadowBlur=8;ctx.fill();ctx.shadowBlur=0
    }
    ctx.restore()
    ctx.save();ctx.translate(x,y);ctx.textAlign="center";ctx.font="bold 11px 'Segoe UI',sans-serif"
    ctx.fillStyle="rgba(0,0,0,0.6)";ctx.fillText(p.name||"",1,-(r+14)+1)
    ctx.fillStyle="#fff";ctx.fillText(p.name||"",0,-(r+14));ctx.restore()
    if(!dashing&&p.dashCd>0){
        const pct=1-p.dashCd/DASH_CD
        ctx.save();ctx.translate(x,y);ctx.beginPath()
        ctx.arc(0,0,r+5,-Math.PI/2,-Math.PI/2+Math.PI*2*pct)
        ctx.strokeStyle="rgba(200,100,255,0.75)";ctx.lineWidth=2.5;ctx.stroke();ctx.restore()
    }
}
function shadeColor(hex,amt){
    if(!hex||hex[0]!=="#")return hex||"#888"
    let r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16)
    r=Math.max(0,Math.min(255,r+amt));g=Math.max(0,Math.min(255,g+amt));b=Math.max(0,Math.min(255,b+amt))
    return`rgb(${r},${g},${b})`
}

// ─── TRAILS ──────────────────────────────────────────────────────
function updateTrails(dt){
    getPlayers().forEach(p=>{
        if(!p.trailPts)p.trailPts=[]
        const rx=p.id===myId?(local.ready?local.x:p.x):(p.rx??p.x)
        const ry=p.id===myId?(local.ready?local.y:p.y):(p.ry??p.y)
        const boosting=p.id===myId?(local.ready&&getInput().shift&&local.boost>0):p.isBoosting
        const dashing=p.id===myId?(local.ready&&local.dashing):p.dashing
        if(boosting||dashing){
            p.trailPts.unshift({x:rx,y:ry,dash:dashing})
            if(p.trailPts.length>45)p.trailPts.pop()   // longer trail
        } else {
            // Fade out gradually — pop 1 per frame so it lingers
            if(p.trailPts.length)p.trailPts.pop()
        }
    })
}
function drawTrails(){
    getPlayers().forEach(p=>{
        if(!p.trailPts||p.trailPts.length<2)return
        const isBlue=p.team==="blue",isDash=p.trailPts[0].dash
        const imgSrc=p.boostTrail?`assets/boost/${p.boostTrail}`:null
        const baseColor=isDash?"#cc44ff":(isBlue?(settings.blueColor||"#00aaff"):(settings.orangeColor||"#ff6600"))
        ctx.save()
        p.trailPts.forEach((pt,i)=>{
            const t=1-i/p.trailPts.length
            // Size = full CAR_R at head, tapers to 0 at tail
            const sz=CAR_R*t
            if(imgSrc&&!isDash){
                const img=imgCache[imgSrc]
                if(img&&img.complete&&img.naturalWidth){
                    ctx.globalAlpha=t*0.85
                    ctx.drawImage(img,pt.x-sz,pt.y-sz,sz*2,sz*2);return
                }
            }
            // Default glow circle — same radius as car at head
            ctx.globalAlpha=t*0.7
            ctx.shadowColor=baseColor;ctx.shadowBlur=12
            ctx.beginPath();ctx.arc(pt.x,pt.y,sz,0,Math.PI*2)
            ctx.fillStyle=baseColor;ctx.fill()
        })
        ctx.restore()
    })
}

// ─── BALL ────────────────────────────────────────────────────────
function drawBall(){
    ctx.save();ctx.translate(ball.x,ball.y)
    ctx.shadowColor="rgba(255,255,255,0.5)";ctx.shadowBlur=16
    const g=ctx.createRadialGradient(-BALL_R*.35,-BALL_R*.35,1,0,0,BALL_R)
    g.addColorStop(0,"#ffffff");g.addColorStop(0.3,"#d0e8ff");g.addColorStop(0.7,"#6aabdd");g.addColorStop(1,"#1a3a55")
    ctx.beginPath();ctx.arc(0,0,BALL_R,0,Math.PI*2);ctx.fillStyle=g;ctx.fill();ctx.shadowBlur=0
    ctx.rotate(ballAngle)
    for(let i=0;i<6;i++){
        const a=(i/6)*Math.PI*2;hexPath(Math.cos(a)*BALL_R*.52,Math.sin(a)*BALL_R*.52,BALL_R*.23)
        ctx.strokeStyle="rgba(0,140,220,0.5)";ctx.lineWidth=0.9;ctx.stroke()
    }
    hexPath(0,0,BALL_R*.26);ctx.strokeStyle="rgba(0,180,255,0.6)";ctx.lineWidth=1.3;ctx.stroke()
    ctx.restore()
    ctx.save();ctx.translate(ball.x,ball.y)
    ctx.beginPath();ctx.ellipse(-BALL_R*.28,-BALL_R*.32,BALL_R*.22,BALL_R*.12,-0.5,0,Math.PI*2)
    ctx.fillStyle="rgba(255,255,255,0.35)";ctx.fill();ctx.restore()
}
function hexPath(cx,cy,r){
    ctx.beginPath()
    for(let i=0;i<6;i++){const a=(i/6)*Math.PI*2-Math.PI/6;i===0?ctx.moveTo(cx+Math.cos(a)*r,cy+Math.sin(a)*r):ctx.lineTo(cx+Math.cos(a)*r,cy+Math.sin(a)*r)}
    ctx.closePath()
}

// Canvas scale
function resize(){
    const scale=Math.min(window.innerWidth/W,window.innerHeight/H)
    canvas.style.width=(W*scale)+"px";canvas.style.height=(H*scale)+"px"
}
window.addEventListener("resize",resize);resize()

// ─── MAIN RENDER LOOP ─────────────────────────────────────────────
let lastTs=0,prevDashing=false
function loop(ts){
    const dt=Math.min((ts-lastTs)/1000,0.05);lastTs=ts
    if(local.ready&&gamePhase==="playing"){
        if(local.dashing&&!prevDashing)spawnDashParticles(local.x,local.y)
        prevDashing=local.dashing
        physicsStep(local,getInput(),dt)
    }
    getPlayers().forEach(p=>{
        if(p.id===myId){p.rx=local.ready?local.x:p.x;p.ry=local.ready?local.y:p.y}
        else{
            if(p.rx===undefined){p.rx=p.x;p.ry=p.y}
            const a=1-Math.pow(0.01,dt*14);p.rx+=(p.x-p.rx)*a;p.ry+=(p.y-p.ry)*a
        }
        if(p.id!==myId&&p.dashing&&!p._wasDashing)spawnDashParticles(p.rx,p.ry)
        p._wasDashing=p.dashing
        if(p.id===myId)p.dashCd=local.ready?local.dashCd:(p.dashCd||0)
    })
    updateParticles(dt);updateTrails(dt)
    ballAngle+=(ball.spin||0)*dt*0.5+dt*0.8;padAng+=dt*1.6
    const dimTarget=gamePhase==="goal"||gamePhase==="over"?0.55:0
    dimAlpha+=(dimTarget-dimAlpha)*Math.min(1,dt*4)
    ctx.clearRect(0,0,W,H)
    drawArena();drawBoostPads();drawTrails();drawParticles();drawBall()
    if(dimAlpha>0.01){ctx.fillStyle=`rgba(0,0,0,${dimAlpha})`;ctx.fillRect(0,0,W,H)}
    getPlayers().forEach(p=>{
        const x=p.id===myId?(local.ready?local.x:p.x):(p.rx??p.x)
        const y=p.id===myId?(local.ready?local.y:p.y):(p.ry??p.y)
        const vx=p.id===myId?(local.ready?local.vx:0):p.vx||0
        const vy=p.id===myId?(local.ready?local.vy:0):p.vy||0
        const dashing=p.id===myId?(local.ready&&local.dashing):p.dashing
        const boosting=p.id===myId?(local.ready&&getInput().shift&&local.boost>0):p.isBoosting
        drawCar(p,x,y,vx,vy,dashing,boosting)
    })
    if(gamePhase==="kickoffCountdown"&&kickoffTimer>0){
        ctx.save();ctx.textAlign="center"
        ctx.font="bold 160px 'Barlow Condensed','Segoe UI',sans-serif"
        ctx.fillStyle="rgba(255,255,255,0.08)";ctx.fillText(Math.ceil(kickoffTimer),W/2,H/2+60)
        ctx.restore()
    }
    requestAnimationFrame(loop)
}
requestAnimationFrame(loop)
