require('dotenv').config();
const express = require('express');
const path = require('path');
const http = require('http');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');
const rateLimiter = require('./Middlewares/rateLimiter');

// initialize DB (Models/db.js connects using MONGODB_URI)
require('./Models/db');

const authRoutes = require('./Routes/auth');
const userRoutes = require('./Routes/users');
const appointmentRoutes = require('./Routes/appointments');
const prescriptionRoutes = require('./Routes/prescriptions');
const documentRoutes = require('./Routes/documents');
const videoRoutes = require('./Routes/video');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
  cors: { origin: '*', credentials: true },
  transports: ['websocket', 'polling'],
  pingInterval: 25000,
  pingTimeout: 60000,
  allowEIO3: true
});

const PORT = process.env.PORT || 8090;

// Basic security and parsing
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(rateLimiter);

// Mount API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/video', videoRoutes);
app.use('/api/prescriptions', prescriptionRoutes);
app.use('/api/documents', documentRoutes);
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/ping', (req, res) => res.send('pong'));
app.get('/', (req, res) => res.send('API is running'));

// --- SOCKET.IO ---
// Simple in-memory map. For production use Redis if you scale to multiple nodes.
const onlineUsers = new Map(); // userId => socketId
const socketToUser = new Map(); // socketId => userId (reverse lookup)

// Helper: Get userId from socketId
const getUserIdFromSocket = (socketId) => {
    return socketToUser.get(socketId);
};

io.on('connection', (socket) => {
    // expect the client to emit `identify` with their userId after connecting
    socket.on('identify', (userId) => {
        if (!userId) return;
        const userIdStr = userId.toString();
        
        // Remove old mapping if this user was connected before
        const oldSocketId = onlineUsers.get(userIdStr);
        if (oldSocketId) {
            socketToUser.delete(oldSocketId);
        }
        
        console.log('👤 User identified:', userIdStr, 'Socket ID:', socket.id);
        onlineUsers.set(userIdStr, socket.id);
        socketToUser.set(socket.id, userIdStr);
        console.log('📊 onlineUsers now:', Array.from(onlineUsers.entries()));
        io.emit('presence', { userId: userIdStr, online: true });
    });

    socket.on('signal', ({ toUserId, payload }) => {
        const targetSocket = onlineUsers.get(String(toUserId));
        if (targetSocket) io.to(targetSocket).emit('signal', payload);
    });

    socket.on('notify', ({ toUserId, notification }) => {
        const targetSocket = onlineUsers.get(String(toUserId));
        if (targetSocket) io.to(targetSocket).emit('notification', notification);
    });

    // Prepare call: patient accepted notification, ask doctor to (re)send offer
    socket.on('call:prepare', ({ toUserId, appointmentId }) => {
        const targetSocket = onlineUsers.get(String(toUserId));
        const fromUserId = getUserIdFromSocket(socket.id);
        console.log('📣 call:prepare - toUserId:', toUserId, 'fromUserId:', fromUserId, 'appointmentId:', appointmentId);
        if (targetSocket && fromUserId) {
            io.to(targetSocket).emit('call:prepare', { from: fromUserId, appointmentId });
        } else {
            console.log('❌ call:prepare failed - target not online');
        }
    });

    // --- WebRTC Signaling Handlers ---
    // WebRTC Signaling - Call initiation
    socket.on('user:call', ({ toUserId, offer, appointmentId }) => {
        const targetSocket = onlineUsers.get(String(toUserId));
        const fromUserId = getUserIdFromSocket(socket.id);
        console.log('📞 user:call - toUserId:', toUserId, 'fromUserId:', fromUserId, 'appointmentId:', appointmentId);
        if (targetSocket && fromUserId) {
            console.log('✅ Sending incoming:call to socket:', targetSocket);
            io.to(targetSocket).emit('incoming:call', { 
                from: fromUserId,  // Send userId, not socketId
                offer,
                appointmentId 
            });
        } else {
            console.log('❌ User not online:', toUserId);
        }
    });

    // WebRTC Signaling - Call accepted
    socket.on('call:accepted', ({ toUserId, ans, appointmentId }) => {
        const targetSocket = onlineUsers.get(String(toUserId));
        const fromUserId = getUserIdFromSocket(socket.id);
        console.log('📞 call:accepted - toUserId:', toUserId, 'fromUserId:', fromUserId);
        if (targetSocket && fromUserId) {
            io.to(targetSocket).emit('call:accepted', { from: fromUserId, ans });
        } else {
            console.log('❌ call:accepted failed - target not online');
        }
    });

    // WebRTC Signaling - Peer negotiation needed
    socket.on('peer:nego:needed', ({ toUserId, offer }) => {
        const targetSocket = onlineUsers.get(String(toUserId));
        const fromUserId = getUserIdFromSocket(socket.id);
        console.log('🔄 peer:nego:needed - toUserId:', toUserId, 'fromUserId:', fromUserId);
        if (targetSocket && fromUserId) {
            io.to(targetSocket).emit('peer:nego:needed', { from: fromUserId, offer });
        }
    });

    // WebRTC Signaling - Peer negotiation done
    socket.on('peer:nego:done', ({ toUserId, ans }) => {
        const targetSocket = onlineUsers.get(String(toUserId));
        const fromUserId = getUserIdFromSocket(socket.id);
        console.log('✅ peer:nego:done - toUserId:', toUserId, 'fromUserId:', fromUserId);
        if (targetSocket && fromUserId) {
            io.to(targetSocket).emit('peer:nego:final', { from: fromUserId, ans });
        }
    });

    // Call rejection
    socket.on('call:rejected', ({ toUserId, appointmentId }) => {
        const targetSocket = onlineUsers.get(String(toUserId));
        const fromUserId = getUserIdFromSocket(socket.id);
        console.log('❌ call:rejected - toUserId:', toUserId, 'fromUserId:', fromUserId);
        if (targetSocket) {
            io.to(targetSocket).emit('call:rejected', { from: fromUserId, appointmentId });
        }
    });

    // Call ended
    socket.on('call:ended', ({ toUserId, appointmentId }) => {
        const targetSocket = onlineUsers.get(String(toUserId));
        const fromUserId = getUserIdFromSocket(socket.id);
        console.log('📵 call:ended - toUserId:', toUserId, 'fromUserId:', fromUserId, 'appointmentId:', appointmentId);
        if (targetSocket) {
            io.to(targetSocket).emit('call:ended', { from: fromUserId, appointmentId });
        } else {
            console.log('❌ call:ended failed - target not online');
        }
    });

    // Trickle ICE candidate relay
    socket.on('peer:ice-candidate', ({ toUserId, candidate }) => {
        const targetSocket = onlineUsers.get(String(toUserId));
        const fromUserId = getUserIdFromSocket(socket.id);
        console.log('🧊 peer:ice-candidate - toUserId:', toUserId, 'fromUserId:', fromUserId, 'hasCandidate:', !!candidate);
        if (targetSocket && fromUserId && candidate) {
            io.to(targetSocket).emit('peer:ice-candidate', { from: fromUserId, candidate });
        }
    });

    // Notify patient of incoming video call
    socket.on('notify:incoming:call', ({ patientId, doctorName, appointmentId }) => {
        console.log('📞 notify:incoming:call - patientId:', patientId, 'appointmentId:', appointmentId);
        const targetSocket = onlineUsers.get(String(patientId));
        const fromUserId = getUserIdFromSocket(socket.id);
        if (targetSocket && fromUserId) {
            console.log('✅ Notifying patient socket:', targetSocket);
            io.to(targetSocket).emit('notification:incoming:call', {
                doctorName,
                appointmentId,
                doctorUserId: fromUserId  // Send userId, not socketId
            });
        } else {
            console.log('❌ Patient not online:', patientId);
            socket.emit('patient:offline');
        }
    });

    socket.on('incomingVideoCall', ({ remoteUserId, callerName, appointmentId }) => {
        console.log('📞 incomingVideoCall - remoteUserId:', remoteUserId);
        console.log('📞 onlineUsers map:', Array.from(onlineUsers.entries()));
        const targetSocket = onlineUsers.get(String(remoteUserId));
        console.log('📞 targetSocket:', targetSocket);
        if (targetSocket) {
            console.log('✅ Emitting incomingVideoCall to socket:', targetSocket);
            io.to(targetSocket).emit('incomingVideoCall', {
                callerName,
                appointmentId,
                callerId: socket.id
            });
        } else {
            console.log('❌ Patient not found in onlineUsers');
        }
    });

    socket.on('callAccepted', ({ remoteUserId, appointmentId }) => {
        console.log('📞 callAccepted - remoteUserId:', remoteUserId, 'appointmentId:', appointmentId);
        const targetSocket = onlineUsers.get(String(remoteUserId));
        if (targetSocket) {
            console.log('✅ Emitting callAccepted to doctor socket:', targetSocket);
            io.to(targetSocket).emit('callAccepted', {
                appointmentId,
                patientId: socket.id
            });
        }
    });

    socket.on('disconnect', () => {
        const userId = getUserIdFromSocket(socket.id);
        if (userId) {
            onlineUsers.delete(userId);
            socketToUser.delete(socket.id);
            console.log('👋 User disconnected:', userId);
            io.emit('presence', { userId, online: false });
        }
    });
});

// Attach io to app for controllers that want to emit events
app.set('io', io);

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));