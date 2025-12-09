// server.js - Bretton Woods Multiplayer Server
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
const STATE_FILE = path.join(__dirname, 'game-state.json');

// Serve static files
app.use(express.static(__dirname));

// Game state stored on server
let gameState = {
  gameId: Date.now(),
  gameStarted: false,
  currentRound: 0,
  players: {},
  votes: {},
  readyPlayers: [],
  gamePhase: 'lobby', // lobby, voting, results, phase2, complete
  scores: { USA: 0, UK: 0, USSR: 0, France: 0, China: 0 },
  roundHistory: [],
  // User authentication
  users: {}, // username -> { password: hashedPassword, playerId: string, createdAt: timestamp }
  // Phase 2: Post-war economic management (1946-1952)
  phase2: {
    active: false,
    currentYear: 1946,
    maxYears: 7,
    yearlyData: {}, // year -> country -> economic data
    policies: {} // country -> { centralBankRate, exchangeRate, tariffRate }
  }
};

// Load game state from file if it exists
function loadGameState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = fs.readFileSync(STATE_FILE, 'utf8');
      gameState = JSON.parse(data);
      console.log('Game state loaded from file');
    }
  } catch (err) {
    console.error('Error loading game state:', err);
  }
}

// Save game state to file
function saveGameState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(gameState, null, 2));
    console.log('Game state saved to file');
  } catch (err) {
    console.error('Error saving game state:', err);
  }
}

// Load state on startup
loadGameState();

// Password hashing functions
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function verifyPassword(password, hashedPassword) {
  return hashPassword(password) === hashedPassword;
}

// Broadcast state to all connected clients
function broadcastState() {
  io.emit('stateUpdate', gameState);
  saveGameState();
}

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  
  // Send current state to newly connected client
  socket.emit('stateUpdate', gameState);
  
  // Register new user
  socket.on('register', ({ username, password }) => {
    if (!username || !password) {
      socket.emit('registerResult', { success: false, message: 'Username and password required' });
      return;
    }
    
    if (username.length < 3) {
      socket.emit('registerResult', { success: false, message: 'Username must be at least 3 characters' });
      return;
    }
    
    if (password.length < 4) {
      socket.emit('registerResult', { success: false, message: 'Password must be at least 4 characters' });
      return;
    }
    
    if (gameState.users[username]) {
      socket.emit('registerResult', { success: false, message: 'Username already taken' });
      return;
    }
    
    const playerId = `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    gameState.users[username] = {
      password: hashPassword(password),
      playerId: playerId,
      createdAt: Date.now()
    };
    
    broadcastState();
    socket.emit('registerResult', { success: true, playerId: playerId, username: username });
    console.log(`New user registered: ${username}`);
  });
  
  // Login existing user
  socket.on('login', ({ username, password }) => {
    if (!username || !password) {
      socket.emit('loginResult', { success: false, message: 'Username and password required' });
      return;
    }
    
    const user = gameState.users[username];
    if (!user) {
      socket.emit('loginResult', { success: false, message: 'Invalid username or password' });
      return;
    }
    
    if (!verifyPassword(password, user.password)) {
      socket.emit('loginResult', { success: false, message: 'Invalid username or password' });
      return;
    }
    
    socket.emit('loginResult', { success: true, playerId: user.playerId, username: username });
    console.log(`User logged in: ${username}`);
  });
  
  // Join game
  socket.on('joinGame', ({ playerId, country }) => {
    // Check if country is already taken
    const taken = Object.values(gameState.players).some(p => p.country === country);
    
    if (taken) {
      socket.emit('joinResult', { success: false, message: 'Country already taken' });
    } else {
      gameState.players[playerId] = {
        id: playerId,
        country: country,
        socketId: socket.id,
        joinedAt: Date.now()
      };
      socket.emit('joinResult', { success: true });
      broadcastState();
      console.log(`Player ${playerId} joined as ${country}`);
    }
  });
  
  // Leave game
  socket.on('leaveGame', ({ playerId }) => {
    delete gameState.players[playerId];
    gameState.readyPlayers = gameState.readyPlayers.filter(id => id !== playerId);
    broadcastState();
    console.log(`Player ${playerId} left game`);
  });
  
  // Set player ready status
  socket.on('setReady', ({ playerId, ready }) => {
    if (ready) {
      if (!gameState.readyPlayers.includes(playerId)) {
        gameState.readyPlayers.push(playerId);
      }
    } else {
      gameState.readyPlayers = gameState.readyPlayers.filter(id => id !== playerId);
    }
    broadcastState();
    console.log(`Player ${playerId} ready: ${ready}`);
  });
  
  // Start game
  socket.on('startGame', () => {
    const playerCount = Object.keys(gameState.players).length;
    const readyCount = gameState.readyPlayers.length;
    
    if (playerCount > 0 && readyCount === playerCount) {
      gameState.gameStarted = true;
      gameState.currentRound = 1;
      gameState.gamePhase = 'voting';
      gameState.readyPlayers = [];
      broadcastState();
      console.log('Game started');
    }
  });
  
  // Submit vote
  socket.on('submitVote', ({ playerId, issueId, optionId }) => {
    const player = gameState.players[playerId];
    if (player) {
      const voteKey = `${issueId}-${player.country}`;
      gameState.votes[voteKey] = optionId;
      broadcastState();
      console.log(`Player ${playerId} voted for option ${optionId} on issue ${issueId}`);
    }
  });
  
  // Advance to next round
  socket.on('nextRound', () => {
    const playerCount = Object.keys(gameState.players).length;
    const readyCount = gameState.readyPlayers.length;
    
    if (playerCount > 0 && readyCount === playerCount) {
      const issues = require('./game-data.json').issues;
      
      // Calculate scores for current round first
      calculateScoresForCurrentRound();
      
      // Check if Phase 1 is complete
      if (gameState.currentRound >= issues.length) {
        // All voting rounds complete, transition to Phase 2
        initializePhase2();
      } else {
        // Continue to next voting round
        gameState.currentRound += 1;
        gameState.readyPlayers = [];
        gameState.gamePhase = 'voting';
      }
      
      broadcastState();
      console.log(`Advanced to round ${gameState.currentRound} / Phase: ${gameState.gamePhase}`);
    }
  });
  
  // Reset game
  socket.on('resetGame', () => {
    const savedUsers = gameState.users; // Preserve user accounts
    gameState = {
      gameId: Date.now(),
      gameStarted: false,
      currentRound: 0,
      players: {},
      votes: {},
      readyPlayers: [],
      gamePhase: 'lobby',
      scores: { USA: 0, UK: 0, USSR: 0, France: 0, China: 0 },
      roundHistory: [],
      users: savedUsers, // Keep user accounts
      phase2: {
        active: false,
        currentYear: 1946,
        maxYears: 7,
        yearlyData: {},
        policies: {}
      }
    };
    broadcastState();
    console.log('Game reset');
  });
  
  // Phase 2: Set economic policies
  socket.on('setPhase2Policies', ({ playerId, centralBankRate, exchangeRate, tariffRate }) => {
    const player = gameState.players[playerId];
    if (player && gameState.phase2.active) {
      if (!gameState.phase2.policies[gameState.phase2.currentYear]) {
        gameState.phase2.policies[gameState.phase2.currentYear] = {};
      }
      gameState.phase2.policies[gameState.phase2.currentYear][player.country] = {
        centralBankRate: parseFloat(centralBankRate),
        exchangeRate: parseFloat(exchangeRate),
        tariffRate: parseFloat(tariffRate),
        submittedAt: Date.now()
      };
      broadcastState();
      console.log(`Player ${playerId} (${player.country}) set policies for ${gameState.phase2.currentYear}`);
    }
  });

  // Phase 2: Advance year
  socket.on('advanceYear', () => {
    const playerCount = Object.keys(gameState.players).length;
    const readyCount = gameState.readyPlayers.length;
    
    if (playerCount > 0 && readyCount === playerCount && gameState.phase2.active) {
      calculateYearEconomics();
      
      if (gameState.phase2.currentYear - 1946 < gameState.phase2.maxYears) {
        gameState.phase2.currentYear++;
        gameState.readyPlayers = [];
      } else {
        // End of Phase 2
        gameState.gamePhase = 'complete';
      }
      
      broadcastState();
      console.log(`Advanced to year ${gameState.phase2.currentYear}`);
    }
  });
  
  // Disconnect
  socket.on('disconnect', () => {
    // Find and remove player by socket ID
    const playerId = Object.keys(gameState.players).find(
      id => gameState.players[id].socketId === socket.id
    );
    
    if (playerId) {
      delete gameState.players[playerId];
      gameState.readyPlayers = gameState.readyPlayers.filter(id => id !== playerId);
      broadcastState();
      console.log(`Player ${playerId} disconnected`);
    }
    
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// Initialize Phase 2: Post-war economic management
function initializePhase2() {
  const initialEconomicData = require('./game-data.json').economicData;
  
  gameState.phase2.active = true;
  gameState.phase2.currentYear = 1946;
  gameState.gamePhase = 'phase2';
  gameState.readyPlayers = [];
  
  // Initialize starting economic conditions for each country
  gameState.phase2.yearlyData[1946] = {};
  Object.keys(gameState.players).forEach(playerId => {
    const player = gameState.players[playerId];
    const country = player.country;
    const initialData = initialEconomicData[country];
    
    gameState.phase2.yearlyData[1946][country] = {
      gdpGrowth: 0,
      goldReserves: initialData.goldReserves,
      unemployment: country === 'USA' ? 3.9 : country === 'UK' ? 2.5 : country === 'USSR' ? 0 : country === 'France' ? 4.5 : 5.0,
      tradeBalance: initialData.tradeBalance,
      inflation: country === 'USA' ? 8.3 : country === 'UK' ? 3.1 : country === 'USSR' ? 0 : country === 'France' ? 50.0 : 20.0,
      industrialOutput: initialData.industrialOutput
    };
  });
  
  console.log('Phase 2 initialized: Post-war economic management begins (1946-1952)');
}

// Calculate economic outcomes for the year based on policies
function calculateYearEconomics() {
  const currentYear = gameState.phase2.currentYear;
  const policies = gameState.phase2.policies[currentYear] || {};
  const prevYearData = gameState.phase2.yearlyData[currentYear];
  
  if (!prevYearData) return;
  
  // Initialize next year's data
  const nextYear = currentYear + 1;
  gameState.phase2.yearlyData[nextYear] = {};
  
  // Get Bretton Woods agreements impact
  const agreementBonus = calculateAgreementBonus();
  
  Object.keys(gameState.players).forEach(playerId => {
    const player = gameState.players[playerId];
    const country = player.country;
    const policy = policies[country];
    const prevData = prevYearData[country];
    
    if (!policy || !prevData) {
      // If no policy submitted, use defaults
      gameState.phase2.yearlyData[nextYear][country] = {
        ...prevData,
        gdpGrowth: -2.0 // Penalty for not submitting policy
      };
      return;
    }
    
    // Economic calculation model
    const { centralBankRate, exchangeRate, tariffRate } = policy;
    
    // Base growth rate (post-war boom)
    let gdpGrowth = 4.0;
    
    // Central bank rate impact (lower rates = more growth, but more inflation)
    const optimalCBRate = 3.0;
    const cbRateDeviation = Math.abs(centralBankRate - optimalCBRate);
    gdpGrowth -= cbRateDeviation * 0.5;
    
    // Exchange rate impact (competitive = more exports)
    // Higher exchange rate = stronger currency = fewer exports
    const exchangeRateImpact = (exchangeRate - 1.0) * -2.0;
    gdpGrowth += exchangeRateImpact;
    
    // Tariff impact (protection vs trade)
    const optimalTariff = country === 'USA' ? 10 : 15;
    const tariffDeviation = Math.abs(tariffRate - optimalTariff);
    gdpGrowth -= tariffDeviation * 0.1;
    
    // Bretton Woods agreement bonus
    gdpGrowth += agreementBonus[country] || 0;
    
    // Random shock (-1 to +1)
    const randomShock = (Math.random() - 0.5) * 2;
    gdpGrowth += randomShock;
    
    // Calculate inflation
    let inflation = prevData.inflation;
    // Lower CB rates = higher inflation
    if (centralBankRate < 2.0) {
      inflation += (2.0 - centralBankRate) * 2.0;
    } else if (centralBankRate > 5.0) {
      inflation -= (centralBankRate - 5.0) * 1.5;
    }
    inflation = Math.max(0, inflation + (Math.random() - 0.5) * 3);
    
    // Calculate unemployment (inverse of growth)
    let unemployment = prevData.unemployment;
    if (gdpGrowth > 3.0) {
      unemployment -= (gdpGrowth - 3.0) * 0.3;
    } else if (gdpGrowth < 1.0) {
      unemployment += (1.0 - gdpGrowth) * 0.5;
    }
    unemployment = Math.max(0.5, Math.min(25, unemployment));
    
    // Calculate trade balance
    let tradeBalance = prevData.tradeBalance;
    // Lower exchange rate = more competitive = better trade balance
    const exchangeEffect = (1.0 - exchangeRate) * 500;
    // Higher tariffs = less imports but also retaliation
    const tariffEffect = tariffRate * -20;
    // GDP growth increases imports
    const growthEffect = gdpGrowth * -100;
    
    tradeBalance += exchangeEffect + tariffEffect + growthEffect + (Math.random() - 0.5) * 200;
    
    // Calculate gold reserves
    let goldReserves = prevData.goldReserves;
    // Trade surplus = gold inflow, deficit = outflow
    if (tradeBalance > 0) {
      goldReserves += tradeBalance * 0.1;
    } else {
      goldReserves += tradeBalance * 0.15; // Faster outflow than inflow
    }
    goldReserves = Math.max(0, goldReserves);
    
    // Update industrial output
    let industrialOutput = prevData.industrialOutput;
    industrialOutput += gdpGrowth * 0.5;
    industrialOutput = Math.max(0, industrialOutput);
    
    // Store results
    gameState.phase2.yearlyData[nextYear][country] = {
      gdpGrowth: Math.round(gdpGrowth * 10) / 10,
      goldReserves: Math.round(goldReserves),
      unemployment: Math.round(unemployment * 10) / 10,
      tradeBalance: Math.round(tradeBalance),
      inflation: Math.round(inflation * 10) / 10,
      industrialOutput: Math.round(industrialOutput * 10) / 10
    };
    
    // Update country score based on performance
    const performanceScore = calculatePerformanceScore(gdpGrowth, unemployment, inflation, tradeBalance);
    gameState.scores[country] += performanceScore;
  });
}

// Calculate bonus from Bretton Woods agreements
function calculateAgreementBonus() {
  const bonus = {};
  const countries = ['USA', 'UK', 'USSR', 'France', 'China'];
  
  // Countries that got favorable agreements get economic boost
  countries.forEach(country => {
    const countryScore = gameState.scores[country] || 0;
    // Higher Phase 1 score = better agreements = economic boost
    bonus[country] = Math.max(0, countryScore / 20);
  });
  
  return bonus;
}

// Calculate performance score for the year
function calculatePerformanceScore(gdpGrowth, unemployment, inflation, tradeBalance) {
  let score = 0;
  
  // GDP growth (target: 3-5%)
  if (gdpGrowth > 5) score += 5;
  else if (gdpGrowth > 3) score += 10; // Sweet spot
  else if (gdpGrowth > 1) score += 5;
  else if (gdpGrowth > 0) score += 2;
  
  // Unemployment (target: under 5%)
  if (unemployment < 3) score += 10;
  else if (unemployment < 5) score += 8;
  else if (unemployment < 7) score += 4;
  else if (unemployment < 10) score += 2;
  
  // Inflation (target: 2-4%)
  if (inflation > 10) score -= 5;
  else if (inflation > 6) score -= 2;
  else if (inflation >= 2 && inflation <= 4) score += 8;
  else if (inflation < 2) score += 4; // Deflation risk
  
  // Trade balance (surplus is good)
  if (tradeBalance > 1000) score += 5;
  else if (tradeBalance > 0) score += 3;
  else if (tradeBalance > -1000) score += 1;
  
  return score;
}

// Calculate scores for current round (Phase 1)
function calculateScoresForCurrentRound() {
  const issues = require('./game-data.json').issues;
  const currentIssue = issues[gameState.currentRound - 1];
  
  if (currentIssue) {
    // Count votes for each option
    const voteCounts = {};
    currentIssue.options.forEach(opt => voteCounts[opt.id] = 0);
    
    Object.keys(gameState.players).forEach(playerId => {
      const player = gameState.players[playerId];
      const voteKey = `${currentIssue.id}-${player.country}`;
      const votedOptionId = gameState.votes[voteKey];
      if (votedOptionId) {
        voteCounts[votedOptionId] = (voteCounts[votedOptionId] || 0) + 1;
      }
    });
    
    // Find winning option
    let winningOptionId = null;
    let maxVotes = -1;
    Object.entries(voteCounts).forEach(([optId, count]) => {
      if (count > maxVotes) {
        maxVotes = count;
        winningOptionId = optId;
      }
    });
    
    // Award points based on winning option
    if (winningOptionId) {
      const winningOption = currentIssue.options.find(opt => opt.id === winningOptionId);
      if (winningOption) {
        Object.keys(gameState.players).forEach(playerId => {
          const player = gameState.players[playerId];
          
          if (winningOption.favors.includes(player.country)) {
            gameState.scores[player.country] += 10;
          }
          
          if (winningOption.opposes.includes(player.country)) {
            gameState.scores[player.country] -= 5;
          }
        });
        
        // Store round result
        gameState.roundHistory.push({
          round: gameState.currentRound,
          issue: currentIssue.title,
          winningOption: winningOption.text,
          votes: voteCounts
        });
      }
    }
  }
}

// Start server
server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════╗
║   Bretton Woods Multiplayer Server                   ║
║   Server running on http://localhost:65002          ║
║                                                       ║
║   Students can connect by opening:                   ║
║   http://[YOUR-IP]:65002                            ║
║                                                       ║
║   Press Ctrl+C to stop                               ║
╚═══════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nSaving game state and shutting down...');
  saveGameState();
  process.exit(0);
});
