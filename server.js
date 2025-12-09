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
  scores: { USA: 0, UK: 0, USSR: 0, France: 0, China: 0, India: 0, Argentina: 0 },
  roundHistory: [],
  // User authentication
  users: {}, // username -> { password: hashedPassword, playerId: string, createdAt: timestamp }
  // Military deployments by country
  militaryDeployments: {
    USA: {
      bases: [
        { name: "Continental US", lat: 39, lng: -98, troops: 8000000, type: "homeland" },
        { name: "Pearl Harbor", lat: 21.3, lng: -157.8, troops: 50000, type: "naval" },
        { name: "Philippines", lat: 14.6, lng: 121, troops: 30000, type: "occupied" },
        { name: "Germany (Occupation)", lat: 50, lng: 10, troops: 250000, type: "occupation" },
        { name: "Japan (Occupation)", lat: 36, lng: 138, troops: 350000, type: "occupation" }
      ],
      totalTroops: 12000000,
      militaryBudget: 90000 // Million USD
    },
    UK: {
      bases: [
        { name: "British Isles", lat: 54, lng: -2, troops: 3000000, type: "homeland" },
        { name: "India (Colonial)", lat: 20, lng: 77, troops: 200000, type: "colonial" },
        { name: "Egypt (Suez)", lat: 30, lng: 31, troops: 80000, type: "base" },
        { name: "Singapore", lat: 1.3, lng: 103.8, troops: 40000, type: "base" },
        { name: "Germany (Occupation)", lat: 51, lng: 9, troops: 120000, type: "occupation" }
      ],
      totalTroops: 5000000,
      militaryBudget: 15000
    },
    USSR: {
      bases: [
        { name: "Soviet Union", lat: 60, lng: 100, troops: 12000000, type: "homeland" },
        { name: "Eastern Europe", lat: 52, lng: 20, troops: 2000000, type: "occupation" },
        { name: "Manchuria", lat: 45, lng: 125, troops: 500000, type: "forward" }
      ],
      totalTroops: 11000000,
      militaryBudget: 25000
    },
    France: {
      bases: [
        { name: "France", lat: 46, lng: 2, troops: 800000, type: "homeland" },
        { name: "Algeria (Colonial)", lat: 28, lng: 3, troops: 100000, type: "colonial" },
        { name: "Indochina (Colonial)", lat: 16, lng: 106, troops: 50000, type: "colonial" }
      ],
      totalTroops: 1200000,
      militaryBudget: 5000
    },
    China: {
      bases: [
        { name: "Nationalist China", lat: 35, lng: 105, troops: 3000000, type: "homeland" },
        { name: "Communist Base Areas", lat: 38, lng: 109, troops: 1000000, type: "insurgent" }
      ],
      totalTroops: 4300000,
      militaryBudget: 1500
    },
    India: {
      bases: [
        { name: "British India", lat: 20, lng: 77, troops: 2000000, type: "colonial_native" }
      ],
      totalTroops: 2000000,
      militaryBudget: 800
    },
    Argentina: {
      bases: [
        { name: "Argentina", lat: -34, lng: -64, troops: 120000, type: "homeland" }
      ],
      totalTroops: 120000,
      militaryBudget: 300
    }
  },
  // Phase 2: Post-war economic management (1946-1952)
  phase2: {
    active: false,
    currentYear: 1946,
    maxYears: 7,
    yearlyData: {}, // year -> country -> economic data
    policies: {}, // country -> { centralBankRate, exchangeRate, tariffRate }
    achievements: {}, // country -> achievements earned
    yearScores: {} // year -> country -> score breakdown
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
    
    // Check if player was previously in game
    const playerId = user.playerId;
    const existingPlayer = gameState.players[playerId];
    let resumeData = null;
    
    if (existingPlayer) {
      // Player is resuming - update socket ID
      existingPlayer.socketId = socket.id;
      existingPlayer.lastLogin = Date.now();
      resumeData = {
        country: existingPlayer.country,
        gamePhase: gameState.gamePhase,
        currentRound: gameState.currentRound,
        currentYear: gameState.phase2.currentYear,
        isResuming: true
      };
      console.log(`User ${username} resumed as ${existingPlayer.country}`);
    }
    
    socket.emit('loginResult', { 
      success: true, 
      playerId: user.playerId, 
      username: username,
      resumeData: resumeData
    });
    
    // Broadcast updated state if resuming
    if (resumeData) {
      broadcastState();
    }
    
    console.log(`User logged in: ${username}${resumeData ? ' (resuming)' : ''}`);
  });
  
  // Check if player should be auto-resumed
  socket.on('checkResume', ({ playerId }) => {
    const existingPlayer = gameState.players[playerId];
    
    if (existingPlayer) {
      // Player exists in game - update socket ID and resume
      existingPlayer.socketId = socket.id;
      existingPlayer.lastLogin = Date.now();
      
      socket.emit('resumeCheck', {
        shouldResume: true,
        country: existingPlayer.country,
        gamePhase: gameState.gamePhase,
        currentRound: gameState.currentRound,
        currentYear: gameState.phase2.currentYear
      });
      
      console.log(`Auto-resuming player ${playerId} as ${existingPlayer.country}`);
      broadcastState();
    } else {
      socket.emit('resumeCheck', { shouldResume: false });
    }
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
      scores: { USA: 0, UK: 0, USSR: 0, France: 0, China: 0, India: 0, Argentina: 0 },
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
        // End of Phase 2 - Calculate achievements and bonuses
        calculateFinalAchievements();
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
      unemployment: country === 'USA' ? 3.9 : 
                    country === 'UK' ? 2.5 : 
                    country === 'USSR' ? 0 : 
                    country === 'France' ? 4.5 : 
                    country === 'India' ? 8.0 :
                    country === 'Argentina' ? 5.5 : 5.0,
      tradeBalance: initialData.tradeBalance,
      inflation: country === 'USA' ? 8.3 : 
                 country === 'UK' ? 3.1 : 
                 country === 'USSR' ? 0 : 
                 country === 'France' ? 50.0 : 
                 country === 'India' ? 12.0 :
                 country === 'Argentina' ? 4.0 : 20.0,
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
    
    // China Civil War penalties (1946-1949)
    let civilWarPenalty = {
      gdp: 0,
      inflation: 0,
      trade: 0
    };
    if (country === 'China' && currentYear >= 1946 && currentYear <= 1949) {
      civilWarPenalty.gdp = -2.0;     // GDP growth penalty
      civilWarPenalty.inflation = 10;  // Hyperinflation
      civilWarPenalty.trade = -500;    // Trade disruption
    }
    
    // India Independence transition (colonial → independent)
    let indiaTransition = {
      gdp: 0,
      inflation: 0,
      trade: 0
    };
    if (country === 'India') {
      if (currentYear === 1947) {
        // 1947: Partition year - severe disruption
        indiaTransition.gdp = -1.5;      // Partition violence, displacement
        indiaTransition.inflation = 8;    // Economic chaos
        indiaTransition.trade = -300;     // Border disruption with Pakistan
      } else if (currentYear === 1948) {
        // 1948: Post-independence recovery begins
        indiaTransition.gdp = -0.5;      // Still recovering
        indiaTransition.inflation = 3;    // Stabilizing
        indiaTransition.trade = -100;     // Trade routes adjusting
      }
      // 1949+: Full independence, no penalties (but also no colonial advantages)
    }
    
    // Apply penalties
    gdpGrowth += civilWarPenalty.gdp;
    gdpGrowth += indiaTransition.gdp;
    
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
    
    // Apply China civil war hyperinflation
    inflation += civilWarPenalty.inflation;
    
    // Apply India independence transition inflation
    inflation += indiaTransition.inflation;
    
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
    
    // Apply China civil war trade disruption
    tradeBalance += civilWarPenalty.trade;
    
    // Apply India independence transition trade disruption
    tradeBalance += indiaTransition.trade;
    
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
    const prevIndustrialOutput = prevData.industrialOutput;
    industrialOutput += gdpGrowth * 0.5;
    industrialOutput = Math.max(0, industrialOutput);
    const outputGrowth = industrialOutput - prevIndustrialOutput;
    
    // Calculate gold change
    const goldChange = goldReserves - prevData.goldReserves;
    
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
    const performanceResult = calculatePerformanceScore(
      gdpGrowth, 
      unemployment, 
      inflation, 
      tradeBalance,
      goldChange,
      outputGrowth
    );
    
    // Store year score and breakdown for later display
    if (!gameState.phase2.yearScores) gameState.phase2.yearScores = {};
    if (!gameState.phase2.yearScores[nextYear]) gameState.phase2.yearScores[nextYear] = {};
    gameState.phase2.yearScores[nextYear][country] = {
      total: performanceResult.score,
      breakdown: performanceResult.breakdown
    };
    
    gameState.scores[country] += performanceResult.score;
  });
}

// Calculate bonus from Bretton Woods agreements
function calculateAgreementBonus() {
  const bonus = {};
  const countries = ['USA', 'UK', 'USSR', 'France', 'China', 'India', 'Argentina'];
  
  // Countries that got favorable agreements get economic boost
  countries.forEach(country => {
    const countryScore = gameState.scores[country] || 0;
    // Higher Phase 1 score = better agreements = economic boost
    bonus[country] = Math.max(0, countryScore / 20);
  });
  
  return bonus;
}

// Calculate performance score for the year (enhanced system)
function calculatePerformanceScore(gdpGrowth, unemployment, inflation, tradeBalance, goldChange, outputGrowth) {
  let score = 0;
  let breakdown = {};
  
  // GDP Growth (0-15 points) - Sweet spot: 5-7%
  if (gdpGrowth >= 5 && gdpGrowth <= 7) {
    score += 15;
    breakdown.gdp = 15;
  } else if (gdpGrowth >= 3 && gdpGrowth < 5) {
    score += 12;
    breakdown.gdp = 12;
  } else if (gdpGrowth > 7) {
    score += 8;
    breakdown.gdp = 8;
  } else if (gdpGrowth >= 1 && gdpGrowth < 3) {
    score += 6;
    breakdown.gdp = 6;
  } else if (gdpGrowth >= 0 && gdpGrowth < 1) {
    score += 2;
    breakdown.gdp = 2;
  } else {
    score -= 5;
    breakdown.gdp = -5;
  }
  
  // Unemployment (0-15 points) - Target: 2-4%
  if (unemployment >= 2 && unemployment <= 4) {
    score += 15;
    breakdown.unemployment = 15;
  } else if (unemployment < 2) {
    score += 10;
    breakdown.unemployment = 10;
  } else if (unemployment > 4 && unemployment <= 6) {
    score += 12;
    breakdown.unemployment = 12;
  } else if (unemployment > 6 && unemployment <= 8) {
    score += 6;
    breakdown.unemployment = 6;
  } else if (unemployment > 8 && unemployment <= 10) {
    score += 2;
    breakdown.unemployment = 2;
  } else {
    score -= 3;
    breakdown.unemployment = -3;
  }
  
  // Inflation (0-12 points) - Goldilocks: 1-3%
  if (inflation >= 1 && inflation <= 3) {
    score += 12;
    breakdown.inflation = 12;
  } else if (inflation > 3 && inflation <= 5) {
    score += 10;
    breakdown.inflation = 10;
  } else if (inflation > 0 && inflation < 1) {
    score += 5;
    breakdown.inflation = 5;
  } else if (inflation > 5 && inflation <= 7) {
    score += 4;
    breakdown.inflation = 4;
  } else if (inflation > 7 && inflation <= 10) {
    score += 0;
    breakdown.inflation = 0;
  } else if (inflation > 10) {
    score -= 8;
    breakdown.inflation = -8;
  } else {
    score -= 5;
    breakdown.inflation = -5;
  }
  
  // Trade Balance (0-10 points)
  if (tradeBalance > 2000) {
    score += 10;
    breakdown.trade = 10;
  } else if (tradeBalance > 1000) {
    score += 8;
    breakdown.trade = 8;
  } else if (tradeBalance > 0) {
    score += 6;
    breakdown.trade = 6;
  } else if (tradeBalance > -500) {
    score += 4;
    breakdown.trade = 4;
  } else if (tradeBalance > -1500) {
    score += 2;
    breakdown.trade = 2;
  } else {
    score += 0;
    breakdown.trade = 0;
  }
  
  // Gold Reserves Change (0-5 points)
  if (goldChange > 1000) {
    score += 5;
    breakdown.gold = 5;
  } else if (goldChange > 500) {
    score += 3;
    breakdown.gold = 3;
  } else if (goldChange > 0) {
    score += 1;
    breakdown.gold = 1;
  } else if (goldChange > -500) {
    score += 0;
    breakdown.gold = 0;
  } else {
    score -= 2;
    breakdown.gold = -2;
  }
  
  // Industrial Output Growth (0-3 points)
  if (outputGrowth >= 10) {
    score += 3;
    breakdown.output = 3;
  } else if (outputGrowth >= 5) {
    score += 2;
    breakdown.output = 2;
  } else if (outputGrowth >= 2) {
    score += 1;
    breakdown.output = 1;
  } else if (outputGrowth >= 0) {
    score += 0;
    breakdown.output = 0;
  } else {
    score -= 1;
    breakdown.output = -1;
  }
  
  return { score, breakdown };
}

// Calculate final achievements and bonuses at end of Phase 2
function calculateFinalAchievements() {
  if (!gameState.phase2.achievements) {
    gameState.phase2.achievements = {};
  }
  
  const countries = Object.keys(gameState.players).map(pid => gameState.players[pid].country);
  
  countries.forEach(country => {
    const achievements = [];
    let bonusPoints = 0;
    
    // Get all years data for this country
    const years = [];
    for (let year = 1946; year <= 1952; year++) {
      if (gameState.phase2.yearlyData[year] && gameState.phase2.yearlyData[year][country]) {
        years.push(gameState.phase2.yearlyData[year][country]);
      }
    }
    
    if (years.length === 0) return;
    
    // Calculate averages
    const avgGDP = years.reduce((sum, y) => sum + y.gdpGrowth, 0) / years.length;
    const avgUnemployment = years.reduce((sum, y) => sum + y.unemployment, 0) / years.length;
    const avgInflation = years.reduce((sum, y) => sum + y.inflation, 0) / years.length;
    
    // Achievement: Golden Age (100 points)
    if (avgGDP > 5 && avgUnemployment < 4 && avgInflation >= 1 && avgInflation <= 4 && 
        years.every(y => y.gdpGrowth > 0)) {
      achievements.push({ name: 'Golden Age', description: 'Exceptional economic performance', points: 100 });
      bonusPoints += 100;
    }
    
    // Achievement: Stable Prosperity (60 points)
    else if (years.every(y => y.gdpGrowth > 0) && 
             years.every(y => y.inflation <= 8) &&
             years.every(y => y.unemployment <= 10)) {
      achievements.push({ name: 'Stable Prosperity', description: 'Maintained stability all years', points: 60 });
      bonusPoints += 60;
    }
    
    // Achievement: Trade Champion (40 points)
    const allPositiveTrade = years.every(y => y.tradeBalance > 0);
    const totalTradeSurplus = years.reduce((sum, y) => sum + Math.max(0, y.tradeBalance), 0);
    if (allPositiveTrade && totalTradeSurplus > 5000) {
      achievements.push({ name: 'Trade Champion', description: 'Trade surplus all years', points: 40 });
      bonusPoints += 40;
    }
    
    // Achievement: Phoenix Rising (50 points)
    const startGDP = gameData.economicData[country].gdp;
    const endGDP = startGDP + years.reduce((sum, y) => sum + y.gdpGrowth, 0);
    if (endGDP / startGDP > 1.3) {
      achievements.push({ name: 'Phoenix Rising', description: '30%+ GDP growth', points: 50 });
      bonusPoints += 50;
    }
    
    // China-specific achievements
    if (country === 'China') {
      // Survived the Storm (automatic)
      achievements.push({ name: 'Survived the Storm', description: 'Completed Phase 2 as China', points: 30 });
      bonusPoints += 30;
      
      // Great Leap (50 points) - High growth in reconstruction years
      const reconstructionYears = [1950, 1951, 1952].map(y => 
        gameState.phase2.yearlyData[y] ? gameState.phase2.yearlyData[y][country] : null
      ).filter(Boolean);
      
      if (reconstructionYears.length >= 3) {
        const avgReconstructionGDP = reconstructionYears.reduce((sum, y) => sum + y.gdpGrowth, 0) / reconstructionYears.length;
        if (avgReconstructionGDP > 8) {
          achievements.push({ name: 'Great Leap', description: 'Exceptional post-civil war recovery', points: 50 });
          bonusPoints += 50;
        }
      }
    }
    
    // USA-specific achievements
    if (country === 'USA') {
      // Bretton Woods Leader (40 points)
      const alwaysHighestGold = years.every((_, idx) => {
        const year = 1946 + idx;
        const yearData = gameState.phase2.yearlyData[year];
        if (!yearData) return false;
        return Object.keys(yearData).every(c => 
          c === 'USA' || yearData['USA'].goldReserves >= yearData[c].goldReserves
        );
      });
      
      if (alwaysHighestGold) {
        achievements.push({ name: 'Bretton Woods Leader', description: 'Maintained gold supremacy', points: 40 });
        bonusPoints += 40;
      }
    }
    
    // USSR-specific achievement
    if (country === 'USSR') {
      // Soviet Miracle (40 points)
      if (avgGDP >= 6) {
        achievements.push({ name: 'Soviet Miracle', description: 'Command economy excellence', points: 40 });
        bonusPoints += 40;
      }
    }
    
    // India-specific achievements
    if (country === 'India') {
      // Partition Survivor (20 points) - Navigate 1947-1948 transition successfully
      const partition1947 = gameState.phase2.yearlyData[1947]?.[country];
      const partition1948 = gameState.phase2.yearlyData[1948]?.[country];
      if (partition1947 && partition1948) {
        // Survived if GDP stayed positive and unemployment didn't explode
        if (partition1947.gdpGrowth > -3 && partition1948.gdpGrowth > -1 && 
            partition1947.unemployment < 15 && partition1948.unemployment < 12) {
          achievements.push({ name: 'Partition Survivor', description: 'Navigated independence crisis successfully', points: 20 });
          bonusPoints += 20;
        }
      }
      
      // Post-Colonial Success (40 points) - Strong growth after independence
      if (avgGDP >= 5 && avgInflation < 6) {
        achievements.push({ name: 'Post-Colonial Success', description: 'Strong independent development', points: 40 });
        bonusPoints += 40;
      }
      
      // Non-Aligned Leader (30 points) - Balance without extreme policies
      const avgTariff = years.reduce((sum, y) => {
        const year = 1946 + years.indexOf(y);
        const policy = gameState.phase2.policies[year]?.[country];
        return sum + (policy?.tariffRate || 0);
      }, 0) / years.length;
      
      if (avgTariff >= 15 && avgTariff <= 35) {
        achievements.push({ name: 'Non-Aligned Leader', description: 'Balanced economic sovereignty', points: 30 });
        bonusPoints += 30;
      }
    }
    
    // Argentina-specific achievements
    if (country === 'Argentina') {
      // Agricultural Powerhouse (40 points) - Strong trade performance
      const totalTrade = years.reduce((sum, y) => sum + Math.max(0, y.tradeBalance), 0);
      if (totalTrade > 8000 && avgGDP >= 4) {
        achievements.push({ name: 'Agricultural Powerhouse', description: 'Export-led prosperity', points: 40 });
        bonusPoints += 40;
      }
      
      // Economic Independence (30 points) - Avoid debt while growing
      const finalGold = years[years.length - 1].goldReserves;
      const startGold = gameData.economicData[country].goldReserves;
      if (finalGold >= startGold && avgGDP >= 4) {
        achievements.push({ name: 'Economic Independence', description: 'Self-sufficient growth', points: 30 });
        bonusPoints += 30;
      }
    }
    
    // Store achievements
    gameState.phase2.achievements[country] = {
      list: achievements,
      totalBonus: bonusPoints
    };
    
    // Add bonus to score
    gameState.scores[country] += bonusPoints;
    
    console.log(`${country} earned ${bonusPoints} achievement bonus points`);
    achievements.forEach(a => console.log(`  - ${a.name}: ${a.points} pts`));
  });
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
