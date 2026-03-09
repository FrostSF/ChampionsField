const express = require("express")
const app = express()
const http = require("http").createServer(app)
const io = require("socket.io")(http)

app.use(express.static("public"))

// CAMBIO CLAVE: Render elige el puerto, si no existe usa el 3000
const PORT = process.env.PORT || 3000
http.listen(PORT, () => console.log("Servidor corriendo en puerto", PORT))

let rooms = {}

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
            ball: { x: 700, y: 450, vx: 0, vy: 0 }
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

        let existing = rooms[room].players.find(p => p.id === socket.id)
        if (!existing) {
            rooms[room].players.push({
                id: socket.id,
                name: data.name,
                title: data.title,
                titleColor: data.titleColor || "#aaa",
                pfp: data.pfp,
                banner: data.banner || "default.png",
                team: team,
                x: spawnX,
                y: 450,
                vx: 0,
                vy: 0,
                input: {}
            })
        }
        io.to(room).emit("playerInfoUpdate", rooms[room].players)
    })

    socket.on("joinTeam", (data) => {
        const room = rooms[data.room];
        if (!room) return;
        let player = room.players.find(p => p.id === socket.id);
        if (player) {
            player.team = data.team;
            player.x = (data.team === "red") ? 300 : 1100;
            io.to(data.room).emit("playerInfoUpdate", room.players);
        }
    });

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
        const accel = 0.5
        const friction = 0.85
        const maxSpeed = 5

        room.players.forEach(p => {
            if (p.input.w) p.vy -= accel
            if (p.input.s) p.vy += accel
            if (p.input.a) p.vx -= accel
            if (p.input.d) p.vx += accel

            p.vx *= friction; p.vy *= friction
            let speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy)
            if (speed > maxSpeed) {
                p.vx = (p.vx / speed) * maxSpeed
                p.vy = (p.vy / speed) * maxSpeed
            }

            p.x += p.vx; p.y += p.vy
            p.x = Math.max(15, Math.min(1385, p.x))
            p.y = Math.max(15, Math.min(885, p.y))
        })

        room.ball.x += room.ball.vx; room.ball.y += room.ball.vy
        room.ball.vx *= 0.985; room.ball.vy *= 0.985

        if (room.ball.x < 10) { room.ball.vx *= -1.2; room.ball.x = 10; }
        if (room.ball.x > 1390) { room.ball.vx *= -1.2; room.ball.x = 1390; }
        if (room.ball.y < 10) { room.ball.vy *= -1.2; room.ball.y = 10; }
        if (room.ball.y > 890) { room.ball.vy *= -1.2; room.ball.y = 890; }

        room.players.forEach(p => {
            let dx = room.ball.x - p.x; let dy = room.ball.y - p.y
            let dist = Math.sqrt(dx * dx + dy * dy)
            if (dist < 25) {
                let nx = dx / dist; let ny = dy / dist
                room.ball.x = p.x + nx * 25; room.ball.y = p.y + ny * 25
                room.ball.vx += nx * 0.4; room.ball.vy += ny * 0.4
            }
        })

        io.to(code).emit("state", {
            players: room.players.map(p => ({
                id: p.id, x: p.x, y: p.y, team: p.team,
                name: p.name, title: p.title, titleColor: p.titleColor
            })),
            ball: room.ball
        })
    }
}, 1000 / 60)
