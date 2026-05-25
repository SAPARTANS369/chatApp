const express = require('express');
const router = express.Router();
const pool = require('../db');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const cloudinary = require('../cloudinary');

const authMiddleware = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
};

router.use(authMiddleware);

// Multer storage for avatars
const avatarStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, '..', 'uploads', 'avatars');
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, `user_${req.user.userId}_${Date.now()}${path.extname(file.originalname)}`);
    }
});

const avatarUpload = multer({
    storage: avatarStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
    fileFilter: (req, file, cb) => {
        const allowed = /jpeg|jpg|png|gif|webp/;
        const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
        if (allowed.test(ext)) cb(null, true);
        else cb(new Error('Only image files allowed'));
    }
});

// Upload avatar
router.post('/avatar', avatarUpload.single('avatar'), async (req, res) => {
    let resizedPath = '';
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        // Resize to 200x200 using sharp
        resizedPath = req.file.path.replace(path.extname(req.file.path), '_resized.webp');
        await sharp(req.file.path)
            .resize(200, 200, { fit: 'cover', position: 'center' })
            .webp({ quality: 85 })
            .toFile(resizedPath);

        // Delete original
        if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        // Upload to Cloudinary
        const uploadResult = await cloudinary.uploader.upload(resizedPath, {
            folder: 'avatars',
            resource_type: 'image'
        });

        // Delete resized local file
        if (fs.existsSync(resizedPath)) {
            fs.unlinkSync(resizedPath);
        }

        const avatarUrl = uploadResult.secure_url;

        await pool.query('UPDATE users SET avatar_url = ? WHERE user_id = ?', [avatarUrl, req.user.userId]);

        res.json({ avatar_url: avatarUrl });
    } catch (error) {
        console.error(error);
        // Ensure cleanup on error
        if (req.file && req.file.path && fs.existsSync(req.file.path)) {
            try { fs.unlinkSync(req.file.path); } catch {}
        }
        if (resizedPath && fs.existsSync(resizedPath)) {
            try { fs.unlinkSync(resizedPath); } catch {}
        }
        res.status(500).json({ error: 'Avatar upload failed' });
    }
});

// Get own profile
router.get('/profile', async (req, res) => {
    try {
        const [users] = await pool.query(
            'SELECT user_id, username, email, display_name, avatar_url, bio, status, last_seen_at FROM users WHERE user_id = ?',
            [req.user.userId]
        );
        res.json(users[0]);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Update own profile (display_name and bio only — avatar goes through /avatar)
router.put('/profile', async (req, res) => {
    const { display_name, bio } = req.body;
    try {
        await pool.query(
            'UPDATE users SET display_name = ?, bio = ? WHERE user_id = ?',
            [display_name || null, bio || null, req.user.userId]
        );
        const [updated] = await pool.query(
            'SELECT user_id, username, email, display_name, avatar_url, bio, status FROM users WHERE user_id = ?',
            [req.user.userId]
        );
        res.json(updated[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get another user's public profile
router.get('/profile/:id', async (req, res) => {
    try {
        const [users] = await pool.query(
            'SELECT user_id, username, display_name, avatar_url, bio, status, last_seen_at FROM users WHERE user_id = ?',
            [req.params.id]
        );
        if (users.length === 0) return res.status(404).json({ error: 'User not found' });

        const [blocks] = await pool.query(
            'SELECT * FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)',
            [req.user.userId, req.params.id, req.params.id, req.user.userId]
        );
        res.json({ ...users[0], isBlocked: blocks.some(b => b.blocker_id === req.user.userId && b.blocked_id == req.params.id), blockedMe: blocks.some(b => b.blocker_id == req.params.id && b.blocked_id === req.user.userId) });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Get my blocked users list
router.get('/blocks', async (req, res) => {
    try {
        const [blocks] = await pool.query(
            'SELECT blocked_id FROM user_blocks WHERE blocker_id = ?',
            [req.user.userId]
        );
        res.json(blocks.map(b => b.blocked_id));
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Block a user
router.post('/blocks', async (req, res) => {
    const { blocked_id } = req.body;
    if (blocked_id == req.user.userId) return res.status(400).json({ error: 'Cannot block yourself' });
    try {
        await pool.query('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (?, ?)', [req.user.userId, blocked_id]);
        res.json({ message: 'User blocked' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') return res.json({ message: 'Already blocked' });
        res.status(500).json({ error: 'Server error' });
    }
});

// Unblock a user
router.delete('/blocks/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?', [req.user.userId, req.params.id]);
        res.json({ message: 'User unblocked' });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
