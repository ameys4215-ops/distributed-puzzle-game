import { useEffect, useRef, useState } from "react";
import "./App.css";
import { sounds } from "./utils/sound.js";
import { PUZZLE_IMAGES, getImageById } from "./utils/images.js";

const GRID_SIZE = 5;

function getWebSocketUrl() {
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }
  const isHttps = typeof window !== "undefined" && window.location.protocol === "https:";
  const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
  return isHttps ? `wss://${window.location.host}` : `ws://${host}:3001`;
}

function areAdjacent(idx1, idx2) {
  const r1 = Math.floor(idx1 / GRID_SIZE);
  const c1 = idx1 % GRID_SIZE;
  const r2 = Math.floor(idx2 / GRID_SIZE);
  const c2 = idx2 % GRID_SIZE;
  return Math.abs(r1 - r2) + Math.abs(c1 - c2) === 1;
}

function formatTime(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

function App() {
  const [connected, setConnected] = useState(false);
  const [roomCode, setRoomCode] = useState(null);
  const [player, setPlayer] = useState(null);
  const [players, setPlayers] = useState([]);
  const [puzzle, setPuzzle] = useState([]);
  const [isWon, setIsWon] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  // Picture puzzle & audio settings
  const [imageId, setImageId] = useState("nature");
  const [showNumbers, setShowNumbers] = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  const [isMuted, setIsMuted] = useState(sounds.isMuted());

  // Game stats
  const [totalMoves, setTotalMoves] = useState(0);
  const [startTime, setStartTime] = useState(null);
  const [lastMove, setLastMove] = useState(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Form states for Lobby
  const [inputPlayerName, setInputPlayerName] = useState("Player");
  const [inputRoomCode, setInputRoomCode] = useState("");
  const [copied, setCopied] = useState(false);

  const socketRef = useRef(null);
  const prevWonRef = useRef(false);

  // Live timer effect
  useEffect(() => {
    if (!startTime || isWon) return;

    setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));

    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [startTime, isWon]);

  // Audio victory fanfare trigger
  useEffect(() => {
    if (isWon && !prevWonRef.current) {
      sounds.playVictory();
    }
    prevWonRef.current = isWon;
  }, [isWon]);

  useEffect(() => {
    let socket = null;
    let reconnectTimer = null;
    let isMounted = true;

    function connect() {
      if (!isMounted) return;

      const wsUrl = getWebSocketUrl();
      console.log("Connecting to WebSocket at:", wsUrl);
      socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        if (!isMounted) return;
        console.log("Connected to server");
        setConnected(true);
        setErrorMessage(null);
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("Server message:", data);

          if (data.type === "ROOM_JOINED") {
            setRoomCode(data.roomCode);
            setPlayer(data.player);
            setPlayers(data.players || []);
            setPuzzle(data.puzzle || []);
            setIsWon(Boolean(data.isWon));
            setTotalMoves(data.totalMoves || 0);
            setStartTime(data.startTime || null);
            setLastMove(data.lastMove || null);
            if (data.image) setImageId(data.image);
            if (data.startTime) {
              setElapsedSeconds(Math.floor((Date.now() - data.startTime) / 1000));
            } else {
              setElapsedSeconds(0);
            }
            setErrorMessage(null);
          }

          if (data.type === "PLAYERS_UPDATE") {
            setPlayers(data.players || []);
          }

          if (data.type === "IMAGE_CHANGED") {
            setImageId(data.image || "nature");
          }

          if (data.type === "PUZZLE_UPDATE") {
            setPuzzle(data.puzzle || []);
            setIsWon(Boolean(data.isWon));
            setTotalMoves(data.totalMoves || 0);
            setStartTime(data.startTime || null);
            setLastMove(data.lastMove || null);
            if (data.image) setImageId(data.image);
            if (data.players) {
              setPlayers(data.players);
            }
            if (!data.startTime) {
              setElapsedSeconds(0);
            }
          }

          if (data.type === "ROOM_ERROR") {
            setErrorMessage(data.message);
          }

          if (data.type === "ROOM_LEFT") {
            setRoomCode(null);
            setPlayer(null);
            setPlayers([]);
            setPuzzle([]);
            setIsWon(false);
            setTotalMoves(0);
            setStartTime(null);
            setLastMove(null);
            setElapsedSeconds(0);
            setErrorMessage(null);
          }
        } catch (err) {
          console.error("Failed to parse incoming message:", err);
        }
      };

      socket.onclose = () => {
        if (!isMounted) return;
        setConnected(false);
        console.log("Disconnected from server. Retrying in 2 seconds...");
        reconnectTimer = setTimeout(connect, 2000);
      };

      socket.onerror = () => {
        socket.close();
      };
    }

    connect();

    return () => {
      isMounted = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (socket) socket.close();
    };
  }, []);

  function handleCreateRoom(e) {
    e.preventDefault();
    setErrorMessage(null);

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: "CREATE_ROOM",
          playerName: inputPlayerName.trim() || "Player",
          image: imageId
        })
      );
    }
  }

  function handleJoinRoom(e) {
    e.preventDefault();
    setErrorMessage(null);

    const code = inputRoomCode.trim().toUpperCase();
    if (!code) {
      setErrorMessage("Please enter a room code.");
      return;
    }

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: "JOIN_ROOM",
          roomCode: code,
          playerName: inputPlayerName.trim() || "Player"
        })
      );
    }
  }

  function handleLeaveRoom() {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: "LEAVE_ROOM"
        })
      );
    }
    setRoomCode(null);
    setPlayer(null);
    setPlayers([]);
    setPuzzle([]);
    setIsWon(false);
    setTotalMoves(0);
    setStartTime(null);
    setLastMove(null);
    setElapsedSeconds(0);
    setErrorMessage(null);
  }

  function canMove(tileIndex) {
    if (isWon || !connected || !roomCode) return false;
    if (!puzzle || puzzle[tileIndex] === null) return false;

    const emptyIndex = puzzle.indexOf(null);
    if (emptyIndex === -1) return false;

    return areAdjacent(tileIndex, emptyIndex);
  }

  function handleTileClick(index) {
    if (!canMove(index)) {
      sounds.playBump();
      return;
    }

    const emptyIndex = puzzle.indexOf(null);
    if (emptyIndex === -1) return;

    sounds.playMove();

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: "MOVE",
          from: index,
          to: emptyIndex
        })
      );
    }
  }

  function handleShuffle() {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: "SHUFFLE"
        })
      );
    }
  }

  function handleRestart() {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: "RESTART"
        })
      );
    }
  }

  function handleImageChange(newImageId) {
    setImageId(newImageId);
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN && roomCode) {
      socketRef.current.send(
        JSON.stringify({
          type: "CHANGE_IMAGE",
          image: newImageId
        })
      );
    }
  }

  function handleToggleMute() {
    const muted = sounds.toggleMute();
    setIsMuted(muted);
  }

  function handleCopyCode() {
    if (!roomCode) return;
    navigator.clipboard.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const activeImage = getImageById(imageId);

  return (
    <div className="app">
      <header className="app-header">
        <h1>🧩 5x5 Picture Puzzle</h1>
        <div className="header-controls">
          <div className="server-status">
            {connected ? "🟢 Online" : "🔴 Offline"}
          </div>
          <button
            type="button"
            className="sound-toggle-btn"
            onClick={handleToggleMute}
            title={isMuted ? "Unmute Sound" : "Mute Sound"}
          >
            {isMuted ? "🔇 Muted" : "🔊 Sound"}
          </button>
        </div>
      </header>

      {errorMessage && (
        <div className="error-banner">
          ⚠️ {errorMessage}
        </div>
      )}

      {!roomCode ? (
        /* LOBBY VIEW */
        <div className="lobby-card">
          <h2>Game Lobby</h2>

          <div className="form-group">
            <label htmlFor="playerName">Your Nickname:</label>
            <input
              id="playerName"
              type="text"
              className="text-input"
              value={inputPlayerName}
              onChange={(e) => setInputPlayerName(e.target.value)}
              placeholder="e.g. Alice"
              maxLength={20}
            />
          </div>

          <div className="form-group">
            <label htmlFor="themeSelect">Select Puzzle Image:</label>
            <div className="theme-selector-grid">
              {PUZZLE_IMAGES.map((img) => (
                <button
                  key={img.id}
                  type="button"
                  className={`theme-thumb-btn ${imageId === img.id ? "active" : ""}`}
                  onClick={() => handleImageChange(img.id)}
                >
                  <img src={img.url} alt={img.name} className="theme-thumb-img" />
                  <span>{img.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="lobby-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleCreateRoom}
              disabled={!connected}
            >
              ➕ Create 5x5 Room
            </button>

            <div className="divider"><span>OR</span></div>

            <form onSubmit={handleJoinRoom} className="join-room-form">
              <label htmlFor="roomCodeInput">Enter Room Code:</label>
              <div className="join-input-row">
                <input
                  id="roomCodeInput"
                  type="text"
                  className="text-input code-input"
                  value={inputRoomCode}
                  onChange={(e) => setInputRoomCode(e.target.value.toUpperCase())}
                  placeholder="e.g. 7A2B"
                  maxLength={6}
                />
                <button
                  type="submit"
                  className="btn btn-secondary"
                  disabled={!connected || !inputRoomCode.trim()}
                >
                  🚀 Join Room
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : (
        /* ACTIVE ROOM / GAME VIEW */
        <div className="room-container">
          <div className="room-header-bar">
            <div className="room-code-badge">
              <span>Room:</span>
              <strong>{roomCode}</strong>
              <button
                type="button"
                className="copy-btn"
                onClick={handleCopyCode}
                title="Copy Room Code"
              >
                {copied ? "✓ Copied!" : "📋 Copy"}
              </button>
            </div>

            <div className="room-header-actions">
              <button
                type="button"
                className={`btn btn-tool ${showNumbers ? "active" : ""}`}
                onClick={() => setShowNumbers(!showNumbers)}
                title="Toggle number hints on tiles"
              >
                🔢 {showNumbers ? "Numbers On" : "Numbers Off"}
              </button>
              <button
                type="button"
                className={`btn btn-tool ${showPreview ? "active" : ""}`}
                onClick={() => setShowPreview(!showPreview)}
                title="Toggle reference picture preview"
              >
                🖼️ Preview
              </button>
              <button
                type="button"
                className="btn btn-leave"
                onClick={handleLeaveRoom}
              >
                🚪 Leave
              </button>
            </div>
          </div>

          {/* Reference Image Modal / Preview */}
          {showPreview && (
            <div className="reference-preview-box">
              <div className="ref-preview-header">
                <span>Reference Image: {activeImage.name}</span>
                <button type="button" onClick={() => setShowPreview(false)}>✕</button>
              </div>
              <img src={activeImage.url} alt="Target reference" className="ref-preview-img" />
            </div>
          )}

          {/* Stats & Real-Time Activity */}
          <div className="game-stats-bar">
            <div className="stat-pill">
              <span className="stat-icon">⏱️</span>
              <span className="stat-label">Time:</span>
              <span className="stat-value">{formatTime(elapsedSeconds)}</span>
            </div>
            <div className="stat-pill">
              <span className="stat-icon">🎯</span>
              <span className="stat-label">Moves:</span>
              <span className="stat-value">{totalMoves}</span>
            </div>
            <div className="stat-pill theme-pill">
              <span className="stat-label">Theme:</span>
              <select
                className="theme-select-inline"
                value={imageId}
                onChange={(e) => handleImageChange(e.target.value)}
              >
                {PUZZLE_IMAGES.map((img) => (
                  <option key={img.id} value={img.id}>{img.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className={`activity-toast ${lastMove ? "" : "idle"}`}>
            {lastMove ? (
              <span>⚡ <strong>{lastMove.playerName}</strong> moved tile <strong>{lastMove.tile}</strong></span>
            ) : (
              <span>💡 Slide a tile adjacent to the empty spot to begin!</span>
            )}
          </div>

          {/* Victory Modal */}
          {isWon && (
            <div className="victory-overlay">
              <div className="victory-card">
                <div className="victory-icon">🏆</div>
                <h2>Picture Complete!</h2>
                <p className="victory-subtitle">Congratulations! 5x5 picture solved in Room <strong>{roomCode}</strong>!</p>

                <div className="completed-preview-wrap">
                  <img src={activeImage.url} alt="Solved" className="completed-preview-img" />
                </div>

                <div className="victory-stats-grid">
                  <div className="vstat-box">
                    <span className="vstat-num">{formatTime(elapsedSeconds)}</span>
                    <span className="vstat-lbl">Time Taken</span>
                  </div>
                  <div className="vstat-box">
                    <span className="vstat-num">{totalMoves}</span>
                    <span className="vstat-lbl">Total Moves</span>
                  </div>
                </div>

                <div className="contribution-section">
                  <h4>Player Contributions</h4>
                  <div className="contribution-list">
                    {players.map((p) => {
                      const pMoves = p.movesCount || 0;
                      const percent = totalMoves > 0 ? Math.round((pMoves / totalMoves) * 100) : 0;
                      return (
                        <div key={p.id} className="contribution-item">
                          <span className="contrib-name">
                            🟢 {p.name} {p.isHost ? "👑" : ""} {player && p.id === player.id ? "(You)" : ""}
                          </span>
                          <span className="contrib-moves">
                            <strong>{pMoves}</strong> moves ({percent}%)
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn-primary restart-btn"
                  onClick={handleRestart}
                >
                  🔄 Play Again (New Shuffle)
                </button>
              </div>
            </div>
          )}

          {/* 5x5 Picture Puzzle Board */}
          <div className="puzzle-section">
            <div className="board-wrapper">
              {puzzle && puzzle.length === 25 ? (
                <div className="puzzle-board-5x5">
                  {puzzle.map((val, idx) => {
                    const isEmpty = val === null;
                    const movable = canMove(idx);

                    // If won, fill the empty slot with the 25th piece (val 25)
                    const displayVal = isEmpty && isWon ? 25 : val;

                    let bgStyle = {};
                    if (displayVal !== null) {
                      const origIdx = displayVal - 1;
                      const origRow = Math.floor(origIdx / GRID_SIZE);
                      const origCol = origIdx % GRID_SIZE;
                      const bgX = (origCol / (GRID_SIZE - 1)) * 100;
                      const bgY = (origRow / (GRID_SIZE - 1)) * 100;

                      bgStyle = {
                        backgroundImage: `url(${activeImage.url})`,
                        backgroundSize: `${GRID_SIZE * 100}% ${GRID_SIZE * 100}%`,
                        backgroundPosition: `${bgX}% ${bgY}%`
                      };
                    }

                    return (
                      <button
                        key={idx}
                        type="button"
                        className={`picture-tile ${isEmpty && !isWon ? "empty" : ""} ${movable ? "movable" : ""}`}
                        style={bgStyle}
                        onClick={() => handleTileClick(idx)}
                        disabled={!movable && !isWon}
                        aria-label={isEmpty ? "Empty spot" : `Tile ${val}`}
                      >
                        {showNumbers && displayVal !== null && (
                          <span className="tile-number-badge">{displayVal}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p>Loading 5x5 board state...</p>
              )}
            </div>

            <div className="puzzle-controls">
              <button
                type="button"
                className="shuffle-btn"
                onClick={handleShuffle}
                disabled={!connected}
              >
                🔀 Shuffle Puzzle
              </button>
            </div>
          </div>

          <div className="room-players">
            <h2>Players in Room ({players.length})</h2>
            <div className="players-list">
              {players.map((p) => (
                <div key={p.id} className="player-badge">
                  🟢 <strong>{p.name}</strong> {p.isHost ? "👑" : ""} {player && p.id === player.id ? "(You)" : ""}
                  <span className="player-move-count">{p.movesCount || 0} moves</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;