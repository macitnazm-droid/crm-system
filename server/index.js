require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { initDB } = require('./db/schema');
const { setupSocket } = require('./services/socketService');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ['http://localhost:5173', 'http://localhost:3000', 'https://crm-system-y92c.onrender.com'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE']
  }
});

// Middleware
app.use(helmet()); // Güvenli HTTP başlıkları
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? [process.env.FRONTEND_URL]
    : ['http://localhost:5173', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  credentials: true
}));
app.use(express.json());

// Rate Limiting (Geliştirme aşamasında limitler esnetildi)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000, // Limit artırıldı
  message: { error: 'Çok fazla istek gönderildi.' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50, // Giriş deneme limiti artırıldı
  message: { error: 'Çok fazla giriş denemesi.' }
});

app.use('/api/', limiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// DB başlat
const db = initDB();
app.locals.db = db;

// Socket.io kurulum
setupSocket(io, db);
app.locals.io = io;

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/conversations', require('./routes/conversations'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/webhooks', require('./routes/webhooks'));
app.use('/api/integrations', require('./routes/integrations'));
app.use('/api/superadmin', require('./routes/superadmin'));
app.use('/api/appointments', require('./routes/appointments'));

// Unipile polling (webhook yerine)
const { startPolling } = require('./services/unipilePoller');
startPolling(db, io);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Production: React build'i sun
if (process.env.NODE_ENV === 'production') {
  const path = require('path');
  app.use(express.static(path.join(__dirname, '../client/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 CRM Server çalışıyor: http://localhost:${PORT}`);
  console.log(`📡 Socket.io hazır`);
  console.log(`🤖 AI Provider: ${process.env.AI_PROVIDER || 'mock'}`);
});

// Merkezi Hata Yönetimi (Güvenlik için detayları gizler)
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Sunucu tarafında bir hata oluştu.',
    message: process.env.NODE_ENV === 'production' ? 'Lütfen daha sonra tekrar deneyin.' : err.message
  });
});
