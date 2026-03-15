const socket = io()

const SPECIAL_TITLES = {
    "Frost":  { title:"DEVELOPER",   color:"#ff2222" },
    "Matias": { title:"GOAT",         color:"#00ff66" },
    "Tester": { title:"BETA TESTER",  color:"#55ffff" },
}

let player = {
    name:"Jugador", title:"ROOKIE", titleColor:"#aaaaaa",
    pfp:"assets/default_pfp.png",
    banner:"assets/banners/Default.png",
    decal:null, boostTrail:null,
    team:"blue"
}

// ─── LOAD SAVED DATA ─────────────────────────────────────────────
const saved = JSON.parse(localStorage.getItem("playerData")||"null")
if(saved){
    player = { ...player, ...saved }
    applyLoaded()
}

function applyLoaded(){
    const el = id => document.getElementById(id)
    if(player.name && el("username")) el("username").value = player.name
    if(player.banner && el("banner-select")){
        const file = player.banner.split("/").pop()
        const sel  = el("banner-select")
        for(let i=0;i<sel.options.length;i++) if(sel.options[i].value===file){sel.selectedIndex=i;break}
    }
    if(player.pfp && player.pfp.startsWith("data:") && el("pfp-preview"))
        el("pfp-preview").src = player.pfp
    renderPreview()
    // Garage selections are restored inline in index.html
}

// ─── PFP ─────────────────────────────────────────────────────────
const pfpInput = document.getElementById("pfp-input")
if(pfpInput){
    pfpInput.addEventListener("change", e => {
        const r = new FileReader()
        r.onload = () => {
            player.pfp = r.result
            document.getElementById("pfp-preview").src = r.result
        }
        r.readAsDataURL(e.target.files[0])
    })
}

// ─── PROFILE PREVIEWS ────────────────────────────────────────────
function checkSpecialTitle(){
    const name = document.getElementById("username").value.trim()
    const sel  = document.getElementById("player-title")
    if(SPECIAL_TITLES[name]){
        player.title      = SPECIAL_TITLES[name].title
        player.titleColor = SPECIAL_TITLES[name].color
        sel.disabled = true
    } else {
        sel.disabled = false
        updateTitlePreview()
    }
    renderPreview()
}

function updateTitlePreview(){
    const [name,color] = document.getElementById("player-title").value.split("|")
    player.title      = name
    player.titleColor = color
    renderPreview()
}

function previewBanner(file){
    // accepts filename like "Default.png" or full path
    if(!file) return
    player.banner = file.includes("/") ? file : "assets/banners/" + file
    saveToLocalStorage()
}

function renderPreview(){
    const tp = document.getElementById("title-preview")
    const bi = document.getElementById("banner-preview-img")
    if(tp){ tp.innerText = player.title; tp.style.color = player.titleColor }
    if(bi) bi.src = player.banner
}

// ─── GARAGE ──────────────────────────────────────────────────────
function previewDecal(val){
    player.decal = val || null
    saveToLocalStorage()
}
function previewBoost(val){
    player.boostTrail = val || null
    saveToLocalStorage()
}

// ─── SAVE ────────────────────────────────────────────────────────
function saveToLocalStorage(team = player.team || "blue"){
    const usernameEl = document.getElementById("username")
    player.name = (usernameEl ? usernameEl.value.trim() : player.name) || "Jugador"
    player.team = team
    localStorage.setItem("playerData", JSON.stringify(player))
}

// ─── ROOM ACTIONS ────────────────────────────────────────────────
function createRoom(){
    saveToLocalStorage()
    const pd = JSON.parse(localStorage.getItem("playerData") || "{}")
    socket.emit("createRoom", pd)
}

socket.on("roomCreated", code => {
    window.location.href = "lobby.html?room=" + code
})

function joinRoom(){
    const codeEl = document.getElementById("roomCode")
    const code   = (codeEl ? codeEl.value.trim() : "").toUpperCase()
    if(!code) return alert("Escribe un código de sala")
    saveToLocalStorage()
    window.location.href = "lobby.html?room=" + code
}

function startFreePlay(){
    saveToLocalStorage()
    window.location.href = "game.html?free=1"
}
