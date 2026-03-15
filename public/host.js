// ═══════════════════════════════════════════════════════════════
//  CHAMPIONS FIELD — HOST.JS
//  Physics engine + WebRTC host.
//  Connections are opened in the LOBBY and reused in game.html.
// ═══════════════════════════════════════════════════════════════

const RTC_CONFIG = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
    ]
}

// ─── ARENA ───────────────────────────────────────────────────────
const W=1600,H=820
const WALL_T=55,WALL_B=H-55,WALL_L=55,WALL_R=W-55
const GOAL_W=40,GOAL_H=200,GOAL_CY=H/2
const GOAL_L={x:WALL_L-GOAL_W,y:GOAL_CY-GOAL_H/2,w:GOAL_W,h:GOAL_H}
const GOAL_R={x:WALL_R,       y:GOAL_CY-GOAL_H/2,w:GOAL_W,h:GOAL_H}
const BALL_R=24,CAR_R=22
const DT=1/60
const ACCEL=900,FRICTION=0.88,MAX_SPD=580
const BOOST_ACCEL=1400,BOOST_MAX=860,BOOST_DRAIN=38,BOOST_REGEN=0
const DASH_SPEED=MAX_SPD*2.0,DASH_DUR=0.18,DASH_CD=1.2
const PADS_TMPL=[
    {x:180,y:180,type:"big",value:100},{x:W-180,y:180,type:"big",value:100},
    {x:180,y:H-180,type:"big",value:100},{x:W-180,y:H-180,type:"big",value:100},
    {x:W/2,y:H/2,type:"big",value:100},
    {x:W/2,y:160,type:"small",value:25},{x:W/2,y:H-160,type:"small",value:25},
    {x:160,y:H/2,type:"small",value:25},{x:W-160,y:H/2,type:"small",value:25},
    {x:W*.3,y:H*.3,type:"small",value:25},{x:W*.7,y:H*.3,type:"small",value:25},
    {x:W*.3,y:H*.7,type:"small",value:25},{x:W*.7,y:H*.7,type:"small",value:25},
]

// ─── GLOBAL STATE ────────────────────────────────────────────────
let gameState  = null
let HOST_ID    = ""
// peers: { [peerId]: { pc, dc } } — built in LOBBY, used in game
const peers = {}

// ─── SPAWN ───────────────────────────────────────────────────────
function spawnPos(team,index,total){
    const side = team==="blue" ? WALL_L+160 : WALL_R-160
    const span=200, step=total>1?span/(total-1):0
    return {x:side, y:H/2-span/2+index*step}
}

function makeGameState(players, settings){
    const blues=players.filter(p=>p.team==="blue")
    const oranges=players.filter(p=>p.team==="orange")
    const all=players.map(p=>{
        const team=p.team==="orange"?"orange":"blue"
        const sameTeam=team==="blue"?blues:oranges
        const idx=sameTeam.findIndex(x=>x.id===p.id)
        const sp=spawnPos(team,Math.max(0,idx),sameTeam.length)
        return {
            id:p.id, team,
            name:p.name||"?", title:p.title||"", titleColor:p.titleColor||"#aaa",
            pfp:p.pfp||"assets/default_pfp.png",
            banner:p.banner||"assets/banners/Default.png",
            decal:p.decal||null, boostTrail:p.boostTrail||null,
            x:sp.x, y:sp.y, vx:0, vy:0, boost:33,
            dashing:false, dashTimer:0, dashCd:0, dashVx:0, dashVy:0,
            input:{}, lastSeq:0
        }
    })
    return {
        players:all,
        ball:{x:W/2,y:H/2,vx:0,vy:0,spin:0},
        pads:PADS_TMPL.map(p=>({...p,active:true,timer:0})),
        scores:{blue:0,orange:0},
        matchTime:300,
        phase:"kickoffCountdown",
        kickoffTimer:3,
        settings:{...settings}
    }
}

function resetAfterGoal(gs){
    const blues=gs.players.filter(p=>p.team==="blue")
    const oranges=gs.players.filter(p=>p.team==="orange")
    gs.players.forEach(p=>{
        const st=p.team==="blue"?blues:oranges
        const idx=Math.max(0,st.findIndex(x=>x.id===p.id))
        const sp=spawnPos(p.team,idx,st.length)
        p.x=sp.x;p.y=sp.y;p.vx=0;p.vy=0;p.dashing=false;p.dashTimer=0
    })
    gs.ball={x:W/2,y:H/2,vx:0,vy:0,spin:0}
    gs.pads.forEach(p=>{p.active=true;p.timer=0})
    gs.matchTime=300
    gs.phase="kickoffCountdown"
    gs.kickoffTimer=3
    gs.settings.gameNum=(gs.settings.gameNum||1)+1
}

// ─── PHYSICS ─────────────────────────────────────────────────────
function physicsTick(gs){
    const dt=DT
    if(gs.phase==="kickoffCountdown"){
        gs.kickoffTimer-=dt
        if(gs.kickoffTimer<=0){gs.phase="playing";gs.kickoffTimer=0}
        return
    }
    if(gs.phase!=="playing") return

    gs.players.forEach(p=>{
        const inp=p.input||{}
        const boosting=!!(inp.shift&&p.boost>0)
        if(boosting) p.boost=Math.max(0,  p.boost-BOOST_DRAIN*dt)
        else          p.boost=Math.min(100,p.boost+BOOST_REGEN*dt)
        if(p.dashCd>0) p.dashCd-=dt
        if(inp.dash&&!p.dashing&&p.dashCd<=0){
            let dx=(inp.d?1:0)-(inp.a?1:0),dy=(inp.s?1:0)-(inp.w?1:0)
            if(Math.hypot(dx,dy)<0.1){dx=p.vx;dy=p.vy}
            const dl=Math.hypot(dx,dy)||1
            p.dashVx=(dx/dl)*DASH_SPEED;p.dashVy=(dy/dl)*DASH_SPEED
            p.dashing=true;p.dashTimer=DASH_DUR;p.dashCd=DASH_CD
        }
        if(p.dashing){
            const t=p.dashTimer/DASH_DUR
            p.vx=p.dashVx*t;p.vy=p.dashVy*t
            p.dashTimer-=dt;if(p.dashTimer<=0)p.dashing=false
        } else {
            if(inp.w)p.vy-=ACCEL*dt;if(inp.s)p.vy+=ACCEL*dt
            if(inp.a)p.vx-=ACCEL*dt;if(inp.d)p.vx+=ACCEL*dt
            if(boosting){
                const mx=(inp.d?1:0)-(inp.a?1:0),my=(inp.s?1:0)-(inp.w?1:0)
                const ml=Math.hypot(mx,my)||1
                if(ml>0.1){p.vx+=(mx/ml)*BOOST_ACCEL*dt;p.vy+=(my/ml)*BOOST_ACCEL*dt}
            }
            p.vx*=Math.pow(FRICTION,dt*60);p.vy*=Math.pow(FRICTION,dt*60)
            const maxS=boosting?BOOST_MAX:MAX_SPD,spd=Math.hypot(p.vx,p.vy)
            if(spd>maxS){p.vx=p.vx/spd*maxS;p.vy=p.vy/spd*maxS}
        }
        p.x+=p.vx*dt;p.y+=p.vy*dt
        if(p.x-CAR_R<WALL_L){p.x=WALL_L+CAR_R;p.vx=Math.abs(p.vx)*0.4}
        if(p.x+CAR_R>WALL_R){p.x=WALL_R-CAR_R;p.vx=-Math.abs(p.vx)*0.4}
        if(p.y-CAR_R<WALL_T){p.y=WALL_T+CAR_R;p.vy=Math.abs(p.vy)*0.4}
        if(p.y+CAR_R>WALL_B){p.y=WALL_B-CAR_R;p.vy=-Math.abs(p.vy)*0.4}
        gs.pads.forEach(pad=>{
            if(pad.active&&Math.hypot(p.x-pad.x,p.y-pad.y)<40){
                p.boost=Math.min(100,p.boost+pad.value)
                pad.active=false;pad.timer=pad.type==="big"?600:240
            }
        })
    })
    gs.pads.forEach(pad=>{if(!pad.active&&--pad.timer<=0)pad.active=true})

    const b=gs.ball
    b.vx*=Math.pow(0.9985,dt*60);b.vy*=Math.pow(0.9985,dt*60)
    b.spin*=Math.pow(0.990,dt*60);b.x+=b.vx*dt;b.y+=b.vy*dt
    if(b.x-BALL_R<WALL_L){
        const inG=b.y>GOAL_L.y&&b.y<GOAL_L.y+GOAL_L.h
        if(inG&&b.x+BALL_R<GOAL_L.x){handleGoal(gs,"orange");return}
        else if(!inG){b.x=WALL_L+BALL_R;b.vx=Math.abs(b.vx)*0.72;b.spin=-b.spin*0.5}
    }
    if(b.x+BALL_R>WALL_R){
        const inG=b.y>GOAL_R.y&&b.y<GOAL_R.y+GOAL_R.h
        if(inG&&b.x-BALL_R>GOAL_R.x+GOAL_R.w){handleGoal(gs,"blue");return}
        else if(!inG){b.x=WALL_R-BALL_R;b.vx=-Math.abs(b.vx)*0.72;b.spin=-b.spin*0.5}
    }
    if(b.y-BALL_R<WALL_T){b.y=WALL_T+BALL_R;b.vy=Math.abs(b.vy)*0.72}
    if(b.y+BALL_R>WALL_B){b.y=WALL_B-BALL_R;b.vy=-Math.abs(b.vy)*0.72}
    gs.players.forEach(p=>{
        const dx=b.x-p.x,dy=b.y-p.y,dist=Math.hypot(dx,dy),minD=BALL_R+CAR_R
        if(dist<minD&&dist>0.01){
            const nx=dx/dist,ny=dy/dist
            b.x+=nx*(minD-dist);b.y+=ny*(minD-dist)*0.5
            const rvx=b.vx-p.vx,rvy=b.vy-p.vy,relV=rvx*nx+rvy*ny
            if(relV<0){
                const cspd=Math.hypot(p.vx,p.vy)
                const imp=Math.max(200,-(1.5)*relV+cspd*0.85)
                b.vx+=nx*imp;b.vy+=ny*imp;b.spin+=nx*imp*0.05
            }
        }
    })
    gs.matchTime-=dt
    if(gs.matchTime<=0){gs.matchTime=0;gs.phase="over"}
}

function handleGoal(gs,scorer){
    gs.scores[scorer]++
    gs.phase="goal"
    broadcastEvent({type:"goal",scorer,scores:gs.scores,settings:gs.settings})
    setTimeout(()=>{
        resetAfterGoal(gs)
        broadcastEvent({type:"kickoff",scores:gs.scores,settings:gs.settings})
    },3000)
}

// ─── WEBRTC ──────────────────────────────────────────────────────
// Creates a peer connection and DataChannel for one client.
// sigSocket = the signaling socket (works from lobby OR game page).
async function createPeerConnection(peerId, sigSocket){
    if(peers[peerId]){
        // Already have a connection — tear it down and redo
        try{peers[peerId].dc.close();peers[peerId].pc.close()}catch{}
        delete peers[peerId]
    }
    const pc=new RTCPeerConnection(RTC_CONFIG)
    const dc=pc.createDataChannel("game",{ordered:false,maxRetransmits:0})
    peers[peerId]={pc,dc}

    dc.onopen=()=>{
        console.log("[host] DataChannel open →",peerId)
        if(gameState){
            // Game already running — send init packet
            dc.send(JSON.stringify({
                type:"init", myId:peerId,
                players:gameState.players, settings:gameState.settings
            }))
        }
    }
    dc.onmessage=e=>{
        try{
            const msg=JSON.parse(e.data)
            if(msg.type==="input"){
                const p=gameState&&gameState.players.find(x=>x.id===peerId)
                if(p){p.input=msg.input;p.lastSeq=msg.seq||0}
            }
        }catch{}
    }
    dc.onclose=()=>{ console.log("[host] DataChannel closed",peerId); delete peers[peerId] }
    pc.onicecandidate=e=>{
        if(e.candidate) sigSocket.emit("rtc:ice",{to:peerId,candidate:e.candidate})
    }

    const offer=await pc.createOffer()
    await pc.setLocalDescription(offer)
    sigSocket.emit("rtc:offer",{to:peerId,offer})
}

function broadcastState(){
    if(!gameState) return
    const msg=JSON.stringify(buildStateMsg())
    Object.values(peers).forEach(({dc})=>{ if(dc.readyState==="open") dc.send(msg) })
    if(typeof onStateUpdate==="function") onStateUpdate(buildStateMsg())
}

function broadcastEvent(evt){
    const msg=JSON.stringify(evt)
    Object.values(peers).forEach(({dc})=>{ if(dc.readyState==="open") dc.send(msg) })
    if(typeof onGameEvent==="function") onGameEvent(evt)
}

function buildStateMsg(){
    const gs=gameState
    return {
        type:"state",
        players:gs.players.map(p=>({
            id:p.id,x:Math.round(p.x),y:Math.round(p.y),
            vx:+p.vx.toFixed(1),vy:+p.vy.toFixed(1),
            boost:Math.floor(p.boost),dashing:p.dashing,
            dashTimer:+(p.dashTimer||0).toFixed(3),
            dashCd:+(p.dashCd||0).toFixed(2),
            isBoosting:!!(p.input.shift&&p.boost>0),
            seq:p.lastSeq||0,
            decal:p.decal||null,boostTrail:p.boostTrail||null
        })),
        ball:{x:Math.round(gs.ball.x),y:Math.round(gs.ball.y),spin:+gs.ball.spin.toFixed(2)},
        pads:gs.pads.map(p=>({active:p.active})),
        scores:gs.scores,matchTime:Math.ceil(gs.matchTime),
        settings:gs.settings,phase:gs.phase,
        kickoffTimer:Math.ceil(gs.kickoffTimer||0)
    }
}

// ─── PUBLIC API ───────────────────────────────────────────────────
function hostStartGame(players, settings){
    gameState=makeGameState(players,settings)
    setInterval(()=>{ if(gameState){physicsTick(gameState);broadcastState()} },1000/60)
}
function hostSetInput(inp){
    if(!gameState) return
    const me=gameState.players.find(p=>p.id===HOST_ID)
    if(me) me.input=inp
}
async function onPeerJoined(peerId, playerData, sigSocket){
    await createPeerConnection(peerId, sigSocket)
}
function onRtcAnswer(from, answer){
    const peer=peers[from]; if(!peer) return
    peer.pc.setRemoteDescription(new RTCSessionDescription(answer))
}
function onRtcIce(from, candidate){
    const peer=peers[from]; if(!peer) return
    peer.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(()=>{})
}
