const socket = io()
const canvas = document.getElementById("game")
const ctx = canvas.getContext("2d")

// Configuración de la imagen de la cancha
const fieldImg = new Image();
fieldImg.src = "assets/field.png"; 

let players = [] 
let ball = { x: 700, y: 450 } 
let targetBall = { x: 700, y: 450 } 
let boostPads = [] // Guardaremos los pads que mande el servidor
let keys = {}

const params = new URLSearchParams(window.location.search)
const room = params.get("room")
const playerData = JSON.parse(localStorage.getItem("playerData"))

socket.emit("joinGame", { room: room, ...playerData })

// Detección de teclas
document.addEventListener("keydown", (e) => {
    const key = e.key === "Shift" ? "shift" : e.key.toLowerCase();
    keys[key] = true;
});
document.addEventListener("keyup", (e) => {
    const key = e.key === "Shift" ? "shift" : e.key.toLowerCase();
    keys[key] = false;
});

socket.on("playerInfoUpdate", (fullPlayerData) => {
    players = fullPlayerData; 
    updateSidePanels();
});

socket.on("state", (state) => {
    state.players.forEach(serverPlayer => {
        let localPlayer = players.find(p => p.id === serverPlayer.id);
        if (localPlayer) {
            // Guardamos el destino para la interpolación
            localPlayer.targetX = serverPlayer.x;
            localPlayer.targetY = serverPlayer.y;
            localPlayer.team = serverPlayer.team;
            localPlayer.boost = serverPlayer.boost;
        }
    });
    targetBall = state.ball;
    boostPads = state.boostPads || []; // Recibimos la posición de los pads
});

function updateSidePanels() {
    const redDiv = document.getElementById("redTeam");
    const blueDiv = document.getElementById("blueTeam");
    if(!redDiv || !blueDiv) return;
    redDiv.innerHTML = ""; blueDiv.innerHTML = "";

    players.forEach(p => {
        const card = document.createElement("div");
        card.className = "playerCard";
        card.innerHTML = `
            <div class="avatar-container">
                <img src="${p.pfp}" class="pfp">
            </div>
            <div class="info-container" style="background-image: url('${p.banner}')">
                <div class="name">${p.name}</div>
                <div class="playerTitle" style="color: ${p.titleColor}">${p.title}</div>
            </div>
        `;
        if(p.team === "red") redDiv.appendChild(card);
        else blueDiv.appendChild(card);
    });
}

function drawBoostPads() {
    boostPads.forEach(pad => {
        ctx.beginPath();
        ctx.fillStyle = "rgba(255, 215, 0, 0.4)"; // Amarillo brillante
        ctx.arc(pad.x, pad.y, 25, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "gold";
        ctx.lineWidth = 3;
        ctx.stroke();
        
        // Efecto de brillo interno
        ctx.beginPath();
        ctx.fillStyle = "white";
        ctx.arc(pad.x, pad.y, 5, 0, Math.PI * 2);
        ctx.fill();
    });
}

function drawPlayers() {
    players.forEach(p => {
        // CORRECCIÓN DE VISIBILIDAD: Si no hay posición previa, saltar a la del servidor
        if (p.x === undefined || isNaN(p.x)) p.x = p.targetX;
        if (p.y === undefined || isNaN(p.y)) p.y = p.targetY;

        // Solo dibujar si tenemos datos válidos
        if (p.targetX !== undefined && p.targetY !== undefined) {
            p.x += (p.targetX - p.x) * 0.3; // Interpolación suave
            p.y += (p.targetY - p.y) * 0.3;

            ctx.beginPath()
            ctx.fillStyle = p.team === "blue" ? "#00bcff" : "#ff3b3b"
            ctx.arc(p.x, p.y, 15, 0, Math.PI * 2)
            ctx.fill()
            ctx.strokeStyle = "white"; ctx.lineWidth = 2; ctx.stroke()

            // Etiquetas de nombre y título
            ctx.textAlign = "center"; 
            ctx.font = "bold 14px Segoe UI"; 
            ctx.fillStyle = "white";
            ctx.fillText(p.name, p.x, p.y - 35)
            
            ctx.font = "bold 10px Segoe UI"; 
            ctx.fillStyle = p.titleColor || "#aaa";
            ctx.fillText(p.title, p.x, p.y - 22)
        }
    })
}

function drawBall() {
    ball.x += (targetBall.x - ball.x) * 0.3;
    ball.y += (targetBall.y - ball.y) * 0.3;

    ctx.beginPath(); 
    ctx.fillStyle = "white"; 
    ctx.arc(ball.x, ball.y, 10, 0, Math.PI * 2); 
    ctx.fill()
    ctx.strokeStyle = "black"; ctx.lineWidth = 1; ctx.stroke();
}

function drawBoostUI() {
    const myPlayer = players.find(p => p.id === socket.id);
    if (!myPlayer || myPlayer.boost === undefined) return;

    const x = 1300; 
    const y = 800;
    const radius = 60;

    // Fondo gris del círculo
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
    ctx.lineWidth = 12;
    ctx.stroke();

    // Progreso del Boost
    const boostPerc = myPlayer.boost / 100;
    ctx.beginPath();
    ctx.arc(x, y, radius, -Math.PI / 2, (-Math.PI / 2) + (Math.PI * 2 * boostPerc));
    ctx.strokeStyle = myPlayer.boost > 25 ? "#ffae00" : "#ff3b3b";
    ctx.lineWidth = 12;
    ctx.lineCap = "round";
    ctx.stroke();

    // Número central
    ctx.fillStyle = "white";
    ctx.font = "bold 28px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText(Math.floor(myPlayer.boost), x, y + 10);
}

function draw() {
    ctx.clearRect(0, 0, 1400, 900)
    
    // Fondo de cancha
    if (fieldImg.complete) {
        ctx.drawImage(fieldImg, 0, 0, 1400, 900);
    } else {
        ctx.fillStyle = "#1b7a2f";
        ctx.fillRect(0, 0, 1400, 900);
    }

    drawBoostPads();
    drawPlayers(); 
    drawBall();
    drawBoostUI();
    requestAnimationFrame(draw)
}

// Envío de inputs al servidor
setInterval(() => {
    socket.emit("move", { 
        w: keys["w"], a: keys["a"], s: keys["s"], d: keys["d"], 
        shift: keys["shift"] 
    })
}, 1000 / 60)

draw()