const express = require('express');
const { aiService } = require('../services/aiService');

const router = express.Router();

// POST /api/webhooks/instagram — Instagram webhook
router.post('/instagram', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const io = req.app.locals.io;
        const { entry } = req.body;

        if (entry) {
            for (const e of entry) {
                const pageId = e.id;
                // Bu PageID hangi şirkete ait bul
                const integration = db.prepare('SELECT company_id FROM integration_settings WHERE platform = ? AND page_id = ? AND is_active = 1').get('instagram', pageId);

                if (!integration) continue;

                const messaging = e.messaging || e.changes || [];
                for (const event of messaging) {
                    const senderId = event.sender?.id || event.value?.from;
                    const messageText = event.message?.text || event.value?.text;

                    if (senderId && messageText) {
                        await processIncomingMessage(db, io, {
                            company_id: integration.company_id,
                            platform_id: senderId,
                            content: messageText,
                            source: 'instagram'
                        });
                    }
                }
            }
        }

        res.status(200).json({ status: 'ok' });
    } catch (err) {
        console.error('Instagram webhook error:', err);
        res.status(500).json({ error: 'Webhook işlenirken hata oluştu' });
    }
});

// GET /api/webhooks/instagram — Webhook doğrulama
router.get('/instagram', (req, res) => {
    const verifyToken = process.env.INSTAGRAM_VERIFY_TOKEN || 'instagram_webhook_verify_token';
    if (req.query['hub.verify_token'] === verifyToken) {
        res.send(req.query['hub.challenge']);
    } else {
        res.status(403).send('Token geçersiz');
    }
});

// POST /api/webhooks/whatsapp — WhatsApp webhook
router.post('/whatsapp', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const io = req.app.locals.io;
        const { entry } = req.body;

        if (entry) {
            for (const e of entry) {
                const changes = e.changes || [];
                for (const change of changes) {
                    const phoneNumberId = change.value?.metadata?.phone_number_id;
                    const integration = db.prepare('SELECT company_id FROM integration_settings WHERE platform = ? AND phone_number_id = ? AND is_active = 1').get('whatsapp', phoneNumberId);

                    if (!integration) continue;

                    const messages = change.value?.messages || [];
                    for (const msg of messages) {
                        if (msg.type === 'text') {
                            await processIncomingMessage(db, io, {
                                company_id: integration.company_id,
                                platform_id: msg.from,
                                content: msg.text.body,
                                source: 'whatsapp'
                            });
                        }
                    }
                }
            }
        }

        res.status(200).json({ status: 'ok' });
    } catch (err) {
        console.error('WhatsApp webhook error:', err);
        res.status(500).json({ error: 'Webhook işlenirken hata oluştu' });
    }
});

// GET /api/webhooks/whatsapp — Webhook doğrulama
router.get('/whatsapp', (req, res) => {
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'whatsapp_webhook_verify_token';
    if (req.query['hub.verify_token'] === verifyToken) {
        res.send(req.query['hub.challenge']);
    } else {
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
    const { company_id, platform_id, content, source, customer_name, phone, instagram_id, unipile_chat_id } = data;
    const now = new Date().toISOString();

    // 1. Müşteriyi bul veya oluştur
    let customer;
    if (source === 'instagram') {
        customer = db.prepare('SELECT * FROM customers WHERE instagram_id = ? AND company_id = ?').get(platform_id, company_id);
    } else if (source === 'whatsapp') {
        customer = db.prepare('SELECT * FROM customers WHERE whatsapp_id = ? AND company_id = ?').get(platform_id, company_id);
    }

    if (!customer) {
        // Yeni müşteri oluştur
        const result = db.prepare(`
      INSERT INTO customers (company_id, name, phone, instagram_id, whatsapp_id, source, last_message_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
            company_id,
            customer_name || `Müşteri ${platform_id.substring(0, 8)}`,
            phone || null,
            source === 'instagram' ? (instagram_id || platform_id) : null,
            source === 'whatsapp' ? platform_id : null,
            source,
            now, now, now
        );
        customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(result.lastInsertRowid);
    } else {
        db.prepare('UPDATE customers SET last_message_at = ?, updated_at = ? WHERE id = ? AND company_id = ?').run(now, now, customer.id, company_id);
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
    let aiMessage = null;
    if (conversation.ai_enabled) {
        const messages = db.prepare('SELECT * FROM messages WHERE conversation_id = ? AND company_id = ? ORDER BY created_at ASC').all(conversation.id, company_id);
        const prompt = db.prepare('SELECT * FROM ai_prompts WHERE company_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1').get(company_id);
        const systemPrompt = prompt?.system_prompt || 'Sen bir satış asistanısın.';

        const aiResponse = await aiService.generateResponse(messages, systemPrompt, customer);

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

        // Unipile üzerinden AI yanıtını gönder
        try {
            // Her zaman polling'den gelen en güncel chatId'yi kullan
            const chatIdToUse = unipile_chat_id || customer.unipile_chat_id;
            if (unipile_chat_id && unipile_chat_id !== customer.unipile_chat_id) {
                db.prepare('UPDATE customers SET unipile_chat_id = ? WHERE id = ?').run(unipile_chat_id, customer.id);
            }
            const integration = db.prepare(
                "SELECT * FROM integration_settings WHERE company_id = ? AND platform = ? AND provider = 'unipile' AND is_active = 1"
            ).get(company_id, source);
            if (integration && chatIdToUse) {
                const fetch = (await import('node-fetch')).default;
                const dsn = integration.dsn_url.startsWith('http')
                    ? integration.dsn_url.replace(/\/$/, '')
                    : `https://${integration.dsn_url.replace(/\/$/, '')}`;
                const sendRes = await fetch(`${dsn}/api/v1/chats/${chatIdToUse}/messages`, {
                    method: 'POST',
                    headers: { 'X-API-KEY': integration.api_key, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: aiResponse.content })
                });
                if (sendRes.ok) {
                    console.log(`🤖 AI yanıtı Unipile'a gönderildi: "${aiResponse.content.substring(0, 50)}"`);
                } else {
                    console.warn(`Unipile AI outbound hatası: ${sendRes.status}`);
                }
            }
        } catch (unipileErr) {
            console.error('Unipile AI outbound hatası:', unipileErr.message);
        }

        // 5. Müşteriyi kategorize et
        const allMessages = db.prepare('SELECT * FROM messages WHERE customer_id = ? AND company_id = ? ORDER BY created_at ASC').all(customer.id, company_id);
        const categorization = await aiService.categorizeCustomer(allMessages, customer);

        db.prepare('UPDATE customers SET category = ?, lead_score = ?, updated_at = ? WHERE id = ? AND company_id = ?')
            .run(categorization.category, categorization.lead_score, new Date().toISOString(), customer.id, company_id);

        customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customer.id);
        io.to(`company:${company_id}`).emit('customer:categorized', { customer });

        // Randevu tespiti (sadece hot müşteriler)
        if (categorization.category === 'hot') {
            try {
                const existing = db.prepare('SELECT id FROM appointments WHERE conversation_id = ? AND company_id = ?').get(conversation.id, company_id);
                if (!existing) {
                    const appointment = await aiService.extractAppointment(allMessages, customer);
                    if (appointment) {
                        db.prepare(`
                            INSERT INTO appointments (company_id, customer_id, conversation_id, customer_name, phone, appointment_time, notes)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        `).run(company_id, customer.id, conversation.id,
                            appointment.customer_name || customer.name,
                            appointment.phone || customer.phone,
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

        // Her webhook'u tam logla (ilk 800 karakter)
        console.log('🔔 Unipile webhook body:', JSON.stringify(body).substring(0, 800));

        // Unipile webhook formatları
        let senderId, senderName, messageText, provider, chatId;

        if (body.event && body.chat_id) {
            // Format 3 (Gerçek Unipile): { event, account_type, chat_id, attendees, message }
            const attendee = body.attendees?.[0];
            senderId = attendee?.attendee_provider_id || attendee?.attendee_id;
            senderName = attendee?.attendee_name;
            messageText = body.message?.text || body.message?.body || body.message?.content
                || body.text || body.content || body.message_text;
            provider = (body.account_type || '').toUpperCase();
            chatId = body.chat_id;

            // Kendi gönderdiğimiz mesajları işleme (sonsuz döngü önleme)
            if (body.message?.is_sender === true || body.message?.sender === 'me') {
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

        // Entegrasyonun aktif olup olmadığını kontrol et
        const integration = db.prepare(
            'SELECT * FROM integration_settings WHERE company_id = ? AND platform = ? AND provider = ? AND is_active = 1'
        ).get(companyId, source, 'unipile');

        if (!integration) {
            console.warn(`Unipile webhook: company_id=${companyId} için aktif ${source} entegrasyonu yok`);
            return res.status(200).json({ status: 'ok', note: 'no active integration' });
        }

        console.log(`📨 Unipile webhook (${source}): ${senderName || senderId} → "${messageText.substring(0, 60)}"`);

        await processIncomingMessage(db, io, {
            company_id: companyId,
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
