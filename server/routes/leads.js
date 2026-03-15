const express = require('express');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// GET /api/leads — Tüm leadleri listele
router.get('/', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;
        const { status, search, sort } = req.query;

        let query = `
            SELECT l.*, u.name as agent_name
            FROM leads l
            LEFT JOIN users u ON l.assigned_agent_id = u.id
            WHERE l.company_id = ?
        `;
        const params = [companyId];

        if (status && status !== 'all') {
            query += ' AND l.status = ?';
            params.push(status);
        }

        if (search) {
            query += ' AND (l.name LIKE ? OR l.phone LIKE ? OR l.email LIKE ?)';
            const s = `%${search}%`;
            params.push(s, s, s);
        }

        query += ' ORDER BY ' + (sort === 'oldest' ? 'l.created_at ASC' : 'l.created_at DESC');

        const leads = db.prepare(query).all(...params);
        res.json({ leads });
    } catch (err) {
        console.error('Get leads error:', err);
        res.status(500).json({ error: 'Leadler yüklenirken hata oluştu' });
    }
});

// GET /api/leads/stats — Lead istatistikleri
router.get('/stats', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;

        const total = db.prepare('SELECT COUNT(*) as count FROM leads WHERE company_id = ?').get(companyId)?.count || 0;
        const byStatus = db.prepare(`
            SELECT status, COUNT(*) as count FROM leads WHERE company_id = ? GROUP BY status
        `).all(companyId);

        const today = new Date().toISOString().split('T')[0];
        const todayCount = db.prepare('SELECT COUNT(*) as count FROM leads WHERE company_id = ? AND DATE(created_at) = ?').get(companyId, today)?.count || 0;

        const thisWeek = db.prepare(`
            SELECT COUNT(*) as count FROM leads WHERE company_id = ? AND created_at >= DATE('now', '-7 days')
        `).get(companyId)?.count || 0;

        const conversionRate = total > 0
            ? Math.round((db.prepare("SELECT COUNT(*) as count FROM leads WHERE company_id = ? AND status IN ('appointment', 'converted')").get(companyId)?.count || 0) / total * 100)
            : 0;

        const statusMap = { new: 0, contacted: 0, appointment: 0, converted: 0, lost: 0 };
        byStatus.forEach(s => { statusMap[s.status] = s.count; });

        res.json({ total, today: todayCount, this_week: thisWeek, conversion_rate: conversionRate, by_status: statusMap });
    } catch (err) {
        console.error('Lead stats error:', err);
        res.status(500).json({ error: 'Lead istatistikleri yüklenirken hata oluştu' });
    }
});

// GET /api/leads/:id
router.get('/:id', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;
        const lead = db.prepare(`
            SELECT l.*, u.name as agent_name
            FROM leads l
            LEFT JOIN users u ON l.assigned_agent_id = u.id
            WHERE l.id = ? AND l.company_id = ?
        `).get(req.params.id, companyId);

        if (!lead) return res.status(404).json({ error: 'Lead bulunamadı' });
        res.json({ lead });
    } catch (err) {
        console.error('Get lead error:', err);
        res.status(500).json({ error: 'Lead yüklenirken hata oluştu' });
    }
});

// POST /api/leads — Manuel lead oluştur
router.post('/', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;
        const { name, phone, email, source, notes } = req.body;

        if (!name?.trim()) return res.status(400).json({ error: 'İsim zorunludur' });

        const now = new Date().toISOString();
        const result = db.prepare(`
            INSERT INTO leads (company_id, name, phone, email, source, notes, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(companyId, name.trim(), phone || null, email || null, source || 'manual', notes || null, now, now);

        const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(result.lastInsertRowid);

        const io = req.app.locals.io;
        io.to(`company:${companyId}`).emit('lead:new', { lead });

        res.json({ lead });
    } catch (err) {
        console.error('Create lead error:', err);
        res.status(500).json({ error: 'Lead oluşturulurken hata oluştu' });
    }
});

// PATCH /api/leads/:id/status — Lead durumu güncelle
router.patch('/:id/status', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;
        const { status } = req.body;

        const validStatuses = ['new', 'contacted', 'appointment', 'converted', 'lost'];
        if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Geçersiz durum' });

        const result = db.prepare('UPDATE leads SET status = ?, updated_at = ? WHERE id = ? AND company_id = ?')
            .run(status, new Date().toISOString(), req.params.id, companyId);

        if (result.changes === 0) return res.status(404).json({ error: 'Lead bulunamadı' });

        const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);

        const io = req.app.locals.io;
        io.to(`company:${companyId}`).emit('lead:updated', { lead });

        res.json({ lead });
    } catch (err) {
        console.error('Update lead status error:', err);
        res.status(500).json({ error: 'Durum güncellenirken hata oluştu' });
    }
});

// PATCH /api/leads/:id — Lead bilgilerini güncelle
router.patch('/:id', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;
        const { name, phone, email, notes, assigned_agent_id } = req.body;

        const updates = ['updated_at = ?'];
        const params = [new Date().toISOString()];

        if (name) { updates.push('name = ?'); params.push(name.trim()); }
        if (phone !== undefined) { updates.push('phone = ?'); params.push(phone || null); }
        if (email !== undefined) { updates.push('email = ?'); params.push(email || null); }
        if (notes !== undefined) { updates.push('notes = ?'); params.push(notes || null); }
        if (assigned_agent_id !== undefined) { updates.push('assigned_agent_id = ?'); params.push(assigned_agent_id || null); }

        params.push(req.params.id, companyId);

        const result = db.prepare(`UPDATE leads SET ${updates.join(', ')} WHERE id = ? AND company_id = ?`).run(...params);
        if (result.changes === 0) return res.status(404).json({ error: 'Lead bulunamadı' });

        const lead = db.prepare(`
            SELECT l.*, u.name as agent_name
            FROM leads l LEFT JOIN users u ON l.assigned_agent_id = u.id
            WHERE l.id = ?
        `).get(req.params.id);

        const io = req.app.locals.io;
        io.to(`company:${companyId}`).emit('lead:updated', { lead });

        res.json({ lead });
    } catch (err) {
        console.error('Update lead error:', err);
        res.status(500).json({ error: 'Lead güncellenirken hata oluştu' });
    }
});

// DELETE /api/leads/:id
router.delete('/:id', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;
        const result = db.prepare('DELETE FROM leads WHERE id = ? AND company_id = ?').run(req.params.id, companyId);

        if (result.changes === 0) return res.status(404).json({ error: 'Lead bulunamadı' });

        const io = req.app.locals.io;
        io.to(`company:${companyId}`).emit('lead:deleted', { id: parseInt(req.params.id) });

        res.json({ success: true });
    } catch (err) {
        console.error('Delete lead error:', err);
        res.status(500).json({ error: 'Lead silinirken hata oluştu' });
    }
});

// POST /api/leads/:id/create-appointment — Lead'den randevu oluştur
router.post('/:id/create-appointment', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;
        const { appointment_date, start_time, end_time, service_id, staff_id, notes } = req.body;

        const lead = db.prepare('SELECT * FROM leads WHERE id = ? AND company_id = ?').get(req.params.id, companyId);
        if (!lead) return res.status(404).json({ error: 'Lead bulunamadı' });

        if (!appointment_date || !start_time) return res.status(400).json({ error: 'Tarih ve saat zorunludur' });

        const now = new Date().toISOString();

        // Randevu oluştur
        const apptResult = db.prepare(`
            INSERT INTO appointments (company_id, customer_name, phone, appointment_date, start_time, end_time, service_id, staff_id, notes, source, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'lead', 'pending', ?)
        `).run(companyId, lead.name, lead.phone, appointment_date, start_time, end_time || null, service_id || null, staff_id || null, notes || lead.notes, now);

        // Lead'i güncelle
        db.prepare('UPDATE leads SET status = ?, appointment_id = ?, updated_at = ? WHERE id = ?')
            .run('appointment', apptResult.lastInsertRowid, now, lead.id);

        const updatedLead = db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id);

        const io = req.app.locals.io;
        io.to(`company:${companyId}`).emit('lead:updated', { lead: updatedLead });

        res.json({ lead: updatedLead, appointment_id: apptResult.lastInsertRowid });
    } catch (err) {
        console.error('Create appointment from lead error:', err);
        res.status(500).json({ error: 'Randevu oluşturulurken hata oluştu' });
    }
});

// GET /api/leads/settings — Lead otomasyon ayarları
router.get('/settings/automation', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;
        const company = db.prepare('SELECT feature_lead, lead_auto_message, lead_message_template, lead_message_delay FROM companies WHERE id = ?').get(companyId);
        res.json(company || {});
    } catch (err) {
        res.status(500).json({ error: 'Ayarlar yüklenirken hata oluştu' });
    }
});

// PATCH /api/leads/settings/automation — Lead otomasyon ayarları güncelle
router.patch('/settings/automation', authMiddleware, (req, res) => {
    try {
        if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
            return res.status(403).json({ error: 'Bu işlem için yönetici yetkisi gerekli' });
        }
        const db = req.app.locals.db;
        const companyId = req.user.company_id;
        const { feature_lead, lead_auto_message, lead_message_template, lead_message_delay } = req.body;

        const updates = ['updated_at = ?'];
        const params = [new Date().toISOString()];

        if (feature_lead !== undefined) { updates.push('feature_lead = ?'); params.push(feature_lead ? 1 : 0); }
        if (lead_auto_message !== undefined) { updates.push('lead_auto_message = ?'); params.push(lead_auto_message ? 1 : 0); }
        if (lead_message_template) { updates.push('lead_message_template = ?'); params.push(lead_message_template); }
        if (lead_message_delay !== undefined) { updates.push('lead_message_delay = ?'); params.push(lead_message_delay); }

        // companies tablosunda updated_at yoksa kaldır
        const hasUpdatedAt = db.prepare("PRAGMA table_info(companies)").all().some(c => c.name === 'updated_at');
        if (!hasUpdatedAt) {
            updates.shift(); params.shift();
        }

        params.push(companyId);
        db.prepare(`UPDATE companies SET ${updates.join(', ')} WHERE id = ?`).run(...params);

        res.json({ success: true });
    } catch (err) {
        console.error('Update lead settings error:', err);
        res.status(500).json({ error: 'Ayarlar güncellenirken hata oluştu' });
    }
});

module.exports = router;
