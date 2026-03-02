const express = require('express');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// GET /api/customers
router.get('/', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const { category, search, sort } = req.query;
        const companyId = req.user.company_id;

        let query = 'SELECT * FROM customers WHERE company_id = ?';
        const params = [companyId];

        if (category && category !== 'all') {
            query += ' AND category = ?';
            params.push(category);
        }

        if (search) {
            query += ' AND (name LIKE ? OR email LIKE ? OR phone LIKE ?)';
            const s = `%${search}%`;
            params.push(s, s, s);
        }

        query += ' ORDER BY ' + (sort === 'score' ? 'lead_score DESC' : 'last_message_at DESC');

        const customers = db.prepare(query).all(...params);
        res.json({ customers });
    } catch (err) {
        console.error('Get customers error:', err);
        res.status(500).json({ error: 'Müşteriler yüklenirken hata oluştu' });
    }
});

// GET /api/customers/:id
router.get('/:id', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;
        const customer = db.prepare('SELECT * FROM customers WHERE id = ? AND company_id = ?').get(req.params.id, companyId);

        if (!customer) {
            return res.status(404).json({ error: 'Müşteri bulunamadı' });
        }

        const conversations = db.prepare('SELECT * FROM conversations WHERE customer_id = ? AND company_id = ? ORDER BY updated_at DESC').all(customer.id, companyId);

        res.json({ customer, conversations });
    } catch (err) {
        console.error('Get customer error:', err);
        res.status(500).json({ error: 'Müşteri yüklenirken hata oluştu' });
    }
});

// PATCH /api/customers/:id/category
router.patch('/:id/category', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const { category, lead_score } = req.body;
        const companyId = req.user.company_id;

        if (category && !['hot', 'warm', 'cold', 'unqualified'].includes(category)) {
            return res.status(400).json({ error: 'Geçersiz kategori' });
        }

        const updates = [];
        const params = [];

        if (category) {
            updates.push('category = ?');
            params.push(category);
        }
        if (lead_score !== undefined) {
            updates.push('lead_score = ?');
            params.push(lead_score);
        }

        updates.push('updated_at = ?');
        params.push(new Date().toISOString());

        // WHERE clause
        params.push(req.params.id);
        params.push(companyId);

        const result = db.prepare(`UPDATE customers SET ${updates.join(', ')} WHERE id = ? AND company_id = ?`).run(...params);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Müşteri bulunamadı veya yetkiniz yok' });
        }

        const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);

        // Kategori değişikliğini broadcast et
        const io = req.app.locals.io;
        io.to(`company:${companyId}`).emit('customer:categorized', { customer });

        res.json({ customer });
    } catch (err) {
        console.error('Update category error:', err);
        res.status(500).json({ error: 'Kategori güncellenirken hata oluştu' });
    }
});

module.exports = router;
