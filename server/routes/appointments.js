const express = require('express');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { detectAppointment } = require('./webhooks');
const { sendAppointmentNotification } = require('../services/appointmentNotifyService');

const router = express.Router();

// ==================== RANDEVULAR ====================

// GET /api/appointments — Randevuları listele (tarih filtreli)
router.get('/', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;
        const { date, start_date, end_date, staff_id, status } = req.query;

        let query = `
            SELECT a.*,
                   cu.name as customer_db_name, cu.phone as customer_db_phone, cu.source as customer_source,
                   s.name as staff_name, s.avatar_color as staff_color,
                   sv.name as service_name, sv.duration as service_duration, sv.color as service_color,
                   r.name as room_name
            FROM appointments a
            LEFT JOIN customers cu ON a.customer_id = cu.id
            LEFT JOIN staff s ON a.staff_id = s.id
            LEFT JOIN services sv ON a.service_id = sv.id
            LEFT JOIN rooms r ON a.room_id = r.id
            WHERE a.company_id = ?
        `;
        const params = [companyId];

        if (date) {
            query += ` AND a.appointment_date = ?`;
            params.push(date);
        } else if (start_date && end_date) {
            query += ` AND a.appointment_date BETWEEN ? AND ?`;
            params.push(start_date, end_date);
        }
        if (staff_id) {
            query += ` AND a.staff_id = ?`;
            params.push(staff_id);
        }
        if (status) {
            query += ` AND a.status = ?`;
            params.push(status);
        }

        query += ` ORDER BY a.appointment_date ASC, a.start_time ASC LIMIT 500`;

        const appointments = db.prepare(query).all(...params);
        res.json({ appointments });
    } catch (err) {
        console.error('Appointments list error:', err);
        res.status(500).json({ error: 'Randevular yüklenirken hata oluştu' });
    }
});

// POST /api/appointments — Yeni randevu oluştur
router.post('/', authMiddleware, adminOnly, (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;
        const { customer_name, phone, staff_id, service_id, room_id, appointment_date, start_time, end_time, notes, status, source } = req.body;

        if (!appointment_date || !start_time) {
            return res.status(400).json({ error: 'Tarih ve başlangıç saati zorunlu' });
        }

        // end_time yoksa hizmetten hesapla
        let calcEndTime = end_time;
        if (!calcEndTime && service_id) {
            const service = db.prepare('SELECT duration FROM services WHERE id = ? AND company_id = ?').get(service_id, companyId);
            if (service) {
                const [h, m] = start_time.split(':').map(Number);
                const totalMin = h * 60 + m + service.duration;
                calcEndTime = `${String(Math.floor(totalMin / 60)).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}`;
            }
        }
        if (!calcEndTime) {
            const [h, m] = start_time.split(':').map(Number);
            calcEndTime = `${String(Math.floor((h * 60 + m + 60) / 60)).padStart(2, '0')}:${String((h * 60 + m + 60) % 60).padStart(2, '0')}`;
        }

        // Çakışma kontrolü
        if (staff_id) {
            const conflict = db.prepare(`
                SELECT id FROM appointments
                WHERE company_id = ? AND staff_id = ? AND appointment_date = ?
                AND status NOT IN ('cancelled')
                AND ((start_time < ? AND end_time > ?) OR (start_time < ? AND end_time > ?) OR (start_time >= ? AND end_time <= ?))
            `).get(companyId, staff_id, appointment_date, calcEndTime, start_time, calcEndTime, start_time, start_time, calcEndTime);

            if (conflict) {
                return res.status(409).json({ error: 'Bu personelin seçilen saatte başka bir randevusu var' });
            }
        }

        // Foreign key bozuk referans sorunu (customers_old) — geçici kapat
        db.pragma('foreign_keys = OFF');

        const result = db.prepare(`
            INSERT INTO appointments (company_id, customer_name, phone, staff_id, service_id, room_id,
                appointment_date, start_time, end_time, notes, status, source, appointment_time)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            companyId, customer_name || '', phone || '', staff_id || null, service_id || null, room_id || null,
            appointment_date, start_time, calcEndTime, notes || '', status || 'confirmed', source || 'manual',
            `${appointment_date} ${start_time}`
        );

        db.pragma('foreign_keys = ON');

        const appointment = db.prepare('SELECT * FROM appointments WHERE id = ?').get(result.lastInsertRowid);

        // Real-time bildirim
        const io = req.app.locals.io;
        io.to(`company:${companyId}`).emit('appointment:new', { appointment });

        // Randevu onay bildirimi gönder (WhatsApp/SMS)
        sendAppointmentNotification(db, companyId, appointment, 'confirmation').catch(err => {
            console.error('Randevu bildirim hatası:', err.message);
        });

        res.json({ appointment });
    } catch (err) {
        console.error('Create appointment error:', err.message, err.code);
        res.status(500).json({ error: 'Randevu oluşturulurken hata: ' + err.message });
    }
});

// PATCH /api/appointments/:id — Randevu güncelle
router.patch('/:id', authMiddleware, adminOnly, (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;
        const { customer_name, phone, staff_id, service_id, room_id, appointment_date, start_time, end_time, notes, status } = req.body;

        const updates = [];
        const params = [];

        if (customer_name !== undefined) { updates.push('customer_name = ?'); params.push(customer_name); }
        if (phone !== undefined) { updates.push('phone = ?'); params.push(phone); }
        if (staff_id !== undefined) { updates.push('staff_id = ?'); params.push(staff_id || null); }
        if (service_id !== undefined) { updates.push('service_id = ?'); params.push(service_id || null); }
        if (room_id !== undefined) { updates.push('room_id = ?'); params.push(room_id || null); }
        if (appointment_date !== undefined) { updates.push('appointment_date = ?'); params.push(appointment_date); }
        if (start_time !== undefined) { updates.push('start_time = ?'); params.push(start_time); }
        if (end_time !== undefined) { updates.push('end_time = ?'); params.push(end_time); }
        if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
        if (status !== undefined) { updates.push('status = ?'); params.push(status); }

        if (updates.length === 0) return res.status(400).json({ error: 'Güncellenecek alan yok' });

        params.push(req.params.id, companyId);
        db.prepare(`UPDATE appointments SET ${updates.join(', ')} WHERE id = ? AND company_id = ?`).run(...params);

        const appointment = db.prepare('SELECT * FROM appointments WHERE id = ?').get(req.params.id);
        res.json({ appointment });
    } catch (err) {
        console.error('Update appointment error:', err);
        res.status(500).json({ error: 'Güncelleme hatası' });
    }
});

// PATCH /api/appointments/:id/status — Durum güncelle (herkes yapabilir)
router.patch('/:id/status', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const { status } = req.body;
        if (!['pending', 'confirmed', 'cancelled', 'completed', 'no_show'].includes(status)) {
            return res.status(400).json({ error: 'Geçersiz durum' });
        }
        db.prepare('UPDATE appointments SET status = ? WHERE id = ? AND company_id = ?')
            .run(status, req.params.id, req.user.company_id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Güncelleme hatası' });
    }
});

// DELETE /api/appointments/:id — Randevu sil
router.delete('/:id', authMiddleware, adminOnly, (req, res) => {
    try {
        const db = req.app.locals.db;
        db.prepare('DELETE FROM appointments WHERE id = ? AND company_id = ?')
            .run(req.params.id, req.user.company_id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Silme hatası' });
    }
});

// GET /api/appointments/available-slots — Müsait saatleri getir
router.get('/available-slots', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;
        const { date, staff_id, duration } = req.query;

        if (!date) return res.status(400).json({ error: 'Tarih gerekli' });

        const dur = parseInt(duration) || 60;
        const dayOfWeek = new Date(date).getDay(); // 0=Pazar

        // Çalışma saatlerini al
        let workQuery = 'SELECT * FROM working_hours WHERE company_id = ? AND day_of_week = ? AND is_off = 0';
        const workParams = [companyId, dayOfWeek];
        if (staff_id) {
            workQuery += ' AND (staff_id = ? OR staff_id IS NULL)';
            workParams.push(staff_id);
        }
        const workHours = db.prepare(workQuery).all(...workParams);

        if (workHours.length === 0) {
            return res.json({ slots: [], message: 'Bu gün için çalışma saati tanımlı değil' });
        }

        // En geniş çalışma aralığını bul
        let dayStart = '09:00', dayEnd = '19:00';
        if (workHours.length > 0) {
            dayStart = workHours.reduce((min, wh) => wh.start_time < min ? wh.start_time : min, '23:59');
            dayEnd = workHours.reduce((max, wh) => wh.end_time > max ? wh.end_time : max, '00:00');
        }

        // Mevcut randevuları al
        let apptQuery = 'SELECT start_time, end_time FROM appointments WHERE company_id = ? AND appointment_date = ? AND status NOT IN (\'cancelled\')';
        const apptParams = [companyId, date];
        if (staff_id) {
            apptQuery += ' AND staff_id = ?';
            apptParams.push(staff_id);
        }
        const existing = db.prepare(apptQuery).all(...apptParams);

        // Slot'ları hesapla (30dk aralıklarla)
        const slots = [];
        const [startH, startM] = dayStart.split(':').map(Number);
        const [endH, endM] = dayEnd.split(':').map(Number);
        const startMin = startH * 60 + startM;
        const endMin = endH * 60 + endM;

        for (let t = startMin; t + dur <= endMin; t += 30) {
            const slotStart = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
            const slotEnd = `${String(Math.floor((t + dur) / 60)).padStart(2, '0')}:${String((t + dur) % 60).padStart(2, '0')}`;

            // Çakışma kontrolü
            const hasConflict = existing.some(e =>
                (e.start_time < slotEnd && e.end_time > slotStart)
            );

            slots.push({ start: slotStart, end: slotEnd, available: !hasConflict });
        }

        res.json({ slots });
    } catch (err) {
        console.error('Available slots error:', err);
        res.status(500).json({ error: 'Müsait saatler hesaplanırken hata' });
    }
});

// ==================== HİZMETLER ====================

// GET /api/appointments/services
router.get('/services', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const services = db.prepare('SELECT * FROM services WHERE company_id = ? ORDER BY name').all(req.user.company_id);
        res.json({ services });
    } catch (err) {
        res.status(500).json({ error: 'Hizmetler yüklenirken hata' });
    }
});

// POST /api/appointments/services
router.post('/services', authMiddleware, adminOnly, (req, res) => {
    try {
        const db = req.app.locals.db;
        const { name, duration, price, color } = req.body;
        if (!name) return res.status(400).json({ error: 'Hizmet adı zorunlu' });

        const result = db.prepare('INSERT INTO services (company_id, name, duration, price, color) VALUES (?, ?, ?, ?, ?)')
            .run(req.user.company_id, name, duration || 60, price || 0, color || '#6366f1');
        const service = db.prepare('SELECT * FROM services WHERE id = ?').get(result.lastInsertRowid);
        res.json({ service });
    } catch (err) {
        res.status(500).json({ error: 'Hizmet eklenirken hata' });
    }
});

// PATCH /api/appointments/services/:id
router.patch('/services/:id', authMiddleware, adminOnly, (req, res) => {
    try {
        const db = req.app.locals.db;
        const { name, duration, price, color, is_active } = req.body;
        const updates = [];
        const params = [];
        if (name !== undefined) { updates.push('name = ?'); params.push(name); }
        if (duration !== undefined) { updates.push('duration = ?'); params.push(duration); }
        if (price !== undefined) { updates.push('price = ?'); params.push(price); }
        if (color !== undefined) { updates.push('color = ?'); params.push(color); }
        if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active ? 1 : 0); }
        if (updates.length === 0) return res.status(400).json({ error: 'Güncellenecek alan yok' });
        params.push(req.params.id, req.user.company_id);
        db.prepare(`UPDATE services SET ${updates.join(', ')} WHERE id = ? AND company_id = ?`).run(...params);
        const service = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
        res.json({ service });
    } catch (err) {
        res.status(500).json({ error: 'Güncelleme hatası' });
    }
});

// DELETE /api/appointments/services/:id
router.delete('/services/:id', authMiddleware, adminOnly, (req, res) => {
    try {
        const db = req.app.locals.db;
        db.prepare('DELETE FROM services WHERE id = ? AND company_id = ?').run(req.params.id, req.user.company_id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Silme hatası' });
    }
});

// ==================== PERSONEL ====================

// GET /api/appointments/staff
router.get('/staff', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const staffList = db.prepare('SELECT * FROM staff WHERE company_id = ? ORDER BY name').all(req.user.company_id);
        res.json({ staff: staffList });
    } catch (err) {
        res.status(500).json({ error: 'Personel yüklenirken hata' });
    }
});

// POST /api/appointments/staff
router.post('/staff', authMiddleware, adminOnly, (req, res) => {
    try {
        const db = req.app.locals.db;
        const { name, phone, role, avatar_color } = req.body;
        if (!name) return res.status(400).json({ error: 'Personel adı zorunlu' });

        const result = db.prepare('INSERT INTO staff (company_id, name, phone, role, avatar_color) VALUES (?, ?, ?, ?, ?)')
            .run(req.user.company_id, name, phone || '', role || '', avatar_color || '#6366f1');
        const staff = db.prepare('SELECT * FROM staff WHERE id = ?').get(result.lastInsertRowid);
        res.json({ staff });
    } catch (err) {
        res.status(500).json({ error: 'Personel eklenirken hata' });
    }
});

// PATCH /api/appointments/staff/:id
router.patch('/staff/:id', authMiddleware, adminOnly, (req, res) => {
    try {
        const db = req.app.locals.db;
        const { name, phone, role, avatar_color, is_active } = req.body;
        const updates = [];
        const params = [];
        if (name !== undefined) { updates.push('name = ?'); params.push(name); }
        if (phone !== undefined) { updates.push('phone = ?'); params.push(phone); }
        if (role !== undefined) { updates.push('role = ?'); params.push(role); }
        if (avatar_color !== undefined) { updates.push('avatar_color = ?'); params.push(avatar_color); }
        if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active ? 1 : 0); }
        if (updates.length === 0) return res.status(400).json({ error: 'Güncellenecek alan yok' });
        params.push(req.params.id, req.user.company_id);
        db.prepare(`UPDATE staff SET ${updates.join(', ')} WHERE id = ? AND company_id = ?`).run(...params);
        const staff = db.prepare('SELECT * FROM staff WHERE id = ?').get(req.params.id);
        res.json({ staff });
    } catch (err) {
        res.status(500).json({ error: 'Güncelleme hatası' });
    }
});

// DELETE /api/appointments/staff/:id
router.delete('/staff/:id', authMiddleware, adminOnly, (req, res) => {
    try {
        const db = req.app.locals.db;
        db.prepare('DELETE FROM staff WHERE id = ? AND company_id = ?').run(req.params.id, req.user.company_id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Silme hatası' });
    }
});

// ==================== ODALAR ====================

// GET /api/appointments/rooms
router.get('/rooms', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const rooms = db.prepare('SELECT * FROM rooms WHERE company_id = ? ORDER BY name').all(req.user.company_id);
        res.json({ rooms });
    } catch (err) {
        res.status(500).json({ error: 'Odalar yüklenirken hata' });
    }
});

// POST /api/appointments/rooms
router.post('/rooms', authMiddleware, adminOnly, (req, res) => {
    try {
        const db = req.app.locals.db;
        const { name } = req.body;
        if (!name) return res.status(400).json({ error: 'Oda adı zorunlu' });
        const result = db.prepare('INSERT INTO rooms (company_id, name) VALUES (?, ?)').run(req.user.company_id, name);
        const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(result.lastInsertRowid);
        res.json({ room });
    } catch (err) {
        res.status(500).json({ error: 'Oda eklenirken hata' });
    }
});

// DELETE /api/appointments/rooms/:id
router.delete('/rooms/:id', authMiddleware, adminOnly, (req, res) => {
    try {
        const db = req.app.locals.db;
        db.prepare('DELETE FROM rooms WHERE id = ? AND company_id = ?').run(req.params.id, req.user.company_id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Silme hatası' });
    }
});

// ==================== ÇALIŞMA SAATLERİ ====================

// GET /api/appointments/working-hours
router.get('/working-hours', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const { staff_id } = req.query;
        let query = 'SELECT * FROM working_hours WHERE company_id = ?';
        const params = [req.user.company_id];
        if (staff_id) { query += ' AND staff_id = ?'; params.push(staff_id); }
        const hours = db.prepare(query + ' ORDER BY day_of_week, start_time').all(...params);
        res.json({ working_hours: hours });
    } catch (err) {
        res.status(500).json({ error: 'Çalışma saatleri yüklenirken hata' });
    }
});

// POST /api/appointments/working-hours — Toplu kaydet (haftanın 7 günü)
router.post('/working-hours', authMiddleware, adminOnly, (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;
        const { staff_id, hours } = req.body; // hours: [{ day_of_week, start_time, end_time, is_off }]

        if (!hours || !Array.isArray(hours)) return res.status(400).json({ error: 'Geçersiz veri' });

        // Mevcut kayıtları sil ve yeniden yaz
        if (staff_id) {
            db.prepare('DELETE FROM working_hours WHERE company_id = ? AND staff_id = ?').run(companyId, staff_id);
        } else {
            db.prepare('DELETE FROM working_hours WHERE company_id = ? AND staff_id IS NULL').run(companyId);
        }

        const insert = db.prepare('INSERT INTO working_hours (company_id, staff_id, day_of_week, start_time, end_time, is_off) VALUES (?, ?, ?, ?, ?, ?)');
        for (const h of hours) {
            insert.run(companyId, staff_id || null, h.day_of_week, h.start_time || '09:00', h.end_time || '19:00', h.is_off ? 1 : 0);
        }

        const saved = db.prepare('SELECT * FROM working_hours WHERE company_id = ? AND staff_id ' + (staff_id ? '= ?' : 'IS NULL') + ' ORDER BY day_of_week')
            .all(...(staff_id ? [companyId, staff_id] : [companyId]));
        res.json({ working_hours: saved });
    } catch (err) {
        console.error('Working hours save error:', err);
        res.status(500).json({ error: 'Çalışma saatleri kaydedilirken hata' });
    }
});

// ==================== ESKİ UYUMLULUK ====================

// POST /api/appointments/scan — Mevcut konuşmalardan randevu tara (regex tabanlı)
router.post('/scan', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;

        const conversations = db.prepare(`
            SELECT c.id as conv_id, c.customer_id, cu.name, cu.phone
            FROM conversations c
            JOIN customers cu ON c.customer_id = cu.id
            WHERE c.company_id = ?
            AND c.id NOT IN (SELECT conversation_id FROM appointments WHERE company_id = ? AND conversation_id IS NOT NULL)
            AND (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) >= 2
            ORDER BY c.updated_at DESC
            LIMIT 50
        `).all(companyId, companyId);

        let found = 0;
        for (const conv of conversations) {
            try {
                const messages = db.prepare(
                    'SELECT * FROM messages WHERE conversation_id = ? AND company_id = ? ORDER BY created_at ASC'
                ).all(conv.conv_id, companyId);

                const appointment = detectAppointment(messages, conv.name);

                if (appointment) {
                    db.prepare(`
                        INSERT INTO appointments (company_id, customer_id, conversation_id, customer_name, phone, appointment_time, notes, source)
                        VALUES (?, ?, ?, ?, ?, ?, ?, 'ai_detected')
                    `).run(companyId, conv.customer_id, conv.conv_id,
                        appointment.customer_name || conv.name,
                        conv.phone || '',
                        appointment.appointment_time,
                        appointment.notes || null);
                    found++;
                }
            } catch (err) {
                console.error(`Randevu tarama hatası (conv: ${conv.conv_id}):`, err.message);
            }
        }

        res.json({ scanned: conversations.length, found });
    } catch (err) {
        console.error('Appointment scan error:', err);
        res.status(500).json({ error: 'Tarama hatası: ' + err.message });
    }
});

// ==================== BİLDİRİM AYARLARI ====================

// GET /api/appointments/notification-settings
router.get('/notification-settings', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const settings = db.prepare(
            'SELECT appointment_whatsapp_notify, appointment_sms_notify, sms_provider, sms_usercode, sms_password, sms_msgheader, appointment_reminder_minutes FROM companies WHERE id = ?'
        ).get(req.user.company_id);
        res.json({
            appointment_whatsapp_notify: settings?.appointment_whatsapp_notify || 0,
            appointment_sms_notify: settings?.appointment_sms_notify || 0,
            sms_provider: settings?.sms_provider || 'netgsm',
            sms_usercode: settings?.sms_usercode || '',
            sms_password: settings?.sms_password ? '••••••' : '',
            sms_msgheader: settings?.sms_msgheader || '',
            appointment_reminder_minutes: settings?.appointment_reminder_minutes || 60,
        });
    } catch (err) {
        res.status(500).json({ error: 'Ayarlar yüklenirken hata' });
    }
});

// PATCH /api/appointments/notification-settings
router.patch('/notification-settings', authMiddleware, adminOnly, (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;
        const { appointment_whatsapp_notify, appointment_sms_notify, sms_usercode, sms_password, sms_msgheader, appointment_reminder_minutes } = req.body;

        const updates = [];
        const params = [];

        if (appointment_whatsapp_notify !== undefined) { updates.push('appointment_whatsapp_notify = ?'); params.push(appointment_whatsapp_notify ? 1 : 0); }
        if (appointment_sms_notify !== undefined) { updates.push('appointment_sms_notify = ?'); params.push(appointment_sms_notify ? 1 : 0); }
        if (sms_usercode !== undefined) { updates.push('sms_usercode = ?'); params.push(sms_usercode); }
        if (sms_password !== undefined && sms_password !== '••••••') { updates.push('sms_password = ?'); params.push(sms_password); }
        if (sms_msgheader !== undefined) { updates.push('sms_msgheader = ?'); params.push(sms_msgheader); }
        if (appointment_reminder_minutes !== undefined) { updates.push('appointment_reminder_minutes = ?'); params.push(appointment_reminder_minutes); }

        if (updates.length > 0) {
            params.push(companyId);
            db.prepare(`UPDATE companies SET ${updates.join(', ')} WHERE id = ?`).run(...params);
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Notification settings update error:', err);
        res.status(500).json({ error: 'Ayarlar güncellenirken hata' });
    }
});

module.exports = router;
