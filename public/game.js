// ═══════════════════════════════════════════════════════════════
//  ROCKET HAX — Top-down 2D (HaxBall style) v5
//  WASD free movement, Space=dash, Shift=boost
//  Client-side prediction + reconciliation
// ═══════════════════════════════════════════════════════════════
const socket = io()
const canvas = document.getElementById("game")
const ctx    = canvas.getContext("2d")

const W = 1600, H = 820
const WALL_T=55, WALL_B=H-55, WALL_L=55, WALL_R=W-55
const GOAL_W=40, GOAL_H=200, GOAL_CY=H/2
const GOAL_L={x:WALL_L-GOAL_W, y:GOAL_CY-GOAL_H/2, w:GOAL_W, h:GOAL_H}
const GOAL_R={x:WALL_R,        y:GOAL_CY-GOAL_H/2, w:GOAL_W, h:GOAL_H}
const BALL_R=24, CAR_R=22

// Physics (must mirror server)
const ACCEL=900, FRICTION=0.88, MAX_SPD=580
const BOOST_ACCEL=1400, BOOST_MAX=860, BOOST_DRAIN=38, BOOST_REGEN=9
const DASH_SPEED=MAX_SPD*3.2, DASH_DUR=0.22, DASH_CD=1.4

// State
let myId=null, ball={x:W/2,y:H/2,spin:0}, ballAngle=0
let scores={blue:0,orange:0}, matchTime=300, padAng=0
let settings={blueTeamName:"BLUE",orangeTeamName:"ORANGE",blueColor:"#00aaff",orangeColor:"#ff6600",seriesTitle:"FRIENDLY MATCH",gameNum:1,bestOf:7}
const particles=[]

const PADS_POS=[
    {x:180,     y:180,     type:"big"},   {x:W-180,   y:180,     type:"big"},
    {x:180,     y:H-180,   type:"big"},   {x:W-180,   y:H-180,   type:"big"},
    {x:W/2,     y:H/2,     type:"big"},
    {x:W/2,     y:160,     type:"small"}, {x:W/2,     y:H-160,   type:"small"},
    {x:160,     y:H/2,     type:"small"}, {x:W-160,   y:H/2,     type:"small"},
    {x:W*0.3,   y:H*0.3,   type:"small"}, {x:W*0.7,   y:H*0.3,  type:"small"},
    {x:W*0.3,   y:H*0.7,   type:"small"}, {x:W*0.7,   y:H*0.7,  type:"small"},
]
const boostPads=PADS_POS.map(p=>({...p,active:true}))

// Player registry
const playerMap={}
function getPlayers(){ return Object.values(playerMap) }
function ensurePlayer(id,def={}){
    if(!playerMap[id]){
        const team=def.team||"blue"
        playerMap[id]={
            id,team,
            name:def.name||"…",title:def.title||"",titleColor:def.titleColor||"#aaa",
            pfp:def.pfp||"assets/default_pfp.png",banner:def.banner||"assets/banners/Default.png",
            x:def.x??(team==="blue"?320:W-320), y:def.y??(H/2),
            vx:0,vy:0,boost:33,dashing:false,dashTimer:0,dashCd:0,isBoosting:false,
            rx:def.x??(team==="blue"?320:W-320), ry:def.y??(H/2),
            angle:0, trailPts:[], dashParticles:[]
        }
    }
    return playerMap[id]
}

// Local prediction
const local={
    ready:false, x:0,y:0,vx:0,vy:0,boost:33,
    dashing:false,dashTimer:0,dashCd:0,dashVx:0,dashVy:0
}

// Input
const keys={}
document.addEventListener("keydown",e=>{
    const k=e.key==="Shift"?"shift":e.code==="Space"?"dash":e.key.toLowerCase()
    keys[k]=true; if(["Space"].includes(e.code))e.preventDefault()
})
document.addEventListener("keyup",e=>{
    const k=e.key==="Shift"?"shift":e.code==="Space"?"dash":e.key.toLowerCase()
    keys[k]=false
})
function getInput(){ return {w:!!keys.w,a:!!keys.a,s:!!keys.s,d:!!keys.d,shift:!!keys.shift,dash:!!keys.dash} }

// Input buffer
let inputSeq=0
const inputBuf=[]
setInterval(()=>{
    const inp=getInput(); inputSeq++
    inputBuf.push({seq:inputSeq,inp,dt:1/60})
    if(inputBuf.length>120) inputBuf.shift()
    socket.emit("move",{...inp,seq:inputSeq})
},1000/60)

// Prediction physics
function physicsStep(s,inp,dt){
    const boosting=inp.shift&&s.boost>0
    if(boosting) s.boost=Math.max(0,  s.boost-BOOST_DRAIN*dt)
    else          s.boost=Math.min(100,s.boost+BOOST_REGEN*dt)
    if(s.dashCd>0) s.dashCd-=dt

    if(inp.dash&&!s.dashing&&s.dashCd<=0){
        let dx=(inp.d?1:0)-(inp.a?1:0), dy=(inp.s?1:0)-(inp.w?1:0)
        const len=Math.hypot(dx,dy)
        if(len<0.1){dx=s.vx;dy=s.vy}
        const dl=Math.hypot(dx,dy)||1
        s.dashVx=(dx/dl)*DASH_SPEED; s.dashVy=(dy/dl)*DASH_SPEED
        s.dashing=true; s.dashTimer=DASH_DUR; s.dashCd=DASH_CD
    }

    if(s.dashing){
        const t=s.dashTimer/DASH_DUR
        s.vx=s.dashVx*t; s.vy=s.dashVy*t
        s.dashTimer-=dt; if(s.dashTimer<=0) s.dashing=false
    } else {
        if(inp.w) s.vy-=ACCEL*dt
        if(inp.s) s.vy+=ACCEL*dt
        if(inp.a) s.vx-=ACCEL*dt
        if(inp.d) s.vx+=ACCEL*dt
        if(boosting){
            const mx=(inp.d?1:0)-(inp.a?1:0), my=(inp.s?1:0)-(inp.w?1:0)
            const ml=Math.hypot(mx,my)||1
            if(ml>0.1){ s.vx+=(mx/ml)*BOOST_ACCEL*dt; s.vy+=(my/ml)*BOOST_ACCEL*dt }
        }
        s.vx*=Math.pow(FRICTION,dt*60); s.vy*=Math.pow(FRICTION,dt*60)
        const maxS=boosting?BOOST_MAX:MAX_SPD, spd=Math.hypot(s.vx,s.vy)
        if(spd>maxS){s.vx=s.vx/spd*maxS;s.vy=s.vy/spd*maxS}
    }
    s.x+=s.vx*dt; s.y+=s.vy*dt
    if(s.x-CAR_R<WALL_L){s.x=WALL_L+CAR_R;s.vx=Math.abs(s.vx)*0.4}
    if(s.x+CAR_R>WALL_R){s.x=WALL_R-CAR_R;s.vx=-Math.abs(s.vx)*0.4}
    if(s.y-CAR_R<WALL_T){s.y=WALL_T+CAR_R;s.vy=Math.abs(s.vy)*0.4}
    if(s.y+CAR_R>WALL_B){s.y=WALL_B-CAR_R;s.vy=-Math.abs(s.vy)*0.4}
}

function reconcile(srv){
    local.x=srv.x;local.y=srv.y;local.vx=srv.vx||0;local.vy=srv.vy||0
    local.boost=srv.boost;local.dashing=srv.dashing||false
    local.dashTimer=srv.dashTimer||0;local.dashCd=srv.dashCd||0
    local.ready=true
    const lastAck=srv.seq||0
    inputBuf.filter(e=>e.seq>lastAck).forEach(e=>physicsStep(local,e.inp,e.dt))
}

// Socket
const params=new URLSearchParams(window.location.search)
const room=params.get("room")
const playerData=JSON.parse(localStorage.getItem("playerData")||"{}")

socket.on("connect",()=>{ myId=socket.id; socket.emit("joinGame",{room,...playerData}) })

socket.on("state",data=>{
    const srv=data.players.find(p=>p.id===myId)
    if(srv) reconcile(srv)
    data.players.forEach(sp=>{
        const p=ensurePlayer(sp.id,{team:sp.team})
        p.x=sp.x;p.y=sp.y;p.vx=sp.vx||0;p.vy=sp.vy||0
        p.boost=sp.boost;p.dashing=sp.dashing;p.isBoosting=sp.isBoosting
        p.dashCd=sp.dashCd||0
    })
    const live=new Set(data.players.map(p=>p.id))
    Object.keys(playerMap).forEach(id=>{if(!live.has(id))delete playerMap[id]})
    ball=data.ball; scores=data.scores; matchTime=data.matchTime
    if(data.settings) settings=data.settings
    if(data.pads) data.pads.forEach((sp,i)=>boostPads[i]&&(boostPads[i].active=sp.active))
    updateHUD()
})

socket.on("playerInfoUpdate",({players:pList,settings:s})=>{
    if(s) settings=s
    pList.forEach(sp=>{
        const p=ensurePlayer(sp.id,sp)
        p.name=sp.name;p.title=sp.title;p.titleColor=sp.titleColor
        p.pfp=sp.pfp;p.banner=sp.banner;p.team=sp.team
    })
    const live=new Set(pList.map(p=>p.id))
    Object.keys(playerMap).forEach(id=>{if(!live.has(id))delete playerMap[id]})
    updateSidePanels(pList)
})

socket.on("goal",({scorer,scores:sc,settings:s})=>{
    if(s) settings=s; scores=sc; local.ready=false
    showGoalBanner(scorer); spawnGoalExplosion(scorer); updateHUD()
})
socket.on("kickoff",({scores:sc,settings:s})=>{
    if(s) settings=s; scores=sc
    document.getElementById("goalBanner").classList.remove("show"); updateHUD()
})
socket.on("gameOver",sc=>{scores=sc;showGameOver(sc)})

// ─── HUD ─────────────────────────────────────────────────────────
function updateHUD(){
    // Scoreboard team names + colors
    const bc=settings.blueColor||"#00aaff", oc=settings.orangeColor||"#ff6600"
    document.getElementById("sb-blue-name").textContent=settings.blueTeamName||"BLUE"
    document.getElementById("sb-orange-name").textContent=settings.orangeTeamName||"ORANGE"
    document.getElementById("sb-blue-score").textContent=scores.blue||0
    document.getElementById("sb-orange-score").textContent=scores.orange||0
    document.getElementById("sb-blue-block").style.background=bc
    document.getElementById("sb-orange-block").style.background=oc
    // Series info
    document.getElementById("sb-series-title").textContent=settings.seriesTitle||"FRIENDLY"
    document.getElementById("sb-game-num").textContent=`GAME ${settings.gameNum||1}`
    document.getElementById("sb-best-of").textContent=`BEST OF ${settings.bestOf||7}`
    // Timer
    const m=Math.floor(matchTime/60),s=Math.floor(matchTime%60)
    document.getElementById("hud-timer").textContent=`${m}:${s.toString().padStart(2,"0")}`
    // Boost circle for my player
    const me=playerMap[myId]
    if(me){
        const b=Math.round(local.ready?local.boost:me.boost)
        document.getElementById("boost-circle-val").textContent=b
        drawBoostCircle(b, me.team==="blue"?settings.blueColor:settings.orangeColor)
    }
}

function drawBoostCircle(pct, color){
    const bc=document.getElementById("boost-canvas")
    if(!bc) return
    const c=bc.getContext("2d"), sz=bc.width, cx=sz/2, cy=sz/2, r=sz/2-6
    c.clearRect(0,0,sz,sz)
    // Background ring
    c.beginPath(); c.arc(cx,cy,r,0,Math.PI*2)
    c.strokeStyle="rgba(255,255,255,0.1)"; c.lineWidth=8; c.stroke()
    // Fill arc
    const start=-Math.PI/2, end=start+(Math.PI*2*(pct/100))
    c.beginPath(); c.arc(cx,cy,r,start,end)
    c.strokeStyle=color; c.lineWidth=8
    c.shadowColor=color; c.shadowBlur=12; c.stroke()
    c.shadowBlur=0
}

function showGoalBanner(team){
    const el=document.getElementById("goalBanner")
    const word=document.getElementById("goalWord"), sub=document.getElementById("goalSub")
    const color=team==="blue"?(settings.blueColor||"#00aaff"):(settings.orangeColor||"#ff6600")
    const name=team==="blue"?(settings.blueTeamName||"BLUE"):(settings.orangeTeamName||"ORANGE")
    word.style.color=color; word.style.textShadow=`0 0 60px ${color}88`
    word.textContent="¡GOL!"; sub.textContent=name+" ANOTA"
    el.classList.add("show")
}
function showGameOver(sc){
    const blueName=settings.blueTeamName||"BLUE", orgName=settings.orangeTeamName||"ORANGE"
    const w=sc.blue>sc.orange?blueName:sc.orange>sc.blue?orgName:"EMPATE"
    document.getElementById("goalWord").textContent=w
    document.getElementById("goalWord").style.color="#ffd700"
    document.getElementById("goalSub").textContent=`${sc.blue} — ${sc.orange}`
    document.getElementById("goalBanner").classList.add("show")
}

function updateSidePanels(pList){
    const bd=document.getElementById("blueTeam"),od=document.getElementById("orangeTeam")
    if(!bd||!od) return; bd.innerHTML=od.innerHTML=""
    pList.forEach(p=>{
        const card=document.createElement("div"); card.className="playerCard"
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
    for(let i=0;i<18;i++){
        const a=Math.random()*Math.PI*2,s=120+Math.random()*200
        particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:0.5,maxLife:0.5,color:`hsl(${260+Math.random()*40},100%,${65+Math.random()*20}%)`,size:3+Math.random()*5,drag:0.88})
    }
}
function spawnGoalExplosion(team){
    const c=team==="blue"?(settings.blueColor||"#00aaff"):(settings.orangeColor||"#ff6600")
    const gx=team==="blue"?GOAL_R.x+GOAL_R.w/2:GOAL_L.x+GOAL_L.w/2
    spawnParts(gx,GOAL_CY,c,60,600,1.4,6); spawnParts(gx,GOAL_CY,"#fff",25,350,0.9,3)
}
function updateParticles(dt){
    for(let i=particles.length-1;i>=0;i--){
        const p=particles[i];p.x+=p.vx*dt;p.y+=p.vy*dt
        p.vx*=p.drag;p.vy*=p.drag;p.life-=dt
        if(p.life<=0) particles.splice(i,1)
    }
}
function drawParticles(){
    particles.forEach(p=>{
        const t=p.life/p.maxLife;ctx.globalAlpha=t*0.9;ctx.shadowColor=p.color;ctx.shadowBlur=8
        ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.size*t,0,Math.PI*2);ctx.fill()
    }); ctx.globalAlpha=1;ctx.shadowBlur=0
}

// ─── ARENA ───────────────────────────────────────────────────────
function drawArena(){
    // Background — top-down dark green grass
    ctx.fillStyle="#0e2016"; ctx.fillRect(0,0,W,H)

    // Grass lines
    ctx.strokeStyle="rgba(255,255,255,0.03)"; ctx.lineWidth=1
    for(let x=WALL_L;x<=WALL_R;x+=80){
        ctx.beginPath();ctx.moveTo(x,WALL_T);ctx.lineTo(x,WALL_B);ctx.stroke()
    }
    for(let y=WALL_T;y<=WALL_B;y+=80){
        ctx.beginPath();ctx.moveTo(WALL_L,y);ctx.lineTo(WALL_R,y);ctx.stroke()
    }

    // Field markings
    ctx.strokeStyle="rgba(255,255,255,0.12)"; ctx.lineWidth=2
    // Outer field boundary
    ctx.strokeRect(WALL_L,WALL_T,WALL_R-WALL_L,WALL_B-WALL_T)
    // Center line (vertical, since goals are on left/right)
    ctx.beginPath();ctx.moveTo(W/2,WALL_T);ctx.lineTo(W/2,WALL_B);ctx.stroke()
    // Center circle
    ctx.beginPath();ctx.arc(W/2,H/2,100,0,Math.PI*2);ctx.stroke()
    // Center dot
    ctx.beginPath();ctx.arc(W/2,H/2,6,0,Math.PI*2);ctx.fillStyle="rgba(255,255,255,0.3)";ctx.fill()
    // Penalty arcs
    ;[[WALL_L+80,H/2],[WALL_R-80,H/2]].forEach(([cx,cy])=>{
        ctx.beginPath();ctx.arc(cx,cy,90,0,Math.PI*2)
        ctx.strokeStyle="rgba(255,255,255,0.08)";ctx.lineWidth=2;ctx.stroke()
    })

    // Walls
    ctx.fillStyle="#0a1a12"
    ctx.fillRect(0,0,WALL_L,H);ctx.fillRect(WALL_R,0,W-WALL_R,H)
    ctx.fillRect(0,0,W,WALL_T);ctx.fillRect(0,WALL_B,W,H-WALL_B)

    // Wall glow strips
    ;[[WALL_L-2,true],[WALL_R-1,false]].forEach(([wx,left])=>{
        const g=ctx.createLinearGradient(wx,0,wx+(left?4:-4),0)
        g.addColorStop(0,"rgba(100,200,100,0.3)");g.addColorStop(1,"transparent")
        ctx.fillStyle=g;ctx.fillRect(wx,WALL_T,4,WALL_B-WALL_T)
    })
    ;[[WALL_T-2,true],[WALL_B-1,false]].forEach(([wy])=>{
        const g=ctx.createLinearGradient(0,wy,0,wy+4)
        g.addColorStop(0,"rgba(100,200,100,0.3)");g.addColorStop(1,"transparent")
        ctx.fillStyle=g;ctx.fillRect(WALL_L,wy,WALL_R-WALL_L,4)
    })

    // Goals
    drawGoal(GOAL_L, settings.blueColor||"#00aaff",   true)
    drawGoal(GOAL_R, settings.orangeColor||"#ff6600",  false)
}

function drawGoal(g,color,isLeft){
    ctx.save()
    ctx.fillStyle="rgba(0,0,0,0.7)"; ctx.fillRect(g.x,g.y,g.w,g.h)
    // Net lines
    ctx.strokeStyle=color+"33"; ctx.lineWidth=0.8
    for(let y=g.y;y<g.y+g.h;y+=16){ctx.beginPath();ctx.moveTo(g.x,y);ctx.lineTo(g.x+g.w,y);ctx.stroke()}
    for(let x=g.x;x<g.x+g.w;x+=12){ctx.beginPath();ctx.moveTo(x,g.y);ctx.lineTo(x,g.y+g.h);ctx.stroke()}
    // Frame
    ctx.shadowColor=color;ctx.shadowBlur=14;ctx.strokeStyle=color;ctx.lineWidth=3
    ctx.beginPath()
    if(isLeft){ctx.moveTo(g.x+g.w,g.y);ctx.lineTo(g.x,g.y);ctx.lineTo(g.x,g.y+g.h);ctx.lineTo(g.x+g.w,g.y+g.h)}
    else       {ctx.moveTo(g.x,g.y);ctx.lineTo(g.x+g.w,g.y);ctx.lineTo(g.x+g.w,g.y+g.h);ctx.lineTo(g.x,g.y+g.h)}
    ctx.stroke();ctx.restore()
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

// ─── CAR (top-down circle with direction arrow) ───────────────────
function drawCar(p, x, y, vx, vy, dashing, isBoosting){
    const isBlue=p.team==="blue"
    const teamColor=isBlue?(settings.blueColor||"#00aaff"):(settings.orangeColor||"#ff6600")
    const r=CAR_R

    // Velocity angle for direction arrow
    const spd=Math.hypot(vx,vy)
    const angle=spd>10?Math.atan2(vy,vx):null

    ctx.save(); ctx.translate(x,y)

    // Dash ring effect
    if(dashing){
        ctx.beginPath();ctx.arc(0,0,r+8,0,Math.PI*2)
        ctx.strokeStyle="#cc88ff";ctx.lineWidth=3
        ctx.shadowColor="#aa44ff";ctx.shadowBlur=20;ctx.stroke();ctx.shadowBlur=0
    }

    // Boost glow
    if(isBoosting){ctx.shadowColor=teamColor;ctx.shadowBlur=20}

    // Car body circle
    const grad=ctx.createRadialGradient(-r*0.3,-r*0.3,0,0,0,r)
    grad.addColorStop(0,"rgba(255,255,255,0.25)"); grad.addColorStop(0.5,teamColor); grad.addColorStop(1,shadeColor(teamColor,-40))
    ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.fillStyle=grad;ctx.fill()
    ctx.strokeStyle="rgba(255,255,255,0.4)";ctx.lineWidth=2;ctx.stroke()
    ctx.shadowBlur=0

    // Direction arrow (shows where car is going)
    if(angle!==null){
        ctx.rotate(angle)
        ctx.fillStyle="rgba(255,255,255,0.85)"
        ctx.beginPath()
        ctx.moveTo(r*0.55,0);ctx.lineTo(r*0.1,-r*0.25);ctx.lineTo(r*0.1,r*0.25)
        ctx.closePath();ctx.fill()
    }

    // "ME" dot
    if(p.id===myId){
        ctx.rotate(angle?-angle:0)
        ctx.beginPath();ctx.arc(0,-r-10,5,0,Math.PI*2)
        ctx.fillStyle="#ffd700";ctx.shadowColor="#ffd700";ctx.shadowBlur=8;ctx.fill();ctx.shadowBlur=0
    }

    ctx.restore()

    // Name above car
    ctx.save();ctx.translate(x,y)
    ctx.textAlign="center";ctx.font="bold 11px 'Segoe UI',sans-serif"
    ctx.fillStyle="rgba(0,0,0,0.6)"
    ctx.fillText(p.name||"",1,-(r+14)+1)
    ctx.fillStyle="#ffffff";ctx.fillText(p.name||"",0,-(r+14))
    ctx.restore()

    // Dash cooldown arc (thin ring)
    if(!dashing && p.dashCd>0){
        const pct=1-p.dashCd/DASH_CD
        ctx.save();ctx.translate(x,y)
        ctx.beginPath();ctx.arc(0,0,r+4,-Math.PI/2,-Math.PI/2+Math.PI*2*pct)
        ctx.strokeStyle="rgba(200,100,255,0.7)";ctx.lineWidth=2;ctx.stroke()
        ctx.restore()
    }
}

function shadeColor(hex, amt){
    let r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16)
    r=Math.max(0,Math.min(255,r+amt));g=Math.max(0,Math.min(255,g+amt));b=Math.max(0,Math.min(255,b+amt))
    return `rgb(${r},${g},${b})`
}

// Boost trail (behind moving car)
function updateTrails(dt){
    getPlayers().forEach(p=>{
        if(!p.trailPts) p.trailPts=[]
        const rx=p.id===myId?(local.ready?local.x:p.x):(p.rx??p.x)
        const ry=p.id===myId?(local.ready?local.y:p.y):(p.ry??p.y)
        const boosting=p.id===myId?(local.ready&&getInput().shift&&local.boost>0):p.isBoosting
        const dashing=p.id===myId?(local.ready&&local.dashing):p.dashing
        if(boosting||dashing){
            p.trailPts.unshift({x:rx,y:ry,dash:dashing})
            if(p.trailPts.length>20) p.trailPts.pop()
        } else { if(p.trailPts.length) p.trailPts.pop() }
    })
}
function drawTrails(){
    getPlayers().forEach(p=>{
        if(!p.trailPts||p.trailPts.length<2) return
        const isBlue=p.team==="blue"
        const baseColor=p.trailPts[0].dash?"#cc44ff":(isBlue?(settings.blueColor||"#00aaff"):(settings.orangeColor||"#ff6600"))
        ctx.save()
        p.trailPts.forEach((pt,i)=>{
            const t=1-i/p.trailPts.length;ctx.globalAlpha=t*0.55
            ctx.shadowColor=baseColor;ctx.shadowBlur=10
            ctx.beginPath();ctx.arc(pt.x,pt.y,CAR_R*0.6*t,0,Math.PI*2)
            ctx.fillStyle=baseColor;ctx.fill()
        });ctx.restore()
    })
}

// ─── BALL ────────────────────────────────────────────────────────
function drawBall(){
    ctx.save();ctx.translate(ball.x,ball.y)
    ctx.shadowColor="rgba(255,255,255,0.5)";ctx.shadowBlur=16
    const g=ctx.createRadialGradient(-BALL_R*0.35,-BALL_R*0.35,1,0,0,BALL_R)
    g.addColorStop(0,"#ffffff");g.addColorStop(0.3,"#d0e8ff");g.addColorStop(0.7,"#6aabdd");g.addColorStop(1,"#1a3a55")
    ctx.beginPath();ctx.arc(0,0,BALL_R,0,Math.PI*2);ctx.fillStyle=g;ctx.fill();ctx.shadowBlur=0
    // Rotating hex
    ctx.rotate(ballAngle)
    for(let i=0;i<6;i++){
        const a=(i/6)*Math.PI*2;hexPath(Math.cos(a)*BALL_R*0.52,Math.sin(a)*BALL_R*0.52,BALL_R*0.23)
        ctx.strokeStyle="rgba(0,140,220,0.5)";ctx.lineWidth=0.9;ctx.stroke()
    }
    hexPath(0,0,BALL_R*0.26);ctx.strokeStyle="rgba(0,180,255,0.6)";ctx.lineWidth=1.3;ctx.stroke()
    ctx.restore()
    // Specular
    ctx.save();ctx.translate(ball.x,ball.y)
    ctx.beginPath();ctx.ellipse(-BALL_R*0.28,-BALL_R*0.32,BALL_R*0.22,BALL_R*0.12,-0.5,0,Math.PI*2)
    ctx.fillStyle="rgba(255,255,255,0.35)";ctx.fill();ctx.restore()
}
function hexPath(cx,cy,r){
    ctx.beginPath()
    for(let i=0;i<6;i++){const a=(i/6)*Math.PI*2-Math.PI/6;i===0?ctx.moveTo(cx+Math.cos(a)*r,cy+Math.sin(a)*r):ctx.lineTo(cx+Math.cos(a)*r,cy+Math.sin(a)*r)}
    ctx.closePath()
}

// Canvas scaling
function resize(){
    const scale=Math.min(window.innerWidth/W,window.innerHeight/H)
    canvas.style.width=(W*scale)+"px";canvas.style.height=(H*scale)+"px"
}
window.addEventListener("resize",resize);resize()

// ─── MAIN LOOP ────────────────────────────────────────────────────
let lastTs=0, prevDashing=false
function loop(ts){
    const dt=Math.min((ts-lastTs)/1000,0.05);lastTs=ts

    if(local.ready){
        // Detect dash start for particle burst
        if(local.dashing&&!prevDashing) spawnDashParticles(local.x,local.y)
        prevDashing=local.dashing
        physicsStep(local,getInput(),dt)
    }

    getPlayers().forEach(p=>{
        if(p.id===myId){
            p.rx=local.ready?local.x:p.x; p.ry=local.ready?local.y:p.y
        } else {
            if(p.rx===undefined){p.rx=p.x;p.ry=p.y}
            const a=1-Math.pow(0.01,dt*14)
            p.rx+=(p.x-p.rx)*a; p.ry+=(p.y-p.ry)*a
        }
        // Dash particle burst for remote players
        if(p.id!==myId&&p.dashing&&!p._wasDashing) spawnDashParticles(p.rx,p.ry)
        p._wasDashing=p.dashing
    })

    updateParticles(dt); updateTrails(dt)
    ballAngle+=(ball.spin||0)*dt*0.5+dt*0.8
    padAng+=dt*1.6

    ctx.clearRect(0,0,W,H)
    drawArena(); drawBoostPads(); drawTrails(); drawParticles(); drawBall()

    getPlayers().forEach(p=>{
        const x=p.id===myId?(local.ready?local.x:p.x):(p.rx??p.x)
        const y=p.id===myId?(local.ready?local.y:p.y):(p.ry??p.y)
        const vx=p.id===myId?(local.ready?local.vx:0):p.vx||0
        const vy=p.id===myId?(local.ready?local.vy:0):p.vy||0
        const dashing=p.id===myId?(local.ready&&local.dashing):p.dashing
        const boosting=p.id===myId?(local.ready&&getInput().shift&&local.boost>0):p.isBoosting
        // Pass dashCd for cooldown arc
        if(p.id===myId) p.dashCd=local.ready?local.dashCd:(p.dashCd||0)
        drawCar(p,x,y,vx,vy,dashing,boosting)
    })

    requestAnimationFrame(loop)
}
requestAnimationFrame(loop)
