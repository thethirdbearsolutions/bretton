// test-countries.js - Run this on your server to verify India & Argentina are present

console.log('🧪 Testing Bretton Woods Game Data...\n');

try {
  const gameData = require('./game-data.json');
  
  console.log('✅ game-data.json loaded successfully\n');
  
  // Test countries
  const countries = Object.keys(gameData.countries);
  console.log(`📊 Total Countries: ${countries.length}`);
  console.log(`📋 Countries List: ${countries.join(', ')}\n`);
  
  // Check for India
  if (gameData.countries.India) {
    console.log('✅ India found!');
    console.log(`   Name: ${gameData.countries.India.name}`);
    console.log(`   Color: ${gameData.countries.India.color}`);
    console.log(`   Position: ${gameData.countries.India.economicPosition}\n`);
  } else {
    console.log('❌ India NOT FOUND!\n');
  }
  
  // Check for Argentina
  if (gameData.countries.Argentina) {
    console.log('✅ Argentina found!');
    console.log(`   Name: ${gameData.countries.Argentina.name}`);
    console.log(`   Color: ${gameData.countries.Argentina.color}`);
    console.log(`   Position: ${gameData.countries.Argentina.economicPosition}\n`);
  } else {
    console.log('❌ Argentina NOT FOUND!\n');
  }
  
  // Check economic data
  const economicCountries = Object.keys(gameData.economicData);
  console.log(`💰 Economic Data Countries: ${economicCountries.length}`);
  console.log(`📋 Economic Data List: ${economicCountries.join(', ')}\n`);
  
  // Summary
  console.log('═══════════════════════════════════════');
  if (countries.length === 7 && gameData.countries.India && gameData.countries.Argentina) {
    console.log('✅ SUCCESS! All 7 countries present!');
    console.log('✅ India and Argentina are ready!');
    console.log('✅ You can start the server now!');
  } else {
    console.log('❌ PROBLEM DETECTED!');
    console.log('❌ You have the OLD version!');
    console.log('❌ Download and extract the NEW zip file!');
  }
  console.log('═══════════════════════════════════════\n');
  
} catch (error) {
  console.log('❌ ERROR: Could not load game-data.json');
  console.log(`   Error: ${error.message}`);
  console.log('\n   Make sure you are in the correct directory!');
  console.log('   Run: ls -la game-data.json\n');
}
