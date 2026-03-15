// ═══════════════════════════════════════════════════════════════
//  CHAMPIONS FIELD — Signaling Server (WebRTC relay only)
// ═══════════════════════════════════════════════════════════════
const express = require("express")
const app  = express()
const http = require("http").createServer(app)
const io   = require("socket.io")(http, {
    cors: { origin: "*" },
    pingInterval: 10000,
    pingTimeout:  25000
})

app.use(express.static("public"))
const PORT = process.env.PORT || 3000
http.listen(PORT, () => console.log("🚀 Champions Field signaling on port", PORT))

// rooms[code] = { hostPlayerData, hostSocketId|null, players[], settings{}, phase }
const rooms = {}

function makeCode() {
    return Array.from({length:5}, () =>
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[Math.floor(Math.random()*36)]
    ).join("")
}

io.on("connection", socket => {

    // ── CREATE ROOM ───────────────────────────────────────────────
    // Called from index.html. The socket here will disconnect when the
    // browser navigates to lobby.html — so we store the room independently
    // and let the host re-claim it via joinLobby.
    socket.on("createRoom", (playerData) => {
        const code = makeCode()
        rooms[code] = {
            hostSocketId:   null,          // will be set when host joins lobby
            hostPlayerData: { ...playerData, isHost: true },
            players:  [],                  // filled on joinLobby
            settings: {
                blueTeamName:"BLUE",   orangeTeamName:"ORANGE",
                blueColor:"#00aaff",   orangeColor:"#ff6600",
                seriesTitle:"CHAMPIONS FIELD", gameNum:1, bestOf:7
            },
            phase: "lobby"
        }
        socket.emit("roomCreated", code)
        // Note: we do NOT socket.join(code) here because this socket
        // will disconnect immediately on navigation.
    })

    // ── JOIN LOBBY ────────────────────────────────────────────────
    // Called from lobby.html by BOTH host and clients.
    socket.on("joinLobby", ({ room: code, ...playerData }) => {
        const room = rooms[code]
        if (!room) return socket.emit("roomError", "Sala no encontrada")
        if (room.phase === "playing") return socket.emit("roomError", "Partida en curso")

        socket.join(code)
        socket.roomCode = code

        // First person to joinLobby with this code becomes the host
        const isHost = room.hostSocketId === null
        if (isHost) {
            room.hostSocketId = socket.id
            // Merge saved playerData with hostPlayerData
            const hp = { ...room.hostPlayerData, ...playerData, id: socket.id, isHost: true }
            room.players.unshift(hp)   // host is always first in list
        } else {
            if (!room.players.find(p => p.id === socket.id)) {
                room.players.push({ id: socket.id, isHost: false, ...playerData })
            }
        }

        // Tell this socket who the host is + full state
        socket.emit("lobbyJoined", {
            hostId:   room.hostSocketId,
            players:  room.players,
            settings: room.settings,
            myId:     socket.id
        })

        // Update all lobby members
        io.to(code).emit("lobbyUpdate", { players: room.players, settings: room.settings })

        // If client (not host), tell host to open a WebRTC channel to them
        if (!isHost) {
            socket.to(room.hostSocketId).emit("peerJoined", { peerId: socket.id, playerData })
        }
    })

    // ── TEAM ──────────────────────────────────────────────────────
    socket.on("joinTeam", ({ room: code, team }) => {
        const room = rooms[code]; if (!room) return
        const p = room.players.find(p => p.id === socket.id)
        if (p) p.team = team
        io.to(code).emit("lobbyUpdate", { players: room.players, settings: room.settings })
    })

    // ── SETTINGS (host only) ──────────────────────────────────────
    socket.on("updateSettings", ({ room: code, settings }) => {
        const room = rooms[code]; if (!room) return
        if (room.hostSocketId !== socket.id) return
        Object.assign(room.settings, settings)
        io.to(code).emit("lobbyUpdate", { players: room.players, settings: room.settings })
    })

    // ── WEBRTC RELAY (pure passthrough) ───────────────────────────
    socket.on("rtc:offer",  ({ to, offer })     => io.to(to).emit("rtc:offer",  { from: socket.id, offer }))
    socket.on("rtc:answer", ({ to, answer })    => io.to(to).emit("rtc:answer", { from: socket.id, answer }))
    socket.on("rtc:ice",    ({ to, candidate }) => io.to(to).emit("rtc:ice",    { from: socket.id, candidate }))

    // ── GAME STARTED ──────────────────────────────────────────────
    socket.on("gameStarted", ({ room: code }) => {
        const room = rooms[code]; if (!room) return
        if (room.hostSocketId !== socket.id) return
        room.phase = "playing"
        io.to(code).emit("gameStarted")
    })

    // ── DISCONNECT ────────────────────────────────────────────────
    socket.on("disconnect", () => {
        const code = socket.roomCode
        if (!code || !rooms[code]) return
        const room = rooms[code]

        room.players = room.players.filter(p => p.id !== socket.id)

        if (room.hostSocketId === socket.id) {
            if (room.phase === "playing") {
                // Game in progress — close the room
                io.to(code).emit("hostDisconnected")
                delete rooms[code]
            } else {
                // Lobby — keep room alive, clear hostSocketId so next
                // joinLobby can reclaim the host slot (handles page refresh)
                room.hostSocketId = null
                io.to(code).emit("lobbyUpdate", { players: room.players, settings: room.settings })
            }
        } else {
            io.to(room.hostSocketId).emit("peerLeft", { peerId: socket.id })
            io.to(code).emit("lobbyUpdate", { players: room.players, settings: room.settings })
        }
    })
})
