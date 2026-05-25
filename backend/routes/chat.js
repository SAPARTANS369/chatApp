const express = require('express');
const router = express.Router();
const pool = require('../db');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
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

// Dynamic multer storage — per-user folder
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, '..', 'uploads', `user_${req.user.userId}`);
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const unique = Date.now() + '_' + Math.round(Math.random() * 1e6);
        cb(null, unique + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
    fileFilter: (req, file, cb) => {
        const allowed = /jpeg|jpg|png|gif|webp|mp3|ogg|wav|m4a|webm|mp4|pdf|txt/;
        const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
        if (allowed.test(ext)) cb(null, true);
        else cb(new Error('File type not allowed'));
    }
});

// Get conversations with previews
router.get('/conversations', async (req, res) => {
    try {
        const query = `
            SELECT 
                c.conversation_id, c.conversation_type, c.name, c.updated_at,
                (SELECT u.display_name 
                 FROM users u 
                 JOIN conversation_members cm2 ON u.user_id = cm2.user_id 
                 WHERE cm2.conversation_id = c.conversation_id AND cm2.user_id != ? 
                 LIMIT 1) as other_user_name,
                (SELECT m.content FROM messages m WHERE m.conversation_id = c.conversation_id ORDER BY m.created_at DESC LIMIT 1) as last_message_content,
                (SELECT m.message_type FROM messages m WHERE m.conversation_id = c.conversation_id ORDER BY m.created_at DESC LIMIT 1) as last_message_type,
                (SELECT m.is_deleted FROM messages m WHERE m.conversation_id = c.conversation_id ORDER BY m.created_at DESC LIMIT 1) as last_message_deleted,
                (SELECT COUNT(*) FROM messages m 
                 WHERE m.conversation_id = c.conversation_id 
                 AND m.message_id > IFNULL(cm.last_read_message_id, 0) 
                 AND m.sender_id != ?) as unread_count
            FROM conversations c
            JOIN conversation_members cm ON c.conversation_id = cm.conversation_id
            WHERE cm.user_id = ?
            ORDER BY c.updated_at DESC
        `;
        const [conversations] = await pool.query(query, [req.user.userId, req.user.userId, req.user.userId]);
        res.json(conversations);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Create private chat
router.post('/conversations', async (req, res) => {
    const { otherUserId } = req.body;
    try {
        const [blocks] = await pool.query(
            'SELECT * FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)',
            [req.user.userId, otherUserId, otherUserId, req.user.userId]
        );
        if (blocks.length > 0) return res.status(403).json({ error: 'Interaction blocked' });

        const [existing] = await pool.query(`
            SELECT c.conversation_id FROM conversations c
            JOIN conversation_members cm1 ON c.conversation_id = cm1.conversation_id AND cm1.user_id = ?
            JOIN conversation_members cm2 ON c.conversation_id = cm2.conversation_id AND cm2.user_id = ?
            WHERE c.conversation_type = 'private'
        `, [req.user.userId, otherUserId]);

        if (existing.length > 0) return res.json({ conversation_id: existing[0].conversation_id });

        const connection = await pool.getConnection();
        await connection.beginTransaction();
        try {
            const [cResult] = await connection.query('INSERT INTO conversations (conversation_type, created_by) VALUES (?, ?)', ['private', req.user.userId]);
            const convId = cResult.insertId;
            await connection.query('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?), (?, ?)',
                [convId, req.user.userId, convId, otherUserId]);
            await connection.commit();
            res.json({ conversation_id: convId });
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Create group chat
router.post('/conversations/group', async (req, res) => {
    const { name, members } = req.body;
    try {
        const connection = await pool.getConnection();
        await connection.beginTransaction();
        try {
            const [cResult] = await connection.query('INSERT INTO conversations (conversation_type, name, created_by) VALUES (?, ?, ?)', ['group', name, req.user.userId]);
            const convId = cResult.insertId;
            let vals = [[convId, req.user.userId, 'admin']];
            members.forEach(id => vals.push([convId, id, 'member']));
            await connection.query('INSERT INTO conversation_members (conversation_id, user_id, member_role) VALUES ?', [vals]);
            await connection.commit();
            res.json({ conversation_id: convId });
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Add members to existing group chat
router.post('/conversations/:id/members', async (req, res) => {
    const { members } = req.body; // Array of user IDs
    const conversationId = req.params.id;
    try {
        // Verify current user is a member/admin of the group first
        const [existing] = await pool.query('SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?', [conversationId, req.user.userId]);
        if (existing.length === 0) return res.status(403).json({ error: 'Forbidden' });

        const connection = await pool.getConnection();
        await connection.beginTransaction();
        try {
            let vals = [];
            members.forEach(id => vals.push([conversationId, id, 'member']));
            await connection.query('INSERT INTO conversation_members (conversation_id, user_id, member_role) VALUES ?', [vals]);
            await connection.commit();
            res.json({ success: true });
        } catch (err) {
            await connection.rollback();
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ error: 'Some users are already in this group' });
            }
            throw err;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get messages (with replied-to message data)
router.get('/conversations/:id/messages', async (req, res) => {
    try {
        const [parts] = await pool.query('SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?', [req.params.id, req.user.userId]);
        if (parts.length === 0) return res.status(403).json({ error: 'Forbidden' });

        const [messages] = await pool.query(`
            SELECT m.*, u.username, u.display_name,
                   rm.content AS reply_content,
                   rm.message_type AS reply_type,
                   ru.display_name AS reply_display_name
            FROM messages m
            JOIN users u ON m.sender_id = u.user_id
            LEFT JOIN messages rm ON m.reply_to_message_id = rm.message_id
            LEFT JOIN users ru ON rm.sender_id = ru.user_id
            WHERE m.conversation_id = ?
            ORDER BY m.created_at ASC
        `, [req.params.id]);
        res.json(messages);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Send text message (with optional reply)
router.post('/conversations/:id/messages', async (req, res) => {
    const { content, reply_to_message_id } = req.body;
    try {
        const [conv] = await pool.query('SELECT conversation_type FROM conversations WHERE conversation_id = ?', [req.params.id]);
        if (conv[0].conversation_type === 'private') {
            const [others] = await pool.query('SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ?', [req.params.id, req.user.userId]);
            if (others.length > 0) {
                const [blocks] = await pool.query('SELECT * FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)',
                    [req.user.userId, others[0].user_id, others[0].user_id, req.user.userId]);
                if (blocks.length > 0) return res.status(403).json({ error: 'Cannot send messages to blocked user' });
            }
        }

        const [result] = await pool.query(
            'INSERT INTO messages (conversation_id, sender_id, message_type, content, reply_to_message_id) VALUES (?, ?, ?, ?, ?)',
            [req.params.id, req.user.userId, 'text', content, reply_to_message_id || null]
        );
        await pool.query('UPDATE conversations SET updated_at = NOW() WHERE conversation_id = ?', [req.params.id]);

        const [message] = await pool.query(`
            SELECT m.*, u.username, u.display_name,
                   rm.content AS reply_content, rm.message_type AS reply_type,
                   ru.display_name AS reply_display_name
            FROM messages m
            JOIN users u ON m.sender_id = u.user_id
            LEFT JOIN messages rm ON m.reply_to_message_id = rm.message_id
            LEFT JOIN users ru ON rm.sender_id = ru.user_id
            WHERE m.message_id = ?
        `, [result.insertId]);
        res.status(201).json(message[0]);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Upload file/image/audio message
router.post('/conversations/:id/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const ext = path.extname(req.file.originalname).toLowerCase();
        const audioExts = ['.mp3', '.ogg', '.wav', '.m4a'];
        const voiceExts = ['.webm'];
        const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
        let messageType = 'file';
        if (imageExts.includes(ext)) messageType = 'image';
        else if (voiceExts.includes(ext)) messageType = 'voice';
        else if (audioExts.includes(ext)) messageType = 'audio';

        let resourceType = 'raw';
        if (messageType === 'image') resourceType = 'image';
        else if (messageType === 'audio' || messageType === 'voice') resourceType = 'video';

        // Upload to Cloudinary
        const uploadResult = await cloudinary.uploader.upload(req.file.path, {
            folder: `chat_attachments/user_${req.user.userId}`,
            resource_type: resourceType
        });

        // Delete local temporary file
        if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        const fileUrl = uploadResult.secure_url;
        const { reply_to_message_id } = req.body;

        const [result] = await pool.query(
            'INSERT INTO messages (conversation_id, sender_id, message_type, file_url, reply_to_message_id) VALUES (?, ?, ?, ?, ?)',
            [req.params.id, req.user.userId, messageType, fileUrl, reply_to_message_id || null]
        );
        await pool.query('UPDATE conversations SET updated_at = NOW() WHERE conversation_id = ?', [req.params.id]);

        const [message] = await pool.query(`
            SELECT m.*, u.username, u.display_name,
                   rm.content AS reply_content, rm.message_type AS reply_type,
                   ru.display_name AS reply_display_name
            FROM messages m
            JOIN users u ON m.sender_id = u.user_id
            LEFT JOIN messages rm ON m.reply_to_message_id = rm.message_id
            LEFT JOIN users ru ON rm.sender_id = ru.user_id
            WHERE m.message_id = ?
        `, [result.insertId]);

        res.status(201).json(message[0]);
    } catch (error) {
        console.error(error);
        if (req.file && req.file.path && fs.existsSync(req.file.path)) {
            try { fs.unlinkSync(req.file.path); } catch {}
        }
        res.status(500).json({ error: 'Upload failed' });
    }
});

// Mark read
router.put('/conversations/:id/read', async (req, res) => {
    try {
        await pool.query(`
            UPDATE conversation_members 
            SET last_read_message_id = (SELECT MAX(message_id) FROM messages WHERE conversation_id = ?) 
            WHERE conversation_id = ? AND user_id = ?
        `, [req.params.id, req.params.id, req.user.userId]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Edit message
router.put('/messages/:id', async (req, res) => {
    const { content } = req.body;
    try {
        await pool.query('UPDATE messages SET content = ?, updated_at = NOW() WHERE message_id = ? AND sender_id = ?', [content, req.params.id, req.user.userId]);
        res.json({ message: 'Updated' });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Soft delete message
router.delete('/messages/:id', async (req, res) => {
    try {
        await pool.query('UPDATE messages SET is_deleted = TRUE, content = "[DELETED]" WHERE message_id = ? AND sender_id = ?', [req.params.id, req.user.userId]);
        res.json({ message: 'Deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
