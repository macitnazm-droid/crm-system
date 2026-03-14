// Meta Graph API servisi — Instagram & WhatsApp mesaj gönderme

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';

// Page Token cache — system user token'dan page token'ları çeker ve cache'ler
const pageTokenCache = new Map();

/**
 * System User Token'dan Page Access Token al
 * me/accounts çağrısı her sayfa için page token döner
 * Bu page token ile me/messages çalışır
 */
async function getPageToken(accessToken) {
    if (pageTokenCache.has(accessToken)) return pageTokenCache.get(accessToken);
    try {
        const fetch = (await import('node-fetch')).default;
        const res = await fetch(`${GRAPH_API_BASE}/me/accounts?access_token=${accessToken}&fields=id,name,access_token`);
        const data = await res.json();
        if (data.data && data.data.length > 0) {
            const page = data.data[0];
            const pageToken = page.access_token;
            if (pageToken && pageToken !== accessToken) {
                pageTokenCache.set(accessToken, pageToken);
                console.log(`🔑 Page Token alındı: ${page.name} (${page.id})`);
                return pageToken;
            }
        }
    } catch (err) {
        console.error('Page Token alınamadı:', err.message);
    }
    // Fallback: token zaten page token olabilir
    return accessToken;
}

/**
 * Instagram DM gönder (Meta Graph API)
 */
async function sendInstagramMessage(accessToken, recipientId, text) {
    const fetch = (await import('node-fetch')).default;
    const token = await getPageToken(accessToken);
    const url = `${GRAPH_API_BASE}/me/messages?access_token=${token}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            recipient: { id: recipientId },
            message: { text }
        })
    });
    const data = await res.json();
    if (!res.ok) {
        throw new Error(`Meta IG API hatası: ${res.status} - ${JSON.stringify(data.error || data)}`);
    }
    return data;
}

/**
 * WhatsApp mesaj gönder (Meta Cloud API)
 */
async function sendWhatsAppMessage(accessToken, phoneNumberId, recipientPhone, text) {
    const fetch = (await import('node-fetch')).default;
    const url = `${GRAPH_API_BASE}/${phoneNumberId}/messages?access_token=${accessToken}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: recipientPhone,
            type: 'text',
            text: { body: text }
        })
    });
    const data = await res.json();
    if (!res.ok) {
        throw new Error(`Meta WA API hatası: ${res.status} - ${JSON.stringify(data.error || data)}`);
    }
    return data;
}

/**
 * Messenger mesaj gönder (Meta Graph API)
 */
async function sendMessengerMessage(accessToken, recipientId, text) {
    const fetch = (await import('node-fetch')).default;
    const token = await getPageToken(accessToken);
    const url = `${GRAPH_API_BASE}/me/messages?access_token=${token}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            recipient: { id: recipientId },
            message: { text }
        })
    });
    const data = await res.json();
    if (!res.ok) {
        throw new Error(`Meta Messenger API hatası: ${res.status} - ${JSON.stringify(data.error || data)}`);
    }
    return data;
}

/**
 * Meta Access Token doğrulama
 */
async function verifyToken(accessToken) {
    const fetch = (await import('node-fetch')).default;
    // Önce me/accounts dene (System User Token)
    const accountsRes = await fetch(`${GRAPH_API_BASE}/me/accounts?fields=id,name&access_token=${accessToken}`);
    const accountsData = await accountsRes.json();
    if (accountsData.data && accountsData.data.length > 0) {
        const page = accountsData.data[0];
        return { valid: true, message: `Bağlantı başarılı! Sayfa: ${page.name} (${page.id})`, data: page };
    }
    // Fallback: me dene (Page Token)
    const res = await fetch(`${GRAPH_API_BASE}/me?fields=id,name&access_token=${accessToken}`);
    const data = await res.json();
    if (res.ok && data.id) {
        return { valid: true, message: `Bağlantı başarılı! Sayfa: ${data.name} (${data.id})`, data };
    }
    return { valid: false, message: `Token geçersiz: ${data.error?.message || 'Bilinmeyen hata'}` };
}

/**
 * Instagram/Messenger'a görsel gönder
 */
async function sendImageMessage(accessToken, recipientId, imageUrl, platform = 'instagram') {
    const fetch = (await import('node-fetch')).default;
    const token = await getPageToken(accessToken);
    const url = `${GRAPH_API_BASE}/me/messages?access_token=${token}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            recipient: { id: recipientId },
            message: {
                attachment: {
                    type: 'image',
                    payload: { url: imageUrl, is_reusable: true }
                }
            }
        })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Meta ${platform} image API hatası: ${res.status} - ${JSON.stringify(data.error || data)}`);
    return data;
}

/**
 * WhatsApp'a görsel gönder
 */
async function sendWhatsAppImage(accessToken, phoneNumberId, recipientPhone, imageUrl, caption) {
    const fetch = (await import('node-fetch')).default;
    const url = `${GRAPH_API_BASE}/${phoneNumberId}/messages?access_token=${accessToken}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: recipientPhone,
            type: 'image',
            image: { link: imageUrl, caption: caption || '' }
        })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Meta WA image API hatası: ${res.status} - ${JSON.stringify(data.error || data)}`);
    return data;
}

async function sendOutboundMessage(db, { companyId, source, recipientId, recipientPhone, text, mediaUrl, mediaType }) {
    // Birden fazla provider olabilir — öncelik: whatsapp-web > unipile > meta
    const integrations = db.prepare(
        'SELECT * FROM integration_settings WHERE company_id = ? AND platform = ? AND is_active = 1 ORDER BY id DESC'
    ).all(companyId, source);

    const integration = integrations.find(i => i.provider === 'whatsapp-web')
        || integrations.find(i => i.provider === 'unipile')
        || integrations.find(i => i.provider === 'meta')
        || null;

    if (!integration) {
        console.warn(`Outbound mesaj gönderilemedi: ${source} entegrasyonu yok veya aktif değil`);
        return { sent: false, reason: 'no_integration' };
    }

    // WhatsApp Web.js provider
    if (integration.provider === 'whatsapp-web') {
        try {
            const { sendMessage } = require('./whatsappWebService');
            const phone = recipientPhone || recipientId;
            if (!phone) return { sent: false, reason: 'missing_phone' };
            return await sendMessage(companyId, phone, text);
        } catch (err) {
            console.error('WhatsApp Web outbound hatası:', err.message);
            return { sent: false, reason: err.message };
        }
    }

    if (integration.provider === 'meta') {
        try {
            if (source === 'instagram' && recipientId) {
                if (mediaUrl && mediaType === 'image') {
                    await sendImageMessage(integration.api_key, recipientId, mediaUrl, 'instagram');
                    if (text) await sendInstagramMessage(integration.api_key, recipientId, text);
                } else {
                    await sendInstagramMessage(integration.api_key, recipientId, text);
                }
                console.log(`📤 Meta IG mesaj gönderildi: "${(text || '📷').substring(0, 50)}"`);
                return { sent: true, provider: 'meta' };
            } else if (source === 'whatsapp' && (recipientPhone || recipientId)) {
                if (mediaUrl && mediaType === 'image') {
                    await sendWhatsAppImage(integration.api_key, integration.phone_number_id, recipientPhone || recipientId, mediaUrl, text);
                } else {
                    await sendWhatsAppMessage(integration.api_key, integration.phone_number_id, recipientPhone || recipientId, text);
                }
                console.log(`📤 Meta WA mesaj gönderildi: "${(text || '📷').substring(0, 50)}"`);
                return { sent: true, provider: 'meta' };
            } else if (source === 'messenger' && recipientId) {
                if (mediaUrl && mediaType === 'image') {
                    await sendImageMessage(integration.api_key, recipientId, mediaUrl, 'messenger');
                    if (text) await sendMessengerMessage(integration.api_key, recipientId, text);
                } else {
                    await sendMessengerMessage(integration.api_key, recipientId, text);
                }
                console.log(`📤 Meta Messenger mesaj gönderildi: "${(text || '📷').substring(0, 50)}"`);
                return { sent: true, provider: 'meta' };
            }
            return { sent: false, reason: 'missing_recipient' };
        } catch (err) {
            console.error(`Meta outbound hatası (${source}):`, err.message);
            return { sent: false, reason: err.message };
        }
    } else if (integration.provider === 'unipile') {
        try {
            const customer = recipientId
                ? db.prepare(`SELECT * FROM customers WHERE (instagram_id = ? OR whatsapp_id = ?) AND company_id = ?`).get(recipientId, recipientId, companyId)
                : null;
            const chatId = customer?.unipile_chat_id;
            if (!chatId) {
                return { sent: false, reason: 'no_unipile_chat_id' };
            }
            const fetch = (await import('node-fetch')).default;
            const dsn = integration.dsn_url.startsWith('http')
                ? integration.dsn_url.replace(/\/$/, '')
                : `https://${integration.dsn_url.replace(/\/$/, '')}`;
            const sendRes = await fetch(`${dsn}/api/v1/chats/${chatId}/messages`, {
                method: 'POST',
                headers: { 'X-API-KEY': integration.api_key, 'Content-Type': 'application/json' },
                body: JSON.stringify({ text })
            });
            if (sendRes.ok) {
                console.log(`📤 Unipile mesaj gönderildi: "${text.substring(0, 50)}"`);
                return { sent: true, provider: 'unipile' };
            }
            console.warn(`Unipile outbound hatası: ${sendRes.status}`);
            return { sent: false, reason: `unipile_${sendRes.status}` };
        } catch (err) {
            console.error(`Unipile outbound hatası:`, err.message);
            return { sent: false, reason: err.message };
        }
    }

    return { sent: false, reason: 'unknown_provider' };
}

module.exports = { sendInstagramMessage, sendWhatsAppMessage, sendMessengerMessage, verifyToken, sendOutboundMessage };
