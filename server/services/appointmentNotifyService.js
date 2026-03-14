const { sendOutboundMessage } = require('./metaService');

/**
 * Randevu bildirim mesajı formatla
 */
function formatAppointmentMessage(appointment, type = 'confirmation') {
    const { customer_name, appointment_date, start_time, end_time, service_name, staff_name } = appointment;

    // Tarih formatla: 2026-03-15 → 15 Mart 2026
    let dateStr = appointment_date;
    try {
        const d = new Date(appointment_date + 'T00:00:00');
        dateStr = d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch (e) { }

    if (type === 'confirmation') {
        let msg = `Merhaba ${customer_name || 'Değerli Müşterimiz'}, randevunuz onaylanmıştır.\n\n`;
        msg += `📅 Tarih: ${dateStr}\n`;
        msg += `⏰ Saat: ${start_time}`;
        if (end_time) msg += ` - ${end_time}`;
        msg += '\n';
        if (service_name) msg += `💆 Hizmet: ${service_name}\n`;
        if (staff_name) msg += `👤 Personel: ${staff_name}\n`;
        msg += '\nDeğişiklik veya iptal için bize mesaj atabilirsiniz.';
        return msg;
    }

    if (type === 'reminder') {
        let msg = `Hatırlatma: Bugün saat ${start_time} randevunuz bulunmaktadır.\n\n`;
        if (service_name) msg += `💆 Hizmet: ${service_name}\n`;
        if (staff_name) msg += `👤 Personel: ${staff_name}\n`;
        msg += '\nSizi bekliyoruz!';
        return msg;
    }

    return '';
}

/**
 * Randevu bildirimi gönder (WhatsApp/SMS/Instagram — mevcut entegrasyon üzerinden)
 * Toggle bağımsız çalışır — her zaman göndermeyi dener
 */
async function sendAppointmentNotification(db, companyId, appointment, type = 'confirmation') {
    const company = db.prepare(
        'SELECT appointment_whatsapp_notify, appointment_sms_notify, sms_provider, sms_usercode, sms_password, sms_msgheader, appointment_reminder_minutes FROM companies WHERE id = ?'
    ).get(companyId);

    if (!company) {
        console.log(`⚠️ [NOTIFY] Company bulunamadı: ${companyId}`);
        return;
    }

    // Hizmet ve personel adını al
    let serviceName = null;
    let staffName = null;
    if (appointment.service_id) {
        const svc = db.prepare('SELECT name FROM services WHERE id = ?').get(appointment.service_id);
        serviceName = svc?.name;
    }
    if (appointment.staff_id) {
        const stf = db.prepare('SELECT name FROM staff WHERE id = ?').get(appointment.staff_id);
        staffName = stf?.name;
    }

    const msgData = {
        ...appointment,
        service_name: serviceName || appointment.notes || '',
        staff_name: staffName || ''
    };

    const message = formatAppointmentMessage(msgData, type);
    const phone = appointment.phone;
    const results = { whatsapp: null, sms: null };

    console.log(`📢 [NOTIFY] Bildirim başlıyor: type=${type}, phone=${phone}, whatsapp_toggle=${company.appointment_whatsapp_notify}, sms_toggle=${company.appointment_sms_notify}`);

    // 1) WhatsApp bildirimi (toggle açıksa + telefon varsa)
    if (company.appointment_whatsapp_notify && phone) {
        try {
            // Önce whatsapp platform entegrasyonu dene, yoksa Unipile üzerinden gönder
            let result = await sendOutboundMessage(db, {
                companyId,
                source: 'whatsapp',
                recipientId: phone,
                recipientPhone: phone,
                text: message
            });

            // WhatsApp entegrasyonu bulunamadıysa, Unipile varsa onunla dene
            if (!result.sent && result.reason === 'no_integration') {
                console.log(`📱 [NOTIFY] WhatsApp platform entegrasyonu yok, Unipile ile deneniyor...`);
                const unipileInt = db.prepare(
                    "SELECT * FROM integration_settings WHERE company_id = ? AND provider = 'unipile' AND is_active = 1 LIMIT 1"
                ).get(companyId);

                if (unipileInt) {
                    // Unipile üzerinden WhatsApp mesajı gönder
                    const fetch = (await import('node-fetch')).default;
                    const dsn = unipileInt.dsn_url.startsWith('http')
                        ? unipileInt.dsn_url.replace(/\/$/, '')
                        : `https://${unipileInt.dsn_url.replace(/\/$/, '')}`;

                    // Telefon numarasını formatla
                    let formattedPhone = phone.replace(/[\s\-\(\)]/g, '');
                    if (formattedPhone.startsWith('+')) formattedPhone = formattedPhone.substring(1);
                    if (!formattedPhone.startsWith('9') && formattedPhone.startsWith('0')) {
                        formattedPhone = '9' + formattedPhone;
                    }

                    // Unipile: yeni chat başlat veya mevcut chat'e gönder
                    // Önce müşterinin mevcut chat_id'si var mı kontrol et
                    let chatId = null;
                    if (appointment.customer_id) {
                        const cust = db.prepare('SELECT unipile_chat_id FROM customers WHERE id = ?').get(appointment.customer_id);
                        chatId = cust?.unipile_chat_id;
                    }

                    if (chatId) {
                        // Mevcut chat'e mesaj gönder
                        const sendRes = await fetch(`${dsn}/api/v1/chats/${chatId}/messages`, {
                            method: 'POST',
                            headers: { 'X-API-KEY': unipileInt.api_key, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ text: message })
                        });
                        if (sendRes.ok) {
                            result = { sent: true, provider: 'unipile' };
                        } else {
                            const errBody = await sendRes.text();
                            result = { sent: false, reason: `unipile_${sendRes.status}: ${errBody}` };
                        }
                    } else {
                        // Chat ID yok — Unipile ile yeni mesaj göndermeyi dene
                        const sendRes = await fetch(`${dsn}/api/v1/messages`, {
                            method: 'POST',
                            headers: { 'X-API-KEY': unipileInt.api_key, 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                account_id: unipileInt.unipile_account_id,
                                text: message,
                                attendees_ids: [formattedPhone + '@s.whatsapp.net']
                            })
                        });
                        if (sendRes.ok) {
                            result = { sent: true, provider: 'unipile-new' };
                        } else {
                            const errBody = await sendRes.text();
                            result = { sent: false, reason: `unipile_new_${sendRes.status}: ${errBody}` };
                        }
                    }
                }
            }

            results.whatsapp = result;
            console.log(`📱 [NOTIFY] WhatsApp ${result.sent ? '✅ gönderildi' : '❌ gönderilemedi'}: ${appointment.customer_name} (reason: ${result.reason || 'ok'})`);
        } catch (err) {
            console.error('📱 [NOTIFY] WhatsApp hatası:', err.message);
            results.whatsapp = { sent: false, reason: err.message };
        }
    } else {
        console.log(`📱 [NOTIFY] WhatsApp atlandı: toggle=${company.appointment_whatsapp_notify}, phone=${phone || 'yok'}`);
    }

    // 2) SMS bildirimi (toggle açıksa + telefon + SMS ayarları varsa)
    if (company.appointment_sms_notify && phone && company.sms_usercode && company.sms_password) {
        try {
            const smsResult = await sendSMS(company, phone, message);
            results.sms = smsResult;
            console.log(`📩 [NOTIFY] SMS ${smsResult.sent ? '✅ gönderildi' : '❌ gönderilemedi'}: ${appointment.customer_name}`);
        } catch (err) {
            console.error('📩 [NOTIFY] SMS hatası:', err.message);
            results.sms = { sent: false, reason: err.message };
        }
    }

    const anySent = results.whatsapp?.sent || results.sms?.sent;
    console.log(`📢 [NOTIFY] Sonuç: ${anySent ? '✅ En az bir kanal başarılı' : '❌ Hiçbir kanaldan gönderilemedi'}`);

    return results;
}

/**
 * NetGSM SMS gönder
 */
async function sendSMS(company, phone, message) {
    const fetch = (await import('node-fetch')).default;

    // Telefon numarasını formatla (başındaki + veya 0 kaldır)
    let formattedPhone = phone.replace(/[\s\-\(\)]/g, '');
    if (formattedPhone.startsWith('+')) formattedPhone = formattedPhone.substring(1);
    if (formattedPhone.startsWith('0')) formattedPhone = '9' + formattedPhone; // 0532 → 90532 (Türkiye)

    if (company.sms_provider === 'netgsm') {
        const params = new URLSearchParams({
            usercode: company.sms_usercode,
            password: company.sms_password,
            gsmno: formattedPhone,
            message: message,
            msgheader: company.sms_msgheader || 'CRM',
            dil: 'TR'
        });

        const res = await fetch(`https://api.netgsm.com.tr/sms/send/get/?${params.toString()}`);
        const text = await res.text();

        // NetGSM yanıt: "00 XXXXX" başarılı, "20" hata vb.
        if (text.startsWith('00')) {
            return { sent: true, provider: 'netgsm', response: text };
        }
        return { sent: false, provider: 'netgsm', reason: text };
    }

    return { sent: false, reason: 'unknown_sms_provider' };
}

/**
 * Randevu hatırlatma kontrolü (periyodik çağrılır)
 */
function checkReminders(db) {
    try {
        const companies = db.prepare(
            'SELECT id, appointment_whatsapp_notify, appointment_sms_notify, appointment_reminder_minutes FROM companies WHERE is_active = 1'
        ).all();

        for (const company of companies) {
            const reminderMinutes = company.appointment_reminder_minutes || 60;
            const now = new Date();
            const reminderTime = new Date(now.getTime() + reminderMinutes * 60 * 1000);

            const today = now.toISOString().split('T')[0];
            const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            const targetTime = `${String(reminderTime.getHours()).padStart(2, '0')}:${String(reminderTime.getMinutes()).padStart(2, '0')}`;

            // Hatırlatma zamanı gelen randevuları bul (±5 dakika pencere)
            const appointments = db.prepare(`
                SELECT a.*, s.name as service_name, st.name as staff_name
                FROM appointments a
                LEFT JOIN services s ON a.service_id = s.id
                LEFT JOIN staff st ON a.staff_id = st.id
                WHERE a.company_id = ? AND a.appointment_date = ? AND a.status NOT IN ('cancelled', 'completed')
                AND a.reminder_sent = 0 AND a.start_time BETWEEN ? AND ?
            `).all(company.id, today, currentTime, targetTime);

            for (const appt of appointments) {
                sendAppointmentNotification(db, company.id, appt, 'reminder').then(() => {
                    db.prepare('UPDATE appointments SET reminder_sent = 1 WHERE id = ?').run(appt.id);
                }).catch(err => {
                    console.error(`Hatırlatma gönderim hatası (appt:${appt.id}):`, err.message);
                });
            }
        }
    } catch (err) {
        console.error('Hatırlatma kontrol hatası:', err.message);
    }
}

/**
 * Hatırlatma zamanlayıcısını başlat (her 5 dakikada kontrol)
 */
function startReminderScheduler(db) {
    console.log('⏰ Randevu hatırlatma zamanlayıcısı başlatıldı (her 5dk)');
    setInterval(() => checkReminders(db), 5 * 60 * 1000);
    // İlk kontrolü 30 saniye sonra yap
    setTimeout(() => checkReminders(db), 30 * 1000);
}

module.exports = { sendAppointmentNotification, startReminderScheduler, formatAppointmentMessage };
