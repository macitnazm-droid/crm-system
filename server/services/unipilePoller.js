const { processIncomingMessage } = require('../routes/webhooks');

// Her entegrasyon için son kontrol zamanını ve işlenmiş mesaj ID'lerini tut
const lastPolledAt = new Map();   // key: `${companyId}_${integId}` -> ISO string
const processedMsgIds = new Set(); // Tekrar işlemeyi önle

async function startPolling(db, io, intervalMs = 30000) {
    console.log('🔄 Unipile polling başlatıldı (her 30s)');
    await pollAll(db, io);
    setInterval(() => pollAll(db, io), intervalMs);
}

async function pollAll(db, io) {
    let integrations;
    try {
        integrations = db.prepare(
            "SELECT * FROM integration_settings WHERE provider = 'unipile' AND is_active = 1 AND api_key != '' AND dsn_url != ''"
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

    // Unipile: son konuşmaları getir
    const chatsRes = await fetch(`${dsn}/api/v1/chats?limit=30`, {
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

            // Sadece gelen mesajlar
            if (msg.is_sender === true || msg.is_sender === 1) continue;

            // Tekrar işleme
            const msgId = msg.id;
            if (msgId && processedMsgIds.has(msgId)) continue;
            if (msgId) processedMsgIds.add(msgId);

            const senderId = msg.sender_id || msg.from_id || msg.attendee_id
                || chat.attendee_id || chat.from_id;
            const senderName = msg.sender_name || msg.from_name || msg.attendee_name
                || chat.attendee_name || chat.name;
            const text = msg.text || msg.body || msg.content;

            if (!senderId || !text) continue;

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

    // processedMsgIds çok büyümesin (son 5000 ID tut)
    if (processedMsgIds.size > 5000) {
        const arr = [...processedMsgIds];
        arr.slice(0, 1000).forEach(id => processedMsgIds.delete(id));
    }
}

module.exports = { startPolling };
