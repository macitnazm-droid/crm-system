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

module.exports = router;
