const socket = io()
const canvas = document.getElementById("game")
const ctx = canvas.getContext("2d")

const fieldImg = new Image();
fieldImg.src = "assets/field.png"; 

let players = [] 
let ball = { x: 700, y: 450 } 
let targetBall = { x: 700, y: 450 } 
let boostPads = [] 
let keys = {}

// CONTROLES MÓVIL
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

// Touch Events
canvas.addEventListener("touchstart", (e) => {
    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    joystick.active = true;
    joystick.startX = (touch.clientX - rect.left) * (canvas.width / rect.width);
    joystick.startY = (touch.clientY - rect.top) * (canvas.height / rect.height);
    joystick.x = joystick.startX; joystick.y = joystick.startY;
});
canvas.addEventListener("touchmove", (e) => {
    if (!joystick.active) return;
    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    joystick.x = (touch.clientX - rect.left) * (canvas.width / rect.width);
    joystick.y = (touch.clientY - rect.top) * (canvas.height / rect.height);
    const dx = joystick.x - joystick.startX;
    const dy = joystick.y - joystick.startY;
    touchInput.a = dx < -20; touchInput.d = dx > 20;
    touchInput.w = dy < -20; touchInput.s = dy > 20;
    touchInput.shift = Math.abs(dx) > 60 || Math.abs(dy) > 60;
});
canvas.addEventListener("touchend", () => {
    joystick.active = false;
    touchInput = { w: false, s: false, a: false, d: false, shift: false };
});

socket.on("state", (state) => {
    state.players.forEach(serverPlayer => {
        let localPlayer = players.find(p => p.id === serverPlayer.id);
        if (localPlayer) {
            localPlayer.targetX = serverPlayer.x;
            localPlayer.targetY = serverPlayer.y;
            localPlayer.boost = serverPlayer.boost;
            localPlayer.team = serverPlayer.team;
        }
    });
    targetBall = state.ball;
    boostPads = state.boostPads || [];
});

socket.on("playerInfoUpdate", (fullPlayerData) => {
    players = fullPlayerData;
    updateSidePanels();
});

function drawPlayers() {
    players.forEach(p => {
        if (p.x === undefined) { p.x = p.targetX; p.y = p.targetY; }

        if (p.id === socket.id) {
            // Predicción simplificada sin fricción acumulada (evita el lag pesado)
            let speed = (keys['shift'] || touchInput.shift) && p.boost > 0 ? 9 : 5; 
            if (keys['w'] || touchInput.w) p.y -= speed;
            if (keys['s'] || touchInput.s) p.y += speed;
            if (keys['a'] || touchInput.a) p.x -= speed;
            if (keys['d'] || touchInput.d) p.x += speed;

            // Suavizado rápido hacia la posición del server
            p.x += (p.targetX - p.x) * 0.4;
            p.y += (p.targetY - p.y) * 0.4;
        } else {
            // Demás jugadores con interpolación alta
            p.x += (p.targetX - p.x) * 0.5;
            p.y += (p.targetY - p.y) * 0.5;
        }

        ctx.beginPath();
        ctx.fillStyle = p.team === "blue" ? "#00bcff" : "#ff3b3b";
        ctx.arc(p.x, p.y, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "white"; ctx.lineWidth = 2; ctx.stroke();
        ctx.textAlign = "center"; ctx.fillStyle = "white"; ctx.font = "bold 14px Segoe UI";
        ctx.fillText(p.name, p.x, p.y - 35);
    });
}

function drawBall() {
    // Balón casi instantáneo para que el choque se sienta real
    ball.x += (targetBall.x - ball.x) * 0.7;
    ball.y += (targetBall.y - ball.y) * 0.7;

    ctx.beginPath(); ctx.fillStyle = "white";
    ctx.arc(ball.x, ball.y, 10, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "black"; ctx.stroke();
}

function draw() {
    ctx.clearRect(0, 0, 1400, 900);
    if (fieldImg.complete) ctx.drawImage(fieldImg, 0, 0, 1400, 900);
    else { ctx.fillStyle = "#1b7a2f"; ctx.fillRect(0, 0, 1400, 900); }
    
    boostPads.forEach(pad => {
        ctx.beginPath(); ctx.fillStyle = "rgba(255, 215, 0, 0.4)";
        ctx.arc(pad.x, pad.y, 25, 0, Math.PI * 2); ctx.fill();
    });

    drawPlayers();
    drawBall();
    
    // UI de Boost
    const myPlayer = players.find(p => p.id === socket.id);
    if (myPlayer && myPlayer.boost !== undefined) {
        const x = 1300, y = 800;
        ctx.beginPath(); ctx.arc(x, y, 60, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 12; ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 60, -Math.PI/2, -Math.PI/2 + (Math.PI*2*(myPlayer.boost/100)));
        ctx.strokeStyle = myPlayer.boost > 20 ? "orange" : "red"; ctx.stroke();
        ctx.fillStyle = "white"; ctx.font = "24px Arial"; ctx.fillText(Math.floor(myPlayer.boost), x, y+10);
    }

    if (joystick.active) {
        ctx.beginPath(); ctx.arc(joystick.startX, joystick.startY, 50, 0, Math.PI * 2);
        ctx.strokeStyle = "white"; ctx.stroke();
        ctx.beginPath(); ctx.arc(joystick.x, joystick.y, 25, 0, Math.PI * 2);
        ctx.fillStyle = "white"; ctx.fill();
    }
    requestAnimationFrame(draw);
}

function updateSidePanels() {
    const redDiv = document.getElementById("redTeam");
    const blueDiv = document.getElementById("blueTeam");
    if(!redDiv || !blueDiv) return;
    redDiv.innerHTML = ""; blueDiv.innerHTML = "";
    players.forEach(p => {
        const card = document.createElement("div");
        card.className = "playerCard";
        card.innerHTML = `
            <div class="avatar-container"><img src="${p.pfp}" class="pfp"></div>
            <div class="info-container" style="background-image: url('${p.banner}')">
                <div class="name">${p.name}</div>
                <div class="playerTitle" style="color: ${p.titleColor}">${p.title}</div>
            </div>`;
        if(p.team === "red") redDiv.appendChild(card);
        else blueDiv.appendChild(card);
    });
}

setInterval(() => {
    socket.emit("move", { 
        w: keys["w"] || touchInput.w, a: keys["a"] || touchInput.a, 
        s: keys["s"] || touchInput.s, d: keys["d"] || touchInput.d, 
        shift: keys["shift"] || touchInput.shift 
    });
}, 1000 / 60);

draw();