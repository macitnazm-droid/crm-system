const express = require('express');
const { authMiddleware, superAdminOnly } = require('../middleware/auth');
const bcrypt = require('bcryptjs');

const router = express.Router();

const PLANS = {
  free:  { message_limit: 500,   user_limit: 3 },
  basic: { message_limit: 2000,  user_limit: 10 },
  pro:   { message_limit: 10000, user_limit: 999 },
};

// GET /api/superadmin/companies
router.get('/companies', authMiddleware, superAdminOnly, (req, res) => {
  try {
    const db = req.app.locals.db;
    const companies = db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM users WHERE company_id = c.id AND is_active = 1) as user_count,
        (SELECT COUNT(*) FROM customers WHERE company_id = c.id) as customer_count,
        (SELECT COUNT(*) FROM messages WHERE company_id = c.id) as total_messages,
        (SELECT MAX(created_at) FROM messages WHERE company_id = c.id) as last_activity_at
      FROM companies c
      ORDER BY c.created_at DESC
    `).all();
    res.json({ companies });
  } catch (err) {
    console.error('Superadmin get companies error:', err);
    res.status(500).json({ error: 'Şirketler listelenirken hata oluştu' });
  }
});

// POST /api/superadmin/companies
router.post('/companies', authMiddleware, superAdminOnly, (req, res) => {
  try {
    const { name, domain, adminEmail, adminPassword, adminName, subscription_plan, subscription_expires_at } = req.body;
    const db = req.app.locals.db;

    if (!name || !adminEmail || !adminPassword || !adminName) {
      return res.status(400).json({ error: 'Şirket adı ve yönetici bilgileri zorunludur' });
    }

    const plan = subscription_plan || 'free';
    const limits = PLANS[plan] || PLANS.free;

    const result = db.transaction(() => {
      const companyRes = db.prepare(
        'INSERT INTO companies (name, domain, user_limit, subscription_plan, message_limit, subscription_expires_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(name, domain || null, limits.user_limit, plan, limits.message_limit, subscription_expires_at || null);
      const companyId = companyRes.lastInsertRowid;

      const passwordHash = bcrypt.hashSync(adminPassword, 10);
      db.prepare(`
        INSERT INTO users (company_id, email, password_hash, name, role, avatar_color)
        VALUES (?, ?, ?, ?, 'admin', '#6366f1')
      `).run(companyId, adminEmail, passwordHash, adminName);

      db.prepare(`
        INSERT INTO ai_prompts (company_id, name, system_prompt, instructions, is_active)
        VALUES (?, 'Standart Asistan', 'Sen bir satış asistanısın.', 'Müşteriyi kategorize et.', 1)
      `).run(companyId);

      return companyId;
    })();

    res.json({ success: true, companyId: result });
  } catch (err) {
    console.error('Superadmin create company error:', err);
    res.status(500).json({ error: 'Şirket oluşturulurken hata oluştu: ' + err.message });
  }
});

// PATCH /api/superadmin/companies/:id/status
router.patch('/companies/:id/status', authMiddleware, superAdminOnly, (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;
    const db = req.app.locals.db;
    db.prepare('UPDATE companies SET is_active = ? WHERE id = ?').run(is_active ? 1 : 0, id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Şirket durumu güncellenirken hata oluştu' });
  }
});

// PATCH /api/superadmin/companies/:id
router.patch('/companies/:id', authMiddleware, superAdminOnly, (req, res) => {
  try {
    const { id } = req.params;
    const { name, domain, user_limit, subscription_plan, subscription_expires_at, message_limit } = req.body;
    const db = req.app.locals.db;

    let finalUserLimit = user_limit;
    let finalMessageLimit = message_limit;

    if (subscription_plan && PLANS[subscription_plan]) {
      finalUserLimit = finalUserLimit || PLANS[subscription_plan].user_limit;
      finalMessageLimit = finalMessageLimit || PLANS[subscription_plan].message_limit;
    }

    db.prepare(`
      UPDATE companies SET
        name = COALESCE(?, name),
        domain = COALESCE(?, domain),
        user_limit = COALESCE(?, user_limit),
        subscription_plan = COALESCE(?, subscription_plan),
        subscription_expires_at = COALESCE(?, subscription_expires_at),
        message_limit = COALESCE(?, message_limit)
      WHERE id = ?
    `).run(name, domain, finalUserLimit, subscription_plan, subscription_expires_at, finalMessageLimit, id);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Şirket bilgileri güncellenirken hata oluştu' });
  }
});

// GET /api/superadmin/companies/:id/users
router.get('/companies/:id/users', authMiddleware, superAdminOnly, (req, res) => {
  try {
    const db = req.app.locals.db;
    const users = db.prepare(
      'SELECT id, name, email, role, avatar_color, is_active, created_at FROM users WHERE company_id = ? ORDER BY created_at DESC'
    ).all(req.params.id);
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: 'Kullanıcılar listelenemedi' });
  }
});

// POST /api/superadmin/companies/:id/users
router.post('/companies/:id/users', authMiddleware, superAdminOnly, (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const db = req.app.locals.db;
    const companyId = req.params.id;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'İsim, email ve şifre zorunludur' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) return res.status(400).json({ error: 'Bu email zaten kayıtlı' });

    const company = db.prepare('SELECT user_limit FROM companies WHERE id = ?').get(companyId);
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE company_id = ? AND is_active = 1').get(companyId).count;
    if (userCount >= company.user_limit) {
      return res.status(403).json({ error: `Kullanıcı limiti (${company.user_limit}) dolmuştur` });
    }

    const colors = ['#8b5cf6', '#06b6d4', '#f43f5e', '#10b981', '#f59e0b', '#ec4899'];
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare(
      'INSERT INTO users (company_id, email, password_hash, name, role, avatar_color) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(companyId, email, hash, name, role || 'agent', colors[Math.floor(Math.random() * colors.length)]);

    const user = db.prepare('SELECT id, name, email, role, avatar_color, is_active, created_at FROM users WHERE id = ?').get(result.lastInsertRowid);
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: 'Kullanıcı eklenemedi: ' + err.message });
  }
});

// DELETE /api/superadmin/companies/:id/users/:userId
router.delete('/companies/:id/users/:userId', authMiddleware, superAdminOnly, (req, res) => {
  try {
    const db = req.app.locals.db;
    db.prepare('UPDATE users SET is_active = 0 WHERE id = ? AND company_id = ?').run(req.params.userId, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Kullanıcı deaktif edilemedi' });
  }
});

// POST /api/superadmin/companies/:id/users/:userId/reset-password
router.post('/companies/:id/users/:userId/reset-password', authMiddleware, superAdminOnly, (req, res) => {
  try {
    const db = req.app.locals.db;
    const { new_password } = req.body;
    if (!new_password || new_password.length < 6) {
      return res.status(400).json({ error: 'Şifre en az 6 karakter olmalı' });
    }
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync(new_password, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ? AND company_id = ?').run(hash, req.params.userId, req.params.id);
    res.json({ success: true, message: 'Şifre başarıyla sıfırlandı' });
  } catch (err) {
    res.status(500).json({ error: 'Şifre sıfırlanamadı' });
  }
});

// PATCH /api/superadmin/companies/:id/features — Şirket özellik toggle'ları
router.patch('/companies/:id/features', authMiddleware, superAdminOnly, (req, res) => {
  try {
    const db = req.app.locals.db;
    const { feature, enabled } = req.body;
    const allowed = ['ai_instagram', 'ai_whatsapp', 'ai_messenger', 'appointment_whatsapp_notify', 'appointment_sms_notify', 'lead_auto_message'];
    if (!allowed.includes(feature)) {
      return res.status(400).json({ error: 'Geçersiz özellik' });
    }
    db.prepare(`UPDATE companies SET ${feature} = ? WHERE id = ?`).run(enabled ? 1 : 0, req.params.id);
    const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
    res.json({ success: true, company });
  } catch (err) {
    res.status(500).json({ error: 'Özellik güncellenemedi' });
  }
});

// GET /api/superadmin/stats
router.get('/stats', authMiddleware, superAdminOnly, (req, res) => {
  try {
    const db = req.app.locals.db;
    const stats = {
      total_companies: db.prepare('SELECT COUNT(*) as count FROM companies').get().count,
      active_companies: db.prepare('SELECT COUNT(*) as count FROM companies WHERE is_active = 1').get().count,
      total_users: db.prepare('SELECT COUNT(*) as count FROM users WHERE is_active = 1').get().count,
      total_customers: db.prepare('SELECT COUNT(*) as count FROM customers').get().count,
      total_messages: db.prepare('SELECT COUNT(*) as count FROM messages').get().count,
    };
    res.json({ stats });
  } catch (err) {
    res.status(500).json({ error: 'İstatistikler alınırken hata oluştu' });
  }
});

module.exports = router;
