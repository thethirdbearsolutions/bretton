#!/usr/bin/env node
// fix-admin-role.js - Fix admin role in existing data

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, 'game-state-multiroom.json');

console.log('🔧 Fixing Admin Role in Data\n');
console.log('=' .repeat(60));

if (!fs.existsSync(STATE_FILE)) {
  console.log('\n❌ No data file found!');
  console.log(`   Looking for: ${STATE_FILE}`);
  process.exit(0);
}

try {
  const data = fs.readFileSync(STATE_FILE, 'utf8');
  const state = JSON.parse(data);
  
  console.log('\n📊 Current Users:');
  let fixed = false;
  
  Object.entries(state.users || {}).forEach(([username, user]) => {
    console.log(`\n   Username: ${username}`);
    console.log(`   Role: ${user.role || 'undefined'}`);
    console.log(`   Player ID: ${user.playerId}`);
    
    // Check if this should be superadmin
    const shouldBeAdmin = username.toLowerCase() === 'jjucovy@gmail.com' || 
                          username.toLowerCase() === 'jjucovy';
    
    if (shouldBeAdmin && user.role !== 'superadmin') {
      console.log(`   ⚠️  Should be superadmin! Fixing...`);
      user.role = 'superadmin';
      fixed = true;
    } else if (shouldBeAdmin) {
      console.log(`   ✅ Already superadmin`);
    }
  });
  
  if (fixed) {
    // Backup
    const backupFile = STATE_FILE.replace('.json', '-backup-before-fix.json');
    fs.writeFileSync(backupFile, data);
    console.log(`\n💾 Backup created: ${path.basename(backupFile)}`);
    
    // Save fixed
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    console.log(`\n✅ Fixed and saved!`);
    console.log('\nRestart the server for changes to take effect.');
  } else {
    console.log(`\n✅ No fixes needed - all roles correct!`);
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('\n💡 If you still have issues:');
  console.log('   1. Delete game-state-multiroom.json');
  console.log('   2. Restart server');
  console.log('   3. Register as jjucovy@gmail.com or jjucovy');
  console.log('   4. You will be superadmin automatically\n');
  
} catch (err) {
  console.error('\n❌ Error:', err.message);
}
