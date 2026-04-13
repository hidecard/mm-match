const fs = require('fs');
const path = require('path');

// Read the migration file
const migrationPath = path.join(__dirname, 'performance-migration.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');

console.log('Migration SQL:');
console.log(migration);
console.log('\nPlease run this SQL manually in your Turso database dashboard or use the Turso CLI:');
