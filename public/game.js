const socket = io()
const canvas = document.getElementById("game")
const ctx = canvas.getContext("2d")
const fieldImg = new Image();
fieldImg.src = "assets/field.png"; 

let players = [], ball = { x: 700, y: 450 }, targetBall = { x: 700, y: 450 };
let boostPads = [], keys = {}, localVelX = 0, localVelY = 0;
const friction = 0.89;

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
    const touch = e.touches[0], rect = canvas.getBoundingClientRect();
    joystick.active = true;
    joystick.startX = (touch.clientX - rect.left) * (canvas.width / rect.width);
    joystick.startY = (touch.clientY - rect.top) * (canvas.height / rect.height);
    joystick.x = joystick.startX; joystick.y = joystick.startY;
});
canvas.addEventListener("touchmove", (e) => {
    if (!joystick.active) return;
    const touch = e.touches[0], rect = canvas.getBoundingClientRect();
    joystick.x = (touch.clientX - rect.left) * (canvas.width / rect.width);
    joystick.y = (touch.clientY - rect.top) * (canvas.height / rect.height);
    const dx = joystick.x - joystick.startX, dy = joystick.y - joystick.startY;
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

socket.on("playerInfoUpdate", (data) => { players = data; });

function drawPlayers() {
    players.forEach(p => {
        if (p.x === undefined) { p.x = p.targetX || 700; p.y = p.targetY || 450; }

        if (p.id === socket.id) {
            let moveX = 0, moveY = 0;
            if (keys['w'] || touchInput.w) moveY -= 1;
            if (keys['s'] || touchInput.s) moveY += 1;
            if (keys['a'] || touchInput.a) moveX -= 1;
            if (keys['d'] || touchInput.d) moveX += 1;

            let isBoosting = (keys['shift'] || touchInput.shift) && p.boost > 0;
            let currentAcc = isBoosting ? 1.4 : 0.25; 
            let currentLimit = isBoosting ? 9.5 : 3.2;

            localVelX += moveX * currentAcc;
            localVelY += moveY * currentAcc;
            localVelX *= friction;
            localVelY *= friction;

            // Limitar velocidad localmente para evitar tirones
            let speed = Math.sqrt(localVelX * localVelX + localVelY * localVelY);
            if (speed > currentLimit) {
                localVelX = (localVelX / speed) * currentLimit;
                localVelY = (localVelY / speed) * currentLimit;
            }

            p.x += localVelX; p.y += localVelY;
            p.x += (p.targetX - p.x) * 0.15; // Suavizado
            p.y += (p.targetY - p.y) * 0.15;
            
            if(Math.hypot(p.x - p.targetX, p.y - p.targetY) > 50) {
                p.x = p.targetX; p.y = p.targetY;
            }
        } else {
            p.x += (p.targetX - p.x) * 0.3;
            p.y += (p.targetY - p.y) * 0.3;
        }

        ctx.save();
        ctx.beginPath();
        ctx.fillStyle = p.team === "blue" ? "#00bcff" : "#ff3b3b";
        ctx.arc(p.x, p.y, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "white"; ctx.lineWidth = 2; ctx.stroke();
        ctx.textAlign = "center"; ctx.fillStyle = "white"; ctx.font = "bold 14px Segoe UI";
        ctx.fillText(p.name, p.x, p.y - 35);
        if(p.title) {
            ctx.fillStyle = p.titleColor || "#aaa"; ctx.font = "bold 10px Segoe UI";
            ctx.fillText(p.title, p.x, p.y - 50);
        }
        ctx.restore();
    });
}

function drawBall() {
    ball.x += (targetBall.x - ball.x) * 0.4;
    ball.y += (targetBall.y - ball.y) * 0.4;
    ctx.beginPath(); ctx.fillStyle = "white";
    ctx.arc(ball.x, ball.y, 10, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "black"; ctx.stroke();
}

function drawBoostUI() {
    const myPlayer = players.find(p => p.id === socket.id);
    if (!myPlayer || myPlayer.boost === undefined) return;
    const x = canvas.width - 80, y = canvas.height - 80, radius = 55;
    const boostPerc = myPlayer.boost / 100;

    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)"; ctx.fill();
    ctx.beginPath(); ctx.lineWidth = 6; ctx.strokeStyle = "#333";
    ctx.arc(x, y, radius - 5, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.strokeStyle = "#ff8c00"; ctx.shadowBlur = 10;
    ctx.shadowColor = "#ff8c00"; ctx.lineCap = "round";
    ctx.arc(x, y, radius - 5, -Math.PI / 2, (-Math.PI / 2) + (Math.PI * 2 * boostPerc));
    ctx.stroke();
    ctx.shadowBlur = 0; ctx.fillStyle = "white"; ctx.font = "bold 28px Segoe UI";
    ctx.textAlign = "center"; ctx.fillText(Math.floor(myPlayer.boost), x, y + 10);
    ctx.restore();
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (fieldImg.complete) ctx.drawImage(fieldImg, 0, 0, 1400, 900);
    else { ctx.fillStyle = "#0a1a0a"; ctx.fillRect(0, 0, 1400, 900); }
    
    boostPads.forEach(pad => {
        if (!pad.active) return;
        ctx.save();
        ctx.beginPath(); ctx.shadowBlur = 12;
        if (pad.type === 'big') {
            ctx.shadowColor = "#ff8c00"; ctx.fillStyle = "rgba(255, 140, 0, 0.8)";
            ctx.arc(pad.x, pad.y, 18, 0, Math.PI * 2);
        } else {
            ctx.shadowColor = "#ffcc00"; ctx.fillStyle = "rgba(255, 204, 0, 0.7)";
            ctx.arc(pad.x, pad.y, 8, 0, Math.PI * 2);
        }
        ctx.fill(); ctx.restore();
    });

    drawPlayers(); drawBall(); drawBoostUI();
    if (joystick.active) {
        ctx.beginPath(); ctx.arc(joystick.startX, joystick.startY, 50, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.3)"; ctx.lineWidth = 3; ctx.stroke();
        ctx.beginPath(); ctx.arc(joystick.x, joystick.y, 25, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 255, 255, 0.5)"; ctx.fill();
    }
    requestAnimationFrame(draw);
}

setInterval(() => {
    socket.emit("move", { 
        w: keys["w"] || touchInput.w, a: keys["a"] || touchInput.a, 
        s: keys["s"] || touchInput.s, d: keys["d"] || touchInput.d, 
        shift: keys["shift"] || touchInput.shift 
    });
}, 1000 / 60);

draw();