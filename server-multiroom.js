// server-multiroom.js - Bretton Woods Multi-Room Server
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 65002;
const STATE_FILE = path.join(__dirname, 'game-state-multiroom.json');

// Serve static files
app.use(express.static(__dirname));

// Serve multi-room HTML as the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index-multiroom.html'));
});

// Multi-room game state
let globalState = {
  users: {}, // username -> { password: hashedPassword, playerId: string, createdAt: timestamp }
  rooms: {}, // roomId -> gameState
  roomList: [] // { id, name, host, playerCount, maxPlayers, status, createdAt }
};

// Load military deployments data
const militaryDeploymentsData = require('./military-deployments.json');

// Create default game state template
function createGameState(roomId, roomName, hostId) {
  return {
    roomId: roomId,
    roomName: roomName,
    hostId: hostId,
    gameId: Date.now(),
    gameStarted: false,
    currentRound: 0,
    players: {},
    votes: {},
    readyPlayers: [],
    gamePhase: 'lobby',
    scores: { USA: 0, UK: 0, USSR: 0, France: 0, China: 0, India: 0, Argentina: 0 },
    roundHistory: [],
    militaryDeployments: militaryDeploymentsData,
    phase2: {
      active: false,
      currentYear: 1946,
      yearlyData: {},
      achievements: {}
    },
    maxPlayers: 7,
    createdAt: Date.now()
  };
}

// Load/save state functions
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = fs.readFileSync(STATE_FILE, 'utf8');
      const loadedState = JSON.parse(data);
      
      globalState = {
        users: loadedState.users || {},
        rooms: loadedState.rooms || {},
        roomList: loadedState.roomList || []
      };
      
      console.log('✅ Multi-room state loaded from file');
      console.log(`   - Users: ${Object.keys(globalState.users).length}`);
      console.log(`   - Rooms: ${Object.keys(globalState.rooms).length}`);
    } else {
      console.log('📝 No saved state found, using defaults');
    }
  } catch (err) {
    console.error('❌ Error loading state:', err);
    console.log('⚠️  Using default state');
  }
}

function saveState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const backupFile = STATE_FILE.replace('.json', '-backup.json');
      fs.copyFileSync(STATE_FILE, backupFile);
    }
    
    fs.writeFileSync(STATE_FILE, JSON.stringify(globalState, null, 2));
    console.log('💾 Multi-room state saved');
  } catch (err) {
    console.error('❌ Error saving state:', err);
  }
}

// Load state on startup
loadState();

// Auto-save every 2 minutes
setInterval(() => {
  saveState();
  console.log('🔄 Auto-save completed');
}, 2 * 60 * 1000);

// Save on shutdown
process.on('SIGINT', () => {
  console.log('\n⚠️  Server shutting down...');
  saveState();
  console.log('✅ Final save completed');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n⚠️  Server terminating...');
  saveState();
  console.log('✅ Final save completed');
  process.exit(0);
});

// Password functions
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function verifyPassword(password, hashedPassword) {
  return hashPassword(password) === hashedPassword;
}

// Helper to update room list
function updateRoomList() {
  globalState.roomList = Object.keys(globalState.rooms).map(roomId => {
    const room = globalState.rooms[roomId];
    const playerCount = Object.keys(room.players).length;
    
    return {
      id: roomId,
      name: room.roomName,
      host: room.hostId,
      playerCount: playerCount,
      maxPlayers: room.maxPlayers,
      status: room.gameStarted ? 'playing' : 'waiting',
      phase: room.gamePhase,
      createdAt: room.createdAt
    };
  });
}

// Broadcast to specific room
function broadcastToRoom(roomId) {
  const room = globalState.rooms[roomId];
  if (!room) return;
  
  io.to(roomId).emit('stateUpdate', room);
}

// Broadcast room list to lobby
function broadcastRoomList() {
  updateRoomList();
  io.emit('roomListUpdate', globalState.roomList);
}

// Socket connection
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  
  // Send current room list
  socket.emit('roomListUpdate', globalState.roomList);
  
  // Register new user
  socket.on('register', ({ username, password }) => {
    if (!username || !password) {
      socket.emit('registerResult', { success: false, message: 'Username and password required' });
      return;
    }
    
    if (globalState.users[username]) {
      socket.emit('registerResult', { success: false, message: 'Username already exists' });
      return;
    }
    
    const playerId = `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    globalState.users[username] = {
      password: hashPassword(password),
      playerId: playerId,
      createdAt: Date.now()
    };
    
    socket.emit('registerResult', { 
      success: true, 
      playerId: playerId,
      username: username
    });
    
    saveState();
    console.log(`User registered: ${username}`);
  });
  
  // Login existing user
  socket.on('login', ({ username, password }) => {
    if (!username || !password) {
      socket.emit('loginResult', { success: false, message: 'Username and password required' });
      return;
    }
    
    const user = globalState.users[username];
    if (!user) {
      socket.emit('loginResult', { success: false, message: 'Invalid username or password' });
      return;
    }
    
    if (!verifyPassword(password, user.password)) {
      socket.emit('loginResult', { success: false, message: 'Invalid username or password' });
      return;
    }
    
    socket.emit('loginResult', { 
      success: true, 
      playerId: user.playerId, 
      username: username
    });
    
    console.log(`User logged in: ${username}`);
  });
  
  // Create new room
  socket.on('createRoom', ({ playerId, roomName }) => {
    const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    globalState.rooms[roomId] = createGameState(roomId, roomName, playerId);
    
    socket.join(roomId);
    socket.emit('roomCreated', { 
      success: true, 
      roomId: roomId,
      roomName: roomName
    });
    
    broadcastRoomList();
    saveState();
    
    console.log(`Room created: ${roomName} (${roomId}) by ${playerId}`);
  });
  
  // Join existing room
  socket.on('joinRoom', ({ roomId }) => {
    if (!globalState.rooms[roomId]) {
      socket.emit('joinRoomResult', { success: false, message: 'Room not found' });
      return;
    }
    
    socket.join(roomId);
    socket.emit('joinRoomResult', { 
      success: true, 
      roomId: roomId 
    });
    
    broadcastToRoom(roomId);
    console.log(`Player joined room: ${roomId}`);
  });
  
  // Leave room
  socket.on('leaveRoom', ({ roomId }) => {
    socket.leave(roomId);
    socket.emit('leftRoom', { roomId });
    console.log(`Player left room: ${roomId}`);
  });
  
  // Delete room (host only)
  socket.on('deleteRoom', ({ roomId, playerId }) => {
    const room = globalState.rooms[roomId];
    
    if (!room) {
      socket.emit('deleteRoomResult', { success: false, message: 'Room not found' });
      return;
    }
    
    if (room.hostId !== playerId) {
      socket.emit('deleteRoomResult', { success: false, message: 'Only host can delete room' });
      return;
    }
    
    // Notify all players in room
    io.to(roomId).emit('roomDeleted', { roomId });
    
    // Delete room
    delete globalState.rooms[roomId];
    
    socket.emit('deleteRoomResult', { success: true });
    broadcastRoomList();
    saveState();
    
    console.log(`Room deleted: ${roomId}`);
  });
  
  // Join game in room
  socket.on('joinGame', ({ roomId, playerId, country }) => {
    const room = globalState.rooms[roomId];
    
    if (!room) {
      socket.emit('joinResult', { success: false, message: 'Room not found' });
      return;
    }
    
    const taken = Object.values(room.players).some(p => p.country === country);
    
    if (taken) {
      socket.emit('joinResult', { success: false, message: 'Country already taken' });
    } else {
      room.players[playerId] = {
        id: playerId,
        country: country,
        socketId: socket.id,
        joinedAt: Date.now()
      };
      
      socket.emit('joinResult', { success: true });
      broadcastToRoom(roomId);
      broadcastRoomList();
      saveState();
      
      console.log(`Player ${playerId} joined as ${country} in room ${roomId}`);
    }
  });
  
  // Leave game in room
  socket.on('leaveGame', ({ roomId, playerId }) => {
    const room = globalState.rooms[roomId];
    if (!room) return;
    
    delete room.players[playerId];
    room.readyPlayers = room.readyPlayers.filter(id => id !== playerId);
    
    broadcastToRoom(roomId);
    broadcastRoomList();
    saveState();
    
    console.log(`Player ${playerId} left game in room ${roomId}`);
  });
  
  // Set ready status
  socket.on('setReady', ({ roomId, playerId, ready }) => {
    const room = globalState.rooms[roomId];
    if (!room) return;
    
    if (ready) {
      if (!room.readyPlayers.includes(playerId)) {
        room.readyPlayers.push(playerId);
      }
    } else {
      room.readyPlayers = room.readyPlayers.filter(id => id !== playerId);
    }
    
    broadcastToRoom(roomId);
    saveState();
  });
  
  // Disconnect
  socket.on('disconnect', () => {
    // Find rooms where this socket is a player
    Object.keys(globalState.rooms).forEach(roomId => {
      const room = globalState.rooms[roomId];
      const playerId = Object.keys(room.players).find(
        id => room.players[id].socketId === socket.id
      );
      
      if (playerId) {
        room.players[playerId].disconnected = true;
        room.players[playerId].disconnectedAt = Date.now();
        room.readyPlayers = room.readyPlayers.filter(id => id !== playerId);
        
        broadcastToRoom(roomId);
        saveState();
        
        console.log(`Player ${playerId} disconnected from room ${roomId} - keeping in game`);
      }
    });
    
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// Start server
server.listen(PORT, () => {
  console.log('🌍 Bretton Woods Multi-Room Server');
  console.log('===================================');
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📂 State file: ${STATE_FILE}`);
  console.log(`👥 Users: ${Object.keys(globalState.users).length}`);
  console.log(`🏠 Rooms: ${Object.keys(globalState.rooms).length}`);
  console.log('===================================');
});
