const express = require('express');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// GET /api/reports/today
router.get('/today', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const today = new Date().toISOString().split('T')[0];
        const companyId = req.user.company_id;

        const totalMessages = db.prepare(
            "SELECT COUNT(*) as count FROM messages WHERE company_id = ? AND DATE(created_at) = ?"
        ).get(companyId, today)?.count || 0;

        const aiResponses = db.prepare(
            "SELECT COUNT(*) as count FROM messages WHERE company_id = ? AND DATE(created_at) = ? AND is_ai_generated = 1"
        ).get(companyId, today)?.count || 0;

        const manualResponses = db.prepare(
            "SELECT COUNT(*) as count FROM messages WHERE company_id = ? AND DATE(created_at) = ? AND is_manual_override = 1"
        ).get(companyId, today)?.count || 0;

        const inboundMessages = db.prepare(
            "SELECT COUNT(*) as count FROM messages WHERE company_id = ? AND DATE(created_at) = ? AND direction = 'inbound'"
        ).get(companyId, today)?.count || 0;

        const activeConversations = db.prepare(
            "SELECT COUNT(*) as count FROM conversations WHERE company_id = ? AND status = 'open'"
        ).get(companyId)?.count || 0;

        const newCustomers = db.prepare(
            "SELECT COUNT(*) as count FROM customers WHERE company_id = ? AND DATE(created_at) = ?"
        ).get(companyId, today)?.count || 0;

        res.json({
            total_messages: totalMessages,
            ai_responses: aiResponses,
            manual_responses: manualResponses,
            inbound_messages: inboundMessages,
            active_conversations: activeConversations,
            new_customers: newCustomers,
            ai_rate: totalMessages > 0 ? Math.round((aiResponses / Math.max(1, aiResponses + manualResponses)) * 100) : 0
        });
    } catch (err) {
        console.error('Reports today error:', err);
        res.status(500).json({ error: 'Rapor yüklenirken hata oluştu' });
    }
});

// GET /api/reports/categories
router.get('/categories', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;
        const categories = db.prepare(`
      SELECT category, COUNT(*) as count, AVG(lead_score) as avg_score
      FROM customers
      WHERE company_id = ?
      GROUP BY category
    `).all(companyId);

        const result = { hot: 0, warm: 0, cold: 0, unqualified: 0 };
        const scores = { hot: 0, warm: 0, cold: 0, unqualified: 0 };

        for (const c of categories) {
            result[c.category] = c.count;
            scores[c.category] = Math.round(c.avg_score || 0);
        }

        res.json({ categories: result, avg_scores: scores });
    } catch (err) {
        console.error('Reports categories error:', err);
        res.status(500).json({ error: 'Kategori raporu yüklenirken hata oluştu' });
    }
});

// GET /api/reports/agents
router.get('/agents', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;

        const agents = db.prepare(`
      SELECT u.id, u.name, u.avatar_color,
        (SELECT COUNT(*) FROM conversations WHERE assigned_agent_id = u.id AND status = 'open' AND company_id = ?) as active_conversations,
        (SELECT COUNT(*) FROM messages WHERE user_id = u.id AND is_manual_override = 1 AND company_id = ?) as manual_messages,
        (SELECT COUNT(*) FROM conversations WHERE assigned_agent_id = u.id AND company_id = ?) as total_conversations
      FROM users u
      WHERE u.company_id = ? AND u.role IN ('agent', 'admin', 'manager') AND u.is_active = 1
      ORDER BY active_conversations DESC
    `).all(companyId, companyId, companyId, companyId);

        res.json({ agents });
    } catch (err) {
        console.error('Reports agents error:', err);
        res.status(500).json({ error: 'Temsilci raporu yüklenirken hata oluştu' });
    }
});

// GET /api/reports/messages-chart
router.get('/messages-chart', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;

        const data = db.prepare(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as total,
        SUM(CASE WHEN direction = 'inbound' THEN 1 ELSE 0 END) as inbound,
        SUM(CASE WHEN is_ai_generated = 1 THEN 1 ELSE 0 END) as ai,
        SUM(CASE WHEN is_manual_override = 1 THEN 1 ELSE 0 END) as manual
      FROM messages
      WHERE company_id = ? AND created_at >= DATE('now', '-7 days')
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `).all(companyId);

        res.json({ chart_data: data });
    } catch (err) {
        console.error('Messages chart error:', err);
        res.status(500).json({ error: 'Mesaj grafiği yüklenirken hata oluştu' });
    }
});

// GET /api/reports/sources
router.get('/sources', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;

        const sources = db.prepare(`
      SELECT source, COUNT(*) as count
      FROM customers
      WHERE company_id = ?
      GROUP BY source
    `).all(companyId);

        res.json({ sources });
    } catch (err) {
        res.status(500).json({ error: 'Kaynak raporu yüklenirken hata oluştu' });
    }
});

// GET /api/reports/dashboard — Gelişmiş dashboard istatistikleri
router.get('/dashboard', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;
        const today = new Date().toISOString().split('T')[0];

        // Mesaj sayıları
        const msgToday = db.prepare("SELECT COUNT(*) as c FROM messages WHERE company_id = ? AND DATE(created_at) = ?").get(companyId, today)?.c || 0;
        const msgWeek = db.prepare("SELECT COUNT(*) as c FROM messages WHERE company_id = ? AND created_at >= DATE('now', '-7 days')").get(companyId)?.c || 0;
        const msgMonth = db.prepare("SELECT COUNT(*) as c FROM messages WHERE company_id = ? AND created_at >= DATE('now', '-30 days')").get(companyId)?.c || 0;

        // Kanal bazlı müşteri dağılımı
        const channelCustomers = db.prepare('SELECT source, COUNT(*) as count FROM customers WHERE company_id = ? GROUP BY source').all(companyId);

        // Kanal bazlı mesaj dağılımı (son 30 gün)
        const channelMessages = db.prepare("SELECT source, COUNT(*) as count FROM messages WHERE company_id = ? AND created_at >= DATE('now', '-30 days') GROUP BY source").all(companyId);

        // Ortalama yanıt süresi (dk)
        const avgResponseTime = db.prepare(`
            SELECT AVG(response_time) as avg_time FROM (
                SELECT MIN((julianday(o.created_at) - julianday(i.created_at)) * 24 * 60) as response_time
                FROM messages i
                JOIN messages o ON o.conversation_id = i.conversation_id AND o.direction = 'outbound' AND o.created_at > i.created_at AND o.created_at <= datetime(i.created_at, '+24 hours')
                WHERE i.company_id = ? AND i.direction = 'inbound' AND i.created_at >= DATE('now', '-7 days')
                GROUP BY i.id
            )
        `).get(companyId)?.avg_time || 0;

        // Lead dönüşüm
        const totalLeads = db.prepare('SELECT COUNT(*) as c FROM leads WHERE company_id = ?').get(companyId)?.c || 0;
        const convertedLeads = db.prepare("SELECT COUNT(*) as c FROM leads WHERE company_id = ? AND status IN ('appointment', 'converted')").get(companyId)?.c || 0;

        // Müşteri kategorileri
        const categories = db.prepare('SELECT category, COUNT(*) as count FROM customers WHERE company_id = ? GROUP BY category').all(companyId);
        const catMap = { hot: 0, warm: 0, cold: 0, unqualified: 0 };
        categories.forEach(c => { catMap[c.category] = c.count; });

        // Günlük mesaj grafiği (14 gün)
        const dailyChart = db.prepare(`
            SELECT DATE(created_at) as date, COUNT(*) as total,
                SUM(CASE WHEN direction = 'inbound' THEN 1 ELSE 0 END) as inbound,
                SUM(CASE WHEN direction = 'outbound' THEN 1 ELSE 0 END) as outbound,
                SUM(CASE WHEN is_ai_generated = 1 THEN 1 ELSE 0 END) as ai
            FROM messages WHERE company_id = ? AND created_at >= DATE('now', '-14 days')
            GROUP BY DATE(created_at) ORDER BY date ASC
        `).all(companyId);

        const newCustomersWeek = db.prepare("SELECT COUNT(*) as c FROM customers WHERE company_id = ? AND created_at >= DATE('now', '-7 days')").get(companyId)?.c || 0;
        const activeConversations = db.prepare("SELECT COUNT(*) as c FROM conversations WHERE company_id = ? AND status = 'open'").get(companyId)?.c || 0;

        res.json({
            messages: { today: msgToday, week: msgWeek, month: msgMonth },
            channels: { customers: channelCustomers, messages: channelMessages },
            avg_response_time_min: Math.round(avgResponseTime * 10) / 10,
            leads: { total: totalLeads, converted: convertedLeads, conversion_rate: totalLeads > 0 ? Math.round(convertedLeads / totalLeads * 100) : 0 },
            categories: catMap,
            daily_chart: dailyChart,
            new_customers_week: newCustomersWeek,
            active_conversations: activeConversations,
        });
    } catch (err) {
        console.error('Dashboard stats error:', err);
        res.status(500).json({ error: 'Dashboard istatistikleri yüklenirken hata oluştu' });
    }
});

// GET /api/reports/export/customers — Müşteri CSV export
router.get('/export/customers', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;
        const { from, to } = req.query;

        let query = 'SELECT name, phone, email, source, category, lead_score, created_at, last_message_at FROM customers WHERE company_id = ?';
        const params = [companyId];
        if (from) { query += ' AND created_at >= ?'; params.push(from); }
        if (to) { query += ' AND created_at <= ?'; params.push(to + 'T23:59:59'); }
        query += ' ORDER BY created_at DESC';

        const rows = db.prepare(query).all(...params);
        const bom = '\uFEFF';
        const header = 'Ad,Telefon,Email,Kaynak,Kategori,Skor,Oluşturulma,Son Mesaj';
        const csv = rows.map(r =>
            `"${r.name || ''}","${r.phone || ''}","${r.email || ''}","${r.source || ''}","${r.category || ''}",${r.lead_score || 0},"${r.created_at || ''}","${r.last_message_at || ''}"`
        );

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename=musteriler-${today()}.csv`);
        res.send(bom + header + '\n' + csv.join('\n'));
    } catch (err) {
        console.error('Export customers error:', err);
        res.status(500).json({ error: 'Dışa aktarma hatası' });
    }
});

// GET /api/reports/export/leads — Lead CSV export
router.get('/export/leads', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;
        const { from, to } = req.query;

        let query = `SELECT l.name, l.phone, l.email, l.source, l.status, l.form_name, l.ad_name, l.campaign_name, l.notes, l.created_at, u.name as agent_name
            FROM leads l LEFT JOIN users u ON l.assigned_agent_id = u.id WHERE l.company_id = ?`;
        const params = [companyId];
        if (from) { query += ' AND l.created_at >= ?'; params.push(from); }
        if (to) { query += ' AND l.created_at <= ?'; params.push(to + 'T23:59:59'); }
        query += ' ORDER BY l.created_at DESC';

        const rows = db.prepare(query).all(...params);
        const bom = '\uFEFF';
        const header = 'Ad,Telefon,Email,Kaynak,Durum,Form,Reklam,Kampanya,Notlar,Temsilci,Oluşturulma';
        const csv = rows.map(r =>
            `"${r.name || ''}","${r.phone || ''}","${r.email || ''}","${r.source || ''}","${r.status || ''}","${r.form_name || ''}","${r.ad_name || ''}","${r.campaign_name || ''}","${(r.notes || '').replace(/"/g, '""')}","${r.agent_name || ''}","${r.created_at || ''}"`
        );

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename=leadler-${today()}.csv`);
        res.send(bom + header + '\n' + csv.join('\n'));
    } catch (err) {
        console.error('Export leads error:', err);
        res.status(500).json({ error: 'Dışa aktarma hatası' });
    }
});

// GET /api/reports/export/appointments — Randevu CSV export
router.get('/export/appointments', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;
        const { from, to } = req.query;

        let query = `SELECT a.customer_name, a.phone, a.appointment_date, a.start_time, a.end_time, a.status, a.source, a.notes,
            s.name as service_name, st.name as staff_name
            FROM appointments a LEFT JOIN services s ON a.service_id = s.id LEFT JOIN staff st ON a.staff_id = st.id
            WHERE a.company_id = ?`;
        const params = [companyId];
        if (from) { query += ' AND a.appointment_date >= ?'; params.push(from); }
        if (to) { query += ' AND a.appointment_date <= ?'; params.push(to); }
        query += ' ORDER BY a.appointment_date DESC, a.start_time DESC';

        const rows = db.prepare(query).all(...params);
        const bom = '\uFEFF';
        const header = 'Müşteri,Telefon,Tarih,Başlangıç,Bitiş,Durum,Kaynak,Hizmet,Personel,Notlar';
        const statusLabels = { pending: 'Bekliyor', confirmed: 'Onaylı', cancelled: 'İptal', completed: 'Tamamlandı', no_show: 'Gelmedi' };
        const csv = rows.map(r =>
            `"${r.customer_name || ''}","${r.phone || ''}","${r.appointment_date || ''}","${r.start_time || ''}","${r.end_time || ''}","${statusLabels[r.status] || r.status}","${r.source || ''}","${r.service_name || ''}","${r.staff_name || ''}","${(r.notes || '').replace(/"/g, '""')}"`
        );

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename=randevular-${today()}.csv`);
        res.send(bom + header + '\n' + csv.join('\n'));
    } catch (err) {
        console.error('Export appointments error:', err);
        res.status(500).json({ error: 'Dışa aktarma hatası' });
    }
});

function today() { return new Date().toISOString().split('T')[0]; }

module.exports = router;
