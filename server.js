const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);

app.use(express.static("public"));

const PORT = 3000;
http.listen(PORT, () => console.log("Servidor corriendo en puerto", PORT));

let rooms = {};

const BOOST_PADS = [
    { x: 100, y: 100, type: 'big', value: 100 },
    { x: 1300, y: 100, type: 'big', value: 100 },
    { x: 100, y: 800, type: 'big', value: 100 },
    { x: 1300, y: 800, type: 'big', value: 100 },
    { x: 700, y: 80, type: 'big', value: 100 },
    { x: 700, y: 820, type: 'big', value: 100 },
    { x: 400, y: 450, type: 'small', value: 12 },
    { x: 1000, y: 450, type: 'small', value: 12 },
    { x: 700, y: 450, type: 'small', value: 12 },
    { x: 550, y: 250, type: 'small', value: 12 },
    { x: 850, y: 250, type: 'small', value: 12 },
    { x: 550, y: 650, type: 'small', value: 12 },
    { x: 850, y: 650, type: 'small', value: 12 }
];

function makeCode() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let code = "";
    for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
}

io.on("connection", (socket) => {
    socket.on("createRoom", () => {
        const code = makeCode();
        rooms[code] = {
            players: [],
            ball: { x: 700, y: 450, vx: 0, vy: 0 },
            boostPads: BOOST_PADS.map(p => ({ ...p, active: true, timer: 0 }))
        };
        socket.join(code);
        socket.emit("roomCreated", code);
    });

    socket.on("joinGame", (data) => {
        const room = data.room;
        if (!rooms[room]) return;
        socket.join(room);
        const team = data.team || "red";
        rooms[room].players.push({
            id: socket.id,
            name: data.name,
            title: data.title,
            titleColor: data.titleColor || "#aaa",
            pfp: data.pfp,
            banner: data.banner ? (data.banner.includes('/') ? data.banner : 'assets/banners/' + data.banner) : 'assets/banners/default.png',
            team: team,
            x: team === "red" ? 300 : 1100, y: 450,
            vx: 0, vy: 0,
            boost: 33,
            input: {}
        });
        io.to(room).emit("playerInfoUpdate", rooms[room].players);
    });

    socket.on("move", (input) => {
        for (const r in rooms) {
            let player = rooms[r].players.find(p => p.id === socket.id);
            if (player) player.input = input;
        }
    });

    socket.on("disconnect", () => {
        for (const r in rooms) {
            rooms[r].players = rooms[r].players.filter(p => p.id !== socket.id);
            io.to(r).emit("playerInfoUpdate", rooms[r].players);
        }
    });
});

setInterval(() => {
    for (const code in rooms) {
        const room = rooms[code];
        const friction = 0.96;
        const baseAcc = 0.2;
        const boostAcc = 0.45;
        const maxSpeedNormal = 5;
        const maxSpeedBoost = 8.5;

        room.players.forEach(p => {
            let isBoosting = p.input.shift && p.boost > 0;
            const accel = isBoosting ? boostAcc : baseAcc; 
            const limit = isBoosting ? maxSpeedBoost : maxSpeedNormal;

            if (p.input.w) p.vy -= accel;
            if (p.input.s) p.vy += accel;
            if (p.input.a) p.vx -= accel;
            if (p.input.d) p.vx += accel;

            if (isBoosting) p.boost -= 0.4;

            p.vx *= friction; p.vy *= friction;
            
            let speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
            if (speed > limit) {
                p.vx = (p.vx / speed) * limit;
                p.vy = (p.vy / speed) * limit;
            }

            p.x += p.vx; p.y += p.vy;
            p.x = Math.max(15, Math.min(1385, p.x));
            p.y = Math.max(15, Math.min(885, p.y));

            room.boostPads.forEach(pad => {
                if (pad.active && Math.hypot(p.x - pad.x, p.y - pad.y) < 35) {
                    p.boost = Math.min(100, p.boost + pad.value);
                    pad.active = false;
                    pad.timer = pad.type === 'big' ? 600 : 240; 
                }
            });
        });

        room.boostPads.forEach(pad => {
            if (!pad.active) {
                pad.timer--;
                if (pad.timer <= 0) pad.active = true;
            }
        });

        // Pelota
        room.ball.x += room.ball.vx; room.ball.y += room.ball.vy;
        room.ball.vx *= 0.985; room.ball.vy *= 0.985;
        if (room.ball.x < 15 || room.ball.x > 1385) room.ball.vx *= -1;
        if (room.ball.y < 15 || room.ball.y > 885) room.ball.vy *= -1;

        room.players.forEach(p => {
            let dx = room.ball.x - p.x, dy = room.ball.y - p.y;
            let dist = Math.hypot(dx, dy);
            if (dist < 28) {
                let nx = dx / dist, ny = dy / dist;
                room.ball.vx += nx * 0.8; room.ball.vy += ny * 0.8;
            }
        });

        io.to(code).emit("state", {
            players: room.players.map(p => ({
                id: p.id, x: p.x, y: p.y, team: p.team,
                name: p.name, title: p.title, titleColor: p.titleColor, 
                boost: p.boost, banner: p.banner
            })),
            ball: room.ball,
            boostPads: room.boostPads
        });
    }
}, 1000 / 60);