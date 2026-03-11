const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);

app.use(express.static("public"));

const PORT = 3000;
http.listen(PORT, () => console.log("Servidor corriendo en puerto", PORT));

let rooms = {};
const BOOST_PADS = [
    { x: 100, y: 100, type: 'big', value: 100 }, { x: 1300, y: 100, type: 'big', value: 100 },
    { x: 100, y: 800, type: 'big', value: 100 }, { x: 1300, y: 800, type: 'big', value: 100 },
    { x: 700, y: 80, type: 'big', value: 100 }, { x: 700, y: 820, type: 'big', value: 100 },
    { x: 400, y: 450, type: 'small', value: 12 }, { x: 1000, y: 450, type: 'small', value: 12 },
    { x: 700, y: 450, type: 'small', value: 12 }, { x: 550, y: 250, type: 'small', value: 12 },
    { x: 850, y: 250, type: 'small', value: 12 }, { x: 550, y: 650, type: 'small', value: 12 },
    { x: 850, y: 650, type: 'small', value: 12 }
];

function makeCode() { return Math.random().toString(36).substring(2, 7).toUpperCase(); }

io.on("connection", (socket) => {
    socket.on("createRoom", () => {
        const code = makeCode();
        rooms[code] = {
            players: [],
            ball: { x: 700, y: 450, vx: 0, vy: 0 },
            boostPads: BOOST_PADS.map(p => ({ ...p, active: true, timer: 0 }))
        };
        socket.join(code); socket.emit("roomCreated", code);
    });

    socket.on("joinGame", (data) => {
        const r = data.room; if (!rooms[r]) return;
        socket.join(r);
        const team = data.team || "red";
        
        const newPlayer = {
            id: socket.id, name: data.name, title: data.title, titleColor: data.titleColor,
            pfp: data.pfp, banner: data.banner, team: team,
            x: team === "red" ? 300 : 1100, y: 450, vx: 0, vy: 0,
            boost: 33, input: {}
        };
        
        rooms[r].players.push(newPlayer);
        
        // Enviamos la info pesada (nombres, pfp) SOLO cuando alguien entra
        io.to(r).emit("playerInfoUpdate", rooms[r].players.map(p => ({
            id: p.id, name: p.name, title: p.title, titleColor: p.titleColor,
            pfp: p.pfp, banner: p.banner, team: p.team
        })));
    });

    socket.on("move", (input) => {
        for (const r in rooms) {
            let p = rooms[r].players.find(p => p.id === socket.id);
            if (p) p.input = input;
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
        const baseAcc = 0.18;   
        const boostAcc = 0.4;    
        const maxSpeedNormal = 4.5;
        const maxSpeedBoost = 8;

        room.players.forEach(p => {
            let isBoosting = p.input.shift && p.boost > 0;
            const accel = isBoosting ? boostAcc : baseAcc; 
            const limit = isBoosting ? maxSpeedBoost : maxSpeedNormal;

            if (p.input.w) p.vy -= accel; if (p.input.s) p.vy += accel;
            if (p.input.a) p.vx -= accel; if (p.input.d) p.vx += accel;

            if (isBoosting) p.boost -= 0.35;
            p.vx *= friction; p.vy *= friction;
            
            let speed = Math.sqrt(p.vx**2 + p.vy**2);
            if (speed > limit) { p.vx = (p.vx/speed)*limit; p.vy = (p.vy/speed)*limit; }

            p.x += p.vx; p.y += p.vy;
            p.x = Math.max(15, Math.min(1385, p.x));
            p.y = Math.max(15, Math.min(885, p.y));

            room.boostPads.forEach(pad => {
                if (pad.active && Math.hypot(p.x - pad.x, p.y - pad.y) < 35) {
                    p.boost = Math.min(100, p.boost + pad.value);
                    pad.active = false; pad.timer = pad.type === 'big' ? 600 : 240; 
                }
            });
        });

        room.boostPads.forEach(pad => { if (!pad.active) { pad.timer--; if (pad.timer <= 0) pad.active = true; } });

        // Pelota
        room.ball.x += room.ball.vx; room.ball.y += room.ball.vy;
        room.ball.vx *= 0.985; room.ball.vy *= 0.985;
        if (room.ball.x < 15 || room.ball.x > 1385) room.ball.vx *= -1;
        if (room.ball.y < 15 || room.ball.y > 885) room.ball.vy *= -1;

        room.players.forEach(p => {
            let dist = Math.hypot(room.ball.x - p.x, room.ball.y - p.y);
            if (dist < 28) {
                let nx = (room.ball.x - p.x) / dist;
                let ny = (room.ball.y - p.y) / dist;
                room.ball.vx += nx * 0.7; room.ball.vy += ny * 0.7;
            }
        });

        // --- OPTIMIZACIÓN: Solo enviamos datos que cambian constantemente ---
        io.to(code).emit("state", {
            players: room.players.map(p => ({
                id: p.id, 
                x: Math.round(p.x * 10) / 10, // Redondeamos para ahorrar caracteres
                y: Math.round(p.y * 10) / 10, 
                boost: Math.floor(p.boost)
            })),
            ball: { 
                x: Math.round(room.ball.x * 10) / 10, 
                y: Math.round(room.ball.y * 10) / 10 
            },
            boostPads: room.boostPads.map(pad => ({ active: pad.active })) // El cliente ya conoce las posiciones de los pads
        });
    }
}, 1000 / 60);