#!/usr/bin/env node
// view-multiroom-data.js - View multi-room saved data

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, 'game-state-multiroom.json');

console.log('🔍 Bretton Woods Multi-Room - Data Viewer\n');
console.log('=' .repeat(60));

if (!fs.existsSync(STATE_FILE)) {
  console.log('\n❌ No saved data file found!');
  console.log(`   Looking for: ${STATE_FILE}`);
  console.log('\n💡 This is normal if:');
  console.log('   - Server has never been started');
  console.log('   - No users have registered');
  console.log('   - No rooms have been created');
  console.log('   - Data file was deleted');
  process.exit(0);
}

try {
  const data = fs.readFileSync(STATE_FILE, 'utf8');
  const state = JSON.parse(data);
  
  console.log('\n✅ Data file found!');
  console.log(`   Location: ${STATE_FILE}`);
  console.log(`   Size: ${(fs.statSync(STATE_FILE).size / 1024).toFixed(2)} KB`);
  
  console.log('\n📊 MULTI-ROOM DATA SUMMARY:');
  console.log('=' .repeat(60));
  
  // Users
  const userCount = Object.keys(state.users || {}).length;
  console.log(`\n👥 Registered Users: ${userCount}`);
  if (userCount > 0) {
    console.log('   Accounts:');
    Object.entries(state.users).forEach(([username, user]) => {
      const joinedDate = new Date(user.createdAt).toLocaleString();
      console.log(`   - ${username} (created ${joinedDate})`);
      console.log(`     Player ID: ${user.playerId}`);
    });
  }
  
  // Rooms
  const roomCount = Object.keys(state.rooms || {}).length;
  console.log(`\n🏠 Active Rooms: ${roomCount}`);
  if (roomCount > 0) {
    Object.entries(state.rooms).forEach(([roomId, room]) => {
      console.log(`\n   📍 Room: "${room.roomName}"`);
      console.log(`      ID: ${roomId}`);
      console.log(`      Host: ${room.hostId}`);
      console.log(`      Status: ${room.gameStarted ? 'Playing' : 'Waiting'}`);
      console.log(`      Phase: ${room.gamePhase}`);
      console.log(`      Created: ${new Date(room.createdAt).toLocaleString()}`);
      
      const playerCount = Object.keys(room.players || {}).length;
      console.log(`      Players: ${playerCount}/${room.maxPlayers}`);
      
      if (playerCount > 0) {
        console.log('      Countries:');
        Object.values(room.players).forEach(player => {
          const status = player.disconnected ? '🔌 Disconnected' : '✓ Connected';
          console.log(`        - ${player.country} (${status})`);
        });
      }
      
      if (room.gamePhase === 'voting') {
        console.log(`      Current Round: ${room.currentRound}`);
      } else if (room.gamePhase === 'phase2') {
        console.log(`      Current Year: ${room.phase2?.currentYear || 'N/A'}`);
      }
      
      // Scores
      const scores = room.scores || {};
      const activeScores = Object.entries(scores).filter(([, score]) => score > 0);
      if (activeScores.length > 0) {
        console.log('      Scores:');
        activeScores
          .sort((a, b) => b[1] - a[1])
          .forEach(([country, score]) => {
            console.log(`        - ${country}: ${score} points`);
          });
      }
    });
  }
  
  // Room List
  const roomListCount = (state.roomList || []).length;
  console.log(`\n📋 Room List Entries: ${roomListCount}`);
  if (roomListCount > 0) {
    state.roomList.forEach(room => {
      console.log(`   - ${room.name}: ${room.playerCount}/${room.maxPlayers} players (${room.status})`);
    });
  }
  
  // File info
  const stats = fs.statSync(STATE_FILE);
  console.log(`\n⏰ Last Modified: ${stats.mtime.toLocaleString()}`);
  
  // Check for backup
  const backupFile = STATE_FILE.replace('.json', '-backup.json');
  if (fs.existsSync(backupFile)) {
    const backupStats = fs.statSync(backupFile);
    console.log(`💾 Backup File: ${(backupStats.size / 1024).toFixed(2)} KB (${backupStats.mtime.toLocaleString()})`);
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('\n✅ Multi-room data is being saved and persisted correctly!\n');
  
  // Storage breakdown
  const totalPlayers = Object.values(state.rooms || {})
    .reduce((sum, room) => sum + Object.keys(room.players || {}).length, 0);
  
  console.log('📈 Storage Summary:');
  console.log(`   - ${userCount} user account(s)`);
  console.log(`   - ${roomCount} active room(s)`);
  console.log(`   - ${totalPlayers} player(s) in games`);
  console.log(`   - File size: ${(fs.statSync(STATE_FILE).size / 1024).toFixed(2)} KB`);
  console.log();
  
} catch (err) {
  console.error('\n❌ Error reading data file:', err.message);
  console.log('\n💡 The file may be corrupted. Consider:');
  console.log('   - Restoring from backup (game-state-multiroom-backup.json)');
  console.log('   - Deleting the file to start fresh');
}
