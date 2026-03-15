const jwt = require('jsonwebtoken');
const JWT_SECRET = require('../config/jwtSecret');

function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Yetkilendirme token\'ı gerekli' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const db = req.app.locals.db;
        const user = db.prepare('SELECT id, company_id, email, name, role, avatar_color FROM users WHERE id = ? AND is_active = 1').get(decoded.userId);

        if (!user) {
            return res.status(401).json({ error: 'Kullanıcı bulunamadı' });
        }

        req.user = user;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Geçersiz token' });
    }
}

function adminOnly(req, res, next) {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Bu işlem için admin yetkisi gerekli' });
    }
    next();
}

function superAdminOnly(req, res, next) {
    if (req.user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Sadece Süper Admin bu işlemi yapabilir' });
    }
    next();
}

module.exports = { authMiddleware, adminOnly, superAdminOnly };
