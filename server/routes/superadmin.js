const express = require('express');
const { authMiddleware, superAdminOnly } = require('../middleware/auth');
const bcrypt = require('bcryptjs');

const router = express.Router();

// Şirket listesini getir
router.get('/companies', authMiddleware, superAdminOnly, (req, res) => {
    try {
        const db = req.app.locals.db;
        const companies = db.prepare(`
      SELECT c.*, 
      (SELECT COUNT(*) FROM users WHERE company_id = c.id) as user_count,
      (SELECT COUNT(*) FROM customers WHERE company_id = c.id) as customer_count
      FROM companies c
      ORDER BY c.created_at DESC
    `).all();
        res.json({ companies });
    } catch (err) {
        console.error('Superadmin get companies error:', err);
        res.status(500).json({ error: 'Şirketler listelenirken hata oluştu' });
    }
});

// Yeni şirket ekle
router.post('/companies', authMiddleware, superAdminOnly, (req, res) => {
    try {
        const { name, domain, adminEmail, adminPassword, adminName, userLimit } = req.body;
        const db = req.app.locals.db;

        if (!name || !adminEmail || !adminPassword || !adminName) {
            return res.status(400).json({ error: 'Şirket adı ve yönetici bilgileri zorunludur' });
        }

        // İşlem (Transaction) kullan
        const result = db.transaction(() => {
            // 1. Şirketi oluştur
            const companyRes = db.prepare('INSERT INTO companies (name, domain, user_limit) VALUES (?, ?, ?)').run(
                name,
                domain || null,
                userLimit || 10
            );
            const companyId = companyRes.lastInsertRowid;

            // 2. Şirket adminini oluştur
            const passwordHash = bcrypt.hashSync(adminPassword, 10);
            db.prepare(`
        INSERT INTO users (company_id, email, password_hash, name, role, avatar_color)
        VALUES (?, ?, ?, ?, 'admin', '#6366f1')
      `).run(companyId, adminEmail, passwordHash, adminName);

            // 3. Şirket için varsayılan AI prompt'u oluştur
            db.prepare(`
        INSERT INTO ai_prompts (company_id, name, system_prompt, instructions, is_active)
        VALUES (?, 'Standart Asistan', 'Sen bir asistanasın...', 'Müşteriyi kategorize et...', 1)
      `).run(companyId);

            return companyId;
        })();

        res.json({ success: true, companyId: result });
    } catch (err) {
        console.error('Superadmin create company error:', err);
        res.status(500).json({ error: 'Şirket oluşturulurken hata oluştu: ' + err.message });
    }
});

// Şirket durumunu güncelle (Aktif/Pasif)
router.patch('/companies/:id/status', authMiddleware, superAdminOnly, (req, res) => {
    try {
        const { id } = req.params;
        const { is_active } = req.body;
        const db = req.app.locals.db;

        db.prepare('UPDATE companies SET is_active = ? WHERE id = ?').run(is_active ? 1 : 0, id);
        res.json({ success: true });
    } catch (err) {
        console.error('Superadmin update company status error:', err);
        res.status(500).json({ error: 'Şirket durumu güncellenirken hata oluştu' });
    }
});

// Şirket detaylarını güncelle (Ad, Domain, Limit)
router.patch('/companies/:id', authMiddleware, superAdminOnly, (req, res) => {
    try {
        const { id } = req.params;
        const { name, domain, user_limit } = req.body;
        const db = req.app.locals.db;

        db.prepare(`
            UPDATE companies 
            SET name = COALESCE(?, name), 
                domain = COALESCE(?, domain), 
                user_limit = COALESCE(?, user_limit) 
            WHERE id = ?
        `).run(name, domain, user_limit, id);

        res.json({ success: true });
    } catch (err) {
        console.error('Superadmin update company error:', err);
        res.status(500).json({ error: 'Şirket bilgileri güncellenirken hata oluştu' });
    }
});

// Sistem genel istatistikleri
router.get('/stats', authMiddleware, superAdminOnly, (req, res) => {
    try {
        const db = req.app.locals.db;
        const stats = {
            total_companies: db.prepare('SELECT COUNT(*) as count FROM companies').get().count,
            total_users: db.prepare('SELECT COUNT(*) as count FROM users').get().count,
            total_customers: db.prepare('SELECT COUNT(*) as count FROM customers').get().count,
            total_messages: db.prepare('SELECT COUNT(*) as count FROM messages').get().count,
        };
        res.json({ stats });
    } catch (err) {
        console.error('Superadmin get stats error:', err);
        res.status(500).json({ error: 'İstatistikler alınırken hata oluştu' });
    }
});

module.exports = router;
