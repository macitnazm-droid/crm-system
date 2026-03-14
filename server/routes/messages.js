const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authMiddleware } = require('../middleware/auth');
const { sendOutboundMessage } = require('../services/metaService');

const router = express.Router();

// Upload dizini
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const allowed = /jpeg|jpg|png|gif|webp|mp4|mp3|ogg|pdf|doc|docx/;
        const ext = allowed.test(path.extname(file.originalname).toLowerCase());
        const mime = allowed.test(file.mimetype);
        cb(null, ext || mime);
    }
});

// GET /api/messages?conversation_id=X
router.get('/', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const { conversation_id, limit } = req.query;
        const companyId = req.user.company_id;

        if (!conversation_id) {
            return res.status(400).json({ error: 'conversation_id gerekli' });
        }

        const messages = db.prepare(`
      SELECT m.*, u.name as sender_name
      FROM messages m
      LEFT JOIN users u ON m.user_id = u.id
      WHERE m.conversation_id = ? AND m.company_id = ?
      ORDER BY m.created_at ASC
      LIMIT ?
    `).all(conversation_id, companyId, parseInt(limit) || 100);

        res.json({ messages });
    } catch (err) {
        console.error('Get messages error:', err);
        res.status(500).json({ error: 'Mesajlar yüklenirken hata oluştu' });
    }
});

// POST /api/messages/send — Agent manual mesaj gönderme
router.post('/send', authMiddleware, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const io = req.app.locals.io;
        const { conversation_id, content, media_url, media_type } = req.body;
        const companyId = req.user.company_id;

        if (!conversation_id || (!content && !media_url)) {
            return res.status(400).json({ error: 'conversation_id ve content veya media_url gerekli' });
        }

        const conversation = db.prepare(`
      SELECT c.*, cu.source as customer_source
      FROM conversations c
      LEFT JOIN customers cu ON c.customer_id = cu.id
      WHERE c.id = ? AND c.company_id = ?
    `).get(conversation_id, companyId);

        if (!conversation) {
            return res.status(404).json({ error: 'Konuşma bulunamadı veya yetkiniz yok' });
        }

        const now = new Date().toISOString();

        // Mesajı kaydet
        const displayContent = content || (media_type === 'image' ? '📷 Görsel' : media_type === 'video' ? '🎥 Video' : '📎 Dosya');
        const result = db.prepare(`
      INSERT INTO messages (company_id, conversation_id, customer_id, user_id, content, source, direction, is_ai_generated, is_manual_override, media_url, media_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'outbound', 0, 1, ?, ?, ?)
    `).run(companyId, conversation_id, conversation.customer_id, req.user.id, displayContent, conversation.customer_source || 'manual', media_url || null, media_type || null, now);

        // Konuşmayı güncelle
        db.prepare(`
      UPDATE conversations
      SET last_message_preview = ?, assigned_agent_id = COALESCE(assigned_agent_id, ?), updated_at = ?
      WHERE id = ? AND company_id = ?
    `).run(displayContent.substring(0, 100), req.user.id, now, conversation_id, companyId);

        // Müşteri son mesajını güncelle
        db.prepare('UPDATE customers SET last_message_at = ?, updated_at = ? WHERE id = ? AND company_id = ?')
            .run(now, now, conversation.customer_id, companyId);

        const message = db.prepare(`
      SELECT m.*, u.name as sender_name
      FROM messages m
      LEFT JOIN users u ON m.user_id = u.id
      WHERE m.id = ?
    `).get(result.lastInsertRowid);

        // Real-time broadcast (Sadece aynı şirkete)
        io.to(`company:${companyId}`).emit('message:new', { message, conversation_id });

        // Provider'a göre mesajı gönder (Meta veya Unipile)
        try {
            const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(conversation.customer_id);
            const source = conversation.customer_source || 'instagram';
            const sendResult = await sendOutboundMessage(db, {
                companyId,
                source,
                recipientId: customer?.instagram_id || customer?.whatsapp_id || customer?.messenger_id,
                recipientPhone: customer?.phone || customer?.whatsapp_id,
                text: content || '',
                mediaUrl: media_url,
                mediaType: media_type,
            });
            if (sendResult.sent) {
                console.log(`📤 Mesaj gönderildi (${sendResult.provider}): "${content.substring(0, 50)}"`);
            } else {
                console.warn(`Mesaj gönderilemedi: ${sendResult.reason}`);
            }
        } catch (outboundErr) {
            console.error('Outbound mesaj hatası:', outboundErr.message);
        }

        res.json({ message });
    } catch (err) {
        console.error('Send message error:', err);
        res.status(500).json({ error: 'Mesaj gönderilirken hata oluştu' });
    }
});

// POST /api/messages/upload — Dosya yükle
router.post('/upload', authMiddleware, upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Dosya yüklenemedi' });
        }
        const fileUrl = `/uploads/${req.file.filename}`;
        const mimeType = req.file.mimetype || '';
        let mediaType = 'file';
        if (mimeType.startsWith('image/')) mediaType = 'image';
        else if (mimeType.startsWith('video/')) mediaType = 'video';
        else if (mimeType.startsWith('audio/')) mediaType = 'audio';

        res.json({ url: fileUrl, media_type: mediaType, filename: req.file.originalname });
    } catch (err) {
        console.error('Upload error:', err);
        res.status(500).json({ error: 'Dosya yüklenirken hata oluştu' });
    }
});

module.exports = router;
