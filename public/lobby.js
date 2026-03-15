// ═══════════════════════════════════════════════════════════════
//  CHAMPIONS FIELD — LOBBY.JS  (socket.io, no WebRTC)
// ═══════════════════════════════════════════════════════════════
const socket = io()
const params = new URLSearchParams(window.location.search)
const room   = params.get("room")
document.getElementById("roomCode").textContent = room

const pd = JSON.parse(localStorage.getItem("playerData")||"{}")
if(!pd.team) pd.team = "blue"

let amHost=false, myId=null
let currentPlayers=[], currentSettings={}

socket.on("connect", ()=>{
    myId = socket.id
    socket.emit("joinLobby",{room,...pd})
})

socket.on("lobbyJoined", ({myId:id, players, settings, phase})=>{
    myId = id
    // Host = whoever joined first (players[0])
    amHost = (id === players[0]?.id)
    currentPlayers=players; currentSettings=settings

    document.getElementById("startBtn").style.display = amHost ? "block" : "none"
    const hostNote = document.getElementById("host-note")
    if(hostNote) hostNote.style.display = amHost ? "none" : "block"

    applySettings(settings)
    renderAllPlayers(players)
})

socket.on("lobbyUpdate", ({players, settings})=>{
    currentPlayers=players; currentSettings=settings
    amHost = (myId === players[0]?.id)
    document.getElementById("startBtn").style.display = amHost ? "block" : "none"
    const hostNote = document.getElementById("host-note")
    if(hostNote) hostNote.style.display = amHost ? "none" : "block"
    applySettings(settings)
    renderAllPlayers(players)
})

socket.on("roomError", msg=>{
    const el=document.getElementById("lobby-error")
    if(el){el.textContent="⚠ "+msg; el.style.display="block"}
})

socket.on("gameStarted", ()=>{
    window.location.href=`game.html?room=${room}`
})

function joinTeam(team){
    const data=JSON.parse(localStorage.getItem("playerData")||"{}")
    data.team=team
    localStorage.setItem("playerData",JSON.stringify(data))
    socket.emit("joinTeam",{room,team})
}

function pushSettings(){
    if(!amHost) return
    const s=readSettings()
    socket.emit("updateSettings",{room,settings:s})
    applyPreview(s)
}

function readSettings(){
    const v=id=>{const el=document.getElementById(id);return el?el.value:""}
    return {
        blueTeamName:  v("cfg-bluename")||"BLUE",
        orangeTeamName:v("cfg-orangename")||"ORANGE",
        blueColor:     v("cfg-bluecolor"),
        orangeColor:   v("cfg-orangecolor"),
        seriesTitle:   v("cfg-series")||"CHAMPIONS FIELD",
        gameNum:       parseInt(v("cfg-gamenum"))||1,
        bestOf:        parseInt(v("cfg-bestof"))||7,
    }
}

function applySettings(s){
    const set=(id,val)=>{const el=document.getElementById(id);if(el)el.value=val}
    set("cfg-bluename",s.blueTeamName); set("cfg-orangename",s.orangeTeamName)
    set("cfg-bluecolor",s.blueColor);   set("cfg-orangecolor",s.orangeColor)
    set("cfg-series",s.seriesTitle);    set("cfg-gamenum",s.gameNum); set("cfg-bestof",s.bestOf)
    ;["cfg-bluename","cfg-orangename","cfg-bluecolor","cfg-orangecolor","cfg-series","cfg-gamenum","cfg-bestof"]
        .forEach(id=>{const el=document.getElementById(id);if(el)el.disabled=!amHost})
    applyPreview(s)
}

function applyPreview(s){
    const t=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v}
    const c=(id,p,v)=>{const el=document.getElementById(id);if(el)el.style[p]=v}
    t("sbp-blue-name",s.blueTeamName); t("sbp-orange-name",s.orangeTeamName)
    t("sbp-series-text",s.seriesTitle); t("sbp-game-text","GAME "+s.gameNum); t("sbp-bo-text","BEST OF "+s.bestOf)
    t("blue-label",s.blueTeamName);    t("orange-label",s.orangeTeamName)
    c("sbp-blue-bar","background",s.blueColor);  c("sbp-orange-bar","background",s.orangeColor)
    c("blue-label","color",s.blueColor);          c("orange-label","color",s.orangeColor)
    c("blue-dot","background",s.blueColor);       c("blue-dot","boxShadow",`0 0 8px ${s.blueColor}`)
    c("orange-dot","background",s.orangeColor);   c("orange-dot","boxShadow",`0 0 8px ${s.orangeColor}`)
}

function renderAllPlayers(players){
    renderTeam("bluePlayers",  players.filter(p=>p.team==="blue"))
    renderTeam("orangePlayers",players.filter(p=>p.team==="orange"))
}

function renderTeam(divId,players){
    const div=document.getElementById(divId); if(!div) return
    div.innerHTML=""
    players.forEach(p=>{
        const card=document.createElement("div"); card.className="playerCard"
        const isMe = p.id===myId
        card.innerHTML=`
            <div class="avatar-container">
                <img src="${p.pfp||'assets/default_pfp.png'}" class="pfp" onerror="this.src='assets/default_pfp.png'">
            </div>
            <div class="info-container" style="background-image:url('${p.banner||'assets/banners/Default.png'}')">
                <div class="name">${p.name||"Jugador"}${isMe?' <span style="color:#ffd700;font-size:9px">TÚ</span>':''}</div>
                <div class="playerTitle" style="color:${p.titleColor||'#aaa'}">${p.title||""}</div>
            </div>`
        div.appendChild(card)
    })
}

function startGame(){
    if(!amHost) return
    socket.emit("startGame",{room})
}
