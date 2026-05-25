const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function setup() {
    console.log('Starting database setup...');
    
    // Connect without database first to drop/create
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        multipleStatements: true
    });

    try {
        console.log('Reading schema.sql...');
        const schema = fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8');
        
        console.log('Executing schema.sql...');
        await connection.query('DROP DATABASE IF EXISTS chat_app;');
        await connection.query(schema);
        console.log('Schema created successfully.');
        
        await connection.query('USE chat_app;');
        
        // Seed some test users
        console.log('Seeding initial users...');
        const pass1 = await bcrypt.hash('neo123', 10);
        const pass2 = await bcrypt.hash('matrix123', 10);
        const pass3 = await bcrypt.hash('trinity123', 10);
        
        await connection.query(`
            INSERT INTO users (username, email, password_hash, display_name, bio) VALUES 
            ('neo', 'neo@matrix.com', ?, 'Neo', 'The One'),
            ('morpheus', 'morpheus@matrix.com', ?, 'Morpheus', 'Nebuchadnezzar Captain'),
            ('trinity', 'trinity@matrix.com', ?, 'Trinity', 'First Mate')
        `, [pass1, pass2, pass3]);
        
        console.log('Initial users seeded! You can login with:');
        console.log('- neo / neo123');
        console.log('- morpheus / matrix123');
        console.log('- trinity / trinity123');
        
    } catch (error) {
        console.error('Error during setup:', error);
    } finally {
        await connection.end();
        console.log('Setup finished.');
    }
}

setup();
