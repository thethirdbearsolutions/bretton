#!/usr/bin/env node
// migrate-to-multiroom.js - Convert single-room data to multi-room format

const fs = require('fs');
const path = require('path');

const SINGLE_FILE = path.join(__dirname, 'game-state.json');
const MULTI_FILE = path.join(__dirname, 'game-state-multiroom.json');

console.log('🔄 Migrating from Single-Room to Multi-Room');
console.log('============================================\n');

// Check if single-room file exists
if (!fs.existsSync(SINGLE_FILE)) {
  console.log('✅ No single-room data found - starting fresh!');
  console.log('💡 Multi-room will create new data file on first use.');
  process.exit(0);
}

// Check if multi-room file already exists
if (fs.existsSync(MULTI_FILE)) {
  console.log('⚠️  Multi-room data file already exists!');
  console.log(`   File: ${MULTI_FILE}`);
  console.log('\n❓ What would you like to do?');
  console.log('   1. Keep existing multi-room data (skip migration)');
  console.log('   2. Merge with single-room data');
  console.log('   3. Replace with single-room data (creates backup)');
  console.log('\n💡 Run with argument: node migrate-to-multiroom.js [skip|merge|replace]');
  process.exit(0);
}

try {
  // Load single-room data
  console.log('📂 Loading single-room data...');
  const singleData = JSON.parse(fs.readFileSync(SINGLE_FILE, 'utf8'));
  
  console.log('   ✓ Loaded successfully');
  console.log(`   - Users: ${Object.keys(singleData.users || {}).length}`);
  console.log(`   - Players: ${Object.keys(singleData.players || {}).length}`);
  console.log(`   - Game phase: ${singleData.gamePhase}`);
  
  // Create multi-room structure
  console.log('\n🔨 Converting to multi-room format...');
  
  const multiData = {
    users: singleData.users || {},
    rooms: {},
    roomList: []
  };
  
  // Only create default room if there's active game data
  const hasActivePlayers = Object.keys(singleData.players || {}).length > 0;
  const hasGameStarted = singleData.gameStarted;
  
  if (hasActivePlayers || hasGameStarted) {
    const defaultRoomId = 'default_room_' + Date.now();
    
    console.log('   ✓ Creating default room from existing game...');
    
    // Create default room with all game data
    multiData.rooms[defaultRoomId] = {
      roomId: defaultRoomId,
      roomName: 'Migrated Game',
      hostId: 'admin',
      gameId: singleData.gameId || Date.now(),
      gameStarted: singleData.gameStarted || false,
      currentRound: singleData.currentRound || 0,
      players: singleData.players || {},
      votes: singleData.votes || {},
      readyPlayers: singleData.readyPlayers || [],
      gamePhase: singleData.gamePhase || 'lobby',
      scores: singleData.scores || { USA: 0, UK: 0, USSR: 0, France: 0, China: 0, India: 0, Argentina: 0 },
      roundHistory: singleData.roundHistory || [],
      militaryDeployments: singleData.militaryDeployments || {},
      phase2: singleData.phase2 || {
        active: false,
        currentYear: 1946,
        yearlyData: {},
        achievements: {}
      },
      maxPlayers: 7,
      createdAt: Date.now()
    };
    
    // Add to room list
    multiData.roomList.push({
      id: defaultRoomId,
      name: 'Migrated Game',
      host: 'admin',
      playerCount: Object.keys(singleData.players || {}).length,
      maxPlayers: 7,
      status: singleData.gameStarted ? 'playing' : 'waiting',
      phase: singleData.gamePhase || 'lobby',
      createdAt: Date.now()
    });
    
    console.log('   ✓ Default room created with existing game state');
  } else {
    console.log('   ✓ No active game found - creating empty multi-room state');
  }
  
  // Backup single-room file
  const backupFile = SINGLE_FILE.replace('.json', '-backup-before-migration.json');
  console.log(`\n💾 Creating backup: ${path.basename(backupFile)}`);
  fs.copyFileSync(SINGLE_FILE, backupFile);
  console.log('   ✓ Backup created');
  
  // Save multi-room file
  console.log(`\n💾 Saving multi-room data: ${path.basename(MULTI_FILE)}`);
  fs.writeFileSync(MULTI_FILE, JSON.stringify(multiData, null, 2));
  console.log('   ✓ Multi-room data saved');
  
  // Summary
  console.log('\n📊 Migration Summary:');
  console.log('   ✓ Users migrated:', Object.keys(multiData.users).length);
  console.log('   ✓ Rooms created:', Object.keys(multiData.rooms).length);
  console.log('   ✓ Original data backed up');
  
  console.log('\n✅ Migration complete!');
  console.log('\n📝 Next steps:');
  console.log('   1. Start multi-room server: ./start-multiroom.sh');
  console.log('   2. Or on Render: node server-multiroom.js');
  console.log('   3. Users can login with same credentials');
  if (hasActivePlayers) {
    console.log('   4. Active game preserved in "Migrated Game" room');
  }
  console.log('\n💡 Note: Keep the backup file in case you need to revert!');
  
} catch (err) {
  console.error('\n❌ Error during migration:', err.message);
  console.log('\n💡 Possible issues:');
  console.log('   - Single-room file may be corrupted');
  console.log('   - Insufficient permissions');
  console.log('   - Invalid JSON format');
  console.log('\n🔧 Try:');
  console.log('   - Check file: cat game-state.json');
  console.log('   - Validate JSON: node -e "JSON.parse(require(\'fs\').readFileSync(\'game-state.json\'))"');
  process.exit(1);
}
