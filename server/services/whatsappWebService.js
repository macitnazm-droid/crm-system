// WhatsApp Web.js entegrasyonu — Ücretsiz WhatsApp bağlantısı (QR kod ile)
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const { processIncomingMessage } = require('../routes/webhooks');
const { isDuplicate, markAsSent, wasSentByUs } = require('./messageDedup');

// Her şirket için ayrı WhatsApp Web client
const clients = new Map();       // companyId -> Client
const qrCodes = new Map();       // companyId -> base64 QR image
const clientStatus = new Map();  // companyId -> { status, phone, name }

function getStatus(companyId) {
    return clientStatus.get(companyId) || { status: 'disconnected', phone: null, name: null };
}

function getQR(companyId) {
    return qrCodes.get(companyId) || null;
}

async function initClient(db, io, companyId) {
    // Zaten bağlıysa tekrar başlatma
    if (clients.has(companyId)) {
        const existing = clients.get(companyId);
        const state = await existing.getState().catch(() => null);
        if (state === 'CONNECTED') {
            return { status: 'already_connected' };
        }
        // Bağlı değilse temizle ve yeniden başlat
        try { await existing.destroy(); } catch (e) { }
        clients.delete(companyId);
    }

    clientStatus.set(companyId, { status: 'initializing', phone: null, name: null });
    qrCodes.delete(companyId);

    const client = new Client({
        authStrategy: new LocalAuth({ clientId: `company_${companyId}` }),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--single-process'
            ]
        }
    });

    // QR kod oluşturulduğunda
    client.on('qr', async (qr) => {
        console.log(`📱 WhatsApp Web QR oluşturuldu (company: ${companyId})`);
        try {
            const qrImage = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
            qrCodes.set(companyId, qrImage);
            clientStatus.set(companyId, { status: 'qr_ready', phone: null, name: null });
            // Real-time QR güncellemesi
            io.to(`company:${companyId}`).emit('whatsapp-web:qr', { qr: qrImage });
        } catch (err) {
            console.error('QR oluşturma hatası:', err.message);
        }
    });

    // Bağlantı başarılı
    client.on('ready', async () => {
        console.log(`✅ WhatsApp Web bağlandı (company: ${companyId})`);
        qrCodes.delete(companyId);
        try {
            const info = client.info;
            const phone = info?.wid?.user || '';
            const name = info?.pushname || '';
            clientStatus.set(companyId, { status: 'connected', phone, name });

            // integration_settings'e kaydet
            const existing = db.prepare(
                "SELECT id FROM integration_settings WHERE company_id = ? AND platform = 'whatsapp' AND provider = 'whatsapp-web'"
            ).get(companyId);

            if (!existing) {
                db.prepare(`
                    INSERT INTO integration_settings (company_id, platform, provider, is_active, api_key, created_at, updated_at)
                    VALUES (?, 'whatsapp', 'whatsapp-web', 1, ?, ?, ?)
                `).run(companyId, `connected:${phone}`, new Date().toISOString(), new Date().toISOString());
            } else {
                db.prepare(
                    "UPDATE integration_settings SET is_active = 1, api_key = ?, updated_at = ? WHERE id = ?"
                ).run(`connected:${phone}`, new Date().toISOString(), existing.id);
            }

            io.to(`company:${companyId}`).emit('whatsapp-web:status', { status: 'connected', phone, name });
        } catch (err) {
            console.error('WhatsApp Web ready info hatası:', err.message);
            clientStatus.set(companyId, { status: 'connected', phone: '', name: '' });
        }
    });

    // Bağlantı kesildi
    client.on('disconnected', (reason) => {
        console.log(`❌ WhatsApp Web bağlantı kesildi (company: ${companyId}): ${reason}`);
        clientStatus.set(companyId, { status: 'disconnected', phone: null, name: null });
        clients.delete(companyId);
        qrCodes.delete(companyId);

        // DB'de pasife çek
        try {
            db.prepare(
                "UPDATE integration_settings SET is_active = 0, updated_at = ? WHERE company_id = ? AND platform = 'whatsapp' AND provider = 'whatsapp-web'"
            ).run(new Date().toISOString(), companyId);
        } catch (e) { }

        io.to(`company:${companyId}`).emit('whatsapp-web:status', { status: 'disconnected' });
    });

    // Auth hatası
    client.on('auth_failure', (msg) => {
        console.error(`❌ WhatsApp Web auth hatası (company: ${companyId}):`, msg);
        clientStatus.set(companyId, { status: 'auth_failed', phone: null, name: null });
        clients.delete(companyId);
        qrCodes.delete(companyId);
        io.to(`company:${companyId}`).emit('whatsapp-web:status', { status: 'auth_failed' });
    });

    // Gelen mesajlar
    client.on('message', async (msg) => {
        try {
            // Kendi gönderdiğimiz mesajları atla
            if (msg.fromMe) return;

            // Sadece text mesajlar
            if (msg.type !== 'chat') return;

            const text = msg.body;
            if (!text) return;

            // Dedup kontrolü
            if (isDuplicate(msg.id._serialized)) return;

            // Kendi gönderdiğimiz içeriği geri alıyorsak atla
            if (wasSentByUs(text)) {
                console.log(`⏭ WhatsApp Web kendi mesajımız, atlanıyor: "${text.substring(0, 40)}"`);
                return;
            }

            // Gönderen bilgisi
            const contact = await msg.getContact().catch(() => null);
            const senderPhone = msg.from.replace('@c.us', '');
            const senderName = contact?.pushname || contact?.name || '';

            console.log(`📨 WhatsApp Web (company: ${companyId}): ${senderName || senderPhone} → "${text.substring(0, 60)}"`);

            await processIncomingMessage(db, io, {
                company_id: companyId,
                platform_id: senderPhone,
                content: text,
                source: 'whatsapp',
                customer_name: senderName || null,
                phone: senderPhone
            });
        } catch (err) {
            console.error(`WhatsApp Web mesaj işleme hatası (company: ${companyId}):`, err.message);
        }
    });

    clients.set(companyId, client);

    // Client'ı başlat
    try {
        await client.initialize();
        return { status: 'initializing' };
    } catch (err) {
        console.error(`WhatsApp Web başlatma hatası (company: ${companyId}):`, err.message);
        clientStatus.set(companyId, { status: 'error', phone: null, name: null, error: err.message });
        clients.delete(companyId);
        return { status: 'error', error: err.message };
    }
}

async function disconnectClient(db, companyId) {
    const client = clients.get(companyId);
    if (client) {
        try {
            await client.logout();
            await client.destroy();
        } catch (e) { }
        clients.delete(companyId);
    }
    qrCodes.delete(companyId);
    clientStatus.set(companyId, { status: 'disconnected', phone: null, name: null });

    // DB güncelle
    try {
        db.prepare(
            "UPDATE integration_settings SET is_active = 0, updated_at = ? WHERE company_id = ? AND platform = 'whatsapp' AND provider = 'whatsapp-web'"
        ).run(new Date().toISOString(), companyId);
    } catch (e) { }

    return { status: 'disconnected' };
}

async function sendMessage(companyId, phone, text) {
    const client = clients.get(companyId);
    if (!client) {
        return { sent: false, reason: 'client_not_connected' };
    }

    const state = await client.getState().catch(() => null);
    if (state !== 'CONNECTED') {
        return { sent: false, reason: 'not_connected' };
    }

    try {
        // Telefon numarasını normalize et (başındaki + ve 0'ları temizle)
        let normalized = phone.replace(/[\s\-\(\)]/g, '');
        if (normalized.startsWith('+')) normalized = normalized.slice(1);
        // Türkiye: 0 ile başlıyorsa 90'a çevir
        if (normalized.startsWith('0') && normalized.length === 11) {
            normalized = '9' + normalized;
        }

        const chatId = normalized + '@c.us';
        await client.sendMessage(chatId, text);
        markAsSent(text);
        console.log(`📤 WhatsApp Web mesaj gönderildi (company: ${companyId}): "${text.substring(0, 50)}"`);
        return { sent: true, provider: 'whatsapp-web' };
    } catch (err) {
        console.error(`WhatsApp Web mesaj gönderme hatası:`, err.message);
        return { sent: false, reason: err.message };
    }
}

// Sunucu başlatıldığında mevcut aktif whatsapp-web entegrasyonlarını otomatik başlat
async function autoReconnect(db, io) {
    try {
        const activeIntegrations = db.prepare(
            "SELECT company_id FROM integration_settings WHERE platform = 'whatsapp' AND provider = 'whatsapp-web' AND is_active = 1"
        ).all();

        for (const integ of activeIntegrations) {
            console.log(`🔄 WhatsApp Web otomatik yeniden bağlanıyor (company: ${integ.company_id})`);
            // Hata olursa sessizce geç (session yoksa QR bekleyecek)
            initClient(db, io, integ.company_id).catch(err => {
                console.warn(`WhatsApp Web auto-reconnect hatası (company: ${integ.company_id}):`, err.message);
            });
        }
    } catch (err) {
        console.warn('WhatsApp Web auto-reconnect genel hatası:', err.message);
    }
}

module.exports = {
    initClient,
    disconnectClient,
    sendMessage,
    getStatus,
    getQR,
    autoReconnect,
    clients
};
