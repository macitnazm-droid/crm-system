const express = require('express');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

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
        const { conversation_id, content } = req.body;
        const companyId = req.user.company_id;

        if (!conversation_id || !content) {
            return res.status(400).json({ error: 'conversation_id ve content gerekli' });
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
        const result = db.prepare(`
      INSERT INTO messages (company_id, conversation_id, customer_id, user_id, content, source, direction, is_ai_generated, is_manual_override, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'outbound', 0, 1, ?)
    `).run(companyId, conversation_id, conversation.customer_id, req.user.id, content, conversation.customer_source || 'manual', now);

        // Konuşmayı güncelle
        db.prepare(`
      UPDATE conversations 
      SET last_message_preview = ?, assigned_agent_id = COALESCE(assigned_agent_id, ?), updated_at = ?
      WHERE id = ? AND company_id = ?
    `).run(content.substring(0, 100), req.user.id, now, conversation_id, companyId);

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

        // Unipile üzerinden gerçek mesaj gönder
        try {
            const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(conversation.customer_id);
            const integration = db.prepare(
                "SELECT * FROM integration_settings WHERE company_id = ? AND platform = ? AND provider = 'unipile' AND is_active = 1"
            ).get(companyId, conversation.customer_source || 'instagram');

            if (integration && customer?.unipile_chat_id) {
                const fetch = (await import('node-fetch')).default;
                const dsn = integration.dsn_url.startsWith('http')
                    ? integration.dsn_url.replace(/\/$/, '')
                    : `https://${integration.dsn_url.replace(/\/$/, '')}`;

                const sendRes = await fetch(`${dsn}/api/v1/chats/${customer.unipile_chat_id}/messages`, {
                    method: 'POST',
                    headers: { 'X-API-KEY': integration.api_key, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: content })
                });

                if (!sendRes.ok) {
                    console.warn(`Unipile mesaj gönderme hatası: ${sendRes.status}`);
                } else {
                    console.log(`📤 Unipile'a mesaj gönderildi: "${content.substring(0, 50)}"`);
                }
            }
        } catch (unipileErr) {
            console.error('Unipile outbound hatası:', unipileErr.message);
        }

        res.json({ message });
    } catch (err) {
        console.error('Send message error:', err);
        res.status(500).json({ error: 'Mesaj gönderilirken hata oluştu' });
    }
});

module.exports = router;
