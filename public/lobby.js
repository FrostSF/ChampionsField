const socket = io()
const params = new URLSearchParams(window.location.search)
const room   = params.get("room")

document.getElementById("roomCode").textContent = room

const playerData = JSON.parse(localStorage.getItem("playerData") || "{}")
socket.emit("joinLobby", { room, ...playerData })

function joinTeam(team) {
    const data = JSON.parse(localStorage.getItem("playerData") || "{}")
    data.team  = team
    localStorage.setItem("playerData", JSON.stringify(data))
    socket.emit("joinTeam", { room, team })
}

function pushSettings() {
    const settings = readSettings()
    socket.emit("updateSettings", { room, settings })
    applyPreview(settings)
}

function readSettings() {
    return {
        blueTeamName:   document.getElementById("cfg-bluename").value   || "BLUE",
        orangeTeamName: document.getElementById("cfg-orangename").value || "ORANGE",
        blueColor:      document.getElementById("cfg-bluecolor").value,
        orangeColor:    document.getElementById("cfg-orangecolor").value,
        seriesTitle:    document.getElementById("cfg-series").value     || "FRIENDLY MATCH",
        gameNum:        parseInt(document.getElementById("cfg-gamenum").value) || 1,
        bestOf:         parseInt(document.getElementById("cfg-bestof").value)  || 7,
    }
}

function applyPreview(s) {
    // Update scoreboard preview
    document.getElementById("sbp-blue-name").textContent    = s.blueTeamName
    document.getElementById("sbp-orange-name").textContent  = s.orangeTeamName
    document.getElementById("sbp-blue-bar").style.background   = s.blueColor
    document.getElementById("sbp-orange-bar").style.background = s.orangeColor
    document.getElementById("sbp-series-text").textContent  = s.seriesTitle
    document.getElementById("sbp-game-text").textContent    = "GAME " + s.gameNum
    document.getElementById("sbp-bo-text").textContent      = "BEST OF " + s.bestOf
    // Update team headers
    document.getElementById("blue-label").textContent    = s.blueTeamName
    document.getElementById("orange-label").textContent  = s.orangeTeamName
    document.getElementById("blue-label").style.color    = s.blueColor
    document.getElementById("orange-label").style.color  = s.orangeColor
    document.getElementById("blue-dot").style.background    = s.blueColor
    document.getElementById("blue-dot").style.boxShadow     = `0 0 8px ${s.blueColor}`
    document.getElementById("orange-dot").style.background  = s.orangeColor
    document.getElementById("orange-dot").style.boxShadow   = `0 0 8px ${s.orangeColor}`
}

socket.on("lobbyUpdate", ({ players, settings }) => {
    if (settings) {
        // Sync inputs from server (in case another tab changed them)
        document.getElementById("cfg-bluename").value   = settings.blueTeamName
        document.getElementById("cfg-orangename").value = settings.orangeTeamName
        document.getElementById("cfg-bluecolor").value  = settings.blueColor
        document.getElementById("cfg-orangecolor").value= settings.orangeColor
        document.getElementById("cfg-series").value     = settings.seriesTitle
        document.getElementById("cfg-gamenum").value    = settings.gameNum
        document.getElementById("cfg-bestof").value     = settings.bestOf
        applyPreview(settings)
    }
    renderTeam("bluePlayers",   players.filter(p => p.team === "blue"))
    renderTeam("orangePlayers", players.filter(p => p.team === "orange"))
})

function renderTeam(divId, players) {
    const div = document.getElementById(divId)
    if (!div) return
    div.innerHTML = ""
    players.forEach(p => {
        const card = document.createElement("div")
        card.className = "playerCard"
        const banner = p.banner || "assets/banners/Default.png"
        card.innerHTML = `
            <div class="avatar-container">
                <img src="${p.pfp||'assets/default_pfp.png'}" class="pfp" onerror="this.src='assets/default_pfp.png'">
            </div>
            <div class="info-container" style="background-image:url('${banner}')">
                <div class="name">${p.name||"Jugador"}</div>
                <div class="playerTitle" style="color:${p.titleColor||'#aaa'}">${p.title||""}</div>
            </div>`
        div.appendChild(card)
    })
}

function startGame() {
    window.location.href = "game.html?room=" + room
}
