// ═══════════════════════════════════════════════════════════════
//  CHAMPIONS FIELD — LOBBY.JS
//  ALL WebRTC setup happens here.
//  By the time "Iniciar Partida" is clicked, DataChannels are open.
// ═══════════════════════════════════════════════════════════════
const socket = io()
const params = new URLSearchParams(window.location.search)
const room   = params.get("room")
document.getElementById("roomCode").textContent = room

// Make socket accessible to client.js onRtcOffer
_sigSocket = socket

const playerData = JSON.parse(localStorage.getItem("playerData") || "{}")
// Default team to blue if not set
if(!playerData.team) playerData.team = "blue"

let amHost         = false
let mySocketId     = null
let myHostId       = null
let currentPlayers = []
let currentSettings= {}

// ── JOIN ─────────────────────────────────────────────────────────
socket.on("connect", () => {
    mySocketId = socket.id
    socket.emit("joinLobby", { room, ...playerData })
})

socket.on("lobbyJoined", ({ hostId, players, settings, myId }) => {
    mySocketId   = myId
    myHostId     = hostId
    amHost       = (myId === hostId)

    // If I am a client (not host), start WebRTC connection to host
    if(!amHost){
        clientConnect(hostId, socket, myId)
    } else {
        // I am the host — set HOST_ID
        HOST_ID = myId
    }

    currentPlayers  = players
    currentSettings = settings

    document.getElementById("startBtn").style.display = amHost ? "block" : "none"
    applySettings(settings)
    renderAllPlayers(players)
})

socket.on("lobbyUpdate", ({ players, settings }) => {
    currentPlayers  = players
    currentSettings = settings
    applySettings(settings)
    renderAllPlayers(players)
})

socket.on("roomError", msg => {
    const el = document.getElementById("lobby-error")
    if(el){ el.textContent = "⚠ " + msg; el.style.display = "block" }
    else   console.error("Room error:", msg)
})

// ── WebRTC SIGNALING (host side) ──────────────────────────────────
socket.on("peerJoined", async ({ peerId, playerData: pd }) => {
    if(!amHost) return
    console.log("[lobby] peerJoined:", peerId)
    await onPeerJoined(peerId, pd, socket)
})

// WebRTC signaling — host receives answers, client receives offers
socket.on("rtc:offer", ({ from, offer }) => {
    if(!amHost) onRtcOffer(from, offer)
})
socket.on("rtc:answer", ({ from, answer }) => {
    if(amHost) onRtcAnswer(from, answer)
})
socket.on("rtc:ice", ({ from, candidate }) => {
    if(amHost) onRtcIce(from, candidate)
    else       onRtcIce(from, candidate)
})

socket.on("peerLeft", ({ peerId }) => {
    if(peers[peerId]){
        try{peers[peerId].dc.close();peers[peerId].pc.close()}catch{}
        delete peers[peerId]
    }
    // Remove from display
    currentPlayers = currentPlayers.filter(p => p.id !== peerId)
    renderAllPlayers(currentPlayers)
})

socket.on("gameStarted", () => {
    // Non-host clients navigate to game page
    if(!amHost){
        localStorage.setItem("hostId", myHostId)
        window.location.href = `game.html?room=${room}`
    }
})

// ── TEAM SELECTION ────────────────────────────────────────────────
function joinTeam(team){
    const data = JSON.parse(localStorage.getItem("playerData") || "{}")
    data.team  = team
    localStorage.setItem("playerData", JSON.stringify(data))
    socket.emit("joinTeam", { room, team })
}

// ── SETTINGS ─────────────────────────────────────────────────────
function pushSettings(){
    if(!amHost) return
    const s = readSettings()
    socket.emit("updateSettings", { room, settings: s })
    applyPreview(s)
}

function readSettings(){
    return {
        blueTeamName:   v("cfg-bluename")   || "BLUE",
        orangeTeamName: v("cfg-orangename") || "ORANGE",
        blueColor:      v("cfg-bluecolor"),
        orangeColor:    v("cfg-orangecolor"),
        seriesTitle:    v("cfg-series")     || "CHAMPIONS FIELD",
        gameNum:        parseInt(v("cfg-gamenum"))  || 1,
        bestOf:         parseInt(v("cfg-bestof"))   || 7,
    }
}

function v(id){ const el=document.getElementById(id); return el?el.value:"" }

function applySettings(s){
    const set=(id,val)=>{ const el=document.getElementById(id); if(el) el.value=val }
    set("cfg-bluename",    s.blueTeamName)
    set("cfg-orangename",  s.orangeTeamName)
    set("cfg-bluecolor",   s.blueColor)
    set("cfg-orangecolor", s.orangeColor)
    set("cfg-series",      s.seriesTitle)
    set("cfg-gamenum",     s.gameNum)
    set("cfg-bestof",      s.bestOf)
    ;["cfg-bluename","cfg-orangename","cfg-bluecolor","cfg-orangecolor",
      "cfg-series","cfg-gamenum","cfg-bestof"].forEach(id=>{
        const el=document.getElementById(id); if(el) el.disabled=!amHost
    })
    applyPreview(s)
}

function applyPreview(s){
    const t=(id,val)=>{ const el=document.getElementById(id); if(el) el.textContent=val }
    const c=(id,p,val)=>{ const el=document.getElementById(id); if(el) el.style[p]=val }
    t("sbp-blue-name",   s.blueTeamName)
    t("sbp-orange-name", s.orangeTeamName)
    t("sbp-series-text", s.seriesTitle)
    t("sbp-game-text",   "GAME "+s.gameNum)
    t("sbp-bo-text",     "BEST OF "+s.bestOf)
    t("blue-label",      s.blueTeamName)
    t("orange-label",    s.orangeTeamName)
    c("sbp-blue-bar",   "background", s.blueColor)
    c("sbp-orange-bar", "background", s.orangeColor)
    c("blue-label",     "color",      s.blueColor)
    c("orange-label",   "color",      s.orangeColor)
    c("blue-dot",       "background", s.blueColor)
    c("blue-dot",       "boxShadow",  `0 0 8px ${s.blueColor}`)
    c("orange-dot",     "background", s.orangeColor)
    c("orange-dot",     "boxShadow",  `0 0 8px ${s.orangeColor}`)
}

// ── RENDER ────────────────────────────────────────────────────────
function renderAllPlayers(players){
    renderTeam("bluePlayers",   players.filter(p=>p.team==="blue"))
    renderTeam("orangePlayers", players.filter(p=>p.team==="orange"))
}

function renderTeam(divId, players){
    const div=document.getElementById(divId); if(!div) return
    div.innerHTML=""
    players.forEach(p=>{
        const card=document.createElement("div"); card.className="playerCard"
        const hostBadge=(p.id===myHostId)?
            `<span style="color:#ffd700;font-size:9px;letter-spacing:1px;margin-left:4px">HOST</span>`:""
        card.innerHTML=`
            <div class="avatar-container">
                <img src="${p.pfp||'assets/default_pfp.png'}" class="pfp"
                     onerror="this.src='assets/default_pfp.png'">
            </div>
            <div class="info-container"
                 style="background-image:url('${p.banner||'assets/banners/Default.png'}')">
                <div class="name">${p.name||"Jugador"}${hostBadge}</div>
                <div class="playerTitle" style="color:${p.titleColor||'#aaa'}">
                    ${p.title||""}
                </div>
            </div>`
        div.appendChild(card)
    })
}

// ── START GAME ────────────────────────────────────────────────────
function startGame(){
    if(!amHost) return
    const settings = readSettings()
    // Save for game.html bootstrap
    localStorage.setItem("lobbyData", JSON.stringify({
        players: currentPlayers,
        settings
    }))
    localStorage.setItem("hostId", socket.id)
    // Tell server — clients will navigate on "gameStarted" event
    socket.emit("gameStarted", { room })
    // Host navigates
    window.location.href = `game.html?room=${room}&host=1`
}
