const Anthropic = require('@anthropic-ai/sdk');

class AIService {
    constructor() {
        this.provider = process.env.AI_PROVIDER || 'mock';

        if (this.provider === 'claude' && process.env.CLAUDE_API_KEY) {
            this.claude = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
            console.log('🤖 Claude AI bağlandı');
        } else {
            this.provider = 'mock';
            console.log('🤖 Mock AI modu aktif (API anahtarı yok)');
        }
    }

    async generateResponse(conversationHistory, systemPrompt, customerInfo) {
        if (this.provider === 'claude') {
            return this.generateClaudeResponse(conversationHistory, systemPrompt, customerInfo);
        }
        return this.generateMockResponse(conversationHistory, customerInfo);
    }

    async generateClaudeResponse(conversationHistory, systemPrompt, customerInfo) {
        try {
            const fs = require('fs');
            const path = require('path');
            const messages = conversationHistory.map(msg => {
                const role = msg.direction === 'inbound' ? 'user' : 'assistant';

                // Görsel varsa multimodal mesaj oluştur
                if (msg.media_url && ['image', 'sticker'].includes(msg.media_type) && role === 'user') {
                    const content = [];

                    // Lokal dosya ise base64'e çevir
                    if (msg.media_url.startsWith('/uploads/')) {
                        try {
                            const filePath = path.join(__dirname, '..', msg.media_url);
                            if (fs.existsSync(filePath)) {
                                const fileData = fs.readFileSync(filePath);
                                const base64 = fileData.toString('base64');
                                const ext = path.extname(filePath).toLowerCase();
                                const mediaTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
                                content.push({
                                    type: 'image',
                                    source: { type: 'base64', media_type: mediaTypes[ext] || 'image/jpeg', data: base64 }
                                });
                            }
                        } catch (e) {
                            console.warn('Görsel AI\'ya gönderilemedi:', e.message);
                        }
                    } else if (msg.media_url.startsWith('http')) {
                        // Harici URL ise direkt gönder
                        content.push({
                            type: 'image',
                            source: { type: 'url', url: msg.media_url }
                        });
                    }

                    // Metin varsa ekle
                    if (msg.content && !['📷 Görsel', '📎 Dosya'].includes(msg.content)) {
                        content.push({ type: 'text', text: msg.content });
                    } else {
                        content.push({ type: 'text', text: 'Müşteri bu görseli gönderdi. Görseli analiz et ve buna göre yanıt ver.' });
                    }

                    return { role, content };
                }

                return { role, content: msg.content || '...' };
            });

            const system = `${systemPrompt}\n\nMüşteri Bilgileri:\n- İsim: ${customerInfo.name || 'Bilinmiyor'}\n- Kaynak: ${customerInfo.source || 'Bilinmiyor'}\n- Kategori: ${customerInfo.category || 'Belirlenmemiş'}\n\nÖNEMLİ: Yanıtlarında kesinlikle markdown formatı kullanma (**, *, #, -, > gibi). Düz metin kullan. Instagram ve WhatsApp'ta markdown görünmez.\n\nGÖRSEL ANALİZ: Müşteri görsel gönderdiğinde görseli dikkatlice analiz et. Örneğin nail art görseli ise tasarımı yorumla, ürün görseli ise ürünü tanımla, referans görseli ise benzer hizmet öner. Görsele uygun, doğal ve yardımcı bir yanıt ver.`;

            const response = await this.claude.messages.create({
                model: 'claude-sonnet-4-6',
                max_tokens: 500,
                system: system,
                messages: messages
            });

            return {
                content: response.content[0].text,
                model: 'claude',
                confidence: 0.85
            };
        } catch (err) {
            console.error('Claude API hatası:', err.message);
            return this.generateMockResponse(conversationHistory, customerInfo);
        }
    }

    generateMockResponse(conversationHistory, customerInfo) {
        const lastMessage = conversationHistory[conversationHistory.length - 1];
        const content = lastMessage?.content?.toLowerCase() || '';

        let response = 'Merhaba! Size nasıl yardımcı olabilirim?';

        if (content.includes('fiyat') || content.includes('ücret') || content.includes('kaç')) {
            response = 'Ürünlerimizin fiyatları 499 TL\'den başlamaktadır. Detaylı fiyat bilgisi için satış temsilcimiz size yardımcı olacaktır. Hangi ürünle ilgileniyorsunuz?';
        } else if (content.includes('kargo')) {
            response = '500 TL üzeri siparişlerde kargo ücretsizdir! Altında ise sadece 49 TL kargo ücreti alınmaktadır. Siparişiniz 1-3 iş günü içinde teslim edilir.';
        } else if (content.includes('sipariş') || content.includes('almak')) {
            response = 'Harika! Sipariş vermek istemenize çok sevindim. Size hemen bir satış temsilcisi yönlendiriyorum. Birkaç dakika içinde sizinle iletişime geçecektir.';
        } else if (content.includes('iade') || content.includes('değişim')) {
            response = '14 gün içinde ücretsiz iade ve değişim hakkınız bulunmaktadır. İade işleminiz için lütfen sipariş numaranızı paylaşır mısınız?';
        } else if (content.includes('indirim') || content.includes('kampanya')) {
            response = 'Şu anda harika kampanyalarımız var! Seçili ürünlerde %30\'a varan indirimler devam ediyor. Hangi ürün kategorisine bakıyorsunuz?';
        } else if (content.includes('merhaba') || content.includes('selam')) {
            response = `Merhaba${customerInfo.name ? ' ' + customerInfo.name : ''}! 🙋 Size nasıl yardımcı olabilirim? Ürünlerimiz, fiyatlar veya siparişiniz hakkında bilgi alabilirim.`;
        } else if (content.includes('renk') || content.includes('beden')) {
            response = 'Ürünlerimiz S, M, L, XL ve XXL bedenlerde mevcuttur. Renk seçeneklerimiz: Siyah, Beyaz, Lacivert, Kırmızı ve Haki. Hangi bedeni tercih edersiniz?';
        } else if (content.includes('teşekkür')) {
            response = 'Rica ederim! Başka bir sorunuz olursa her zaman buradayım. İyi günler dilerim! 😊';
        } else if (content.includes('toptan')) {
            response = 'Toptan siparişler için özel fiyatlarımız mevcut! Minimum sipariş adedi ve indirimli fiyatlar hakkında detaylı bilgi için satış temsilcimiz sizinle iletişime geçecektir.';
        }

        return {
            content: response,
            model: 'mock',
            confidence: 0.7
        };
    }

    async categorizeCustomer(messages, customerInfo) {
        if (this.provider === 'claude') {
            return this.categorizeWithClaude(messages, customerInfo);
        }
        return this.categorizeWithRules(messages, customerInfo);
    }

    async categorizeWithClaude(messages, customerInfo) {
        try {
            const messageTexts = messages
                .slice(-20)
                .map(m => `${m.direction === 'inbound' ? 'Müşteri' : 'İşletme'}: ${m.content}`)
                .join('\n');

            const response = await this.claude.messages.create({
                model: 'claude-sonnet-4-6',
                max_tokens: 200,
                system: `Sen bir CRM müşteri sınıflandırma uzmanısın. Konuşma bağlamını analiz ederek müşteriyi kategorize et.

KATEGORİ KURALLARI:
- HOT (70-100 puan): Randevu almak istiyor, müsaitlik soruyor, fiyat sorup devam ediyor, sipariş vermek istiyor, "gelebilir miyim", "ne zaman müsaitsiniz", "rezervasyon", hizmet/ürün almaya kararlı
- WARM (40-69 puan): Fiyat soruyor, bilgi alıyor, ilgi gösteriyor ama henüz karar vermemiş, "düşüneyim" diyor, referans görseli gönderiyor
- COLD (0-39 puan): Sadece selamlaşma, tek mesaj atıp gitmiş, "istemiyorum" demiş, hiç etkileşim yok

ÖNEMLİ: Türkçe konuşma bağlamını iyi anla. "Salı müsait misiniz?" = HOT (randevu almak istiyor). "Fiyat ne?" = WARM. Sadece "merhaba" = COLD.

Yanıt sadece JSON olsun, başka bir şey yazma.`,
                messages: [{
                    role: 'user',
                    content: `Konuşma:\n${messageTexts}\n\nJSON formatında yanıt ver:\n{"category": "hot|warm|cold", "lead_score": 0-100, "reasoning": "kısa açıklama"}`
                }]
            });

            const text = response.content[0].text;
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
        } catch (err) {
            console.error('Kategorize hatası:', err.message);
        }
        return this.categorizeWithRules(messages, customerInfo);
    }

    categorizeWithRules(messages, customerInfo) {
        const inboundMessages = messages.filter(m => m.direction === 'inbound');
        const allText = inboundMessages.map(m => m.content.toLowerCase()).join(' ');

        let score = 30;
        let reasoning = 'Genel ilgi seviyesi';

        // HOT sinyaller — randevu/satın alma niyeti
        if (allText.match(/müsait|randevu|rezervasyon|gelebilir|gelmek ist|ne zaman açık|appointment/)) {
            score += 40;
            reasoning = 'Randevu/ziyaret niyeti var';
        }
        if (allText.includes('sipariş') || allText.includes('almak ist') || allText.includes('satın')) {
            score += 40;
            reasoning = 'Satın alma niyeti var';
        }
        if (allText.match(/hemen|acil|bugün|yarın|bu hafta/)) {
            score += 20;
            reasoning = 'Acil talep';
        }
        if (allText.match(/salı|pazartesi|çarşamba|perşembe|cuma|cumartesi|pazar/)) {
            score += 25;
            reasoning = 'Belirli gün soruyor — randevu niyeti';
        }
        if (allText.match(/saat kaçta|kaça kadar|kaçta açık|çalışma saat/)) {
            score += 20;
            reasoning = 'Çalışma saati soruyor';
        }

        // WARM sinyaller — ilgi var ama karar yok
        if (allText.match(/fiyat|ücret|kaç.*(tl|lira)|ne kadar/)) {
            score += 15;
            reasoning = 'Fiyat sorguluyor';
        }
        if (allText.includes('toptan')) {
            score += 25;
            reasoning = 'Toptan satış ilgisi';
        }
        if (allText.match(/indirim|kampanya|promosyon/)) {
            score += 10;
            reasoning = 'Kampanya ilgisi';
        }
        if (allText.match(/bilgi|detay|nasıl yapılır|hizmet/)) {
            score += 10;
            reasoning = 'Bilgi alıyor';
        }

        // COLD sinyaller
        if (allText.match(/düşüneceğim|belki|bakarız|sonra/)) {
            score -= 15;
            reasoning = 'Kararsız';
        }
        if (allText.match(/hayır|istemiyorum|vazgeçtim|gerek yok/)) {
            score -= 30;
            reasoning = 'İlgi yok';
        }

        // Mesaj sayısı bonusu
        if (inboundMessages.length > 3) score += 10;
        if (inboundMessages.length > 7) score += 10;

        score = Math.max(0, Math.min(100, score));

        let category = 'cold';
        if (score >= 65) category = 'hot';
        else if (score >= 40) category = 'warm';

        return { category, lead_score: score, reasoning };
    }

    async extractCustomerName(messages) {
        const inboundTexts = messages
            .filter(m => m.direction === 'inbound')
            .slice(-10)
            .map(m => m.content);
        const allText = inboundTexts.join(' ');

        // Önce basit regex ile dene (API çağrısı yapmadan)
        // "Ben Ahmet", "Adım Ayşe", "Merhaba ben Mehmet" gibi kalıplar
        const namePatterns = [
            /(?:ben|adım|ismim|benim adım|adım\s+benim)\s+([A-ZÇĞİÖŞÜa-zçğıöşü]{2,}(?:\s+[A-ZÇĞİÖŞÜa-zçğıöşü]{2,})?)/i,
            /(?:merhaba|selam|iyi günler),?\s*ben\s+([A-ZÇĞİÖŞÜa-zçğıöşü]{2,}(?:\s+[A-ZÇĞİÖŞÜa-zçğıöşü]{2,})?)/i,
        ];

        for (const pattern of namePatterns) {
            const match = allText.match(pattern);
            if (match && match[1]) {
                const name = match[1].trim();
                // Tek harfli veya genel kelime değilse kabul et
                if (name.length >= 2 && !['bir', 'bu', 'de', 'da', 'mi', 'ne'].includes(name.toLowerCase())) {
                    console.log(`👤 İsim regex ile bulundu: "${name}"`);
                    return name;
                }
            }
        }

        // Regex bulamadıysa ve Claude varsa AI ile dene
        if (this.provider === 'claude' && inboundTexts.length >= 2) {
            try {
                const response = await this.claude.messages.create({
                    model: 'claude-sonnet-4-6',
                    max_tokens: 50,
                    system: 'Müşteri mesajlarından kişinin gerçek adını çıkar. Sadece JSON yanıt ver. Emin değilsen name: null yaz.',
                    messages: [{
                        role: 'user',
                        content: `Mesajlar:\n${inboundTexts.join('\n')}\n\nJSON: {"name": "isim veya null"}`
                    }]
                });
                const text = response.content[0].text;
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    if (parsed.name && parsed.name !== 'null' && parsed.name.length >= 2) {
                        console.log(`👤 İsim AI ile bulundu: "${parsed.name}"`);
                        return parsed.name;
                    }
                }
            } catch (err) {
                console.warn('AI isim çıkarma hatası:', err.message);
            }
        }

        return null;
    }

    async extractAppointment(messages, customerInfo) {
        if (this.provider !== 'claude') return null;
        try {
            const allText = messages.map(m =>
                `${m.direction === 'inbound' ? 'Müşteri' : 'Asistan'}: ${m.content}`
            ).join('\n');

            const response = await this.claude.messages.create({
                model: 'claude-sonnet-4-6',
                max_tokens: 300,
                system: 'Konuşmadan randevu bilgilerini çıkar. Yanıt sadece JSON olsun.',
                messages: [{
                    role: 'user',
                    content: `Konuşma:\n${allText}\n\nRandevu bilgisi var mı? Format:\n{"has_appointment": true/false, "customer_name": "...", "phone": "...", "appointment_time": "...", "notes": "..."}\nRandevu yoksa: {"has_appointment": false}`
                }]
            });

            const text = response.content[0].text;
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return parsed.has_appointment ? parsed : null;
            }
        } catch (err) {
            console.error('Randevu çıkarma hatası:', err.message);
        }
        return null;
    }
}

// Singleton
const aiService = new AIService();
module.exports = { aiService };
