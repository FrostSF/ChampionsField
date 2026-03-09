const socket = io()
const canvas = document.getElementById("game")
const ctx = canvas.getContext("2d")

// Configuración de la imagen de la cancha
const fieldImg = new Image();
fieldImg.src = "assets/field.png"; 

let players = [] 
let ball = { x: 700, y: 450 } 
let targetBall = { x: 700, y: 450 } 
let boostPads = [] 
let keys = {}

// --- SOPORTE MÓVIL (Joystick) ---
let joystick = { active: false, x: 0, y: 0, startX: 0, startY: 0 };
let touchInput = { w: false, s: false, a: false, d: false, shift: false };

const params = new URLSearchParams(window.location.search)
const room = params.get("room")
const playerData = JSON.parse(localStorage.getItem("playerData"))

socket.emit("joinGame", { room: room, ...playerData })

// Controles de Teclado
document.addEventListener("keydown", (e) => {
    const key = e.key === "Shift" ? "shift" : e.key.toLowerCase();
    keys[key] = true;
});
document.addEventListener("keyup", (e) => {
    const key = e.key === "Shift" ? "shift" : e.key.toLowerCase();
    keys[key] = false;
});

// Controles Táctiles (Joystick Virtual)
canvas.addEventListener("touchstart", (e) => {
    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    joystick.active = true;
    joystick.startX = (touch.clientX - rect.left) * (canvas.width / rect.width);
    joystick.startY = (touch.clientY - rect.top) * (canvas.height / rect.height);
    joystick.x = joystick.startX;
    joystick.y = joystick.startY;
});

canvas.addEventListener("touchmove", (e) => {
    if (!joystick.active) return;
    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    joystick.x = (touch.clientX - rect.left) * (canvas.width / rect.width);
    joystick.y = (touch.clientY - rect.top) * (canvas.height / rect.height);

    // Calcular dirección
    const dx = joystick.x - joystick.startX;
    const dy = joystick.y - joystick.startY;
    
    touchInput.a = dx < -20;
    touchInput.d = dx > 20;
    touchInput.w = dy < -20;
    touchInput.s = dy > 20;
    touchInput.shift = Math.abs(dx) > 60 || Math.abs(dy) > 60; // Shift si estira mucho el joystick
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
        if (p.x === undefined || isNaN(p.x)) p.x = p.targetX || 700;
        if (p.y === undefined || isNaN(p.y)) p.y = p.targetY || 450;

        if (p.id === socket.id) {
            // Predicción Local Calibrada
            let speed = (keys['shift'] || touchInput.shift) && p.boost > 0 ? 8 : 5; 
            if (keys['w'] || touchInput.w) p.y -= speed;
            if (keys['s'] || touchInput.s) p.y += speed;
            if (keys['a'] || touchInput.a) p.x -= speed;
            if (keys['d'] || touchInput.d) p.x += speed;

            // Suavizado de corrección (0.15 para evitar el 'snapback' brusco)
            p.x += (p.targetX - p.x) * 0.15;
            p.y += (p.targetY - p.y) * 0.15;
        } else {
            p.x += (p.targetX - p.x) * 0.6;
            p.y += (p.targetY - p.y) * 0.6;
        }

        ctx.beginPath();
        ctx.fillStyle = p.team === "blue" ? "#00bcff" : "#ff3b3b";
        ctx.arc(p.x, p.y, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "white"; ctx.lineWidth = 2; ctx.stroke();

        ctx.textAlign = "center"; ctx.fillStyle = "white";
        ctx.font = "bold 14px Segoe UI";
        ctx.fillText(p.name, p.x, p.y - 35);
    });
}

function drawJoystick() {
    if (!joystick.active) return;
    ctx.beginPath();
    ctx.arc(joystick.startX, joystick.startY, 50, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(joystick.x, joystick.y, 25, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.fill();
}

function drawBall() {
    ball.x += (targetBall.x - ball.x) * 0.6;
    ball.y += (targetBall.y - ball.y) * 0.6;
    ctx.beginPath();
    ctx.fillStyle = "white";
    ctx.arc(ball.x, ball.y, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "black"; ctx.stroke();
}

function drawBoostUI() {
    const myPlayer = players.find(p => p.id === socket.id);
    if (!myPlayer || myPlayer.boost === undefined) return;
    const x = 1300, y = 800, radius = 60;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.4)"; ctx.lineWidth = 12; ctx.stroke();
    const boostPerc = myPlayer.boost / 100;
    ctx.beginPath();
    ctx.arc(x, y, radius, -Math.PI / 2, (-Math.PI / 2) + (Math.PI * 2 * boostPerc));
    ctx.strokeStyle = myPlayer.boost > 25 ? "#ffae00" : "#ff3b3b";
    ctx.lineWidth = 12; ctx.lineCap = "round"; ctx.stroke();
    ctx.fillStyle = "white"; ctx.font = "bold 28px Segoe UI"; ctx.textAlign = "center";
    ctx.fillText(Math.floor(myPlayer.boost), x, y + 10);
}

function draw() {
    ctx.clearRect(0, 0, 1400, 900);
    if (fieldImg.complete) ctx.drawImage(fieldImg, 0, 0, 1400, 900);
    else { ctx.fillStyle = "#1b7a2f"; ctx.fillRect(0, 0, 1400, 900); }
    
    // Dibujar Pads
    boostPads.forEach(pad => {
        ctx.beginPath(); ctx.fillStyle = "rgba(255, 215, 0, 0.3)";
        ctx.arc(pad.x, pad.y, 20, 0, Math.PI * 2); ctx.fill();
    });

    drawPlayers();
    drawBall();
    drawBoostUI();
    drawJoystick();
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
        card.innerHTML = `<div class="info-container" style="background-image: url('${p.banner}')">
            <div class="name">${p.name}</div>
            <div class="playerTitle" style="color: ${p.titleColor}">${p.title}</div>
        </div>`;
        if(p.team === "red") redDiv.appendChild(card);
        else blueDiv.appendChild(card);
    });
}

setInterval(() => {
    socket.emit("move", { 
        w: keys["w"] || touchInput.w, 
        a: keys["a"] || touchInput.a, 
        s: keys["s"] || touchInput.s, 
        d: keys["d"] || touchInput.d, 
        shift: keys["shift"] || touchInput.shift 
    });
}, 1000 / 60);

draw();