const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/register
router.post('/register', (req, res) => {
    try {
        const { email, password, name, role, company_id } = req.body;
        const db = req.app.locals.db;

        if (!email || !password || !name) {
            return res.status(400).json({ error: 'Email, şifre ve isim gerekli' });
        }

        const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
        if (existing) {
            return res.status(400).json({ error: 'Bu email zaten kayıtlı' });
        }

        const effectiveCompanyId = company_id || 1;

        // Şirket limiti ve aktiflik kontrolü
        const company = db.prepare('SELECT user_limit, is_active FROM companies WHERE id = ?').get(effectiveCompanyId);
        if (!company) {
            return res.status(404).json({ error: 'Şirket bulunamadı' });
        }
        if (!company.is_active) {
            return res.status(403).json({ error: 'Bu şirket şu anda aktif değil' });
        }

        const userCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE company_id = ?').get(effectiveCompanyId).count;
        if (userCount >= company.user_limit) {
            return res.status(403).json({ error: `Şirket kullanıcı limiti (${company.user_limit}) dolmuştur. Lütfen üst paketlere geçin.` });
        }

        const passwordHash = bcrypt.hashSync(password, 10);
        const colors = ['#8b5cf6', '#06b6d4', '#f43f5e', '#10b981', '#f59e0b', '#ec4899'];
        const avatarColor = colors[Math.floor(Math.random() * colors.length)];

        const result = db.prepare(
            'INSERT INTO users (company_id, email, password_hash, name, role, avatar_color) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(company_id || 1, email, passwordHash, name, role || 'agent', avatarColor);

        const user = db.prepare('SELECT id, company_id, email, name, role, avatar_color FROM users WHERE id = ?').get(result.lastInsertRowid);
        const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || 'fallback-secret', { expiresIn: '7d' });

        res.json({ token, user });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Kayıt sırasında bir hata oluştu' });
    }
});

// POST /api/auth/login
router.post('/login', (req, res) => {
    try {
        const { email, password } = req.body;
        const db = req.app.locals.db;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email ve şifre gerekli' });
        }

        const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email);
        if (!user) {
            return res.status(401).json({ error: 'Geçersiz email veya şifre' });
        }

        const valid = bcrypt.compareSync(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Geçersiz email veya şifre' });
        }

        // Şirket aktif mi kontrol et (superadmin muaf)
        if (user.company_id && user.role !== 'super_admin') {
            const company = db.prepare('SELECT is_active FROM companies WHERE id = ?').get(user.company_id);
            if (company && !company.is_active) {
                return res.status(403).json({ error: 'Şirket hesabı dondurulmuş. Lütfen yönetici ile iletişime geçin.' });
            }
        }

        const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || 'fallback-secret', { expiresIn: '7d' });

        res.json({
            token,
            user: {
                id: user.id,
                company_id: user.company_id,
                email: user.email,
                name: user.name,
                role: user.role,
                avatar_color: user.avatar_color
            }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Giriş sırasında bir hata oluştu' });
    }
});

// GET /api/auth/me
router.get('/me', authMiddleware, (req, res) => {
    res.json({ user: req.user });
});

module.exports = router;
