// Meta Graph API servisi — Instagram & WhatsApp mesaj gönderme

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';

/**
 * Instagram DM gönder (Meta Graph API)
 * @param {string} accessToken - Page Access Token
 * @param {string} recipientId - Instagram Scoped User ID (IGSID)
 * @param {string} text - Mesaj içeriği
 */
async function sendInstagramMessage(accessToken, recipientId, text) {
    const fetch = (await import('node-fetch')).default;
    const url = `${GRAPH_API_BASE}/me/messages`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
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
 * @param {string} accessToken - WhatsApp Access Token
 * @param {string} phoneNumberId - WhatsApp Business Phone Number ID
 * @param {string} recipientPhone - Alıcı telefon numarası (uluslararası format, ör: 905551234567)
 * @param {string} text - Mesaj içeriği
 */
async function sendWhatsAppMessage(accessToken, phoneNumberId, recipientPhone, text) {
    const fetch = (await import('node-fetch')).default;
    const url = `${GRAPH_API_BASE}/${phoneNumberId}/messages`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
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
 * @param {string} accessToken - Page Access Token
 * @param {string} recipientId - Facebook User PSID
 * @param {string} text - Mesaj içeriği
 */
async function sendMessengerMessage(accessToken, recipientId, text) {
    const fetch = (await import('node-fetch')).default;
    const url = `${GRAPH_API_BASE}/me/messages`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
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
 * @param {string} accessToken
 * @returns {{ valid: boolean, message: string, data?: object }}
 */
async function verifyToken(accessToken) {
    const fetch = (await import('node-fetch')).default;
    const res = await fetch(`${GRAPH_API_BASE}/me?fields=id,name`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const data = await res.json();
    if (res.ok && data.id) {
        return { valid: true, message: `Bağlantı başarılı! Sayfa: ${data.name} (${data.id})`, data };
    }
    return { valid: false, message: `Token geçersiz: ${data.error?.message || 'Bilinmeyen hata'}` };
}

/**
 * Provider'a göre mesaj gönder (genel helper)
 * @param {object} db - Veritabanı
 * @param {object} options
 */
async function sendOutboundMessage(db, { companyId, source, recipientId, recipientPhone, text }) {
    const integration = db.prepare(
        'SELECT * FROM integration_settings WHERE company_id = ? AND platform = ? AND is_active = 1'
    ).get(companyId, source);

    if (!integration || !integration.api_key) {
        console.warn(`Outbound mesaj gönderilemedi: ${source} entegrasyonu yok veya aktif değil`);
        return { sent: false, reason: 'no_integration' };
    }

    if (integration.provider === 'meta') {
        try {
            if (source === 'instagram' && recipientId) {
                await sendInstagramMessage(integration.api_key, recipientId, text);
                console.log(`📤 Meta IG mesaj gönderildi: "${text.substring(0, 50)}"`);
                return { sent: true, provider: 'meta' };
            } else if (source === 'whatsapp' && (recipientPhone || recipientId)) {
                await sendWhatsAppMessage(integration.api_key, integration.phone_number_id, recipientPhone || recipientId, text);
                console.log(`📤 Meta WA mesaj gönderildi: "${text.substring(0, 50)}"`);
                return { sent: true, provider: 'meta' };
            } else if (source === 'messenger' && recipientId) {
                await sendMessengerMessage(integration.api_key, recipientId, text);
                console.log(`📤 Meta Messenger mesaj gönderildi: "${text.substring(0, 50)}"`);
                return { sent: true, provider: 'meta' };
            }
            return { sent: false, reason: 'missing_recipient' };
        } catch (err) {
            console.error(`Meta outbound hatası (${source}):`, err.message);
            return { sent: false, reason: err.message };
        }
    } else if (integration.provider === 'unipile') {
        // Unipile outbound — mevcut customer.unipile_chat_id gerekli
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
