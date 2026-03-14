const express = require('express');
const fs = require('fs');
const pathModule = require('path');
const { aiService } = require('../services/aiService');
const { isDuplicate, markAsSent, wasSentByUs } = require('../services/messageDedup');
const { sendOutboundMessage } = require('../services/metaService');
const { sendAppointmentNotification } = require('../services/appointmentNotifyService');

/**
 * Harici medya URL'sini indir ve sunucuya kaydet
 * Instagram/Facebook CDN linkleri kısa sürede expire olur
 */
async function downloadAndSaveMedia(externalUrl, mediaType) {
    if (!externalUrl) return null;
    // Zaten lokal dosyaysa indirmeye gerek yok
    if (externalUrl.startsWith('/uploads/')) return externalUrl;
    try {
        const fetch = (await import('node-fetch')).default;
        const res = await fetch(externalUrl, { timeout: 15000 });
        if (!res.ok) {
            console.warn(`⚠️ Medya indirilemedi (${res.status}): ${externalUrl.substring(0, 100)}`);
            return externalUrl; // Fallback: orijinal URL'yi döndür
        }
        const contentType = res.headers.get('content-type') || '';
        let ext = '.jpg';
        if (contentType.includes('png')) ext = '.png';
        else if (contentType.includes('gif')) ext = '.gif';
        else if (contentType.includes('webp')) ext = '.webp';
        else if (contentType.includes('mp4') || contentType.includes('video')) ext = '.mp4';
        else if (contentType.includes('audio') || contentType.includes('ogg')) ext = '.ogg';
        else if (mediaType === 'video') ext = '.mp4';
        else if (mediaType === 'audio') ext = '.ogg';

        const uploadsDir = pathModule.join(__dirname, '..', 'uploads');
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

        const filename = `media_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
        const filepath = pathModule.join(uploadsDir, filename);
        const buffer = await res.buffer();
        fs.writeFileSync(filepath, buffer);
        console.log(`💾 Medya kaydedildi: ${filename} (${(buffer.length / 1024).toFixed(1)} KB)`);
        return `/uploads/${filename}`;
    } catch (err) {
        console.error('⚠️ Medya indirme hatası:', err.message);
        return externalUrl; // Fallback: orijinal URL
    }
}

// Regex tabanlı randevu tespiti (AI'a bağımlı değil)
function detectAppointment(messages, customerName) {
    // Son 6 mesajı kontrol et (en güncel konuşma)
    const recent = messages.slice(-6).map(m => m.content).join(' ');
    const text = recent.toLowerCase();

    // Randevu anahtar kelimeleri
    const hasAppointmentKeyword = /randevu|appointment|rezerv|saat\s*\d|:\d{2}|buluş|görüş|gelece[gğ]|bekl[ei]yor/i.test(text);
    if (!hasAppointmentKeyword) return null;

    // Tarih tespiti
    let dateStr = '';
    // "20 mart", "15 nisan", "3 ocak" vs.
    const dateMatch = recent.match(/(\d{1,2})\s*(ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık)/i);
    // "yarın", "bugün"
    const relativeMatch = recent.match(/\b(yarın|bugün|öbür\s*gün|haftaya)\b/i);

    if (dateMatch) {
        dateStr = `${dateMatch[1]} ${dateMatch[2]}`;
    } else if (relativeMatch) {
        const today = new Date();
        if (relativeMatch[1].toLowerCase() === 'yarın') {
            today.setDate(today.getDate() + 1);
        } else if (relativeMatch[1].toLowerCase().includes('öbür')) {
            today.setDate(today.getDate() + 2);
        }
        dateStr = today.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
    }

    // Saat tespiti
    let timeStr = '';
    const timeMatch = recent.match(/(?:saat\s*)?(\d{1,2})[:.:](\d{2})/i) || recent.match(/(?:saat\s*)(\d{1,2}):?(\d{2})?/i);
    if (timeMatch) {
        timeStr = `${timeMatch[1]}:${timeMatch[2] || '00'}`;
    }

    if (!dateStr && !timeStr) return null;

    // Notlar — AI yanıtından hizmet bilgisi çıkar
    let notes = '';
    const serviceMatch = recent.match(/(protez|tırnak|manikür|pedikür|saç|kesim|boyama|bakım|masaj|cilt|epilasyon|lazer|dolgu|botoks)/i);
    if (serviceMatch) notes = serviceMatch[0];

    return {
        customer_name: customerName,
        appointment_time: [dateStr, timeStr].filter(Boolean).join(' Saat: '),
        notes: notes || null
    };
}

const router = express.Router();

// POST /api/webhooks/instagram — Meta Graph API Instagram webhook
router.post('/instagram', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const io = req.app.locals.io;
        const body = req.body;

        console.log('📩 Instagram webhook:', JSON.stringify(body).substring(0, 1000));

        // Meta Webhook format: { object: "instagram", entry: [...] }
        if (body.object === 'instagram' && body.entry) {
            for (const e of body.entry) {
                const pageId = e.id;

                // page_id ile şirketi bul (provider'a bakma — Meta webhook sadece Meta'dan gelir)
                let integration = db.prepare(
                    "SELECT * FROM integration_settings WHERE platform = 'instagram' AND provider = 'meta' AND page_id = ? AND is_active = 1"
                ).get(pageId);

                if (!integration) {
                    // page_id henüz kaydedilmemiş ama sadece 1 entegrasyon varsa onu kullan
                    const unmatched = db.prepare(
                        "SELECT * FROM integration_settings WHERE platform = 'instagram' AND provider = 'meta' AND is_active = 1 AND (page_id IS NULL OR page_id = '')"
                    ).all();
                    if (unmatched.length === 1) {
                        // Tek boş page_id'li entegrasyon var — bu ilk bağlantı, page_id'yi kaydet
                        db.prepare('UPDATE integration_settings SET page_id = ? WHERE id = ?').run(pageId, unmatched[0].id);
                        console.log(`📝 page_id=${pageId} ilk bağlantıda kaydedildi (integration:${unmatched[0].id})`);
                        integration = unmatched[0];
                    } else {
                        console.warn(`Instagram webhook: page_id=${pageId} için aktif Meta entegrasyonu bulunamadı (${unmatched.length} boş entegrasyon var)`);
                        continue;
                    }
                }

                const companyId = integration.company_id;
                if (!companyId) continue;

                // Instagram Messaging webhook: entry[].messaging[]
                const messaging = e.messaging || [];
                const activeIntegration = integration;
                for (const event of messaging) {
                    const senderId = event.sender?.id;
                    const messageText = event.message?.text;
                    const recipientId = event.recipient?.id;

                    // Echo mesajı = bizim gönderdiğimiz mesaj (panelden veya telefondan)
                    if (event.message?.is_echo || senderId === pageId) {
                        if (messageText && !wasSentByUs(messageText)) {
                            // Panelden değil, dışarıdan gönderilmiş → kaydet
                            console.log(`📤 Instagram giden mesaj: → "${messageText.substring(0, 60)}"`);
                            await processOutboundMessage(db, io, {
                                company_id: companyId,
                                platform_id: recipientId || senderId,
                                content: messageText,
                                source: 'instagram',
                            });
                        }
                        continue;
                    }

                    // Görsel/medya kontrolü
                    let igMediaUrl = null;
                    let igMediaType = null;
                    const attachments = event.message?.attachments;
                    if (attachments && attachments.length > 0) {
                        const att = attachments[0];
                        igMediaType = att.type; // image, video, audio, file
                        igMediaUrl = att.payload?.url;
                    }

                    if (senderId && (messageText || igMediaUrl)) {
                        // Graph API'den kullanıcı profil bilgisi çek
                        let customerName = null;
                        let profilePic = null;
                        let username = null;
                        if (activeIntegration?.api_key) {
                            try {
                                const fetch = (await import('node-fetch')).default;
                                const profileRes = await fetch(
                                    `https://graph.facebook.com/v21.0/${senderId}?fields=name,username,profile_pic&access_token=${activeIntegration.api_key}`
                                );
                                if (profileRes.ok) {
                                    const profile = await profileRes.json();
                                    customerName = profile.name || profile.username || null;
                                    username = profile.username || null;
                                    profilePic = profile.profile_pic || null;
                                    console.log(`👤 IG Profil: ${customerName} (@${username})`);
                                } else {
                                    const errData = await profileRes.json().catch(() => ({}));
                                    console.warn(`👤 IG Profil çekilemedi (${profileRes.status}): ${errData?.error?.message || 'bilinmeyen hata'} [page=${pageId}, sender=${senderId}]`);
                                }
                            } catch (profileErr) {
                                console.warn('IG profil çekme hatası:', profileErr.message);
                            }
                        } else {
                            console.warn(`👤 IG Profil: api_key yok [integration=${activeIntegration?.id}, company=${companyId}]`);
                        }

                        const displayContent = messageText || (igMediaType === 'image' ? '📷 Görsel' : igMediaType === 'video' ? '🎥 Video' : '📎 Dosya');
                        console.log(`📨 Meta IG: ${customerName || senderId} → "${displayContent.substring(0, 60)}"${igMediaUrl ? ' [medya]' : ''}`);
                        await processIncomingMessage(db, io, {
                            company_id: companyId,
                            platform_id: senderId,
                            content: displayContent,
                            source: 'instagram',
                            customer_name: customerName,
                            profile_pic: profilePic,
                            username: username,
                            media_url: igMediaUrl,
                            media_type: igMediaType,
                        });
                    }
                }

                // Instagram changes formatı (bazı durumlarda)
                const changes = e.changes || [];
                for (const change of changes) {
                    if (change.field === 'messages' && change.value) {
                        const senderId = change.value.from?.id || change.value.sender?.id;
                        const messageText = change.value.message?.text || change.value.text;
                        if (senderId && messageText) {
                            await processIncomingMessage(db, io, {
                                company_id: companyId,
                                platform_id: senderId,
                                content: messageText,
                                source: 'instagram'
                            });
                        }
                    }
                }
            }
        }

        // Meta her zaman 200 bekler, aksi halde tekrar dener
        res.status(200).json({ status: 'ok' });
    } catch (err) {
        console.error('Instagram webhook error:', err);
        res.status(200).json({ status: 'error handled' });
    }
});

// POST /api/webhooks/messenger — Meta Graph API Messenger webhook
router.post('/messenger', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const io = req.app.locals.io;
        const body = req.body;

        console.log('📩 Messenger webhook:', JSON.stringify(body).substring(0, 1000));

        if (body.object === 'page' && body.entry) {
            for (const e of body.entry) {
                const pageId = e.id;

                let integration = db.prepare(
                    "SELECT * FROM integration_settings WHERE platform = 'messenger' AND provider = 'meta' AND page_id = ? AND is_active = 1"
                ).get(pageId);

                if (!integration) {
                    const unmatched = db.prepare(
                        "SELECT * FROM integration_settings WHERE platform = 'messenger' AND provider = 'meta' AND is_active = 1 AND (page_id IS NULL OR page_id = '')"
                    ).all();
                    if (unmatched.length === 1 && pageId) {
                        db.prepare('UPDATE integration_settings SET page_id = ? WHERE id = ?').run(pageId, unmatched[0].id);
                        integration = unmatched[0];
                    } else {
                        console.warn(`Messenger webhook: page_id=${pageId} için aktif entegrasyon bulunamadı`);
                        continue;
                    }
                }

                const companyId = integration.company_id;
                if (!companyId) continue;

                const activeIntegration = integration;

                const messaging = e.messaging || [];
                for (const event of messaging) {
                    const senderId = event.sender?.id;
                    const messageText = event.message?.text;
                    const recipientId = event.recipient?.id;

                    if (event.message?.is_echo) {
                        if (messageText && !wasSentByUs(messageText)) {
                            console.log(`📤 Messenger giden mesaj: → "${messageText.substring(0, 60)}"`);
                            await processOutboundMessage(db, io, {
                                company_id: companyId,
                                platform_id: recipientId || senderId,
                                content: messageText,
                                source: 'messenger',
                            });
                        }
                        continue;
                    }

                    // Görsel/medya kontrolü
                    let msgMediaUrl = null;
                    let msgMediaType = null;
                    const msgAttachments = event.message?.attachments;
                    if (msgAttachments && msgAttachments.length > 0) {
                        const att = msgAttachments[0];
                        msgMediaType = att.type;
                        msgMediaUrl = att.payload?.url;
                    }

                    if (senderId && (messageText || msgMediaUrl)) {
                        // Graph API'den kullanıcı profil bilgisi çek
                        let customerName = null;
                        let profilePic = null;
                        if (activeIntegration?.api_key) {
                            try {
                                const fetch = (await import('node-fetch')).default;
                                const profileRes = await fetch(
                                    `https://graph.facebook.com/v21.0/${senderId}?fields=name,profile_pic&access_token=${activeIntegration.api_key}`
                                );
                                if (profileRes.ok) {
                                    const profile = await profileRes.json();
                                    customerName = profile.name || null;
                                    profilePic = profile.profile_pic || null;
                                    console.log(`👤 Messenger Profil: ${customerName}`);
                                }
                            } catch (profileErr) {
                                console.warn('Messenger profil çekme hatası:', profileErr.message);
                            }
                        }

                        const msgDisplayContent = messageText || (msgMediaType === 'image' ? '📷 Görsel' : msgMediaType === 'video' ? '🎥 Video' : '📎 Dosya');
                        console.log(`📨 Messenger: ${customerName || senderId} → "${msgDisplayContent.substring(0, 60)}" (company:${companyId})`);
                        try {
                            const result = await processIncomingMessage(db, io, {
                                company_id: companyId,
                                platform_id: senderId,
                                content: msgDisplayContent,
                                source: 'messenger',
                                customer_name: customerName,
                                profile_pic: profilePic,
                                media_url: msgMediaUrl,
                                media_type: msgMediaType,
                            });
                            console.log(`✅ Messenger mesaj kaydedildi: customer=${result?.customer?.id}, conv=${result?.conversation?.id}`);
                        } catch (msgErr) {
                            console.error(`❌ Messenger processIncomingMessage hatası (company:${companyId}):`, msgErr.message, msgErr.stack?.substring(0, 300));
                        }
                    }
                }
            }
        }

        res.status(200).json({ status: 'ok' });
    } catch (err) {
        console.error('Messenger webhook error:', err);
        res.status(200).json({ status: 'error handled' });
    }
});

// GET /api/webhooks/messenger — Meta Webhook doğrulama
router.get('/messenger', (req, res) => {
    const db = req.app.locals.db;
    const integration = db.prepare(
        "SELECT verify_token FROM integration_settings WHERE platform = 'messenger' AND provider = 'meta' AND is_active = 1 AND verify_token != '' LIMIT 1"
    ).get();
    const verifyToken = integration?.verify_token || process.env.MESSENGER_VERIFY_TOKEN || 'messenger_webhook_verify_token';

    if (req.query['hub.verify_token'] === verifyToken && req.query['hub.challenge']) {
        console.log('✅ Messenger webhook doğrulandı');
        res.send(req.query['hub.challenge']);
    } else {
        console.warn(`❌ Messenger webhook doğrulama başarısız`);
        res.status(403).send('Token geçersiz');
    }
});

// GET /api/webhooks/instagram — Meta Webhook doğrulama
router.get('/instagram', (req, res) => {
    const db = req.app.locals.db;
    // Önce DB'deki verify_token'ı dene
    const integration = db.prepare(
        "SELECT verify_token FROM integration_settings WHERE platform = 'instagram' AND provider = 'meta' AND is_active = 1 AND verify_token != '' LIMIT 1"
    ).get();
    const verifyToken = integration?.verify_token || process.env.INSTAGRAM_VERIFY_TOKEN || 'instagram_webhook_verify_token';

    if (req.query['hub.verify_token'] === verifyToken && req.query['hub.challenge']) {
        console.log('✅ Instagram webhook doğrulandı');
        res.send(req.query['hub.challenge']);
    } else {
        console.warn(`❌ Instagram webhook doğrulama başarısız: beklenen="${verifyToken}", gelen="${req.query['hub.verify_token']}"`);
        res.status(403).send('Token geçersiz');
    }
});

// POST /api/webhooks/whatsapp — Meta Cloud API WhatsApp webhook
router.post('/whatsapp', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const io = req.app.locals.io;
        const body = req.body;

        console.log('📩 WhatsApp webhook:', JSON.stringify(body).substring(0, 1000));

        if (body.entry) {
            for (const e of body.entry) {
                const changes = e.changes || [];
                for (const change of changes) {
                    if (change.field !== 'messages') continue;

                    const phoneNumberId = change.value?.metadata?.phone_number_id;
                    let integration = db.prepare(
                        "SELECT * FROM integration_settings WHERE platform = 'whatsapp' AND provider = 'meta' AND phone_number_id = ? AND is_active = 1"
                    ).get(phoneNumberId);

                    if (!integration) {
                        const unmatched = db.prepare(
                            "SELECT * FROM integration_settings WHERE platform = 'whatsapp' AND provider = 'meta' AND is_active = 1 AND (phone_number_id IS NULL OR phone_number_id = '')"
                        ).all();
                        if (unmatched.length === 1 && phoneNumberId) {
                            db.prepare('UPDATE integration_settings SET phone_number_id = ? WHERE id = ?').run(phoneNumberId, unmatched[0].id);
                            integration = unmatched[0];
                        } else {
                            console.warn(`WhatsApp webhook: phone_number_id=${phoneNumberId} için aktif entegrasyon bulunamadı`);
                            continue;
                        }
                    }

                    const companyId = integration.company_id;
                    if (!companyId) continue;

                    // Statuses — okundu bilgisi vb, mesaj değil
                    // Messages — gerçek gelen mesajlar
                    const messages = change.value?.messages || [];
                    for (const msg of messages) {
                        const senderPhone = msg.from;
                        const senderName = change.value?.contacts?.[0]?.profile?.name;
                        let waContent = null;
                        let waMediaUrl = null;
                        let waMediaType = null;

                        if (msg.type === 'text' && msg.text?.body) {
                            waContent = msg.text.body;
                        } else if (['image', 'video', 'audio', 'document', 'sticker'].includes(msg.type)) {
                            waMediaType = msg.type;
                            waContent = msg[msg.type]?.caption || (msg.type === 'image' ? '📷 Görsel' : msg.type === 'video' ? '🎥 Video' : msg.type === 'audio' ? '🎵 Ses' : '📎 Dosya');
                            const mediaId = msg[msg.type]?.id;
                            if (mediaId && integration?.api_key) {
                                try {
                                    const fetch = (await import('node-fetch')).default;
                                    const mediaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
                                        headers: { 'Authorization': `Bearer ${integration.api_key}` }
                                    });
                                    if (mediaRes.ok) {
                                        const mediaData = await mediaRes.json();
                                        waMediaUrl = mediaData.url;
                                    }
                                } catch (e) { }
                            }
                        }

                        if (waContent) {
                            console.log(`📨 Meta WA: ${senderName || senderPhone} → "${waContent.substring(0, 60)}"${waMediaUrl ? ' [medya]' : ''}`);
                            await processIncomingMessage(db, io, {
                                company_id: companyId,
                                platform_id: senderPhone,
                                content: waContent,
                                source: 'whatsapp',
                                customer_name: senderName,
                                phone: senderPhone,
                                media_url: waMediaUrl,
                                media_type: waMediaType,
                            });
                        }
                    }
                }
            }
        }

        res.status(200).json({ status: 'ok' });
    } catch (err) {
        console.error('WhatsApp webhook error:', err);
        res.status(200).json({ status: 'error handled' });
    }
});

// GET /api/webhooks/whatsapp — Meta Webhook doğrulama
router.get('/whatsapp', (req, res) => {
    const db = req.app.locals.db;
    const integration = db.prepare(
        "SELECT verify_token FROM integration_settings WHERE platform = 'whatsapp' AND provider = 'meta' AND is_active = 1 AND verify_token != '' LIMIT 1"
    ).get();
    const verifyToken = integration?.verify_token || process.env.WHATSAPP_VERIFY_TOKEN || 'whatsapp_webhook_verify_token';

    if (req.query['hub.verify_token'] === verifyToken && req.query['hub.challenge']) {
        console.log('✅ WhatsApp webhook doğrulandı');
        res.send(req.query['hub.challenge']);
    } else {
        console.warn(`❌ WhatsApp webhook doğrulama başarısız: beklenen="${verifyToken}", gelen="${req.query['hub.verify_token']}"`);
        res.status(403).send('Token geçersiz');
    }
});

// POST /api/webhooks/simulate — Yerel test simülatörü
router.post('/simulate', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const io = req.app.locals.io;
        const { customer_name, message, source, phone, instagram_id, company_id } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Mesaj gerekli' });
        }

        const platformId = instagram_id || phone || `sim_${Date.now()}`;
        const result = await processIncomingMessage(db, io, {
            company_id: company_id || 1, // Varsayılan Şirket
            platform_id: platformId,
            content: message,
            source: source || 'instagram',
            customer_name: customer_name || 'Simülasyon Müşterisi',
            phone: phone,
            instagram_id: instagram_id
        });

        res.json(result);
    } catch (err) {
        console.error('Simulate error:', err);
        res.status(500).json({ error: 'Simülasyon sırasında hata oluştu' });
    }
});

// Gelen mesajı işle
async function processIncomingMessage(db, io, data) {

    const { company_id, platform_id, content, source, customer_name, phone, instagram_id, unipile_chat_id, profile_pic, username, is_group, media_url: rawMediaUrl, media_type } = data;
    const now = new Date().toISOString();

    // Harici medya URL'sini indir ve lokal olarak kaydet (Instagram CDN linkleri expire olur)
    const media_url = rawMediaUrl ? await downloadAndSaveMedia(rawMediaUrl, media_type) : null;

    // Duplikasyon kontrolü: Aynı müşteriden, aynı içerikle, son 60 saniye içinde mesaj var mı?
    const sixtySecsAgo = new Date(Date.now() - 60 * 1000).toISOString();
    let existingMsg;
    if (source === 'instagram') {
        existingMsg = db.prepare(`
            SELECT m.id FROM messages m
            JOIN customers c ON m.customer_id = c.id
            WHERE c.instagram_id = ? AND c.company_id = ? AND m.content = ? AND m.direction = 'inbound' AND m.created_at > ?
            LIMIT 1
        `).get(platform_id, company_id, content, sixtySecsAgo);
    } else if (source === 'whatsapp') {
        existingMsg = db.prepare(`
            SELECT m.id FROM messages m
            JOIN customers c ON m.customer_id = c.id
            WHERE c.whatsapp_id = ? AND c.company_id = ? AND m.content = ? AND m.direction = 'inbound' AND m.created_at > ?
            LIMIT 1
        `).get(platform_id, company_id, content, sixtySecsAgo);
    } else if (source === 'messenger') {
        existingMsg = db.prepare(`
            SELECT m.id FROM messages m
            JOIN customers c ON m.customer_id = c.id
            WHERE c.messenger_id = ? AND c.company_id = ? AND m.content = ? AND m.direction = 'inbound' AND m.created_at > ?
            LIMIT 1
        `).get(platform_id, company_id, content, sixtySecsAgo);
    }

    if (existingMsg) {
        console.log(`⏭ Duplike mesaj atlandı (DB): "${content.substring(0, 50)}" (msg_id: ${existingMsg.id})`);
        return null;
    }

    // 1. Müşteriyi bul veya oluştur
    let customer;
    if (source === 'instagram') {
        customer = db.prepare('SELECT * FROM customers WHERE instagram_id = ? AND company_id = ?').get(platform_id, company_id);
    } else if (source === 'whatsapp') {
        customer = db.prepare('SELECT * FROM customers WHERE whatsapp_id = ? AND company_id = ?').get(platform_id, company_id);
    } else if (source === 'messenger') {
        customer = db.prepare('SELECT * FROM customers WHERE messenger_id = ? AND company_id = ?').get(platform_id, company_id);
    }

    if (!customer) {
        // Yeni müşteri oluştur
        const result = db.prepare(`
      INSERT INTO customers (company_id, name, phone, instagram_id, whatsapp_id, messenger_id, source, last_message_at, profile_pic, instagram_username, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
            company_id,
            customer_name || `Müşteri ${platform_id.substring(0, 8)}`,
            phone || null,
            source === 'instagram' ? (instagram_id || platform_id) : null,
            source === 'whatsapp' ? platform_id : null,
            source === 'messenger' ? platform_id : null,
            source,
            now,
            profile_pic || '',
            username || '',
            now, now
        );
        customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(result.lastInsertRowid);
    } else {
        // Mevcut müşterinin ismini güncelle (eğer hâlâ "Müşteri xxx" ise ve gerçek isim geldiyse)
        const updates = ['last_message_at = ?', 'updated_at = ?'];
        const params = [now, now];
        if (customer_name && customer.name.startsWith('Müşteri ')) {
            updates.push('name = ?');
            params.push(customer_name);
        }
        if (profile_pic) {
            updates.push('profile_pic = ?');
            params.push(profile_pic);
        }
        if (username && source === 'instagram') {
            updates.push('instagram_username = ?');
            params.push(username);
        }
        // Telefon numarası yoksa ve webhook'tan geldiyse kaydet
        if (phone && !customer.phone) {
            updates.push('phone = ?');
            params.push(phone);
        }
        params.push(customer.id, company_id);
        db.prepare(`UPDATE customers SET ${updates.join(', ')} WHERE id = ? AND company_id = ?`).run(...params);
    }

    // 2. Konuşmayı bul veya oluştur
    let conversation = db.prepare(
        "SELECT * FROM conversations WHERE customer_id = ? AND company_id = ? AND status != 'closed' ORDER BY updated_at DESC LIMIT 1"
    ).get(customer.id, company_id);

    if (!conversation) {
        const result = db.prepare(`
      INSERT INTO conversations (company_id, customer_id, status, ai_enabled, last_message_preview, unread_count, created_at, updated_at)
      VALUES (?, ?, 'open', 1, ?, 1, ?, ?)
    `).run(company_id, customer.id, content.substring(0, 100), now, now);
        conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(result.lastInsertRowid);
    } else {
        db.prepare(`
      UPDATE conversations SET last_message_preview = ?, unread_count = unread_count + 1, updated_at = ? WHERE id = ? AND company_id = ?
    `).run(content.substring(0, 100), now, conversation.id, company_id);
        conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversation.id);
    }

    // 3. Müşteri mesajını kaydet
    const msgResult = db.prepare(`
    INSERT INTO messages (company_id, conversation_id, customer_id, content, source, direction, media_url, media_type, created_at)
    VALUES (?, ?, ?, ?, ?, 'inbound', ?, ?, ?)
  `).run(company_id, conversation.id, customer.id, content || '', source, media_url || null, media_type || null, now);

    const inboundMessage = db.prepare('SELECT * FROM messages WHERE id = ?').get(msgResult.lastInsertRowid);

    // Real-time: yeni mesaj bildirimi (Sadece ilgili şirket odasına)
    io.to(`company:${company_id}`).emit('message:new', { message: inboundMessage, conversation_id: conversation.id });
    io.to(`company:${company_id}`).emit('conversation:updated', { conversation });

    // 4. AI etkinse otomatik yanıt üret
    // Platform bazlı AI kontrolü (şirket ayarı)
    let platformAiEnabled = true;
    try {
        const company = db.prepare('SELECT ai_instagram, ai_whatsapp, ai_messenger FROM companies WHERE id = ?').get(company_id);
        if (company) {
            if (source === 'instagram' && company.ai_instagram === 0) platformAiEnabled = false;
            if (source === 'whatsapp' && company.ai_whatsapp === 0) platformAiEnabled = false;
            if (source === 'messenger' && company.ai_messenger === 0) platformAiEnabled = false;
        }
    } catch (e) { }

    let aiMessage = null;
    if (conversation.ai_enabled && platformAiEnabled && !is_group) {
        const messages = db.prepare('SELECT * FROM messages WHERE conversation_id = ? AND company_id = ? ORDER BY created_at ASC').all(conversation.id, company_id);

        // Sonsuz döngü koruması: Son 3 mesajın hepsi outbound (AI) ise yanıt verme
        const lastThree = messages.slice(-3);
        if (lastThree.length >= 3 && lastThree.every(m => m.direction === 'outbound')) {
            console.log(`⏭ Sonsuz döngü koruması: Son 3 mesaj outbound, AI yanıtı atlanıyor (conv: ${conversation.id})`);
            return { customer, conversation, message: inboundMessage };
        }

        const prompt = db.prepare('SELECT * FROM ai_prompts WHERE company_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1').get(company_id);
        let systemPrompt = prompt?.system_prompt || 'Sen bir satış asistanısın.';

        // Randevu bilgilerini AI'ya ver
        try {
            const servicesData = db.prepare('SELECT name, duration, price FROM services WHERE company_id = ? AND is_active = 1').all(company_id);
            const staffData = db.prepare('SELECT name, role FROM staff WHERE company_id = ? AND is_active = 1').all(company_id);

            if (servicesData.length > 0 || staffData.length > 0) {
                let apptContext = '\n\n--- RANDEVU SİSTEMİ BİLGİLERİ ---';
                if (servicesData.length > 0) {
                    apptContext += '\nHizmetler: ' + servicesData.map(s => `${s.name} (${s.duration}dk${s.price > 0 ? ', ' + s.price + '₺' : ''})`).join(', ');
                }
                if (staffData.length > 0) {
                    apptContext += '\nPersonel: ' + staffData.map(s => `${s.name}${s.role ? ' (' + s.role + ')' : ''}`).join(', ');
                }

                // Bugün, yarın + önümüzdeki 14 günün dolu saatlerini ver
                apptContext += '\nÇalışma saatleri: 09:00-19:00';
                apptContext += '\n\nDOLU RANDEVULAR:';
                for (let d = 0; d < 14; d++) {
                    const dateObj = new Date(Date.now() + d * 86400000);
                    const dateStr = dateObj.toISOString().split('T')[0];
                    const dayAppts = db.prepare(
                        "SELECT start_time, end_time, customer_name FROM appointments WHERE company_id = ? AND appointment_date = ? AND status NOT IN ('cancelled') ORDER BY start_time"
                    ).all(company_id, dateStr);
                    if (dayAppts.length > 0) {
                        apptContext += `\n${dateStr}: ` + dayAppts.map(a => `${a.start_time}-${a.end_time} (${a.customer_name || '?'})`).join(', ');
                    }
                }

                apptContext += '\n\nÖNEMLİ KURALLAR:';
                apptContext += '\n- Yukarıdaki dolu saatlere KESİNLİKLE randevu verme! Dolu olan saate randevu istenmişse "bu saat dolu, şu saatler müsait" de.';
                apptContext += '\n- HİZMET SÜRESİNİ HESABA KAT! Örneğin 90dk\'lık bir hizmet için 14:00 istendiyse 14:00-15:30 arası dolu olur. Eğer 15:00\'da başka randevu varsa 14:00 UYGUN DEĞİLDİR çünkü çakışır. Randevu vermeden önce istenen saat + hizmet süresi aralığının tamamen boş olduğundan emin ol.';
                apptContext += '\n- [RANDEVU: ...] tag\'ını SADECE müşteri açıkça yeni bir randevu talep ettiğinde ve tarih+saat netleştiğinde ve o saat MÜSAIT olduğunda ekle. Onay sorma, direkt oluştur.';
                apptContext += '\n- Müşteri "teşekkür", "tamam", "görüşürüz" gibi kapanış mesajları gönderiyorsa ASLA randevu tag\'ı ekleme.';
                apptContext += '\n- Zaten oluşturulmuş bir randevuyu tekrar oluşturma. Aynı kişi aynı saate tekrar isterse "zaten randevunuz var" de.';
                apptContext += '\n- Müşteri adını sohbette kendisi belirttiyse O İSMİ KULLAN, WhatsApp profil adını değil. Örneğin müşteri "Şamil Tayyar için randevu" diyorsa isim "Şamil Tayyar" olmalı.';
                apptContext += '\n- TELEFON NUMARASI: Randevu oluşturmadan önce müşterinin telefon numarasını mutlaka sor! "WhatsApp üzerinden randevu onay mesajı göndermemiz için telefon numaranızı paylaşır mısınız?" de. Müşteri numarasını verene kadar randevu tag\'ı EKLEME. Eğer müşteri zaten WhatsApp\'tan yazıyorsa telefon zaten var, sormana gerek yok.';
                apptContext += '\n- Tag formatı: [RANDEVU: tarih=YYYY-MM-DD, saat=HH:MM, hizmet=Hizmet Adı, personel=Personel Adı, isim=Müşteri Adı, telefon=Telefon Numarası]';
                apptContext += '\n- isim alanı: Müşterinin sohbette belirttiği ismi yaz. Belirtmemişse boş bırak.';
                apptContext += '\n- telefon alanı: Müşterinin verdiği telefon numarası. WhatsApp\'tan geliyorsa veya telefon zaten biliniyorsa onu yaz. Bilinmiyorsa boş bırak.';
                apptContext += '\n--- RANDEVU SİSTEMİ BİLGİLERİ SONU ---';

                systemPrompt += apptContext;
            }
        } catch (e) {
            console.error('Randevu context hatası:', e.message);
        }

        const aiResponse = await aiService.generateResponse(messages, systemPrompt, customer);

        // AI yanıtında randevu talimatı varsa otomatik kaydet
        try {
            const apptMatch = aiResponse.content.match(/\[RANDEVU:\s*tarih=(\d{4}-\d{2}-\d{2}),\s*saat=(\d{2}:\d{2}),\s*hizmet=([^,\]]+)(?:,\s*personel=([^,\]]+))?(?:,\s*isim=([^,\]]+))?(?:,\s*telefon=([^\]]+))?\]/);
            if (apptMatch) {
                const [, apptDate, apptTime, serviceName, staffName, customerNameFromAI, phoneFromAI] = apptMatch;

                // AI'dan gelen telefon numarasını müşteriye kaydet
                const apptPhone = phoneFromAI?.trim() || customer.phone || phone || '';
                if (apptPhone && !customer.phone) {
                    db.prepare('UPDATE customers SET phone = ?, updated_at = ? WHERE id = ?').run(apptPhone, new Date().toISOString(), customer.id);
                    customer.phone = apptPhone;
                    console.log(`📞 Müşteri telefonu güncellendi: ${customer.name} → ${apptPhone}`);
                }

                // Hizmeti bul
                const svc = db.prepare('SELECT id, duration FROM services WHERE company_id = ? AND name LIKE ? AND is_active = 1').get(company_id, `%${serviceName.trim()}%`);
                // Personeli bul
                const stf = staffName ? db.prepare('SELECT id FROM staff WHERE company_id = ? AND name LIKE ? AND is_active = 1').get(company_id, `%${staffName.trim()}%`) : null;

                // Bitiş saati hesapla
                const dur = svc?.duration || 60;
                const [h, m] = apptTime.split(':').map(Number);
                const endMin = h * 60 + m + dur;
                const endTime = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;

                // Çakışma kontrolü — süre bazlı overlap (yeni randevu aralığı mevcut randevuyla kesişiyor mu?)
                // Overlap koşulu: new_start < existing_end AND new_end > existing_start
                const conflictQuery = stf?.id
                    ? db.prepare(`SELECT id, start_time, end_time, customer_name, customer_id FROM appointments WHERE company_id = ? AND appointment_date = ? AND status NOT IN ('cancelled') AND staff_id = ? AND start_time < ? AND end_time > ?`).get(company_id, apptDate, stf.id, endTime, apptTime)
                    : db.prepare(`SELECT id, start_time, end_time, customer_name, customer_id FROM appointments WHERE company_id = ? AND appointment_date = ? AND status NOT IN ('cancelled') AND start_time < ? AND end_time > ?`).get(company_id, apptDate, endTime, apptTime);

                // Kendi randevusuyla çakışıyorsa → zaten var, tag'ı sil ve AI yanıtını koru
                if (conflictQuery && conflictQuery.customer_id === customer.id) {
                    console.log(`ℹ️ Aynı müşterinin mevcut randevusu, tag siliniyor: ${apptDate} ${apptTime}`);
                    aiResponse.content = aiResponse.content.replace(/\s*\[RANDEVU:[^\]]+\]/, '').trim();
                } else if (conflictQuery) {
                    console.log(`⚠️ AI randevu çakışması: ${apptDate} ${apptTime}-${endTime} çakışıyor (mevcut: ${conflictQuery.start_time}-${conflictQuery.end_time})`);

                    // O günün müsait saatlerini hesapla
                    const dayAppts = db.prepare(
                        "SELECT start_time, end_time FROM appointments WHERE company_id = ? AND appointment_date = ? AND status NOT IN ('cancelled') ORDER BY start_time"
                    ).all(company_id, apptDate);

                    const availableSlots = [];
                    const workStart = 9 * 60; // 09:00
                    const workEnd = 19 * 60;  // 19:00
                    let cursor = workStart;
                    for (const a of dayAppts) {
                        const [sh, sm] = a.start_time.split(':').map(Number);
                        const [eh, em] = a.end_time.split(':').map(Number);
                        const aStart = sh * 60 + sm;
                        const aEnd = eh * 60 + em;
                        // cursor ile randevu başlangıcı arasında yeterli boşluk var mı?
                        if (aStart - cursor >= dur) {
                            availableSlots.push(`${String(Math.floor(cursor / 60)).padStart(2, '0')}:${String(cursor % 60).padStart(2, '0')}`);
                        }
                        cursor = Math.max(cursor, aEnd);
                    }
                    if (workEnd - cursor >= dur) {
                        availableSlots.push(`${String(Math.floor(cursor / 60)).padStart(2, '0')}:${String(cursor % 60).padStart(2, '0')}`);
                    }

                    const slotsText = availableSlots.length > 0
                        ? `Müsait saatler: ${availableSlots.join(', ')}`
                        : 'Maalesef o gün müsait saat bulunmuyor.';

                    // AI'ın kendi metnini tamamen değiştir — çift mesaj sorunu olmasın
                    aiResponse.content = `Üzgünüm, ${apptTime} saati uygun değil çünkü ${conflictQuery.start_time}-${conflictQuery.end_time} arasında başka bir randevu var.\n\n${slotsText}`;
                } else {
                    // Müşteri adı: AI'ın sohbetten aldığı isim > DB'deki isim > WhatsApp profil adı
                    const apptCustomerName = customerNameFromAI?.trim() || customer.name || customer_name || '';

                    db.pragma('foreign_keys = OFF');
                    db.prepare(`
                        INSERT INTO appointments (company_id, customer_id, conversation_id, customer_name, phone, staff_id, service_id, appointment_date, start_time, end_time, notes, status, source, appointment_time)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', 'ai', ?)
                    `).run(
                        company_id, customer.id, conversation.id,
                        apptCustomerName, apptPhone,
                        stf?.id || null, svc?.id || null,
                        apptDate, apptTime, endTime,
                        serviceName.trim(), `${apptDate} ${apptTime}`
                    );
                    db.pragma('foreign_keys = ON');

                    console.log(`📅 AI randevu oluşturdu: ${apptCustomerName} → ${apptDate} ${apptTime} (${serviceName.trim()}) phone=${apptPhone}`);

                // Randevu onay bildirimi gönder (WhatsApp/SMS)
                console.log(`📢 [WEBHOOK] Randevu bildirimi tetikleniyor: ${apptCustomerName} → ${apptDate} ${apptTime}, phone=${apptPhone}`);
                sendAppointmentNotification(db, company_id, {
                    customer_name: apptCustomerName,
                    customer_id: customer.id,
                    conversation_id: conversation.id,
                    phone: apptPhone,
                    appointment_date: apptDate,
                    start_time: apptTime,
                    end_time: endTime,
                    service_id: svc?.id || null,
                    staff_id: stf?.id || null,
                    notes: serviceName.trim()
                }, 'confirmation', io).catch(err => {
                    console.error('AI randevu bildirim hatası:', err.message);
                });

                // Randevu tag'ını yanıttan temizle
                aiResponse.content = aiResponse.content.replace(/\s*\[RANDEVU:[^\]]+\]/, '').trim();

                // Real-time bildirim
                io.to(`company:${company_id}`).emit('appointment:new', {});
                }
            }
        } catch (apptErr) {
            console.error('AI randevu kayıt hatası:', apptErr.message);
        }

        const aiMsgResult = db.prepare(`
      INSERT INTO messages (company_id, conversation_id, customer_id, content, source, direction, is_ai_generated, ai_model, created_at)
      VALUES (?, ?, ?, ?, ?, 'outbound', 1, ?, ?)
    `).run(company_id, conversation.id, customer.id, aiResponse.content, source, aiResponse.model, new Date().toISOString());

        aiMessage = db.prepare('SELECT * FROM messages WHERE id = ?').get(aiMsgResult.lastInsertRowid);

        // Konuşmayı güncelle
        db.prepare('UPDATE conversations SET last_message_preview = ?, updated_at = ? WHERE id = ? AND company_id = ?')
            .run(aiResponse.content.substring(0, 100), new Date().toISOString(), conversation.id, company_id);

        // Real-time: AI yanıtı bildirimi
        io.to(`company:${company_id}`).emit('message:new', { message: aiMessage, conversation_id: conversation.id });

        // AI yanıtını provider'a göre gönder (Meta veya Unipile)
        try {
            // Unipile chat_id güncelle (varsa)
            if (unipile_chat_id && unipile_chat_id !== customer.unipile_chat_id) {
                db.prepare('UPDATE customers SET unipile_chat_id = ? WHERE id = ?').run(unipile_chat_id, customer.id);
            }
            const sendResult = await sendOutboundMessage(db, {
                companyId: company_id,
                source,
                recipientId: platform_id,
                recipientPhone: customer.phone || platform_id,
                text: aiResponse.content
            });
            if (sendResult.sent) {
                markAsSent(aiResponse.content);
                console.log(`🤖 AI yanıtı gönderildi (${sendResult.provider}): "${aiResponse.content.substring(0, 50)}"`);
            }
        } catch (outboundErr) {
            console.error('AI outbound hatası:', outboundErr.message);
        }

        // 5. Müşteriyi kategorize et
        const allMessages = db.prepare('SELECT * FROM messages WHERE customer_id = ? AND company_id = ? ORDER BY created_at ASC').all(customer.id, company_id);
        const categorization = await aiService.categorizeCustomer(allMessages, customer);

        db.prepare('UPDATE customers SET category = ?, lead_score = ?, updated_at = ? WHERE id = ? AND company_id = ?')
            .run(categorization.category, categorization.lead_score, new Date().toISOString(), customer.id, company_id);

        customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customer.id);
        io.to(`company:${company_id}`).emit('customer:categorized', { customer });

        // Randevu tespiti — regex tabanlı (AI çağrısına bağımlı değil)
        if (allMessages.length >= 2) {
            try {
                const existing = db.prepare('SELECT id FROM appointments WHERE conversation_id = ? AND company_id = ?').get(conversation.id, company_id);
                if (!existing) {
                    const appointment = detectAppointment(allMessages, customer.name);
                    if (appointment) {
                        // appointment_time'dan tarih ve saat parse et
                        let parsedDate = null;
                        let parsedTime = null;
                        let parsedEndTime = null;
                        const timeExtract = appointment.appointment_time?.match(/(\d{1,2}):(\d{2})/);
                        if (timeExtract) {
                            parsedTime = `${timeExtract[1].padStart(2, '0')}:${timeExtract[2]}`;
                        }
                        // Tarih parse: "20 mart" veya "2026-03-20" formatları
                        const dateExtract = appointment.appointment_time?.match(/(\d{1,2})\s*(ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık)/i);
                        if (dateExtract) {
                            const monthMap = { 'ocak': '01', 'şubat': '02', 'mart': '03', 'nisan': '04', 'mayıs': '05', 'haziran': '06', 'temmuz': '07', 'ağustos': '08', 'eylül': '09', 'ekim': '10', 'kasım': '11', 'aralık': '12' };
                            const year = new Date().getFullYear();
                            parsedDate = `${year}-${monthMap[dateExtract[2].toLowerCase()]}-${dateExtract[1].padStart(2, '0')}`;
                        }
                        // Hizmet süresini bul
                        let svcId = null;
                        let stfId = null;
                        if (appointment.notes) {
                            const svc = db.prepare('SELECT id, duration FROM services WHERE company_id = ? AND name LIKE ? AND is_active = 1').get(company_id, `%${appointment.notes}%`);
                            if (svc) {
                                svcId = svc.id;
                                if (parsedTime) {
                                    const [ph, pm] = parsedTime.split(':').map(Number);
                                    const endMin = ph * 60 + pm + (svc.duration || 60);
                                    parsedEndTime = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
                                }
                            }
                        }

                        db.prepare(`
                            INSERT INTO appointments (company_id, customer_id, conversation_id, customer_name, phone, appointment_time, appointment_date, start_time, end_time, service_id, staff_id, notes)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `).run(company_id, customer.id, conversation.id,
                            appointment.customer_name || customer.name,
                            customer.phone || '',
                            appointment.appointment_time,
                            parsedDate, parsedTime, parsedEndTime,
                            svcId, stfId,
                            appointment.notes || null);
                        console.log(`📅 Randevu tespit edildi: ${appointment.customer_name} - ${appointment.appointment_time}`);
                        io.to(`company:${company_id}`).emit('appointment:new', { appointment });

                        // Bildirim gönder (WhatsApp/SMS)
                        if (parsedDate && parsedTime && (customer.phone || phone)) {
                            console.log(`📢 [DETECT] Randevu bildirimi tetikleniyor: ${appointment.customer_name} → ${parsedDate} ${parsedTime}`);
                            sendAppointmentNotification(db, company_id, {
                                customer_name: appointment.customer_name || customer.name,
                                customer_id: customer.id,
                                conversation_id: conversation.id,
                                phone: customer.phone || phone || '',
                                appointment_date: parsedDate,
                                start_time: parsedTime,
                                end_time: parsedEndTime,
                                service_id: svcId,
                                staff_id: stfId,
                                notes: appointment.notes || ''
                            }, 'confirmation', io).catch(err => {
                                console.error('detectAppointment bildirim hatası:', err.message);
                            });
                        }
                    }
                }
            } catch (apptErr) {
                console.error('Randevu tespiti hatası:', apptErr.message);
            }
        }
    }

    return {
        customer,
        conversation,
        inbound_message: inboundMessage,
        ai_message: aiMessage
    };
}

// POST /api/webhooks/unipile/debug — Unipile'dan gelen formatı logla (geçici debug)
router.post('/unipile/debug', (req, res) => {
    console.log('=== UNIPILE DEBUG WEBHOOK ===');
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Body:', JSON.stringify(req.body, null, 2));
    console.log('============================');
    res.status(200).json({ status: 'ok', received: req.body });
});

// POST /api/webhooks/unipile/:companyId — Unipile webhook
router.post('/unipile/:companyId', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const io = req.app.locals.io;
        const companyId = parseInt(req.params.companyId);

        if (!companyId) {
            return res.status(400).json({ error: 'Geçersiz company_id' });
        }

        const body = req.body;

        // Duplicate webhook kontrolü (paylaşımlı dedup — poller ile ortak)
        const msgId = body.message_id;
        if (msgId && isDuplicate(msgId)) {
            return res.status(200).json({ status: 'ok', note: 'duplicate' });
        }

        // Her webhook'u tam logla
        console.log('🔔 Unipile webhook body:', JSON.stringify(body).substring(0, 2000));

        // Unipile webhook formatları
        let senderId, senderName, messageText, provider, chatId;
        let uniMediaUrl = null, uniMediaType = null;

        // Unipile attachments
        if (body.attachments && body.attachments.length > 0) {
            const att = body.attachments[0];
            uniMediaUrl = att.url || att.download_url || att.media_url;
            uniMediaType = (att.type || att.mime_type || '').includes('image') ? 'image'
                : (att.type || att.mime_type || '').includes('video') ? 'video'
                : (att.type || att.mime_type || '').includes('audio') ? 'audio' : 'file';
        }

        if (body.event && body.chat_id) {
            // Format 3 (Gerçek Unipile): { event, account_type, chat_id, attendees, message, sender }
            // sender = mesajı gönderen kişi, attendees = konuşmadaki diğer taraf(lar)
            const sender = body.sender;
            senderId = sender?.attendee_provider_id || sender?.attendee_id
                || body.attendees?.[0]?.attendee_provider_id || body.attendees?.[0]?.attendee_id;
            senderName = sender?.attendee_name
                || body.attendees?.[0]?.attendee_name;

            // message field string veya obje olabilir
            messageText = typeof body.message === 'string'
                ? body.message
                : (body.message?.text || body.message?.body || body.message?.content);
            // Fallback'ler
            if (!messageText) messageText = body.text || body.content;

            provider = (body.account_type || '').toUpperCase();
            chatId = body.chat_id;

            // is_sender: bizim taraftan gönderilen mesaj (telefondan, dış servislerden)
            // Panelden gönderilenleri wasSentByUs ile ayırt ediyoruz
        } else if (body.event && body.data) {
            // Format 1
            senderId = body.data.from_id || body.data.sender_id || body.data.attendee_id;
            senderName = body.data.from_name || body.data.sender_name || body.data.attendee_name;
            messageText = body.data.text || body.data.body || body.data.message;
            provider = (body.data.provider || body.account_type || '').toUpperCase();
            chatId = body.data.chat_id || body.data.conversation_id;
        } else if (body.type && body.payload) {
            // Format 2
            senderId = body.payload.sender?.id || body.payload.from_id;
            senderName = body.payload.sender?.name || body.payload.from_name;
            messageText = body.payload.text || body.payload.body;
            provider = (body.payload.provider || body.account_type || '').toUpperCase();
            chatId = body.payload.chat_id || body.payload.conversation_id;
        } else {
            // Bilinmeyen format — logla ve 200 dön
            console.warn('Unipile bilinmeyen webhook formatı:', JSON.stringify(body).substring(0, 300));
            return res.status(200).json({ status: 'ok', note: 'unknown format' });
        }

        console.log(`🔍 Parsed: senderId=${senderId}, text="${messageText?.substring(0, 50)}", chatId=${chatId}, provider=${provider}`);

        // Grup tespiti
        const isGroup = body.is_group === true || body.chat_type === 'group'
            || (body.attendees && body.attendees.length > 2)
            || body.group_name;

        if (!senderId || !messageText) {
            console.warn(`⚠️ Eksik alan: senderId=${senderId}, messageText=${messageText}`);
            return res.status(200).json({ status: 'ok', note: 'no message content' });
        }

        // "Unipile cannot display" mesajlarını: attachment varsa görseli kaydet, yoksa atla
        if (messageText.includes('Unipile cannot display') || messageText.includes('cannot display this type')) {
            if (uniMediaUrl) {
                messageText = uniMediaType === 'image' ? '📷 Görsel' : uniMediaType === 'video' ? '🎥 Video' : '📎 Dosya';
            } else {
                console.log('⏭ Görüntülenemeyen mesaj tipi, atlanıyor');
                return res.status(200).json({ status: 'ok', note: 'unsupported message type' });
            }
        }

        // Platform belirle (INSTAGRAM veya WHATSAPP)
        const source = provider.includes('WHATSAPP') ? 'whatsapp' : 'instagram';

        // Önce account_id ile doğru şirketi bul (Unipile webhook'ları "All Accounts" olabilir)
        const webhookAccountId = body.account_id;
        let integration;
        if (webhookAccountId) {
            integration = db.prepare(
                "SELECT * FROM integration_settings WHERE unipile_account_id = ? AND provider = 'unipile' AND is_active = 1"
            ).get(webhookAccountId);
        }
        // Fallback: URL'deki companyId ile dene
        if (!integration) {
            integration = db.prepare(
                'SELECT * FROM integration_settings WHERE company_id = ? AND platform = ? AND provider = ? AND is_active = 1'
            ).get(companyId, source, 'unipile');
        }

        if (!integration) {
            console.warn(`Unipile webhook: account_id=${webhookAccountId}, company_id=${companyId} için aktif ${source} entegrasyonu yok`);
            return res.status(200).json({ status: 'ok', note: 'no active integration' });
        }

        // Doğru company_id'yi integration'dan al (URL'deki yerine)
        const actualCompanyId = integration.company_id;

        // Telefon numarasını parse et (attendees veya sender'dan)
        let senderPhone = null;
        if (body.attendees) {
            // attendees[0] genelde karşı taraf (müşteri)
            for (const att of body.attendees) {
                const ph = att.attendee_specifics?.phone_number;
                if (ph) { senderPhone = ph; break; }
            }
        }
        // Sender'ın kendi telefonu da olabilir (ama genelde bizim numara)
        if (!senderPhone && body.sender?.attendee_specifics?.phone_number) {
            // sender bizim hesabımızsa kullanma
            if (!body.is_sender) {
                senderPhone = body.sender.attendee_specifics.phone_number;
            }
        }

        // Grup mesajları: platform_id olarak chat_id kullan, isim olarak grup adı
        const platformId = isGroup ? `group_${chatId}` : senderId;
        const displayName = isGroup
            ? (body.group_name || senderName || 'Grup')
            : senderName;
        const displayText = isGroup
            ? `[${senderName || 'Üye'}]: ${messageText}`
            : messageText;

        if (body.is_sender === true) {
            // Telefondan veya dış servisten gönderilen mesaj
            // Panelden gönderilenleri atla (zaten kayıtlı)
            if (wasSentByUs(messageText)) {
                return res.status(200).json({ status: 'ok', note: 'own panel message' });
            }

            // Müşterinin platform_id'si: attendees'ten al (karşı taraf)
            const recipientId = body.attendees?.[0]?.attendee_provider_id || body.attendees?.[0]?.attendee_id || senderId;

            console.log(`📤 Unipile webhook giden mesaj (${source}, company:${actualCompanyId}): → "${messageText.substring(0, 60)}"`);

            await processOutboundMessage(db, io, {
                company_id: actualCompanyId,
                platform_id: isGroup ? `group_${chatId}` : recipientId,
                content: displayText,
                source,
                customer_name: displayName,
                is_group: isGroup,
            });
        } else {
            // Gelen mesaj
            console.log(`📨 Unipile webhook (${source}${isGroup ? '/grup' : ''}, company:${actualCompanyId}): ${displayName} → "${messageText.substring(0, 60)}" phone:${senderPhone || 'yok'}`);

            await processIncomingMessage(db, io, {
                company_id: actualCompanyId,
                platform_id: platformId,
                content: displayText,
                source,
                customer_name: displayName,
                phone: senderPhone,
                unipile_chat_id: chatId,
                is_group: isGroup,
                media_url: uniMediaUrl,
                media_type: uniMediaType,
            });
        }

        res.status(200).json({ status: 'ok' });
    } catch (err) {
        console.error('Unipile webhook error:', err);
        res.status(500).json({ error: 'Webhook işlenirken hata oluştu' });
    }
});

// Dışarıdan gönderilen mesajları (telefondan, dış servislerden) panele kaydet
async function processOutboundMessage(db, io, data) {
    const { company_id, platform_id, content, source, customer_name, unipile_chat_id, is_group, media_url: rawOutMediaUrl, media_type } = data;
    const now = new Date().toISOString();
    const media_url = rawOutMediaUrl ? await downloadAndSaveMedia(rawOutMediaUrl, media_type) : null;

    if (!platform_id || (!content && !media_url)) return null;

    // Müşteriyi bul
    let customer;
    if (source === 'instagram') {
        customer = db.prepare('SELECT * FROM customers WHERE instagram_id = ? AND company_id = ?').get(platform_id, company_id);
    } else if (source === 'whatsapp') {
        customer = db.prepare('SELECT * FROM customers WHERE whatsapp_id = ? AND company_id = ?').get(platform_id, company_id);
    } else if (source === 'messenger') {
        customer = db.prepare('SELECT * FROM customers WHERE messenger_id = ? AND company_id = ?').get(platform_id, company_id);
    }

    // Müşteri yoksa kaydetme (giden mesaj için yeni müşteri oluşturma mantıksız)
    if (!customer) return null;

    // Duplikasyon: aynı içerik son 60sn içinde zaten kaydedilmiş mi?
    const sixtySecsAgo = new Date(Date.now() - 60 * 1000).toISOString();
    const existingMsg = db.prepare(`
        SELECT id FROM messages
        WHERE customer_id = ? AND company_id = ? AND content = ? AND direction = 'outbound' AND created_at > ?
        LIMIT 1
    `).get(customer.id, company_id, content, sixtySecsAgo);

    if (existingMsg) return null;

    // Konuşmayı bul
    let conversation = db.prepare(
        "SELECT * FROM conversations WHERE customer_id = ? AND company_id = ? AND status != 'closed' ORDER BY updated_at DESC LIMIT 1"
    ).get(customer.id, company_id);

    if (!conversation) {
        // Giden mesaj için yeni konuşma oluştur
        const result = db.prepare(`
            INSERT INTO conversations (company_id, customer_id, status, ai_enabled, last_message_preview, unread_count, created_at, updated_at)
            VALUES (?, ?, 'open', 1, ?, 0, ?, ?)
        `).run(company_id, customer.id, content.substring(0, 100), now, now);
        conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(result.lastInsertRowid);
    } else {
        db.prepare(`
            UPDATE conversations SET last_message_preview = ?, updated_at = ? WHERE id = ? AND company_id = ?
        `).run(content.substring(0, 100), now, conversation.id, company_id);
        conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversation.id);
    }

    // Mesajı outbound olarak kaydet
    const msgResult = db.prepare(`
        INSERT INTO messages (company_id, conversation_id, customer_id, content, source, direction, media_url, media_type, created_at)
        VALUES (?, ?, ?, ?, ?, 'outbound', ?, ?, ?)
    `).run(company_id, conversation.id, customer.id, content || '', source, media_url || null, media_type || null, now);

    const outboundMessage = db.prepare('SELECT * FROM messages WHERE id = ?').get(msgResult.lastInsertRowid);

    console.log(`📤 Dış kaynak giden mesaj kaydedildi (${source}): "${content.substring(0, 60)}"`);

    // Real-time bildirim
    io.to(`company:${company_id}`).emit('message:new', { message: outboundMessage, conversation_id: conversation.id });
    io.to(`company:${company_id}`).emit('conversation:updated', { conversation });

    return { customer, conversation, message: outboundMessage };
}

module.exports = router;
module.exports.processIncomingMessage = processIncomingMessage;
module.exports.processOutboundMessage = processOutboundMessage;
module.exports.detectAppointment = detectAppointment;
