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
app.set('trust proxy', 1); // Render load balancer arkasında
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

// Tablo kontrolleri tamamlandı — destructive migration'lar kaldırıldı (veri kaybı riski)
console.log('✅ [INDEX] DB başlatıldı, tablolar hazır');

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

// Unipile polling — webhook ile birlikte çalışır (yedek)
const { startPolling } = require('./services/unipilePoller');
startPolling(db, io);

// WhatsApp Web.js — mevcut oturumları otomatik yeniden bağla
const { autoReconnect } = require('./services/whatsappWebService');
autoReconnect(db, io);

// Randevu hatırlatma zamanlayıcısı
const { startReminderScheduler } = require('./services/appointmentNotifyService');
startReminderScheduler(db);

// Render free tier uyanık tut (her 4 dakikada self-ping)
if (process.env.NODE_ENV === 'production') {
  const keepAliveUrl = process.env.FRONTEND_URL || 'https://crm-system-y92c.onrender.com';
  setInterval(async () => {
    try {
      const fetch = (await import('node-fetch')).default;
      await fetch(`${keepAliveUrl}/api/health`);
    } catch (e) {}
  }, 4 * 60 * 1000);
  console.log('⏰ Keep-alive ping aktif (her 4 dakika)');
}

// In-memory log buffer (son 200 log satırı)
const logBuffer = [];
const MAX_LOGS = 200;
const origLog = console.log;
const origWarn = console.warn;
const origError = console.error;

function captureLog(level, args) {
  const line = `[${new Date().toISOString()}] [${level}] ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`;
  logBuffer.push(line);
  if (logBuffer.length > MAX_LOGS) logBuffer.shift();
}
console.log = (...args) => { captureLog('LOG', args); origLog.apply(console, args); };
console.warn = (...args) => { captureLog('WARN', args); origWarn.apply(console, args); };
console.error = (...args) => { captureLog('ERR', args); origError.apply(console, args); };

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Debug logs endpoint (geçici)
app.get('/api/debug/logs', (req, res) => {
  const filter = req.query.filter || '';
  const lines = filter
    ? logBuffer.filter(l => l.toLowerCase().includes(filter.toLowerCase()))
    : logBuffer;
  res.type('text/plain').send(lines.join('\n') || 'No logs yet');
});

// Debug: integration_settings tablosunu göster
app.get('/api/debug/integrations', (req, res) => {
  try {
    const all = db.prepare('SELECT id, company_id, platform, provider, is_active, dsn_url, api_key FROM integration_settings').all();
    // API key'leri maskele
    const masked = all.map(r => ({ ...r, api_key: r.api_key ? r.api_key.substring(0, 8) + '...' : null }));
    res.json(masked);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
