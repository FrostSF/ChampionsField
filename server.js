// ═══════════════════════════════════════════════════════════════
//  CHAMPIONS FIELD — Server  (socket.io + server-side physics)
// ═══════════════════════════════════════════════════════════════
const express = require("express")
const app  = express()
const http = require("http").createServer(app)
const io   = require("socket.io")(http, {
    cors:{ origin:"*" }, pingInterval:10000, pingTimeout:25000
})
app.use(express.static("public"))
const PORT = process.env.PORT || 3000
http.listen(PORT, () => console.log("Champions Field :" + PORT))

// ─── CONSTANTS ───────────────────────────────────────────────────
const W=1600,H=820,WALL_T=55,WALL_B=H-55,WALL_L=55,WALL_R=W-55
const GOAL_W=40,GOAL_H=200,GOAL_CY=H/2
const GOAL_L={x:WALL_L-GOAL_W,y:GOAL_CY-GOAL_H/2,w:GOAL_W,h:GOAL_H}
const GOAL_R={x:WALL_R,y:GOAL_CY-GOAL_H/2,w:GOAL_W,h:GOAL_H}
const BALL_R=24,CAR_R=22,DT=1/60
const ACCEL=900,FRICTION=0.88,MAX_SPD=580
const BOOST_ACCEL=1400,BOOST_MAX=860,BOOST_DRAIN=38
const DASH_SPEED=MAX_SPD*1.3,DASH_DUR=0.16,DASH_CD=1.0
const PADS=[
    {x:180,y:180,type:"big",value:100},{x:W-180,y:180,type:"big",value:100},
    {x:180,y:H-180,type:"big",value:100},{x:W-180,y:H-180,type:"big",value:100},
    {x:W/2,y:H/2,type:"big",value:100},
    {x:W/2,y:160,type:"small",value:25},{x:W/2,y:H-160,type:"small",value:25},
    {x:160,y:H/2,type:"small",value:25},{x:W-160,y:H/2,type:"small",value:25},
    {x:W*.3,y:H*.3,type:"small",value:25},{x:W*.7,y:H*.3,type:"small",value:25},
    {x:W*.3,y:H*.7,type:"small",value:25},{x:W*.7,y:H*.7,type:"small",value:25},
]

const rooms = {}

function makeCode(){
    return Array.from({length:5},()=>"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[Math.floor(Math.random()*36)]).join("")
}
function spawnPos(team,idx,total){
    const x=team==="blue"?WALL_L+160:WALL_R-160
    const span=200,step=total>1?span/(total-1):0
    return {x,y:H/2-span/2+idx*step}
}
function makePlayer(id,d){
    const team=d.team||"blue"
    return {
        id, team,
        name:d.name||"Jugador", title:d.title||"ROOKIE",
        titleColor:d.titleColor||"#aaa",
        pfp:d.pfp||"assets/default_pfp.png",
        banner:d.banner||"assets/banners/Default.png",
        decal:d.decal||null, boostTrail:d.boostTrail||null,
        x:team==="blue"?WALL_L+160:WALL_R-160, y:H/2,
        vx:0,vy:0,
        boost:33,dashing:false,dashTimer:0,dashCd:0,dashVx:0,dashVy:0,
        input:{},lastSeq:0
    }
}
function makeRoom(){
    return {
        players:[],
        ball:{x:W/2,y:H/2,vx:0,vy:0,spin:0},
        pads:PADS.map(p=>({...p,active:true,timer:0})),
        scores:{blue:0,orange:0}, matchTime:300,
        phase:"lobby", kickoffTimer:3,
        settings:{
            blueTeamName:"BLUE",orangeTeamName:"ORANGE",
            blueColor:"#00aaff",orangeColor:"#ff6600",
            seriesTitle:"CHAMPIONS FIELD",gameNum:1,bestOf:7
        }
    }
}
function reposition(room){
    const bl=room.players.filter(p=>p.team==="blue")
    const or=room.players.filter(p=>p.team==="orange")
    bl.forEach((p,i)=>{const s=spawnPos("blue",i,bl.length);p.x=s.x;p.y=s.y;p.vx=0;p.vy=0})
    or.forEach((p,i)=>{const s=spawnPos("orange",i,or.length);p.x=s.x;p.y=s.y;p.vx=0;p.vy=0})
}

// ─── SOCKETS ─────────────────────────────────────────────────────
io.on("connection", socket => {

    // joinLobby creates the room if it doesn't exist (host) or joins it (client)
    // No separate createRoom needed — eliminates the socket-disconnect timing bug
    socket.on("joinLobby", (data) => {
        const code       = data.room
        const playerData = { ...data }
        delete playerData.room

        // Create room on first join
        if(!rooms[code]) rooms[code] = makeRoom()
        const room = rooms[code]

        socket.join(code)
        socket.roomCode = code

        if(!room.players.find(p=>p.id===socket.id)){
            room.players.push(makePlayer(socket.id, playerData))
        }

        socket.emit("lobbyJoined",{
            myId:socket.id,
            players:room.players,
            settings:room.settings,
            phase:room.phase
        })
        io.to(code).emit("lobbyUpdate",{players:room.players,settings:room.settings})
    })

    socket.on("joinTeam",({room:code,team})=>{
        const room=rooms[code];if(!room)return
        const p=room.players.find(p=>p.id===socket.id);if(p)p.team=team
        io.to(code).emit("lobbyUpdate",{players:room.players,settings:room.settings})
    })

    socket.on("updateSettings",({room:code,settings})=>{
        const room=rooms[code];if(!room)return
        Object.assign(room.settings,settings)
        io.to(code).emit("lobbyUpdate",{players:room.players,settings:room.settings})
    })

    socket.on("input",({seq,input})=>{
        for(const code in rooms){
            const p=rooms[code].players.find(p=>p.id===socket.id)
            if(p){p.input=input;p.lastSeq=seq}
        }
    })

    socket.on("startGame",({room:code})=>{
        const room=rooms[code];if(!room)return
        reposition(room)
        room.ball={x:W/2,y:H/2,vx:0,vy:0,spin:0}
        room.pads.forEach(p=>{p.active=true;p.timer=0})
        room.matchTime=300;room.phase="kickoffCountdown";room.kickoffTimer=3
        room.scores={blue:0,orange:0}
        io.to(code).emit("gameStarted",{players:room.players,settings:room.settings})
    })

    socket.on("disconnect",()=>{
        const code=socket.roomCode
        if(!code||!rooms[code])return
        const room=rooms[code]
        room.players=room.players.filter(p=>p.id!==socket.id)
        io.to(code).emit("lobbyUpdate",{players:room.players,settings:room.settings})
        // Clean up empty lobby rooms after a delay (allow reconnects)
        if(room.players.length===0 && room.phase==="lobby"){
            setTimeout(()=>{
                if(rooms[code]&&rooms[code].players.length===0) delete rooms[code]
            },15000)
        }
    })
})

// ─── PHYSICS LOOP ────────────────────────────────────────────────
setInterval(()=>{
    for(const code in rooms){
        const room=rooms[code]
        const dt=DT

        if(room.phase==="kickoffCountdown"){
            room.kickoffTimer-=dt
            if(room.kickoffTimer<=0){room.phase="playing";room.kickoffTimer=0}
            io.to(code).emit("state",buildState(room));continue
        }
        if(room.phase!=="playing")continue

        room.players.forEach(p=>{
            const inp=p.input||{}
            const boosting=!!(inp.shift&&p.boost>0)
            if(boosting)p.boost=Math.max(0,p.boost-BOOST_DRAIN*dt)
            if(p.dashCd>0)p.dashCd-=dt

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
                    const mx=(inp.d?1:0)-(inp.a?1:0),my=(inp.s?1:0)-(inp.w?1:0),ml=Math.hypot(mx,my)||1
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
            room.pads.forEach(pad=>{
                if(pad.active&&Math.hypot(p.x-pad.x,p.y-pad.y)<40){
                    p.boost=Math.min(100,p.boost+pad.value)
                    pad.active=false;pad.timer=pad.type==="big"?600:240
                }
            })
        })
        room.pads.forEach(pad=>{if(!pad.active&&--pad.timer<=0)pad.active=true})

        const b=room.ball
        b.vx*=Math.pow(0.9985,dt*60);b.vy*=Math.pow(0.9985,dt*60)
        b.spin*=Math.pow(0.990,dt*60);b.x+=b.vx*dt;b.y+=b.vy*dt

        if(b.x-BALL_R<WALL_L){
            const inG=b.y>GOAL_L.y&&b.y<GOAL_L.y+GOAL_L.h
            if(inG&&b.x+BALL_R<GOAL_L.x){handleGoal(room,code,"orange");continue}
            else if(!inG){b.x=WALL_L+BALL_R;b.vx=Math.abs(b.vx)*0.72;b.spin=-b.spin*0.5}
        }
        if(b.x+BALL_R>WALL_R){
            const inG=b.y>GOAL_R.y&&b.y<GOAL_R.y+GOAL_R.h
            if(inG&&b.x-BALL_R>GOAL_R.x+GOAL_R.w){handleGoal(room,code,"blue");continue}
            else if(!inG){b.x=WALL_R-BALL_R;b.vx=-Math.abs(b.vx)*0.72;b.spin=-b.spin*0.5}
        }
        if(b.y-BALL_R<WALL_T){b.y=WALL_T+BALL_R;b.vy=Math.abs(b.vy)*0.72}
        if(b.y+BALL_R>WALL_B){b.y=WALL_B-BALL_R;b.vy=-Math.abs(b.vy)*0.72}

        room.players.forEach(p=>{
            const dx=b.x-p.x,dy=b.y-p.y,dist=Math.hypot(dx,dy),minD=BALL_R+CAR_R
            if(dist<minD&&dist>0.01){
                const nx=dx/dist,ny=dy/dist
                b.x+=nx*(minD-dist);b.y+=ny*(minD-dist)*0.5
                const rvx=b.vx-p.vx,rvy=b.vy-p.vy,relV=rvx*nx+rvy*ny
                if(relV<0){
                    // Cap car speed contribution so dash doesn't launch ball across the map
                    const cspd=Math.min(Math.hypot(p.vx,p.vy), MAX_SPD*1.1)
                    const imp=Math.min(Math.max(200,-(1.4)*relV+cspd*0.6), 900)
                    b.vx+=nx*imp;b.vy+=ny*imp;b.spin+=nx*imp*0.05
                }
            }
        })

        room.matchTime-=dt
        if(room.matchTime<=0){
            room.matchTime=0; room.phase="over"
            io.to(code).emit("gameOver",room.scores)
            // Reset to lobby after 6s so returning players can restart
            setTimeout(()=>{
                if(rooms[code]){
                    rooms[code].phase="lobby"
                    rooms[code].scores={blue:0,orange:0}
                    rooms[code].settings.gameNum=1
                    io.to(code).emit("lobbyUpdate",{players:rooms[code].players,settings:rooms[code].settings})
                }
            },6000)
        }
        io.to(code).emit("state",buildState(room))
    }
},1000/60)

function buildState(room){
    return {
        players:room.players.map(p=>({
            id:p.id,x:Math.round(p.x),y:Math.round(p.y),
            vx:+p.vx.toFixed(1),vy:+p.vy.toFixed(1),
            boost:Math.floor(p.boost),dashing:p.dashing,
            dashTimer:+(p.dashTimer||0).toFixed(3),
            dashCd:+(p.dashCd||0).toFixed(2),
            isBoosting:!!(p.input&&p.input.shift&&p.boost>0),
            seq:p.lastSeq||0
        })),
        ball:{x:Math.round(room.ball.x),y:Math.round(room.ball.y),spin:+room.ball.spin.toFixed(2)},
        pads:room.pads.map(p=>({active:p.active})),
        scores:room.scores,matchTime:Math.ceil(room.matchTime),
        settings:room.settings,phase:room.phase,
        kickoffTimer:Math.ceil(room.kickoffTimer||0)
    }
}
function handleGoal(room,code,scorer){
    room.phase="goal"; room.scores[scorer]++
    room.settings.gameNum=(room.settings.gameNum||1)+1
    // Freeze time at current value — don't reset it
    const frozenTime = room.matchTime
    io.to(code).emit("goal",{scorer,scores:room.scores,settings:room.settings})
    setTimeout(()=>{
        reposition(room)
        room.ball={x:W/2,y:H/2,vx:0,vy:0,spin:0}
        room.pads.forEach(p=>{p.active=true;p.timer=0})
        room.matchTime=frozenTime   // resume from where it was
        room.phase="kickoffCountdown"; room.kickoffTimer=3
        io.to(code).emit("kickoff",{scores:room.scores,settings:room.settings})
    },3000)
}
