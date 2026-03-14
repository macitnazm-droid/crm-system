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

// GET /api/integrations/unipile-accounts — Unipile'daki bağlı hesapları listele
router.get('/unipile-accounts', authMiddleware, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;

        // Bu şirketin Unipile ayarlarından birini al (api_key ve dsn_url için)
        const settings = db.prepare(
            "SELECT api_key, dsn_url FROM integration_settings WHERE company_id = ? AND provider = 'unipile' AND api_key != '' AND dsn_url != '' LIMIT 1"
        ).get(companyId);

        if (!settings) {
            return res.json({ accounts: [], message: 'Önce Unipile API Key ve DSN URL kaydedin' });
        }

        const fetch = (await import('node-fetch')).default;
        const dsn = settings.dsn_url.startsWith('http') ? settings.dsn_url.replace(/\/$/, '') : `https://${settings.dsn_url.replace(/\/$/, '')}`;
        const response = await fetch(`${dsn}/api/v1/accounts`, {
            headers: { 'X-API-KEY': settings.api_key, 'Accept': 'application/json' }
        });

        if (!response.ok) {
            return res.json({ accounts: [], message: `Unipile API hatası: ${response.status}` });
        }

        const data = await response.json();
        const items = data.items || data.accounts || [];

        // Başka şirketlere atanmış account_id'leri bul
        const takenAccounts = db.prepare(
            "SELECT unipile_account_id FROM integration_settings WHERE provider = 'unipile' AND unipile_account_id != '' AND company_id != ?"
        ).all(companyId).map(r => r.unipile_account_id);

        // Bu şirketin kendi atanmış account_id'leri
        const ownAccounts = db.prepare(
            "SELECT unipile_account_id FROM integration_settings WHERE provider = 'unipile' AND unipile_account_id != '' AND company_id = ?"
        ).all(companyId).map(r => r.unipile_account_id);

        const accounts = items.map(a => ({
            id: a.id,
            name: a.name || a.username || a.identifier || a.id,
            type: (a.type || a.provider || '').toUpperCase(),
            status: a.status || 'unknown',
            taken: takenAccounts.includes(a.id) && !ownAccounts.includes(a.id)
        }));

        res.json({ accounts });
    } catch (err) {
        console.error('Unipile accounts error:', err);
        res.status(500).json({ accounts: [], message: 'Hesaplar yüklenirken hata: ' + err.message });
    }
});

// POST /api/integrations — Yeni entegrasyon ekle/güncelle
router.post('/', authMiddleware, adminOnly, (req, res) => {
    try {
        const db = req.app.locals.db;
        const { platform, api_key, api_secret, webhook_url, phone_number_id, page_id, verify_token, is_active, provider, dsn_url, unipile_account_id } = req.body;
        const companyId = req.user.company_id;

        if (!platform || !['instagram', 'whatsapp', 'messenger'].includes(platform)) {
            return res.status(400).json({ error: 'Geçerli bir platform seçin (instagram/whatsapp/messenger)' });
        }

        // Mevcut kayıt var mı kontrol et (platform + provider bazlı)
        const actualProvider = provider || 'meta';
        const existing = db.prepare('SELECT * FROM integration_settings WHERE platform = ? AND provider = ? AND company_id = ?').get(platform, actualProvider, companyId);

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
            if (dsn_url !== undefined) { updates.push('dsn_url = ?'); params.push(dsn_url); }
            if (unipile_account_id !== undefined) { updates.push('unipile_account_id = ?'); params.push(unipile_account_id); }

            updates.push('updated_at = ?'); params.push(new Date().toISOString());

            params.push(existing.id);

            if (updates.length > 1) {
                db.prepare(`UPDATE integration_settings SET ${updates.join(', ')} WHERE id = ?`).run(...params);
            }

            const updated = db.prepare('SELECT * FROM integration_settings WHERE id = ?').get(existing.id);
            res.json({ integration: { ...updated, api_key: updated.api_key ? '••••••••' + updated.api_key.slice(-4) : '', api_secret: updated.api_secret ? '••••••••' + updated.api_secret.slice(-4) : '' } });
        } else {
            // Yeni kayıt (platform + provider bazlı)
            db.prepare(`
        INSERT INTO integration_settings (company_id, platform, api_key, api_secret, webhook_url, phone_number_id, page_id, verify_token, is_active, provider, dsn_url, unipile_account_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(companyId, platform, api_key || '', api_secret || '', webhook_url || '', phone_number_id || '', page_id || '', verify_token || '', is_active ? 1 : 0, actualProvider, dsn_url || '', unipile_account_id || '', new Date().toISOString(), new Date().toISOString());

            const created = db.prepare('SELECT * FROM integration_settings WHERE platform = ? AND provider = ? AND company_id = ?').get(platform, actualProvider, companyId);
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
        const { platform, provider } = req.body;
        const db = req.app.locals.db;
        const companyId = req.user.company_id;
        // Provider belirtilmişse ona göre, yoksa platform'daki aktif olanı bul
        const settings = provider
            ? db.prepare('SELECT * FROM integration_settings WHERE platform = ? AND provider = ? AND company_id = ?').get(platform, provider, companyId)
            : db.prepare('SELECT * FROM integration_settings WHERE platform = ? AND company_id = ? AND is_active = 1').get(platform, companyId);

        if (!settings) {
            return res.json({ success: false, message: 'Bu platform için entegrasyon bulunamadı' });
        }

        if (!settings.api_key) {
            return res.json({ success: false, message: 'API anahtarı / Access Token girilmemiş' });
        }

        // Meta Graph API bağlantı testi
        if (settings.provider === 'meta') {
            try {
                const { verifyToken } = require('../services/metaService');
                const result = await verifyToken(settings.api_key);
                // Facebook Page ID'yi otomatik kaydet
                if (result.valid && result.data?.id) {
                    try {
                        db.prepare('UPDATE integration_settings SET facebook_page_id = ? WHERE id = ?').run(result.data.id, settings.id);
                        console.log(`📄 Facebook Page ID kaydedildi: ${result.data.id} (integration: ${settings.id})`);
                    } catch (e) { }
                }
                return res.json({ success: result.valid, message: result.message });
            } catch (fetchErr) {
                return res.json({ success: false, message: `Meta API bağlantı hatası: ${fetchErr.message}` });
            }
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

        res.json({ success: false, message: 'Bilinmeyen provider' });
    } catch (err) {
        console.error('Test integration error:', err);
        res.status(500).json({ success: false, message: 'Test sırasında hata oluştu' });
    }
});

// POST /api/integrations/unipile-connect — Unipile hosted auth link oluştur (QR kod sayfası)
router.post('/unipile-connect', authMiddleware, adminOnly, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;
        const { provider_type } = req.body; // 'WHATSAPP' veya 'INSTAGRAM'

        // Unipile API key ve DSN URL'yi bul
        const settings = db.prepare(
            "SELECT api_key, dsn_url FROM integration_settings WHERE company_id = ? AND provider = 'unipile' AND api_key != '' AND dsn_url != '' LIMIT 1"
        ).get(companyId);

        if (!settings) {
            return res.status(400).json({ error: 'Önce Unipile API Key ve DSN URL kaydedin' });
        }

        const fetch = (await import('node-fetch')).default;
        const dsn = settings.dsn_url.startsWith('http') ? settings.dsn_url.replace(/\/$/, '') : `https://${settings.dsn_url.replace(/\/$/, '')}`;

        // Unipile hosted auth link oluştur
        const response = await fetch(`${dsn}/api/v1/hosted/accounts/link`, {
            method: 'POST',
            headers: {
                'X-API-KEY': settings.api_key,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                type: provider_type || 'WHATSAPP',
                // Bağlantı sonrası yönlendirme
                success_redirect_url: `${req.protocol}://${req.get('host')}/settings?connected=true`,
                failure_redirect_url: `${req.protocol}://${req.get('host')}/settings?connected=false`,
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error('Unipile connect error:', response.status, errText);
            return res.status(response.status).json({ error: `Unipile hatası: ${errText}` });
        }

        const data = await response.json();
        console.log('Unipile hosted link:', JSON.stringify(data).substring(0, 500));

        // Unipile genelde { url: "https://..." } döndürür
        const authUrl = data.url || data.link || data.hosted_link || data.auth_url;
        if (!authUrl) {
            return res.status(500).json({ error: 'Unipile bağlantı URL\'si alınamadı', raw: data });
        }

        res.json({ url: authUrl });
    } catch (err) {
        console.error('Unipile connect error:', err);
        res.status(500).json({ error: 'Bağlantı oluşturulurken hata: ' + err.message });
    }
});

// POST /api/integrations/unipile-reconnect — Mevcut hesabı yeniden bağla
router.post('/unipile-reconnect', authMiddleware, adminOnly, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;
        const { account_id } = req.body;

        if (!account_id) {
            return res.status(400).json({ error: 'account_id gerekli' });
        }

        const settings = db.prepare(
            "SELECT api_key, dsn_url FROM integration_settings WHERE company_id = ? AND provider = 'unipile' AND api_key != '' AND dsn_url != '' LIMIT 1"
        ).get(companyId);

        if (!settings) {
            return res.status(400).json({ error: 'Önce Unipile API Key ve DSN URL kaydedin' });
        }

        const fetch = (await import('node-fetch')).default;
        const dsn = settings.dsn_url.startsWith('http') ? settings.dsn_url.replace(/\/$/, '') : `https://${settings.dsn_url.replace(/\/$/, '')}`;

        const response = await fetch(`${dsn}/api/v1/hosted/accounts/${account_id}/reconnect`, {
            method: 'POST',
            headers: {
                'X-API-KEY': settings.api_key,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                success_redirect_url: `${req.protocol}://${req.get('host')}/settings?reconnected=true`,
                failure_redirect_url: `${req.protocol}://${req.get('host')}/settings?reconnected=false`,
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            return res.status(response.status).json({ error: `Unipile hatası: ${errText}` });
        }

        const data = await response.json();
        const authUrl = data.url || data.link || data.hosted_link || data.auth_url;

        res.json({ url: authUrl || null, raw: data });
    } catch (err) {
        console.error('Unipile reconnect error:', err);
        res.status(500).json({ error: 'Yeniden bağlantı hatası: ' + err.message });
    }
});

// ==================== WhatsApp Web.js Routes ====================

// POST /api/integrations/whatsapp-web/connect — QR kod ile WhatsApp bağla
router.post('/whatsapp-web/connect', authMiddleware, adminOnly, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const io = req.app.locals.io;
        const companyId = req.user.company_id;

        const { initClient } = require('../services/whatsappWebService');
        const result = await initClient(db, io, companyId);
        res.json(result);
    } catch (err) {
        console.error('WhatsApp Web connect error:', err);
        res.status(500).json({ error: 'WhatsApp bağlantısı başlatılamadı: ' + err.message });
    }
});

// GET /api/integrations/whatsapp-web/qr — Güncel QR kodu getir
router.get('/whatsapp-web/qr', authMiddleware, (req, res) => {
    const companyId = req.user.company_id;
    const { getQR } = require('../services/whatsappWebService');
    const qr = getQR(companyId);
    res.json({ qr });
});

// GET /api/integrations/whatsapp-web/status — Bağlantı durumu
router.get('/whatsapp-web/status', authMiddleware, (req, res) => {
    const companyId = req.user.company_id;
    const { getStatus } = require('../services/whatsappWebService');
    const status = getStatus(companyId);
    res.json(status);
});

// POST /api/integrations/whatsapp-web/disconnect — Bağlantıyı kes
router.post('/whatsapp-web/disconnect', authMiddleware, adminOnly, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;
        const { disconnectClient } = require('../services/whatsappWebService');
        const result = await disconnectClient(db, companyId);
        res.json(result);
    } catch (err) {
        console.error('WhatsApp Web disconnect error:', err);
        res.status(500).json({ error: 'Bağlantı kesilirken hata: ' + err.message });
    }
});

module.exports = router;
