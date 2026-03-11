const express = require('express');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// GET /api/appointments
router.get('/', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;
        const appointments = db.prepare(`
            SELECT a.*, cu.name as customer_db_name, cu.phone as customer_db_phone
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

module.exports = router;
