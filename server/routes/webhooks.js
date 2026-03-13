const express = require('express');
const { aiService } = require('../services/aiService');
const { isDuplicate, markAsSent } = require('../services/messageDedup');
const { sendOutboundMessage } = require('../services/metaService');
const { sendAppointmentNotification } = require('../services/appointmentNotifyService');

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
                const integration = db.prepare(
                    "SELECT * FROM integration_settings WHERE platform = 'instagram' AND provider = 'meta' AND page_id = ? AND is_active = 1"
                ).get(pageId);

                if (!integration) {
                    // Fallback: page_id olmadan Meta provider'lı herhangi bir Instagram entegrasyonu
                    const fallback = db.prepare(
                        "SELECT * FROM integration_settings WHERE platform = 'instagram' AND provider = 'meta' AND is_active = 1 LIMIT 1"
                    ).get();
                    if (!fallback) {
                        console.warn(`Instagram webhook: page_id=${pageId} için aktif Meta entegrasyonu bulunamadı`);
                        continue;
                    }
                    // page_id'yi otomatik kaydet
                    db.prepare('UPDATE integration_settings SET page_id = ? WHERE id = ?').run(pageId, fallback.id);
                    console.log(`📝 page_id=${pageId} otomatik kaydedildi (integration:${fallback.id})`);
                }

                const companyId = (integration || db.prepare("SELECT * FROM integration_settings WHERE platform = 'instagram' AND provider = 'meta' AND is_active = 1 LIMIT 1").get())?.company_id;
                if (!companyId) continue;

                // Instagram Messaging webhook: entry[].messaging[]
                const messaging = e.messaging || [];
                const activeIntegration = integration || db.prepare("SELECT * FROM integration_settings WHERE platform = 'instagram' AND provider = 'meta' AND is_active = 1 LIMIT 1").get();
                for (const event of messaging) {
                    // Echo kontrolü — kendi gönderdiğimiz mesajları atla
                    if (event.message?.is_echo) {
                        console.log('⏭ Instagram echo mesaj, atlanıyor');
                        continue;
                    }

                    const senderId = event.sender?.id;
                    const messageText = event.message?.text;

                    if (senderId && messageText) {
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
                                }
                            } catch (profileErr) {
                                console.warn('IG profil çekme hatası:', profileErr.message);
                            }
                        }

                        console.log(`📨 Meta IG: ${customerName || senderId} → "${messageText.substring(0, 60)}"`);
                        await processIncomingMessage(db, io, {
                            company_id: companyId,
                            platform_id: senderId,
                            content: messageText,
                            source: 'instagram',
                            customer_name: customerName,
                            profile_pic: profilePic,
                            username: username
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

                const integration = db.prepare(
                    "SELECT * FROM integration_settings WHERE platform = 'messenger' AND provider = 'meta' AND page_id = ? AND is_active = 1"
                ).get(pageId);

                if (!integration) {
                    const fallback = db.prepare(
                        "SELECT * FROM integration_settings WHERE platform = 'messenger' AND provider = 'meta' AND is_active = 1 LIMIT 1"
                    ).get();
                    if (!fallback) {
                        console.warn(`Messenger webhook: page_id=${pageId} için aktif entegrasyon bulunamadı`);
                        continue;
                    }
                    if (pageId) {
                        db.prepare('UPDATE integration_settings SET page_id = ? WHERE id = ?').run(pageId, fallback.id);
                    }
                }

                const companyId = (integration || db.prepare("SELECT * FROM integration_settings WHERE platform = 'messenger' AND provider = 'meta' AND is_active = 1 LIMIT 1").get())?.company_id;
                if (!companyId) continue;

                const activeIntegration = integration || db.prepare("SELECT * FROM integration_settings WHERE platform = 'messenger' AND provider = 'meta' AND is_active = 1 LIMIT 1").get();

                const messaging = e.messaging || [];
                for (const event of messaging) {
                    if (event.message?.is_echo) {
                        console.log('⏭ Messenger echo mesaj, atlanıyor');
                        continue;
                    }

                    const senderId = event.sender?.id;
                    const messageText = event.message?.text;

                    if (senderId && messageText) {
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

                        console.log(`📨 Messenger: ${customerName || senderId} → "${messageText.substring(0, 60)}"`);
                        await processIncomingMessage(db, io, {
                            company_id: companyId,
                            platform_id: senderId,
                            content: messageText,
                            source: 'messenger',
                            customer_name: customerName,
                            profile_pic: profilePic
                        });
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
                    const integration = db.prepare(
                        "SELECT * FROM integration_settings WHERE platform = 'whatsapp' AND provider = 'meta' AND phone_number_id = ? AND is_active = 1"
                    ).get(phoneNumberId);

                    if (!integration) {
                        // Fallback
                        const fallback = db.prepare(
                            "SELECT * FROM integration_settings WHERE platform = 'whatsapp' AND provider = 'meta' AND is_active = 1 LIMIT 1"
                        ).get();
                        if (fallback && phoneNumberId) {
                            db.prepare('UPDATE integration_settings SET phone_number_id = ? WHERE id = ?').run(phoneNumberId, fallback.id);
                        }
                        if (!fallback) continue;
                    }

                    const companyId = (integration || db.prepare("SELECT * FROM integration_settings WHERE platform = 'whatsapp' AND provider = 'meta' AND is_active = 1 LIMIT 1").get())?.company_id;
                    if (!companyId) continue;

                    // Statuses — okundu bilgisi vb, mesaj değil
                    // Messages — gerçek gelen mesajlar
                    const messages = change.value?.messages || [];
                    for (const msg of messages) {
                        if (msg.type === 'text' && msg.text?.body) {
                            const senderPhone = msg.from; // Uluslararası format: 905551234567
                            const senderName = change.value?.contacts?.[0]?.profile?.name;
                            console.log(`📨 Meta WA: ${senderName || senderPhone} → "${msg.text.body.substring(0, 60)}"`);
                            await processIncomingMessage(db, io, {
                                company_id: companyId,
                                platform_id: senderPhone,
                                content: msg.text.body,
                                source: 'whatsapp',
                                customer_name: senderName,
                                phone: senderPhone
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

    const { company_id, platform_id, content, source, customer_name, phone, instagram_id, unipile_chat_id, profile_pic, username } = data;
    const now = new Date().toISOString();

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
    INSERT INTO messages (company_id, conversation_id, customer_id, content, source, direction, created_at)
    VALUES (?, ?, ?, ?, ?, 'inbound', ?)
  `).run(company_id, conversation.id, customer.id, content, source, now);

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
    if (conversation.ai_enabled && platformAiEnabled) {
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
                const today = new Date().toISOString().split('T')[0];
                const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

                // Bugün ve yarın için mevcut randevuları al
                const todayAppts = db.prepare(
                    "SELECT start_time, end_time, staff_id, customer_name FROM appointments WHERE company_id = ? AND appointment_date = ? AND status NOT IN ('cancelled') ORDER BY start_time"
                ).all(company_id, today);
                const tomorrowAppts = db.prepare(
                    "SELECT start_time, end_time, staff_id, customer_name FROM appointments WHERE company_id = ? AND appointment_date = ? AND status NOT IN ('cancelled') ORDER BY start_time"
                ).all(company_id, tomorrow);

                let apptContext = '\n\n--- RANDEVU SİSTEMİ BİLGİLERİ ---';
                if (servicesData.length > 0) {
                    apptContext += '\nHizmetler: ' + servicesData.map(s => `${s.name} (${s.duration}dk${s.price > 0 ? ', ' + s.price + '₺' : ''})`).join(', ');
                }
                if (staffData.length > 0) {
                    apptContext += '\nPersonel: ' + staffData.map(s => `${s.name}${s.role ? ' (' + s.role + ')' : ''}`).join(', ');
                }

                apptContext += `\nBugün (${today}) dolu saatler: ` + (todayAppts.length > 0 ? todayAppts.map(a => `${a.start_time}-${a.end_time}`).join(', ') : 'Boş');
                apptContext += `\nYarın (${tomorrow}) dolu saatler: ` + (tomorrowAppts.length > 0 ? tomorrowAppts.map(a => `${a.start_time}-${a.end_time}`).join(', ') : 'Boş');
                apptContext += '\nÇalışma saatleri: 09:00-19:00';
                apptContext += '\n\nMüşteri randevu almak isterse müsait saatleri öner. Müşteri onaylarsa yanıtının sonuna şu formatta ekle: [RANDEVU: tarih=YYYY-MM-DD, saat=HH:MM, hizmet=Hizmet Adı, personel=Personel Adı]';
                apptContext += '\nÖrnek: [RANDEVU: tarih=2026-03-15, saat=14:00, hizmet=Manikür, personel=Büşra]';
                apptContext += '\n--- RANDEVU SİSTEMİ BİLGİLERİ SONU ---';

                systemPrompt += apptContext;
            }
        } catch (e) {
            console.error('Randevu context hatası:', e.message);
        }

        const aiResponse = await aiService.generateResponse(messages, systemPrompt, customer);

        // AI yanıtında randevu talimatı varsa otomatik kaydet
        try {
            const apptMatch = aiResponse.content.match(/\[RANDEVU:\s*tarih=(\d{4}-\d{2}-\d{2}),\s*saat=(\d{2}:\d{2}),\s*hizmet=([^,\]]+)(?:,\s*personel=([^\]]+))?\]/);
            if (apptMatch) {
                const [, apptDate, apptTime, serviceName, staffName] = apptMatch;

                // Hizmeti bul
                const svc = db.prepare('SELECT id, duration FROM services WHERE company_id = ? AND name LIKE ? AND is_active = 1').get(company_id, `%${serviceName.trim()}%`);
                // Personeli bul
                const stf = staffName ? db.prepare('SELECT id FROM staff WHERE company_id = ? AND name LIKE ? AND is_active = 1').get(company_id, `%${staffName.trim()}%`) : null;

                // Bitiş saati hesapla
                const dur = svc?.duration || 60;
                const [h, m] = apptTime.split(':').map(Number);
                const endMin = h * 60 + m + dur;
                const endTime = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;

                db.prepare(`
                    INSERT INTO appointments (company_id, customer_id, conversation_id, customer_name, phone, staff_id, service_id, appointment_date, start_time, end_time, notes, status, source, appointment_time)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', 'ai', ?)
                `).run(
                    company_id, customer.id, conversation.id,
                    customer.name || customer_name || '', customer.phone || phone || '',
                    stf?.id || null, svc?.id || null,
                    apptDate, apptTime, endTime,
                    serviceName.trim(), `${apptDate} ${apptTime}`
                );

                console.log(`📅 AI randevu oluşturdu: ${customer.name} → ${apptDate} ${apptTime} (${serviceName.trim()})`);

                // Randevu onay bildirimi gönder (WhatsApp/SMS)
                sendAppointmentNotification(db, company_id, {
                    customer_name: customer.name || customer_name || '',
                    phone: customer.phone || phone || '',
                    appointment_date: apptDate,
                    start_time: apptTime,
                    end_time: endTime,
                    service_id: svc?.id || null,
                    staff_id: stf?.id || null,
                    notes: serviceName.trim()
                }, 'confirmation').catch(err => {
                    console.error('AI randevu bildirim hatası:', err.message);
                });

                // Randevu tag'ını yanıttan temizle
                aiResponse.content = aiResponse.content.replace(/\s*\[RANDEVU:[^\]]+\]/, '').trim();

                // Real-time bildirim
                io.to(`company:${company_id}`).emit('appointment:new', {});
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
                        db.prepare(`
                            INSERT INTO appointments (company_id, customer_id, conversation_id, customer_name, phone, appointment_time, notes)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        `).run(company_id, customer.id, conversation.id,
                            appointment.customer_name || customer.name,
                            customer.phone || '',
                            appointment.appointment_time,
                            appointment.notes || null);
                        console.log(`📅 Randevu tespit edildi: ${appointment.customer_name} - ${appointment.appointment_time}`);
                        io.to(`company:${company_id}`).emit('appointment:new', { appointment });
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

            // Kendi gönderdiğimiz mesajları işleme (sonsuz döngü önleme)
            // is_sender root seviyede geliyor
            if (body.is_sender === true) {
                console.log('⏭ Kendi mesajımız, atlanıyor');
                return res.status(200).json({ status: 'ok', note: 'own message' });
            }
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

        if (!senderId || !messageText) {
            console.warn(`⚠️ Eksik alan: senderId=${senderId}, messageText=${messageText}`);
            return res.status(200).json({ status: 'ok', note: 'no message content' });
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

        console.log(`📨 Unipile webhook (${source}, company:${actualCompanyId}): ${senderName || senderId} → "${messageText.substring(0, 60)}"`);

        await processIncomingMessage(db, io, {
            company_id: actualCompanyId,
            platform_id: senderId,
            content: messageText,
            source,
            customer_name: senderName,
            unipile_chat_id: chatId,
        });

        res.status(200).json({ status: 'ok' });
    } catch (err) {
        console.error('Unipile webhook error:', err);
        res.status(500).json({ error: 'Webhook işlenirken hata oluştu' });
    }
});

module.exports = router;
module.exports.processIncomingMessage = processIncomingMessage;
module.exports.detectAppointment = detectAppointment;
