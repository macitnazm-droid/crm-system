const { processIncomingMessage } = require('../routes/webhooks');
const { isDuplicate, wasSentByUs } = require('./messageDedup');

// Her entegrasyon için son kontrol zamanını tut
const lastPolledAt = new Map();   // key: `${companyId}_${integId}` -> ISO string

async function startPolling(db, io, intervalMs = 30000) {
    console.log('🔄 Unipile polling başlatıldı (her 30s)');
    await pollAll(db, io);
    setInterval(() => pollAll(db, io), intervalMs);
}

async function pollAll(db, io) {
    let integrations;
    try {
        integrations = db.prepare(
            "SELECT * FROM integration_settings WHERE provider = 'unipile' AND is_active = 1 AND api_key != '' AND dsn_url != '' AND unipile_account_id != ''"
        ).all();
    } catch (err) {
        return;
    }

    for (const integration of integrations) {
        try {
            await pollIntegration(db, io, integration);
        } catch (err) {
            console.error(`Unipile poll hatası (company:${integration.company_id}):`, err.message);
        }
    }
}

async function pollIntegration(db, io, integration) {
    const fetch = (await import('node-fetch')).default;
    const dsn = integration.dsn_url.startsWith('http')
        ? integration.dsn_url.replace(/\/$/, '')
        : `https://${integration.dsn_url.replace(/\/$/, '')}`;

    const key = `${integration.company_id}_${integration.id}`;

    // İlk kez çalışıyorsa son 2 dakikadaki mesajları al (flood önleme)
    if (!lastPolledAt.has(key)) {
        const twoMinsAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
        lastPolledAt.set(key, twoMinsAgo);
    }

    const since = lastPolledAt.get(key);
    const nowIso = new Date().toISOString();

    // Unipile: son konuşmaları getir (account_id ile filtrele)
    const accountFilter = integration.unipile_account_id ? `&account_id=${integration.unipile_account_id}` : '';
    const chatsRes = await fetch(`${dsn}/api/v1/chats?limit=30${accountFilter}`, {
        headers: { 'X-API-KEY': integration.api_key, 'Accept': 'application/json' }
    });

    if (!chatsRes.ok) {
        console.warn(`Unipile chats API hatası: ${chatsRes.status}`);
        return;
    }

    const chatsData = await chatsRes.json();
    const chats = chatsData.items || chatsData.chats || chatsData.object === 'ChatsPage' && chatsData.items || [];

    for (const chat of chats) {
        // Konuşma since'den eski ise atla
        const chatUpdated = chat.updated_at || chat.last_message_at || chat.timestamp;
        if (chatUpdated && chatUpdated < since) continue;

        const chatId = chat.id;
        if (!chatId) continue;

        // Bu konuşmanın mesajlarını getir
        const msgsRes = await fetch(`${dsn}/api/v1/chats/${chatId}/messages?limit=10`, {
            headers: { 'X-API-KEY': integration.api_key, 'Accept': 'application/json' }
        });

        if (!msgsRes.ok) continue;

        const msgsData = await msgsRes.json();
        const messages = msgsData.items || msgsData.messages || [];

        for (const msg of messages) {
            // Zaman filtresi
            const msgTime = msg.timestamp || msg.created_at || msg.date;
            if (msgTime && msgTime < since) continue;

            // Sadece gelen mesajlar (kendi gönderdiğimiz mesajları atla)
            if (msg.is_sender === true || msg.is_sender === 1 || msg.is_sender === 'true') continue;
            // direction field varsa kontrol et
            if (msg.direction === 'outbound' || msg.direction === 'sent') continue;

            // Tekrar işleme (webhook ile paylaşımlı dedup)
            const msgId = msg.id;
            if (isDuplicate(msgId)) continue;

            const senderId = msg.sender_id || msg.from_id || msg.attendee_id
                || chat.attendee_id || chat.from_id;
            const senderName = msg.sender_name || msg.from_name || msg.attendee_name
                || chat.attendee_name || chat.name;
            const text = msg.text || msg.body || msg.content;

            if (!senderId || !text) continue;

            // AI'ın kendi gönderdiği mesajı geri alıyorsak atla
            if (wasSentByUs(text)) {
                console.log(`⏭ Kendi gönderdiğimiz mesaj (poller), atlanıyor: "${text.substring(0, 40)}"`);
                continue;
            }

            const providerRaw = (msg.provider || chat.provider || chat.account_type || integration.platform || '').toUpperCase();
            const source = providerRaw.includes('WHATSAPP') ? 'whatsapp' : 'instagram';

            if (integration.platform !== source) continue;

            console.log(`📨 Unipile yeni mesaj (${source}): ${senderName || senderId} → "${text.substring(0, 60)}"`);

            const result = await processIncomingMessage(db, io, {
                company_id: integration.company_id,
                platform_id: senderId,
                content: text,
                source,
                customer_name: senderName,
                unipile_chat_id: chatId,
            });

            // chat_id'yi müşteri kaydına sakla (outbound için)
            if (result?.customer?.id && chatId) {
                try {
                    db.prepare('UPDATE customers SET unipile_chat_id = ? WHERE id = ? AND (unipile_chat_id IS NULL OR unipile_chat_id = ?)').run(chatId, result.customer.id, '');
                } catch (e) { }
            }
        }
    }

    // Son kontrol zamanını güncelle
    lastPolledAt.set(key, nowIso);

    // Dedup temizliği artık messageDedup modülünde yapılıyor
}

module.exports = { startPolling };
