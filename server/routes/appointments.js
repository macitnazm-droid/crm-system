const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { detectAppointment } = require('./webhooks');

const router = express.Router();

// GET /api/appointments
router.get('/', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;
        const appointments = db.prepare(`
            SELECT a.*, cu.name as customer_db_name, cu.phone as customer_db_phone, cu.source as customer_source
            FROM appointments a
            LEFT JOIN customers cu ON a.customer_id = cu.id
            WHERE a.company_id = ?
            ORDER BY a.created_at DESC
            LIMIT 100
        `).all(companyId);
        res.json({ appointments });
    } catch (err) {
        res.status(500).json({ error: 'Randevular yüklenirken hata oluştu' });
    }
});

// PATCH /api/appointments/:id/status
router.patch('/:id/status', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const { status } = req.body;
        if (!['pending', 'confirmed', 'cancelled'].includes(status)) {
            return res.status(400).json({ error: 'Geçersiz durum' });
        }
        db.prepare('UPDATE appointments SET status = ? WHERE id = ? AND company_id = ?')
            .run(status, req.params.id, req.user.company_id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Güncelleme hatası' });
    }
});

// POST /api/appointments/scan — Mevcut konuşmalardan randevu tara (regex tabanlı)
router.post('/scan', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;

        // En az 2 mesajı olan ve henüz randevu kaydı olmayan konuşmaları bul
        const conversations = db.prepare(`
            SELECT c.id as conv_id, c.customer_id, cu.name, cu.phone
            FROM conversations c
            JOIN customers cu ON c.customer_id = cu.id
            WHERE c.company_id = ?
            AND c.id NOT IN (SELECT conversation_id FROM appointments WHERE company_id = ?)
            AND (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) >= 2
            ORDER BY c.updated_at DESC
            LIMIT 50
        `).all(companyId, companyId);

        let found = 0;
        for (const conv of conversations) {
            try {
                const messages = db.prepare(
                    'SELECT * FROM messages WHERE conversation_id = ? AND company_id = ? ORDER BY created_at ASC'
                ).all(conv.conv_id, companyId);

                const appointment = detectAppointment(messages, conv.name);

                if (appointment) {
                    db.prepare(`
                        INSERT INTO appointments (company_id, customer_id, conversation_id, customer_name, phone, appointment_time, notes)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    `).run(companyId, conv.customer_id, conv.conv_id,
                        appointment.customer_name || conv.name,
                        conv.phone || '',
                        appointment.appointment_time,
                        appointment.notes || null);
                    found++;
                }
            } catch (err) {
                console.error(`Randevu tarama hatası (conv: ${conv.conv_id}):`, err.message);
            }
        }

        res.json({ scanned: conversations.length, found });
    } catch (err) {
        console.error('Appointment scan error:', err);
        res.status(500).json({ error: 'Tarama hatası: ' + err.message });
    }
});

module.exports = router;
