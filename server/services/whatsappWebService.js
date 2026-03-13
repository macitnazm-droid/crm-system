// WhatsApp Baileys entegrasyonu — Ücretsiz WhatsApp bağlantısı (QR kod ile)
// Chromium gerektirmez, direkt WebSocket bağlantısı kullanır (~50MB RAM)

const { makeWASocket, useMultiFileAuthState, DisconnectReason, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const { processIncomingMessage } = require('../routes/webhooks');
const { isDuplicate, markAsSent, wasSentByUs } = require('./messageDedup');
const path = require('path');
const fs = require('fs');

// Her şirket için ayrı WhatsApp socket
const clients = new Map();       // companyId -> socket
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
        if (existing.user) {
            return { status: 'already_connected' };
        }
        // Bağlı değilse temizle
        try { existing.end(); } catch (e) { }
        clients.delete(companyId);
    }

    clientStatus.set(companyId, { status: 'initializing', phone: null, name: null });
    qrCodes.delete(companyId);

    // Auth dosyaları her şirket için ayrı dizinde
    const authDir = path.join(__dirname, '..', '.wwebjs_auth', `company_${companyId}`);
    if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir, { recursive: true });
    }

    console.log(`🔄 Baileys client başlatılıyor (company: ${companyId})...`);

    try {
        const { state, saveCreds } = await useMultiFileAuthState(authDir);

        const sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, undefined),
            },
            printQRInTerminal: false,
            browser: ['CRM Platform', 'Chrome', '120.0'],
            syncFullHistory: false,
            generateHighQualityLinkPreview: false,
        });

        // Creds güncelleme
        sock.ev.on('creds.update', saveCreds);

        // Bağlantı durumu
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            // QR kod oluşturuldu
            if (qr) {
                console.log(`📱 Baileys QR oluşturuldu (company: ${companyId})`);
                try {
                    const qrImage = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
                    qrCodes.set(companyId, qrImage);
                    clientStatus.set(companyId, { status: 'qr_ready', phone: null, name: null });
                    io.to(`company:${companyId}`).emit('whatsapp-web:qr', { qr: qrImage });
                } catch (err) {
                    console.error('QR oluşturma hatası:', err.message);
                }
            }

            // Bağlantı açıldı
            if (connection === 'open') {
                console.log(`✅ Baileys bağlandı (company: ${companyId})`);
                qrCodes.delete(companyId);

                const phone = sock.user?.id?.split(':')[0] || sock.user?.id?.split('@')[0] || '';
                const name = sock.user?.name || '';
                clientStatus.set(companyId, { status: 'connected', phone, name });

                // integration_settings'e kaydet
                try {
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
                } catch (dbErr) {
                    console.error('DB kayıt hatası:', dbErr.message);
                }

                io.to(`company:${companyId}`).emit('whatsapp-web:status', { status: 'connected', phone, name });
            }

            // Bağlantı kapandı
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                console.log(`❌ Baileys bağlantı kesildi (company: ${companyId}), code: ${statusCode}, reconnect: ${shouldReconnect}`);

                clients.delete(companyId);
                qrCodes.delete(companyId);

                if (statusCode === DisconnectReason.loggedOut) {
                    // Oturum kapatıldı — auth dosyalarını temizle
                    clientStatus.set(companyId, { status: 'disconnected', phone: null, name: null });
                    try {
                        fs.rmSync(authDir, { recursive: true, force: true });
                    } catch (e) { }

                    // DB'de pasife çek
                    try {
                        db.prepare(
                            "UPDATE integration_settings SET is_active = 0, updated_at = ? WHERE company_id = ? AND platform = 'whatsapp' AND provider = 'whatsapp-web'"
                        ).run(new Date().toISOString(), companyId);
                    } catch (e) { }

                    io.to(`company:${companyId}`).emit('whatsapp-web:status', { status: 'disconnected' });
                } else if (shouldReconnect) {
                    // Otomatik yeniden bağlan
                    console.log(`🔄 Baileys yeniden bağlanıyor (company: ${companyId})...`);
                    clientStatus.set(companyId, { status: 'reconnecting', phone: null, name: null });
                    setTimeout(() => {
                        initClient(db, io, companyId).catch(err => {
                            console.error(`Baileys reconnect hatası (company: ${companyId}):`, err.message);
                        });
                    }, 3000);
                }
            }
        });

        // Gelen mesajlar
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;

            for (const msg of messages) {
                try {
                    // Kendi gönderdiğimiz mesajları atla
                    if (msg.key.fromMe) continue;

                    // Sadece text mesajlar
                    const text = msg.message?.conversation
                        || msg.message?.extendedTextMessage?.text
                        || null;
                    if (!text) continue;

                    // Dedup kontrolü
                    const msgId = msg.key.id;
                    if (isDuplicate(msgId)) continue;

                    // Kendi gönderdiğimiz içeriği geri alıyorsak atla
                    if (wasSentByUs(text)) {
                        console.log(`⏭ Baileys kendi mesajımız, atlanıyor: "${text.substring(0, 40)}"`);
                        continue;
                    }

                    // Gönderen bilgisi
                    const senderJid = msg.key.remoteJid;
                    const senderPhone = senderJid?.replace('@s.whatsapp.net', '') || '';
                    const senderName = msg.pushName || '';

                    console.log(`📨 Baileys (company: ${companyId}): ${senderName || senderPhone} → "${text.substring(0, 60)}"`);

                    await processIncomingMessage(db, io, {
                        company_id: companyId,
                        platform_id: senderPhone,
                        content: text,
                        source: 'whatsapp',
                        customer_name: senderName || null,
                        phone: senderPhone
                    });
                } catch (err) {
                    console.error(`Baileys mesaj işleme hatası (company: ${companyId}):`, err.message);
                }
            }
        });

        clients.set(companyId, sock);
        return { status: 'initializing' };
    } catch (err) {
        console.error(`❌ Baileys başlatma hatası (company: ${companyId}):`, err.message);
        console.error(`❌ Stack:`, err.stack?.substring(0, 500));
        clientStatus.set(companyId, { status: 'error', phone: null, name: null, error: err.message });
        return { status: 'error', error: err.message };
    }
}

async function disconnectClient(db, companyId) {
    const sock = clients.get(companyId);
    if (sock) {
        try {
            await sock.logout();
        } catch (e) { }
        try {
            sock.end();
        } catch (e) { }
        clients.delete(companyId);
    }
    qrCodes.delete(companyId);
    clientStatus.set(companyId, { status: 'disconnected', phone: null, name: null });

    // Auth dosyalarını temizle
    const authDir = path.join(__dirname, '..', '.wwebjs_auth', `company_${companyId}`);
    try {
        fs.rmSync(authDir, { recursive: true, force: true });
    } catch (e) { }

    // DB güncelle
    try {
        db.prepare(
            "UPDATE integration_settings SET is_active = 0, updated_at = ? WHERE company_id = ? AND platform = 'whatsapp' AND provider = 'whatsapp-web'"
        ).run(new Date().toISOString(), companyId);
    } catch (e) { }

    return { status: 'disconnected' };
}

async function sendMessage(companyId, phone, text) {
    const sock = clients.get(companyId);
    if (!sock) {
        return { sent: false, reason: 'client_not_connected' };
    }

    if (!sock.user) {
        return { sent: false, reason: 'not_connected' };
    }

    try {
        // Telefon numarasını normalize et
        let normalized = phone.replace(/[\s\-\(\)]/g, '');
        if (normalized.startsWith('+')) normalized = normalized.slice(1);
        // Türkiye: 0 ile başlıyorsa 90'a çevir
        if (normalized.startsWith('0') && normalized.length === 11) {
            normalized = '9' + normalized;
        }

        const jid = normalized + '@s.whatsapp.net';
        await sock.sendMessage(jid, { text });
        markAsSent(text);
        console.log(`📤 Baileys mesaj gönderildi (company: ${companyId}): "${text.substring(0, 50)}"`);
        return { sent: true, provider: 'whatsapp-web' };
    } catch (err) {
        console.error(`Baileys mesaj gönderme hatası:`, err.message);
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
            console.log(`🔄 Baileys otomatik yeniden bağlanıyor (company: ${integ.company_id})`);
            initClient(db, io, integ.company_id).catch(err => {
                console.warn(`Baileys auto-reconnect hatası (company: ${integ.company_id}):`, err.message);
            });
        }
    } catch (err) {
        console.warn('Baileys auto-reconnect genel hatası:', err.message);
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
