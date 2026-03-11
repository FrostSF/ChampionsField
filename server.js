const express = require("express")
const app = express()
const http = require("http").createServer(app)
const io = require("socket.io")(http)

app.use(express.static("public"))

const PORT = 3000
http.listen(PORT, () => console.log("Servidor corriendo en puerto", PORT))

let rooms = {}

// Pads de boost fijos para que el servidor los gestione
const BOOST_PADS = [
    { x: 100, y: 100, type: 'big', value: 100 }, { x: 1300, y: 100, type: 'big', value: 100 },
    { x: 100, y: 800, type: 'big', value: 100 }, { x: 1300, y: 800, type: 'big', value: 100 },
    { x: 700, y: 80, type: 'big', value: 100 }, { x: 700, y: 820, type: 'big', value: 100 },
    { x: 400, y: 450, type: 'small', value: 12 }, { x: 1000, y: 450, type: 'small', value: 12 }
];

function makeCode() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    let code = ""
    for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)]
    return code
}

io.on("connection", (socket) => {
    socket.on("createRoom", () => {
        const code = makeCode()
        rooms[code] = {
            players: [],
            ball: { x: 700, y: 450, vx: 0, vy: 0 },
            boostPads: BOOST_PADS.map(p => ({ ...p, active: true, timer: 0 }))
        }
        socket.join(code)
        socket.emit("roomCreated", code)
    })

    socket.on("joinGame", (data) => {
        const room = data.room
        if (!rooms[room]) return
        socket.join(room)

        const team = data.team || "red"
        const spawnX = team === "red" ? 300 : 1100

        rooms[room].players.push({
            id: socket.id,
            name: data.name,
            title: data.title,
            titleColor: data.titleColor || "#aaa",
            pfp: data.pfp,
            banner: data.banner || "default.png",
            team: team,
            x: spawnX, y: 450, vx: 0, vy: 0,
            boost: 33,
            input: {}
        })
        
        // Enviamos la info completa (PFPs, Nombres) SOLO una vez
        io.to(room).emit("playerInfoUpdate", rooms[room].players)
    })

    socket.on("move", (input) => {
        for (const r in rooms) {
            let player = rooms[r].players.find(p => p.id === socket.id)
            if (player) player.input = input
        }
    })

    socket.on("disconnect", () => {
        for (const r in rooms) {
            rooms[r].players = rooms[r].players.filter(p => p.id !== socket.id)
            io.to(r).emit("playerInfoUpdate", rooms[r].players)
        }
    })
})

setInterval(() => {
    for (const code in rooms) {
        const room = rooms[code]
        
        // --- FÍSICA CALIBRADA (Lenta pero fluida) ---
        const friction = 0.94;
        const accelNormal = 0.2;  
        const accelBoost = 0.45;  
        const maxSpeedNormal = 4.5;
        const maxSpeedBoost = 8;

        room.players.forEach(p => {
            const isBoosting = p.input.shift && p.boost > 0;
            const currentAcc = isBoosting ? accelBoost : accelNormal;
            const currentMax = isBoosting ? maxSpeedBoost : maxSpeedNormal;

            if (p.input.w) p.vy -= currentAcc
            if (p.input.s) p.vy += currentAcc
            if (p.input.a) p.vx -= currentAcc
            if (p.input.d) p.vx += currentAcc

            if (isBoosting) p.boost -= 0.4;

            p.vx *= friction; p.vy *= friction;
            let speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy)
            if (speed > currentMax) {
                p.vx = (p.vx / speed) * currentMax
                p.vy = (p.vy / speed) * currentMax
            }

            p.x += p.vx; p.y += p.vy
            p.x = Math.max(15, Math.min(1385, p.x))
            p.y = Math.max(15, Math.min(885, p.y))

            // Lógica de Boost Pads
            room.boostPads.forEach(pad => {
                if (pad.active && Math.hypot(p.x - pad.x, p.y - pad.y) < 35) {
                    p.boost = Math.min(100, p.boost + pad.value);
                    pad.active = false;
                    pad.timer = pad.type === 'big' ? 600 : 240; 
                }
            });
        })

        // Respawn de pads
        room.boostPads.forEach(pad => {
            if (!pad.active) {
                pad.timer--;
                if (pad.timer <= 0) pad.active = true;
            }
        });

        // Pelota
        room.ball.x += room.ball.vx; room.ball.y += room.ball.vy
        room.ball.vx *= 0.985; room.ball.vy *= 0.985

        if (room.ball.x < 15 || room.ball.x > 1385) room.ball.vx *= -1;
        if (room.ball.y < 15 || room.ball.y > 885) room.ball.vy *= -1;

        room.players.forEach(p => {
            let dx = room.ball.x - p.x; let dy = room.ball.y - p.y
            let dist = Math.sqrt(dx * dx + dy * dy)
            if (dist < 30) { // Colisión un poco más grande para ser precisos
                let nx = dx / dist; let ny = dy / dist
                room.ball.vx += nx * 0.8; room.ball.vy += ny * 0.8
            }
        })

        // --- EL SECRETO: ENVIAR SOLO LO NECESARIO ---
        io.to(code).emit("state", {
            players: room.players.map(p => ({
                id: p.id, 
                x: Math.round(p.x), 
                y: Math.round(p.y), 
                boost: Math.floor(p.boost)
            })),
            ball: { x: Math.round(room.ball.x), y: Math.round(room.ball.y) },
            boostPads: room.boostPads.map(pad => ({ active: pad.active }))
        })
    }
}, 1000 / 60)