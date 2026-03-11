const socket = io()
const canvas = document.getElementById("game")
const ctx = canvas.getContext("2d")

const fieldImg = new Image();
fieldImg.src = "assets/field.png"; 

let players = [] 
let ball = { x: 700, y: 450 } 
let boostPads = [] 
let keys = {}

// SOPORTE MÓVIL
let joystick = { active: false, x: 0, y: 0, startX: 0, startY: 0 };
let touchInput = { w: false, s: false, a: false, d: false, shift: false };

const params = new URLSearchParams(window.location.search)
const room = params.get("room")
const playerData = JSON.parse(localStorage.getItem("playerData"))

socket.emit("joinGame", { room: room, ...playerData })

document.addEventListener("keydown", (e) => {
    const key = e.key === "Shift" ? "shift" : e.key.toLowerCase();
    keys[key] = true;
});
document.addEventListener("keyup", (e) => {
    const key = e.key === "Shift" ? "shift" : e.key.toLowerCase();
    keys[key] = false;
});

// TOUCH EVENTS
canvas.addEventListener("touchstart", (e) => {
    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    joystick.active = true;
    joystick.startX = (touch.clientX - rect.left) * (canvas.width / rect.width);
    joystick.startY = (touch.clientY - rect.top) * (canvas.height / rect.height);
});
canvas.addEventListener("touchmove", (e) => {
    if (!joystick.active) return;
    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    const jX = (touch.clientX - rect.left) * (canvas.width / rect.width);
    const jY = (touch.clientY - rect.top) * (canvas.height / rect.height);
    const dx = jX - joystick.startX;
    const dy = jY - joystick.startY;
    touchInput.a = dx < -20; touchInput.d = dx > 20;
    touchInput.w = dy < -20; touchInput.s = dy > 20;
    touchInput.shift = Math.abs(dx) > 60 || Math.abs(dy) > 60;
});
canvas.addEventListener("touchend", () => {
    joystick.active = false;
    touchInput = { w: false, s: false, a: false, d: false, shift: false };
});

// --- OPTIMIZACIÓN DE RECEPCIÓN ---
socket.on("state", (state) => {
    // Solo actualizamos las variables físicas de los jugadores existentes
    state.players.forEach(sp => {
        let lp = players.find(p => p.id === sp.id);
        if (lp) {
            lp.x = sp.x;
            lp.y = sp.y;
            lp.boost = sp.boost;
        }
    });
    ball = state.ball;
    boostPads = state.boostPads || [];
});

socket.on("playerInfoUpdate", (fullPlayerData) => {
    // Aquí es donde SÍ recibimos PFPs y Banners, pero solo cuando alguien entra/sale
    players = fullPlayerData;
    updateSidePanels(fullPlayerData);
});

function drawPlayers() {
    players.forEach(p => {
        ctx.save();
        ctx.beginPath();
        ctx.fillStyle = p.team === "blue" ? "#00bcff" : "#ff3b3b";
        ctx.arc(p.x, p.y, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "white"; ctx.lineWidth = 2; ctx.stroke();
        
        ctx.textAlign = "center";
        ctx.fillStyle = "white";
        ctx.font = "bold 14px Segoe UI";
        ctx.fillText(p.name, p.x, p.y - 35);
        if(p.title) {
            ctx.fillStyle = p.titleColor || "#aaa";
            ctx.font = "bold 10px Segoe UI";
            ctx.fillText(p.title, p.x, p.y - 50);
        }
        ctx.restore();
    });
}

function drawBall() {
    ctx.beginPath(); ctx.fillStyle = "white";
    ctx.arc(ball.x, ball.y, 10, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "black"; ctx.stroke();
}

function drawBoostUI() {
    const myPlayer = players.find(p => p.id === socket.id);
    if (!myPlayer) return;
    const x = canvas.width - 80, y = canvas.height - 80, radius = 55;
    const boostPerc = (myPlayer.boost || 0) / 100;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fill();
    ctx.beginPath();
    ctx.lineWidth = 6; ctx.strokeStyle = "#333";
    ctx.arc(x, y, radius - 5, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.strokeStyle = "#ff8c00";
    ctx.arc(x, y, radius - 5, -Math.PI / 2, (-Math.PI / 2) + (Math.PI * 2 * boostPerc));
    ctx.stroke();
    ctx.fillStyle = "white"; ctx.font = "bold 28px Segoe UI"; ctx.textAlign = "center";
    ctx.fillText(Math.floor(myPlayer.boost || 0), x, y + 10);
    ctx.restore();
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (fieldImg.complete) ctx.drawImage(fieldImg, 0, 0, 1400, 900);
    boostPads.forEach(pad => {
        if (!pad.active) return;
        ctx.beginPath();
        ctx.fillStyle = pad.type === 'big' ? "rgba(255, 140, 0, 0.8)" : "rgba(255, 204, 0, 0.7)";
        ctx.arc(pad.x, pad.y, pad.type === 'big' ? 18 : 8, 0, Math.PI * 2);
        ctx.fill();
    });
    drawPlayers();
    drawBall();
    drawBoostUI();
    requestAnimationFrame(draw);
}

function updateSidePanels(pList) {
    const redDiv = document.getElementById("redTeam");
    const blueDiv = document.getElementById("blueTeam");
    if(!redDiv || !blueDiv) return;
    redDiv.innerHTML = ""; blueDiv.innerHTML = "";
    pList.forEach(p => {
        const card = document.createElement("div");
        card.className = "playerCard";
        const bannerPath = p.banner && p.banner.includes('assets') ? p.banner : `assets/banners/${p.banner || 'default.png'}`;
        card.innerHTML = `
            <div class="avatar-container"><img src="${p.pfp || 'assets/default_pfp.png'}" class="pfp"></div>
            <div class="info-container" style="background-image: url('${bannerPath}')">
                <div class="name">${p.name}</div>
                <div class="playerTitle" style="color: ${p.titleColor || '#fff'}">${p.title || ''}</div>
            </div>`;
        if(p.team === "red") redDiv.appendChild(card);
        else blueDiv.appendChild(card);
    });
}

// REDUCIMOS FRECUENCIA DE ENVÍO PARA EVITAR LAG DE SUBIDA
setInterval(() => {
    socket.emit("move", { 
        w: keys["w"] || touchInput.w, a: keys["a"] || touchInput.a, 
        s: keys["s"] || touchInput.s, d: keys["d"] || touchInput.d, 
        shift: keys["shift"] || touchInput.shift 
    });
}, 1000 / 45); 

draw();