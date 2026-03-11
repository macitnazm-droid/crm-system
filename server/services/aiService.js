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
            const messages = conversationHistory.map(msg => ({
                role: msg.direction === 'inbound' ? 'user' : 'assistant',
                content: msg.content
            }));

            const system = `${systemPrompt}\n\nMüşteri Bilgileri:\n- İsim: ${customerInfo.name || 'Bilinmiyor'}\n- Kaynak: ${customerInfo.source || 'Bilinmiyor'}\n- Kategori: ${customerInfo.category || 'Belirlenmemiş'}\n\nÖNEMLİ: Yanıtlarında kesinlikle markdown formatı kullanma (**, *, #, -, > gibi). Düz metin kullan. Instagram ve WhatsApp'ta markdown görünmez.`;

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
                .filter(m => m.direction === 'inbound')
                .map(m => m.content)
                .join('\n');

            const response = await this.claude.messages.create({
                model: 'claude-sonnet-4-6',
                max_tokens: 200,
                system: 'Müşteri mesajlarını analiz et ve JSON formatında kategorize et. Yanıt sadece JSON olsun.',
                messages: [{
                    role: 'user',
                    content: `Müşteri mesajları:\n${messageTexts}\n\nBu müşteriyi kategorize et. Yanıt formatı (sadece JSON):\n{"category": "hot|warm|cold", "lead_score": 0-100, "reasoning": "kısa açıklama"}`
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

        // Sıcak sinyaller
        if (allText.includes('sipariş') || allText.includes('almak') || allText.includes('satın')) {
            score += 40;
            reasoning = 'Satın alma niyeti var';
        }
        if (allText.includes('hemen') || allText.includes('acil') || allText.includes('bugün')) {
            score += 20;
            reasoning = 'Acil talep';
        }
        if (allText.includes('fiyat') || allText.includes('kaç')) {
            score += 15;
            reasoning = 'Fiyat sorguluyor';
        }
        if (allText.includes('toptan')) {
            score += 25;
            reasoning = 'Toptan satış ilgisi';
        }
        if (allText.includes('indirim') || allText.includes('kampanya')) {
            score += 10;
            reasoning = 'Kampanya ilgisi';
        }

        // Soğuk sinyaller
        if (allText.includes('düşüneceğim') || allText.includes('belki')) {
            score -= 15;
            reasoning = 'Kararsız';
        }
        if (allText.includes('hayır') || allText.includes('istemiyorum')) {
            score -= 30;
            reasoning = 'İlgi yok';
        }

        // Mesaj sayısı
        if (inboundMessages.length > 5) score += 10;
        if (inboundMessages.length > 10) score += 10;

        score = Math.max(0, Math.min(100, score));

        let category = 'cold';
        if (score >= 75) category = 'hot';
        else if (score >= 40) category = 'warm';

        return { category, lead_score: score, reasoning };
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
