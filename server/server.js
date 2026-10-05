const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");

const app = express();

app.use(cors());

const server = http.createServer(app);

const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3001;

const path = require("path");
const fs = require("fs");

const GRID_SIZE = 5;
const TOTAL_TILES = GRID_SIZE * GRID_SIZE; // 25 tiles (1-24 + null)

// Room management: Map<roomCode, { code, puzzle, isWon, totalMoves, startTime, lastMove, image, players, sockets }>
const rooms = new Map();

const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateRoomCode() {
    let code = "";
    do {
        code = "";
        for (let i = 0; i < 4; i++) {
            const idx = Math.floor(Math.random() * ROOM_CODE_CHARS.length);
            code += ROOM_CODE_CHARS[idx];
        }
    } while (rooms.has(code));
    return code;
}

function areAdjacent(idx1, idx2) {
    const r1 = Math.floor(idx1 / GRID_SIZE);
    const c1 = idx1 % GRID_SIZE;
    const r2 = Math.floor(idx2 / GRID_SIZE);
    const c2 = idx2 % GRID_SIZE;
    return Math.abs(r1 - r2) + Math.abs(c1 - c2) === 1;
}

function getAdjacentIndices(index) {
    const neighbors = [];
    const r = Math.floor(index / GRID_SIZE);
    const c = index % GRID_SIZE;
    if (r > 0) neighbors.push(index - GRID_SIZE);
    if (r < GRID_SIZE - 1) neighbors.push(index + GRID_SIZE);
    if (c > 0) neighbors.push(index - 1);
    if (c < GRID_SIZE - 1) neighbors.push(index + 1);
    return neighbors;
}

function checkWin(board) {
    for (let i = 0; i < TOTAL_TILES - 1; i++) {
        if (board[i] !== i + 1) return false;
    }
    return board[TOTAL_TILES - 1] === null;
}

// Generates a new solvable 5x5 puzzle via random walk from the solved state
function createSolvablePuzzle(movesCount = 240) {
    const board = [];
    for (let i = 1; i < TOTAL_TILES; i++) {
        board.push(i);
    }
    board.push(null); // Last slot is empty

    let emptyIdx = TOTAL_TILES - 1;
    let lastMoveIdx = -1;

    for (let i = 0; i < movesCount; i++) {
        const neighbors = getAdjacentIndices(emptyIdx).filter((idx) => idx !== lastMoveIdx);
        const nextIdx = neighbors[Math.floor(Math.random() * neighbors.length)];

        board[emptyIdx] = board[nextIdx];
        board[nextIdx] = null;

        lastMoveIdx = emptyIdx;
        emptyIdx = nextIdx;
    }

    if (checkWin(board)) {
        const neighbors = getAdjacentIndices(emptyIdx);
        const swapIdx = neighbors[0];
        board[emptyIdx] = board[swapIdx];
        board[swapIdx] = null;
    }

    return board;
}

function broadcastToRoom(roomCode, data) {
    const room = rooms.get(roomCode);
    if (!room) return;

    const message = JSON.stringify(data);
    room.sockets.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

function removeSocketFromRoom(socket) {
    const roomCode = socket.roomCode;
    if (!roomCode || !rooms.has(roomCode)) return;

    const room = rooms.get(roomCode);
    room.sockets.delete(socket);

    if (socket.player) {
        room.players = room.players.filter((p) => p.id !== socket.player.id);
        console.log(`Player ${socket.player.name} left room ${roomCode}`);
    }

    socket.roomCode = null;
    socket.player = null;

    if (room.sockets.size === 0) {
        console.log(`Room ${roomCode} is now empty. Retaining for 60 seconds before deleting...`);
        if (!room.cleanupTimer) {
            room.cleanupTimer = setTimeout(() => {
                if (room.sockets.size === 0) {
                    console.log(`Room ${roomCode} expired and deleted.`);
                    rooms.delete(roomCode);
                }
            }, 60000);
        }
    } else {
        broadcastToRoom(roomCode, {
            type: "PLAYERS_UPDATE",
            players: room.players
        });
    }
}

function isValidMove(from, to, board) {
    if (!Number.isInteger(from) || !Number.isInteger(to)) return false;
    if (from < 0 || from >= TOTAL_TILES || to < 0 || to >= TOTAL_TILES) return false;
    if (board[from] === null) return false;
    if (board[to] !== null) return false;
    return areAdjacent(from, to);
}

wss.on("connection", (socket) => {
    console.log("New client connected to server!");
    socket.roomCode = null;
    socket.player = null;

    socket.on("message", (message) => {
        try {
            const data = JSON.parse(message);
            console.log("Message received:", data.type);

            if (data.type === "CREATE_ROOM") {
                if (socket.roomCode) {
                    removeSocketFromRoom(socket);
                }

                const roomCode = generateRoomCode();
                const playerName = (typeof data.playerName === "string" && data.playerName.trim())
                    ? data.playerName.trim()
                    : "Player 1";

                const player = {
                    id: `${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
                    name: playerName,
                    isHost: true,
                    movesCount: 0
                };

                const room = {
                    code: roomCode,
                    puzzle: createSolvablePuzzle(),
                    isWon: false,
                    totalMoves: 0,
                    startTime: null,
                    lastMove: null,
                    image: data.image || "nature",
                    players: [player],
                    sockets: new Set([socket])
                };

                rooms.set(roomCode, room);
                socket.roomCode = roomCode;
                socket.player = player;

                console.log(`Room created: ${roomCode} by ${player.name} (image: ${room.image})`);

                socket.send(
                    JSON.stringify({
                        type: "ROOM_JOINED",
                        roomCode: room.code,
                        player: player,
                        players: room.players,
                        puzzle: room.puzzle,
                        isWon: room.isWon,
                        totalMoves: room.totalMoves,
                        startTime: room.startTime,
                        lastMove: room.lastMove,
                        gridSize: GRID_SIZE,
                        image: room.image
                    })
                );
            } else if (data.type === "JOIN_ROOM") {
                const requestedCode = (data.roomCode || "").toString().trim().toUpperCase();

                if (!rooms.has(requestedCode)) {
                    socket.send(
                        JSON.stringify({
                            type: "ROOM_ERROR",
                            message: `Room "${requestedCode}" was not found. Please check the code.`
                        })
                    );
                    return;
                }

                if (socket.roomCode) {
                    removeSocketFromRoom(socket);
                }

                const room = rooms.get(requestedCode);
                if (room.cleanupTimer) {
                    clearTimeout(room.cleanupTimer);
                    room.cleanupTimer = null;
                    console.log(`Re-activated room ${requestedCode}, cancelled cleanup timer.`);
                }
                const playerName = (typeof data.playerName === "string" && data.playerName.trim())
                    ? data.playerName.trim()
                    : `Player ${room.players.length + 1}`;

                const player = {
                    id: `${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
                    name: playerName,
                    isHost: false,
                    movesCount: 0
                };

                room.players.push(player);
                room.sockets.add(socket);
                socket.roomCode = requestedCode;
                socket.player = player;

                console.log(`Player ${player.name} joined room ${requestedCode}`);

                socket.send(
                    JSON.stringify({
                        type: "ROOM_JOINED",
                        roomCode: room.code,
                        player: player,
                        players: room.players,
                        puzzle: room.puzzle,
                        isWon: room.isWon,
                        totalMoves: room.totalMoves,
                        startTime: room.startTime,
                        lastMove: room.lastMove,
                        gridSize: GRID_SIZE,
                        image: room.image
                    })
                );

                broadcastToRoom(requestedCode, {
                    type: "PLAYERS_UPDATE",
                    players: room.players
                });
            } else if (data.type === "CHANGE_IMAGE") {
                const roomCode = socket.roomCode;
                if (!roomCode || !rooms.has(roomCode)) return;

                const room = rooms.get(roomCode);
                room.image = data.image || "nature";
                console.log(`Room ${roomCode} image changed to:`, room.image);

                broadcastToRoom(roomCode, {
                    type: "IMAGE_CHANGED",
                    image: room.image
                });
            } else if (data.type === "LEAVE_ROOM") {
                removeSocketFromRoom(socket);
                socket.send(
                    JSON.stringify({
                        type: "ROOM_LEFT"
                    })
                );
            } else if (data.type === "MOVE") {
                const roomCode = socket.roomCode;
                if (!roomCode || !rooms.has(roomCode)) {
                    socket.send(
                        JSON.stringify({
                            type: "ROOM_ERROR",
                            message: "You are not currently in an active room."
                        })
                    );
                    return;
                }

                const room = rooms.get(roomCode);
                const { from, to } = data;

                if (isValidMove(from, to, room.puzzle)) {
                    const movedTile = room.puzzle[from];
                    room.puzzle[to] = movedTile;
                    room.puzzle[from] = null;
                    room.isWon = checkWin(room.puzzle);

                    if (!room.startTime) {
                        room.startTime = Date.now();
                    }
                    room.totalMoves++;

                    const p = room.players.find((x) => x.id === socket.player.id);
                    if (p) {
                        p.movesCount = (p.movesCount || 0) + 1;
                    }

                    room.lastMove = {
                        playerName: socket.player.name,
                        tile: movedTile,
                        timestamp: Date.now()
                    };

                    broadcastToRoom(roomCode, {
                        type: "PUZZLE_UPDATE",
                        puzzle: room.puzzle,
                        isWon: room.isWon,
                        totalMoves: room.totalMoves,
                        startTime: room.startTime,
                        lastMove: room.lastMove,
                        gridSize: GRID_SIZE,
                        image: room.image,
                        players: room.players
                    });
                } else {
                    console.warn(`Invalid move rejected in room ${roomCode} from=${from} to=${to}`);
                }
            } else if (data.type === "SHUFFLE" || data.type === "RESTART") {
                const roomCode = socket.roomCode;
                if (!roomCode || !rooms.has(roomCode)) return;

                const room = rooms.get(roomCode);
                room.puzzle = createSolvablePuzzle();
                room.isWon = false;
                room.totalMoves = 0;
                room.startTime = null;
                room.lastMove = null;
                room.players.forEach((p) => {
                    p.movesCount = 0;
                });

                console.log(`Room ${roomCode} puzzle reset/shuffled by ${socket.player?.name}`);

                broadcastToRoom(roomCode, {
                    type: "PUZZLE_UPDATE",
                    puzzle: room.puzzle,
                    isWon: room.isWon,
                    totalMoves: room.totalMoves,
                    startTime: room.startTime,
                    lastMove: room.lastMove,
                    gridSize: GRID_SIZE,
                    image: room.image,
                    players: room.players
                });
            }
        } catch (err) {
            console.error("Failed to parse incoming message:", err.message);
        }
    });

    socket.on("close", () => {
        removeSocketFromRoom(socket);
    });
});

app.get("/api/health", (req, res) => {
    res.json({
        status: "ok",
        activeRooms: rooms.size,
        gridSize: GRID_SIZE
    });
});

// Production deployment: serve static built client if client/dist exists
const clientDist = path.join(__dirname, "../client/dist");
if (fs.existsSync(clientDist)) {
    console.log("Serving static frontend from", clientDist);
    app.use(express.static(clientDist));
    app.use((req, res, next) => {
        if (req.method === "GET" && !req.path.startsWith("/api")) {
            return res.sendFile(path.join(clientDist, "index.html"));
        }
        next();
    });
} else {
    app.get("/", (req, res) => {
        res.json({
            message: "🧩 Distributed Puzzle Game Server is running!",
            activeRooms: rooms.size
        });
    });
}

server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`WebSocket running on ws://localhost:${PORT}`);
});