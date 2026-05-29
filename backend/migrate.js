// backend/migrate.js
const pool = require('./db');

async function runMigration() {
    console.log('Starting E2EE Database Migration...');
    let connection;
    try {
        connection = await pool.getConnection();

        // 1. Check if users table already has the ECDH columns
        const [columns] = await connection.query("SHOW COLUMNS FROM users");
        const columnNames = columns.map(c => c.Field);
        
        if (!columnNames.includes('ecdh_public_key')) {
            console.log('Adding ecdh_public_key column to users table...');
            await connection.query("ALTER TABLE users ADD COLUMN ecdh_public_key TEXT DEFAULT NULL");
        } else {
            console.log('ecdh_public_key column already exists.');
        }

        if (!columnNames.includes('encrypted_private_key')) {
            console.log('Adding encrypted_private_key column to users table...');
            await connection.query("ALTER TABLE users ADD COLUMN encrypted_private_key TEXT DEFAULT NULL");
        } else {
            console.log('encrypted_private_key column already exists.');
        }

        // 2. Create message_keys table if it does not exist
        console.log('Creating message_keys table if it does not exist...');
        await connection.query(`
            CREATE TABLE IF NOT EXISTS message_keys (
                message_id BIGINT UNSIGNED NOT NULL,
                user_id INT UNSIGNED NOT NULL,
                encrypted_key TEXT NOT NULL,
                
                PRIMARY KEY (message_id, user_id),
                
                CONSTRAINT fk_mk_message
                    FOREIGN KEY (message_id) REFERENCES messages(message_id)
                    ON DELETE CASCADE ON UPDATE CASCADE,
                    
                CONSTRAINT fk_mk_user
                    FOREIGN KEY (user_id) REFERENCES users(user_id)
                    ON DELETE CASCADE ON UPDATE CASCADE
            ) ENGINE=InnoDB;
        `);
        console.log('message_keys table checked/created successfully.');

        console.log('E2EE Migration completed successfully!');
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        if (connection) connection.release();
        process.exit(0);
    }
}

runMigration();
