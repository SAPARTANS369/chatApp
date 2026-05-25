const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');

router.post('/register', async (req, res) => {
    const { username, email, password, display_name } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const [result] = await pool.query(
            'INSERT INTO users (username, email, password_hash, display_name) VALUES (?, ?, ?, ?)',
            [username, email, hashedPassword, display_name || username]
        );
        
        res.status(201).json({ message: 'User registered successfully', userId: result.insertId });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Username or email already exists' });
        }
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const [users] = await pool.query('SELECT * FROM users WHERE username = ? OR email = ?', [username, username]);
        if (users.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const user = users[0];
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        // Update user status to online
        await pool.query("UPDATE users SET status = 'online', last_seen_at = NOW() WHERE user_id = ?", [user.user_id]);
        
        const token = jwt.sign({ userId: user.user_id, username: user.username }, process.env.JWT_SECRET, { expiresIn: '1d' });
        res.json({
            token,
            user: {
                id: user.user_id,
                username: user.username,
                displayName: user.display_name,
                avatar: user.avatar_url
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/users', async (req, res) => {
    const { search } = req.query;
    try {
        let query = 'SELECT user_id, username, display_name, avatar_url, bio, status FROM users';
        let params = [];
        if (search) {
            query += ' WHERE username LIKE ? OR display_name LIKE ?';
            params.push(`%${search}%`, `%${search}%`);
        }
        const [users] = await pool.query(query, params);
        res.json(users);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
