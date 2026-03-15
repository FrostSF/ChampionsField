const socket = io()

const SPECIAL_TITLES = {
    "Frost":   { title: "DEVELOPER", color: "#ff2222" },
    "Matias":  { title: "GOAT",       color: "#00ff66" },
    "Tester":  { title: "BETA TESTER",color: "#55ffff" },
}

let player = {
    name:       "Jugador",
    title:      "ROOKIE",
    titleColor: "#aaaaaa",
    pfp:        "assets/default_pfp.png",
    banner:     "assets/banners/Default.png",
    team:       "red"
}

// Load saved data
const saved = JSON.parse(localStorage.getItem("playerData") || "null")
if (saved) {
    player = { ...player, ...saved }
    if (saved.name)   document.getElementById("username").value  = saved.name
    if (saved.banner) {
        const bannerFile = saved.banner.split("/").pop()
        const sel = document.getElementById("banner-select")
        for (let i=0;i<sel.options.length;i++) {
            if (sel.options[i].value === bannerFile) { sel.selectedIndex = i; break }
        }
    }
    renderPreview()
}

// PFP upload
document.getElementById("pfp-input").addEventListener("change", (e) => {
    const reader = new FileReader()
    reader.onload = () => {
        player.pfp = reader.result
        document.getElementById("pfp-preview").src = reader.result
    }
    reader.readAsDataURL(e.target.files[0])
})

function checkSpecialTitle() {
    const name = document.getElementById("username").value.trim()
    const sel  = document.getElementById("player-title")
    if (SPECIAL_TITLES[name]) {
        player.title      = SPECIAL_TITLES[name].title
        player.titleColor = SPECIAL_TITLES[name].color
        sel.disabled = true
    } else {
        sel.disabled = false
        updateTitlePreview()
    }
    renderPreview()
}

function updateTitlePreview() {
    const raw = document.getElementById("player-title").value
    const [name, color] = raw.split("|")
    player.title      = name
    player.titleColor = color
    renderPreview()
}

function previewBanner() {
    player.banner = "assets/banners/" + document.getElementById("banner-select").value
    renderPreview()
}

function renderPreview() {
    document.getElementById("title-preview").innerText    = player.title
    document.getElementById("title-preview").style.color  = player.titleColor
    document.getElementById("banner-preview-img").src     = player.banner
}

function saveToLocalStorage(team = player.team || "red") {
    player.name = document.getElementById("username").value.trim() || "Jugador"
    player.team = team
    localStorage.setItem("playerData", JSON.stringify(player))
}

function createRoom() {
    saveToLocalStorage()
    socket.emit("createRoom")
}

socket.on("roomCreated", (code) => {
    window.location.href = "lobby.html?room=" + code
})

function joinRoom() {
    const code = document.getElementById("roomCode").value.trim().toUpperCase()
    if (!code) return alert("Escribe un código de sala")
    saveToLocalStorage()
    window.location.href = "lobby.html?room=" + code
}
