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

// Serve multi-room HTML as the main page (MUST come before static middleware!)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index-multiroom.html'));
});

// Serve static files (after the specific route)
app.use(express.static(__dirname));

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
    
    // Only jjucovy@gmail.com is the super admin
    const isSuperAdmin = username.toLowerCase() === 'jjucovy@gmail.com' || username.toLowerCase() === 'jjucovy';
    
    globalState.users[username] = {
      password: hashPassword(password),
      playerId: playerId,
      createdAt: Date.now(),
      role: isSuperAdmin ? 'superadmin' : 'player'
    };
    
    socket.emit('registerResult', { 
      success: true, 
      playerId: playerId,
      username: username,
      role: isSuperAdmin ? 'superadmin' : 'player'
    });
    
    saveState();
    console.log(`User registered: ${username} (${isSuperAdmin ? 'SUPER ADMIN' : 'player'})`);
  });
  
  // Login existing user
  socket.on('login', ({ username, password }) => {
    console.log('=== LOGIN REQUEST ===');
    console.log('Username:', username);
    
    if (!username || !password) {
      socket.emit('loginResult', { success: false, message: 'Username and password required' });
      return;
    }
    
    const user = globalState.users[username];
    if (!user) {
      console.log('ERROR: User not found');
      socket.emit('loginResult', { success: false, message: 'Invalid username or password' });
      return;
    }
    
    console.log('User found, role:', user.role || 'undefined');
    
    if (!verifyPassword(password, user.password)) {
      console.log('ERROR: Password incorrect');
      socket.emit('loginResult', { success: false, message: 'Invalid username or password' });
      return;
    }
    
    const role = user.role || 'player';
    console.log('Login successful, sending role:', role);
    
    socket.emit('loginResult', { 
      success: true, 
      playerId: user.playerId, 
      username: username,
      role: role
    });
    
    console.log(`User logged in: ${username} (${role})`);
    console.log('====================');
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
    
    // Prevent superadmin from joining as player
    const user = Object.values(globalState.users).find(u => u.playerId === playerId);
    if (user && user.role === 'superadmin') {
      socket.emit('joinResult', { success: false, message: 'Administrator cannot join as a player. You are an observer.' });
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
  
  // SUPERADMIN ONLY: Start game in room
  socket.on('startGame', ({ roomId, playerId }) => {
    console.log('=== START GAME REQUEST ===');
    console.log('Room ID:', roomId);
    console.log('Player ID:', playerId);
    
    const room = globalState.rooms[roomId];
    if (!room) {
      console.log('ERROR: Room not found');
      socket.emit('startGameResult', { success: false, message: 'Room not found' });
      return;
    }
    
    // Check if user is superadmin
    const user = Object.values(globalState.users).find(u => u.playerId === playerId);
    console.log('User found:', user ? 'YES' : 'NO');
    if (user) {
      console.log('User role:', user.role);
    }
    
    const isSuperAdmin = user && user.role === 'superadmin';
    console.log('Is superadmin:', isSuperAdmin);
    
    if (!isSuperAdmin) {
      console.log('ERROR: Not superadmin');
      socket.emit('startGameResult', { 
        success: false, 
        message: `Only the administrator can start games. Your role: ${user ? user.role : 'not found'}` 
      });
      return;
    }
    
    // Check if enough players
    const playerCount = Object.keys(room.players).length;
    console.log('Player count:', playerCount);
    
    if (playerCount < 2) {
      console.log('ERROR: Not enough players');
      socket.emit('startGameResult', { success: false, message: 'Need at least 2 players to start' });
      return;
    }
    
    room.gameStarted = true;
    room.gamePhase = 'voting';
    room.currentRound = 1;
    
    console.log('SUCCESS: Game started!');
    socket.emit('startGameResult', { success: true });
    broadcastToRoom(roomId);
    broadcastRoomList();
    saveState();
    
    console.log(`Game started in room ${roomId} by superadmin`);
    console.log('=========================');
  });
  
  // Vote on current issue
  socket.on('vote', ({ roomId, playerId, choice }) => {
    const room = globalState.rooms[roomId];
    if (!room || !room.gameStarted) {
      console.log('Vote rejected: room not found or game not started');
      return;
    }
    
    // Check player is in game
    if (!room.players[playerId]) {
      console.log('Vote rejected: player not in game');
      return;
    }
    
    // Store vote
    room.votes[playerId] = choice;
    console.log(`Vote received: ${playerId} voted ${choice} in room ${roomId}`);
    
    // Check if all players have voted
    const playerIds = Object.keys(room.players);
    const allVoted = playerIds.every(id => room.votes[id]);
    
    if (allVoted) {
      console.log('All players voted, calculating results...');
      
      // Tally votes
      const voteTally = { for: 0, against: 0, abstain: 0 };
      Object.values(room.votes).forEach(vote => {
        voteTally[vote] = (voteTally[vote] || 0) + 1;
      });
      
      // Determine outcome (simple majority)
      const outcome = voteTally['for'] > voteTally.against ? 'passed' : 'failed';
      
      // Calculate scores for this round
      const roundScores = {};
      Object.entries(room.players).forEach(([id, player]) => {
        const country = player.country;
        const vote = room.votes[id];
        
        // Simple scoring logic
        let points = 0;
        
        // Base points for participation
        points += 10;
        
        // Bonus points based on vote alignment with outcome
        if ((vote === 'for' && outcome === 'passed') || (vote === 'against' && outcome === 'failed')) {
          points += 30; // Voted with winning side
        }
        
        // Abstain penalty
        if (vote === 'abstain') {
          points += 5; // Small points for abstaining
        }
        
        roundScores[country] = points;
        room.scores[country] = (room.scores[country] || 0) + points;
      });
      
      // Store results
      room.voteTally = voteTally;
      room.roundOutcome = outcome;
      room.roundScores = roundScores;
      room.gamePhase = 'results';
      
      console.log(`Round ${room.currentRound} results:`, { voteTally, outcome });
    }
    
    broadcastToRoom(roomId);
    saveState();
  });
  
  // Advance to next round (admin only)
  socket.on('advanceRound', ({ roomId, playerId }) => {
    const room = globalState.rooms[roomId];
    if (!room) return;
    
    const user = Object.values(globalState.users).find(u => u.playerId === playerId);
    const isSuperAdmin = user && user.role === 'superadmin';
    
    if (!isSuperAdmin) {
      console.log('Advance round rejected: not superadmin');
      return;
    }
    
    // Advance round
    room.currentRound++;
    console.log(`Advancing to round ${room.currentRound}`);
    
    // Check if game is complete
    if (room.currentRound > 10) {
      room.gamePhase = 'complete';
      console.log('Game complete!');
    } else {
      room.gamePhase = 'voting';
      room.votes = {}; // Clear votes for new round
    }
    
    broadcastToRoom(roomId);
    saveState();
  });
  
  // SUPERADMIN ONLY: Reset room
  socket.on('resetRoom', ({ roomId, playerId }) => {
    const room = globalState.rooms[roomId];
    if (!room) return;
    
    const user = Object.values(globalState.users).find(u => u.playerId === playerId);
    const isSuperAdmin = user && user.role === 'superadmin';
    
    if (!isSuperAdmin) {
      socket.emit('resetRoomResult', { success: false, message: 'Only the administrator can reset games' });
      return;
    }
    
    // Reset game state but keep players
    room.gameStarted = false;
    room.currentRound = 0;
    room.gamePhase = 'lobby';
    room.votes = {};
    room.scores = { USA: 0, UK: 0, USSR: 0, France: 0, China: 0, India: 0, Argentina: 0 };
    room.roundHistory = [];
    room.readyPlayers = [];
    room.phase2 = {
      active: false,
      currentYear: 1946,
      yearlyData: {},
      achievements: {}
    };
    
    socket.emit('resetRoomResult', { success: true });
    broadcastToRoom(roomId);
    broadcastRoomList();
    saveState();
    
    console.log(`Room ${roomId} reset by superadmin`);
  });
  
  // SUPERADMIN ONLY: Clear all data
  socket.on('clearAllData', ({ playerId, confirmCode }) => {
    console.log('clearAllData called:', { playerId, confirmCode });
    
    const user = Object.values(globalState.users).find(u => u.playerId === playerId);
    console.log('User found:', user ? `${user.role}` : 'not found');
    console.log('All users:', Object.keys(globalState.users));
    
    if (!user) {
      socket.emit('clearDataResult', { success: false, message: 'User not found. Please try logging out and back in.' });
      return;
    }
    
    if (user.role !== 'superadmin') {
      socket.emit('clearDataResult', { success: false, message: `Access denied. Your role is: ${user.role}. Only superadmin can clear data.` });
      return;
    }
    
    if (confirmCode !== 'CLEAR_ALL_DATA') {
      socket.emit('clearDataResult', { success: false, message: 'Invalid confirmation code. Type exactly: CLEAR_ALL_DATA' });
      return;
    }
    
    // Clear all rooms but keep superadmin user
    globalState.rooms = {};
    globalState.roomList = [];
    
    // Keep only superadmin user
    const superAdminUser = {};
    Object.entries(globalState.users).forEach(([username, userData]) => {
      if (userData.role === 'superadmin') {
        superAdminUser[username] = userData;
      }
    });
    globalState.users = superAdminUser;
    
    broadcastRoomList();
    saveState();
    
    socket.emit('clearDataResult', { success: true, message: 'All data cleared except administrator account' });
    console.log(`All data cleared by superadmin: ${user.playerId}`);
  });
  
  // SUPERADMIN ONLY: Delete any room
  socket.on('adminDeleteRoom', ({ roomId, playerId }) => {
    const user = Object.values(globalState.users).find(u => u.playerId === playerId);
    
    if (!user || user.role !== 'superadmin') {
      socket.emit('deleteRoomResult', { success: false, message: 'Administrator access required' });
      return;
    }
    
    if (!globalState.rooms[roomId]) {
      socket.emit('deleteRoomResult', { success: false, message: 'Room not found' });
      return;
    }
    
    // Notify all players in room
    io.to(roomId).emit('roomDeleted', { roomId });
    
    // Delete room
    delete globalState.rooms[roomId];
    
    socket.emit('deleteRoomResult', { success: true });
    broadcastRoomList();
    saveState();
    
    console.log(`Room ${roomId} deleted by superadmin`);
  });
  
  // Remove promote function - no one can be promoted
  
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
