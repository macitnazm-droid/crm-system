const express = require('express');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// GET /api/conversations
router.get('/', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const { status, assigned } = req.query;
        const companyId = req.user.company_id;

        let query = `
      SELECT c.*, 
             cu.name as customer_name, 
             cu.category as customer_category,
             cu.source as customer_source,
             cu.lead_score as customer_lead_score,
             u.name as agent_name
      FROM conversations c
      LEFT JOIN customers cu ON c.customer_id = cu.id
      LEFT JOIN users u ON c.assigned_agent_id = u.id
      WHERE c.company_id = ?
    `;
        const params = [companyId];

        if (status && status !== 'all') {
            query += ' AND c.status = ?';
            params.push(status);
        }

        if (assigned === 'me') {
            query += ' AND c.assigned_agent_id = ?';
            params.push(req.user.id);
        } else if (assigned === 'unassigned') {
            query += ' AND c.assigned_agent_id IS NULL';
        }

        query += ' ORDER BY c.updated_at DESC';

        const conversations = db.prepare(query).all(...params);
        res.json({ conversations });
    } catch (err) {
        console.error('Get conversations error:', err);
        res.status(500).json({ error: 'Konuşmalar yüklenirken hata oluştu' });
    }
});

// GET /api/conversations/:id
router.get('/:id', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;

        const conversation = db.prepare(`
      SELECT c.*, 
             cu.name as customer_name, 
             cu.category as customer_category,
             cu.source as customer_source,
             cu.phone as customer_phone,
             cu.email as customer_email,
             cu.instagram_id as customer_instagram,
             cu.lead_score as customer_lead_score,
             u.name as agent_name
      FROM conversations c
      LEFT JOIN customers cu ON c.customer_id = cu.id
      LEFT JOIN users u ON c.assigned_agent_id = u.id
      WHERE c.id = ? AND c.company_id = ?
    `).get(req.params.id, companyId);

        if (!conversation) {
            return res.status(404).json({ error: 'Konuşma bulunamadı' });
        }

        const messages = db.prepare(`
      SELECT m.*, u.name as sender_name
      FROM messages m
      LEFT JOIN users u ON m.user_id = u.id
      WHERE m.conversation_id = ? AND m.company_id = ?
      ORDER BY m.created_at ASC
    `).all(req.params.id, companyId);

        res.json({ conversation, messages });
    } catch (err) {
        console.error('Get conversation error:', err);
        res.status(500).json({ error: 'Konuşma yüklenirken hata oluştu' });
    }
});

// PATCH /api/conversations/:id/ai
router.patch('/:id/ai', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const { ai_enabled } = req.body;
        const companyId = req.user.company_id;

        const updates = {
            ai_enabled: ai_enabled ? 1 : 0,
            updated_at: new Date().toISOString()
        };

        if (!ai_enabled) {
            updates.ai_stopped_at = new Date().toISOString();
        } else {
            updates.ai_stopped_at = null;
        }

        const result = db.prepare(`
      UPDATE conversations 
      SET ai_enabled = ?, ai_stopped_at = ?, updated_at = ?
      WHERE id = ? AND company_id = ?
    `).run(updates.ai_enabled, updates.ai_stopped_at, updates.updated_at, req.params.id, companyId);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Konuşma bulunamadı veya yetkiniz yok' });
        }

        // Ajan atanmamışsa, AI kapatılınca mevcut kullanıcıyı ata
        if (!ai_enabled) {
            db.prepare('UPDATE conversations SET assigned_agent_id = ? WHERE id = ? AND assigned_agent_id IS NULL AND company_id = ?')
                .run(req.user.id, req.params.id, companyId);
        }

        const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);

        const io = req.app.locals.io;
        io.to(`company:${companyId}`).emit('conversation:ai_toggled', { conversation });

        res.json({ conversation });
    } catch (err) {
        console.error('Toggle AI error:', err);
        res.status(500).json({ error: 'AI durumu güncellenirken hata oluştu' });
    }
});

// PATCH /api/conversations/:id/assign
router.patch('/:id/assign', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const { agent_id } = req.body;
        const companyId = req.user.company_id;

        const result = db.prepare('UPDATE conversations SET assigned_agent_id = ?, updated_at = ? WHERE id = ? AND company_id = ?')
            .run(agent_id || req.user.id, new Date().toISOString(), req.params.id, companyId);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Konuşma bulunamadı veya yetkiniz yok' });
        }

        const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
        res.json({ conversation });
    } catch (err) {
        console.error('Assign error:', err);
        res.status(500).json({ error: 'Atama sırasında hata oluştu' });
    }
});

// PATCH /api/conversations/:id/read — Okundu işaretle
router.patch('/:id/read', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        db.prepare('UPDATE conversations SET unread_count = 0 WHERE id = ? AND company_id = ?').run(req.params.id, req.user.company_id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Güncelleme hatası' });
    }
});

// PATCH /api/conversations/:id/status
router.patch('/:id/status', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const { status } = req.body;
        const companyId = req.user.company_id;

        if (!['open', 'closed', 'paused'].includes(status)) {
            return res.status(400).json({ error: 'Geçersiz durum' });
        }

        const result = db.prepare('UPDATE conversations SET status = ?, updated_at = ? WHERE id = ? AND company_id = ?')
            .run(status, new Date().toISOString(), req.params.id, companyId);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Konuşma bulunamadı veya yetkiniz yok' });
        }

        const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
        res.json({ conversation });
    } catch (err) {
        console.error('Status update error:', err);
        res.status(500).json({ error: 'Durum güncellenirken hata oluştu' });
    }
});

module.exports = router;
