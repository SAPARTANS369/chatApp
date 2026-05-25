const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const userRoutes = require('./routes/users');
const pool = require('./db');

const app = express();
const server = http.createServer(app);

const frontendOrigin = process.env.FRONTEND_URL || '*';

const io = new Server(server, {
    cors: {
        origin: frontendOrigin,
        methods: ['GET', 'POST']
    }
});

app.use(cors({
    origin: frontendOrigin
}));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/users', userRoutes);

// Socket.io integration
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
        return next(new Error('Authentication error'));
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.userId = decoded.userId;
        next();
    } catch (err) {
        next(new Error('Authentication error'));
    }
});

io.on('connection', async (socket) => {
    console.log('User connected via Socket:', socket.userId);
    
    // Mark user as online
    await pool.query("UPDATE users SET status = 'online' WHERE user_id = ?", [socket.userId]);
    io.emit('user_status_change', { userId: socket.userId, status: 'online' });

    socket.on('join_room', (roomId) => {
        socket.join(roomId);
    });

    socket.on('send_message', (data) => {
        io.to(data.conversation_id).emit('receive_message', data);
    });
    
    socket.on('edit_message', (data) => {
        io.to(data.conversation_id).emit('message_edited', data);
    });
    
    socket.on('delete_message', (data) => {
        io.to(data.conversation_id).emit('message_deleted', data);
    });

    socket.on('typing_start', (data) => {
        // data: { conversation_id, display_name }
        socket.to(data.conversation_id).emit('user_typing', { userId: socket.userId, display_name: data.display_name });
    });

    socket.on('typing_stop', (data) => {
        // data: { conversation_id }
        socket.to(data.conversation_id).emit('user_stopped_typing', { userId: socket.userId });
    });

    socket.on('disconnect', async () => {
        console.log('User disconnected:', socket.userId);
        await pool.query("UPDATE users SET status = 'offline', last_seen_at = NOW() WHERE user_id = ?", [socket.userId]);
        io.emit('user_status_change', { userId: socket.userId, status: 'offline', last_seen_at: new Date() });
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
