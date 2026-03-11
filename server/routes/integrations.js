const express = require('express');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();

// GET /api/integrations — Mevcut entegrasyon ayarlarını getir
router.get('/', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;
        const settings = db.prepare('SELECT * FROM integration_settings WHERE company_id = ? ORDER BY id DESC').all(companyId);

        // API key'lerin sadece son 4 karakterini göster (güvenlik)
        const masked = settings.map(s => ({
            ...s,
            api_key: s.api_key ? '••••••••' + s.api_key.slice(-4) : '',
            api_secret: s.api_secret ? '••••••••' + s.api_secret.slice(-4) : '',
        }));

        res.json({ integrations: masked });
    } catch (err) {
        console.error('Get integrations error:', err);
        res.status(500).json({ error: 'Entegrasyonlar yüklenirken hata oluştu' });
    }
});

// POST /api/integrations — Yeni entegrasyon ekle/güncelle
router.post('/', authMiddleware, adminOnly, (req, res) => {
    try {
        const db = req.app.locals.db;
        const { platform, api_key, api_secret, webhook_url, phone_number_id, page_id, verify_token, is_active, provider, dsn_url } = req.body;
        const companyId = req.user.company_id;

        if (!platform || !['instagram', 'whatsapp'].includes(platform)) {
            return res.status(400).json({ error: 'Geçerli bir platform seçin (instagram/whatsapp)' });
        }

        // Mevcut kayıt var mı kontrol et
        const existing = db.prepare('SELECT * FROM integration_settings WHERE platform = ? AND company_id = ?').get(platform, companyId);

        if (existing) {
            // Güncelle
            const updates = [];
            const params = [];

            if (api_key !== undefined && api_key !== '' && !api_key.startsWith('••••')) {
                updates.push('api_key = ?'); params.push(api_key);
            }
            if (api_secret !== undefined && api_secret !== '' && !api_secret.startsWith('••••')) {
                updates.push('api_secret = ?'); params.push(api_secret);
            }
            if (webhook_url !== undefined) { updates.push('webhook_url = ?'); params.push(webhook_url); }
            if (phone_number_id !== undefined) { updates.push('phone_number_id = ?'); params.push(phone_number_id); }
            if (page_id !== undefined) { updates.push('page_id = ?'); params.push(page_id); }
            if (verify_token !== undefined) { updates.push('verify_token = ?'); params.push(verify_token); }
            if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active ? 1 : 0); }
            if (provider !== undefined) { updates.push('provider = ?'); params.push(provider); }
            if (dsn_url !== undefined) { updates.push('dsn_url = ?'); params.push(dsn_url); }

            updates.push('updated_at = ?'); params.push(new Date().toISOString());

            // WHERE clause params
            params.push(platform);
            params.push(companyId);

            if (updates.length > 1) {
                db.prepare(`UPDATE integration_settings SET ${updates.join(', ')} WHERE platform = ? AND company_id = ?`).run(...params);
            }

            const updated = db.prepare('SELECT * FROM integration_settings WHERE platform = ? AND company_id = ?').get(platform, companyId);
            res.json({ integration: { ...updated, api_key: updated.api_key ? '••••••••' + updated.api_key.slice(-4) : '', api_secret: updated.api_secret ? '••••••••' + updated.api_secret.slice(-4) : '' } });
        } else {
            // Yeni kayıt
            db.prepare(`
        INSERT INTO integration_settings (company_id, platform, api_key, api_secret, webhook_url, phone_number_id, page_id, verify_token, is_active, provider, dsn_url, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(companyId, platform, api_key || '', api_secret || '', webhook_url || '', phone_number_id || '', page_id || '', verify_token || '', is_active ? 1 : 0, provider || 'meta', dsn_url || '', new Date().toISOString(), new Date().toISOString());

            const created = db.prepare('SELECT * FROM integration_settings WHERE platform = ? AND company_id = ?').get(platform, companyId);
            res.json({ integration: { ...created, api_key: created.api_key ? '••••••••' + created.api_key.slice(-4) : '', api_secret: created.api_secret ? '••••••••' + created.api_secret.slice(-4) : '' } });
        }
    } catch (err) {
        console.error('Save integration error:', err);
        res.status(500).json({ error: 'Entegrasyon kaydedilirken hata oluştu' });
    }
});

// POST /api/integrations/test — Bağlantı testi
router.post('/test', authMiddleware, async (req, res) => {
    try {
        const { platform } = req.body;
        const db = req.app.locals.db;
        const companyId = req.user.company_id;
        const settings = db.prepare('SELECT * FROM integration_settings WHERE platform = ? AND company_id = ?').get(platform, companyId);

        if (!settings) {
            return res.json({ success: false, message: 'Bu platform için entegrasyon bulunamadı' });
        }

        if (!settings.api_key) {
            return res.json({ success: false, message: 'API anahtarı girilmemiş' });
        }

        // Unipile gerçek bağlantı testi
        if (settings.provider === 'unipile' && settings.dsn_url) {
            try {
                const fetch = (await import('node-fetch')).default;
                const dsn = settings.dsn_url.startsWith('http') ? settings.dsn_url : `https://${settings.dsn_url}`;
                const response = await fetch(`${dsn}/api/v1/accounts`, {
                    headers: { 'X-API-KEY': settings.api_key }
                });
                if (response.ok) {
                    const data = await response.json();
                    const count = data?.items?.length || 0;
                    return res.json({ success: true, message: `Unipile bağlantısı başarılı! ${count} hesap bağlı.` });
                } else {
                    const err = await response.text();
                    return res.json({ success: false, message: `Unipile hatası: ${response.status} - ${err}` });
                }
            } catch (fetchErr) {
                return res.json({ success: false, message: `Unipile bağlantı hatası: ${fetchErr.message}` });
            }
        }

        // Meta / varsayılan
        res.json({
            success: true,
            message: `${platform === 'instagram' ? 'Instagram' : 'WhatsApp'} bağlantı bilgileri kaydedildi. Webhook URL'nizi ${settings.provider === 'unipile' ? 'Unipile Dashboard' : 'Meta Developer Dashboard'}'da yapılandırın.`,
            webhook_url: settings.webhook_url,
        });
    } catch (err) {
        console.error('Test integration error:', err);
        res.status(500).json({ success: false, message: 'Test sırasında hata oluştu' });
    }
});

module.exports = router;
