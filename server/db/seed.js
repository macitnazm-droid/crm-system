const bcrypt = require('bcryptjs');

function seedDatabase(db) {
    console.log('🌱 Demo verileri ekleniyor...');

    // Kullanıcılar
    const passwordHash = bcrypt.hashSync('password123', 10);

    const insertUser = db.prepare(`
    INSERT INTO users (email, password_hash, name, role, avatar_color) VALUES (?, ?, ?, ?, ?)
  `);

    const users = [
        ['admin@crm.com', passwordHash, 'Zeynep Yıldız', 'admin', '#8b5cf6'],
        ['ahmet@crm.com', passwordHash, 'Ahmet Kaya', 'agent', '#06b6d4'],
        ['elif@crm.com', passwordHash, 'Elif Demir', 'agent', '#f43f5e'],
        ['mehmet@crm.com', passwordHash, 'Mehmet Öz', 'manager', '#10b981'],
    ];

    const userIds = [];
    for (const u of users) {
        const result = insertUser.run(...u);
        userIds.push(result.lastInsertRowid);
    }

    // Müşteriler
    const insertCustomer = db.prepare(`
    INSERT INTO customers (name, phone, instagram_id, whatsapp_id, email, category, lead_score, source, last_message_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

    const now = new Date();
    const customers = [
        ['Ayşe Yılmaz', '+905551234567', 'ayse_yilmaz', 'wa_ayse', 'ayse@email.com', 'hot', 85, 'instagram', new Date(now - 1000 * 60 * 5).toISOString()],
        ['Burak Çelik', '+905559876543', 'burak.celik', 'wa_burak', 'burak@email.com', 'warm', 55, 'whatsapp', new Date(now - 1000 * 60 * 30).toISOString()],
        ['Cemre Aydın', '+905555555555', 'cemre_aydin', null, 'cemre@email.com', 'hot', 92, 'instagram', new Date(now - 1000 * 60 * 2).toISOString()],
        ['Deniz Korkmaz', '+905554443322', null, 'wa_deniz', null, 'cold', 20, 'whatsapp', new Date(now - 1000 * 60 * 60 * 3).toISOString()],
        ['Emre Şahin', '+905553332211', 'emre.sahin', 'wa_emre', 'emre@email.com', 'warm', 60, 'instagram', new Date(now - 1000 * 60 * 45).toISOString()],
        ['Fatma Koç', '+905552221100', 'fatma_koc', null, null, 'cold', 15, 'instagram', new Date(now - 1000 * 60 * 60 * 24).toISOString()],
        ['Gökhan Arslan', '+905551110099', null, 'wa_gokhan', 'gokhan@email.com', 'hot', 78, 'whatsapp', new Date(now - 1000 * 60 * 10).toISOString()],
        ['Hülya Tan', '+905550009988', 'hulya.tan', null, 'hulya@email.com', 'warm', 45, 'instagram', new Date(now - 1000 * 60 * 60 * 2).toISOString()],
        ['İbrahim Polat', '+905559998877', 'ibrahim_polat', 'wa_ibrahim', null, 'unqualified', 5, 'whatsapp', new Date(now - 1000 * 60 * 60 * 48).toISOString()],
        ['Jale Erdem', '+905558887766', 'jale.erdem', null, 'jale@email.com', 'warm', 50, 'instagram', new Date(now - 1000 * 60 * 20).toISOString()],
    ];

    const customerIds = [];
    for (const c of customers) {
        const result = insertCustomer.run(...c);
        customerIds.push(result.lastInsertRowid);
    }

    // Konuşmalar
    const insertConv = db.prepare(`
    INSERT INTO conversations (customer_id, assigned_agent_id, status, ai_enabled, last_message_preview, unread_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

    const conversations = [
        [customerIds[0], userIds[1], 'open', 1, 'Fiyatı ne kadar?', 2, new Date(now - 1000 * 60 * 60).toISOString(), new Date(now - 1000 * 60 * 5).toISOString()],
        [customerIds[1], userIds[2], 'open', 1, 'Kargo ücreti var mı?', 1, new Date(now - 1000 * 60 * 120).toISOString(), new Date(now - 1000 * 60 * 30).toISOString()],
        [customerIds[2], userIds[1], 'open', 0, 'Hemen sipariş vermek istiyorum', 3, new Date(now - 1000 * 60 * 30).toISOString(), new Date(now - 1000 * 60 * 2).toISOString()],
        [customerIds[3], null, 'open', 1, 'Merhaba', 0, new Date(now - 1000 * 60 * 60 * 5).toISOString(), new Date(now - 1000 * 60 * 60 * 3).toISOString()],
        [customerIds[4], userIds[1], 'open', 1, 'Renk seçenekleri neler?', 1, new Date(now - 1000 * 60 * 90).toISOString(), new Date(now - 1000 * 60 * 45).toISOString()],
        [customerIds[5], null, 'closed', 1, 'Teşekkürler, düşüneceğim', 0, new Date(now - 1000 * 60 * 60 * 48).toISOString(), new Date(now - 1000 * 60 * 60 * 24).toISOString()],
        [customerIds[6], userIds[2], 'open', 1, 'Toptan fiyat alabilir miyim?', 2, new Date(now - 1000 * 60 * 60 * 2).toISOString(), new Date(now - 1000 * 60 * 10).toISOString()],
        [customerIds[7], null, 'paused', 0, 'İndirim var mı?', 0, new Date(now - 1000 * 60 * 60 * 6).toISOString(), new Date(now - 1000 * 60 * 60 * 2).toISOString()],
        [customerIds[8], null, 'closed', 1, 'Hayır teşekkürler', 0, new Date(now - 1000 * 60 * 60 * 72).toISOString(), new Date(now - 1000 * 60 * 60 * 48).toISOString()],
        [customerIds[9], userIds[1], 'open', 1, 'Beden tablosu var mı?', 1, new Date(now - 1000 * 60 * 40).toISOString(), new Date(now - 1000 * 60 * 20).toISOString()],
    ];

    const convIds = [];
    for (const c of conversations) {
        const result = insertConv.run(...c);
        convIds.push(result.lastInsertRowid);
    }

    // Mesajlar
    const insertMsg = db.prepare(`
    INSERT INTO messages (conversation_id, customer_id, user_id, content, source, direction, is_ai_generated, ai_model, is_manual_override, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

    // Konuşma 1: Ayşe - Fiyat sorusu
    const c1 = convIds[0], cu1 = customerIds[0];
    insertMsg.run(c1, cu1, null, 'Merhaba, ürünleriniz hakkında bilgi alabilir miyim?', 'instagram', 'inbound', 0, null, 0, new Date(now - 1000 * 60 * 55).toISOString());
    insertMsg.run(c1, cu1, null, 'Merhaba! Tabii ki, size yardımcı olmaktan mutluluk duyarım. Hangi ürünümüzle ilgileniyorsunuz?', 'instagram', 'outbound', 1, 'claude', 0, new Date(now - 1000 * 60 * 54).toISOString());
    insertMsg.run(c1, cu1, null, 'X modeli var mı? Fiyatı ne kadar?', 'instagram', 'inbound', 0, null, 0, new Date(now - 1000 * 60 * 50).toISOString());
    insertMsg.run(c1, cu1, null, 'X modeli mevcut! Fiyatlarımız 999 TL\'den başlıyor. Detaylı bilgi için satış temsilcimiz size yardımcı olacaktır.', 'instagram', 'outbound', 1, 'claude', 0, new Date(now - 1000 * 60 * 49).toISOString());
    insertMsg.run(c1, cu1, null, 'Fiyatı ne kadar?', 'instagram', 'inbound', 0, null, 0, new Date(now - 1000 * 60 * 5).toISOString());

    // Konuşma 2: Burak - Kargo
    const c2 = convIds[1], cu2 = customerIds[1];
    insertMsg.run(c2, cu2, null, 'Selam, kargo ücretsiz mi?', 'whatsapp', 'inbound', 0, null, 0, new Date(now - 1000 * 60 * 60).toISOString());
    insertMsg.run(c2, cu2, null, 'Merhaba! 500 TL üzeri siparişlerde kargo ücretsizdir. Altında ise kargo ücreti 49 TL\'dir.', 'whatsapp', 'outbound', 1, 'claude', 0, new Date(now - 1000 * 60 * 59).toISOString());
    insertMsg.run(c2, cu2, null, 'Kargo ücreti var mı?', 'whatsapp', 'inbound', 0, null, 0, new Date(now - 1000 * 60 * 30).toISOString());

    // Konuşma 3: Cemre - Sipariş (AI kapalı, agent manual)
    const c3 = convIds[2], cu3 = customerIds[2];
    insertMsg.run(c3, cu3, null, 'Merhaba! XL beden siyah model istiyorum', 'instagram', 'inbound', 0, null, 0, new Date(now - 1000 * 60 * 25).toISOString());
    insertMsg.run(c3, cu3, null, 'Harika seçim! Bu ürün şu anda stoklarımızda mevcut. Size yardımcı olabilecek bir temsilciye bağlanıyorum.', 'instagram', 'outbound', 1, 'claude', 0, new Date(now - 1000 * 60 * 24).toISOString());
    insertMsg.run(c3, cu3, userIds[1], 'Merhaba Cemre! Ben Ahmet, siparişinizle ilgileniyorum. XL beden siyah model 1.299 TL. Onaylıyor musunuz?', 'instagram', 'outbound', 0, null, 1, new Date(now - 1000 * 60 * 20).toISOString());
    insertMsg.run(c3, cu3, null, 'Evet onaylıyorum! Nasıl ödeme yapacağım?', 'instagram', 'inbound', 0, null, 0, new Date(now - 1000 * 60 * 15).toISOString());
    insertMsg.run(c3, cu3, userIds[1], 'Harika! Size ödeme linkini şimdi gönderiyorum. Kredi kartı veya havale ile ödeyebilirsiniz.', 'instagram', 'outbound', 0, null, 1, new Date(now - 1000 * 60 * 10).toISOString());
    insertMsg.run(c3, cu3, null, 'Hemen sipariş vermek istiyorum', 'instagram', 'inbound', 0, null, 0, new Date(now - 1000 * 60 * 2).toISOString());

    // Konuşma 7: Gökhan - Toptan
    const c7 = convIds[6], cu7 = customerIds[6];
    insertMsg.run(c7, cu7, null, 'Toptan sipariş vermek istiyorum, 50+ adet', 'whatsapp', 'inbound', 0, null, 0, new Date(now - 1000 * 60 * 30).toISOString());
    insertMsg.run(c7, cu7, null, 'Merhaba! Toptan siparişler için ekibimiz size özel fiyat teklifi hazırlayabilir. Bir temsilcimiz en kısa sürede sizinle iletişime geçecektir.', 'whatsapp', 'outbound', 1, 'claude', 0, new Date(now - 1000 * 60 * 29).toISOString());
    insertMsg.run(c7, cu7, null, 'Toptan fiyat alabilir miyim?', 'whatsapp', 'inbound', 0, null, 0, new Date(now - 1000 * 60 * 10).toISOString());

    console.log('✅ Demo verileri eklendi!');
    console.log('   📧 Admin: admin@crm.com / password123');
    console.log('   📧 Agent: ahmet@crm.com / password123');
    console.log('   📧 Agent: elif@crm.com / password123');
    console.log('   📧 Manager: mehmet@crm.com / password123');
}

module.exports = { seedDatabase };
