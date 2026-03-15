const express = require('express');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { aiService } = require('../services/aiService');

const router = express.Router();

// POST /api/ai/generate-response
router.post('/generate-response', authMiddleware, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { conversation_id } = req.body;
        const companyId = req.user.company_id;

        const conversation = db.prepare('SELECT * FROM conversations WHERE id = ? AND company_id = ?').get(conversation_id, companyId);
        if (!conversation) {
            return res.status(404).json({ error: 'Konuşma bulunamadı' });
        }

        const customer = db.prepare('SELECT * FROM customers WHERE id = ? AND company_id = ?').get(conversation.customer_id, companyId);
        const messages = db.prepare('SELECT * FROM messages WHERE conversation_id = ? AND company_id = ? ORDER BY created_at ASC').all(conversation_id, companyId);

        // Şirketin aktif prompt'unu al
        const prompt = db.prepare('SELECT * FROM ai_prompts WHERE company_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1').get(companyId);
        const systemPrompt = prompt?.system_prompt || 'Sen bir satış asistanısın. Müşterilere yardımcı ol.';

        const aiResponse = await aiService.generateResponse(messages, systemPrompt, customer);

        // AI mesajını kaydet
        const now = new Date().toISOString();
        const result = db.prepare(`
      INSERT INTO messages (company_id, conversation_id, customer_id, user_id, content, source, direction, is_ai_generated, ai_model, created_at)
      VALUES (?, ?, ?, NULL, ?, ?, 'outbound', 1, ?, ?)
    `).run(companyId, conversation_id, conversation.customer_id, aiResponse.content, customer.source || 'manual', aiResponse.model, now);

        // Konuşmayı güncelle
        db.prepare('UPDATE conversations SET last_message_preview = ?, updated_at = ? WHERE id = ? AND company_id = ?')
            .run(aiResponse.content.substring(0, 100), now, conversation_id, companyId);

        db.prepare('UPDATE customers SET last_message_at = ?, updated_at = ? WHERE id = ? AND company_id = ?')
            .run(now, now, conversation.customer_id, companyId);

        const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(result.lastInsertRowid);

        // Real-time broadcast
        const io = req.app.locals.io;
        io.to(`company:${companyId}`).emit('message:new', { message, conversation_id });

        res.json({ message, response: aiResponse });
    } catch (err) {
        console.error('AI generate error:', err);
        res.status(500).json({ error: 'AI yanıt üretirken hata oluştu' });
    }
});

// GET /api/ai/prompts
router.get('/prompts', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;
        const prompts = db.prepare(`
      SELECT p.*, u.name as creator_name 
      FROM ai_prompts p 
      LEFT JOIN users u ON p.created_by = u.id 
      WHERE p.company_id = ?
      ORDER BY p.created_at DESC
    `).all(companyId);
        res.json({ prompts });
    } catch (err) {
        res.status(500).json({ error: 'Promptlar yüklenirken hata oluştu' });
    }
});

// POST /api/ai/prompts
router.post('/prompts', authMiddleware, adminOnly, (req, res) => {
    try {
        const db = req.app.locals.db;
        const { name, system_prompt, instructions } = req.body;
        const companyId = req.user.company_id;

        if (!name || !system_prompt) {
            return res.status(400).json({ error: 'İsim ve system prompt gerekli' });
        }

        const result = db.prepare(`
      INSERT INTO ai_prompts (company_id, name, system_prompt, instructions, created_by, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(companyId, name, system_prompt, instructions || '', req.user.id);

        const prompt = db.prepare('SELECT * FROM ai_prompts WHERE id = ?').get(result.lastInsertRowid);
        res.json({ prompt });
    } catch (err) {
        res.status(500).json({ error: 'Prompt oluşturulurken hata oluştu' });
    }
});

// PATCH /api/ai/prompts/:id
router.patch('/prompts/:id', authMiddleware, adminOnly, (req, res) => {
    try {
        const db = req.app.locals.db;
        const { name, system_prompt, instructions, is_active } = req.body;
        const companyId = req.user.company_id;

        const updates = [];
        const params = [];

        if (name) { updates.push('name = ?'); params.push(name); }
        if (system_prompt) { updates.push('system_prompt = ?'); params.push(system_prompt); }
        if (instructions !== undefined) { updates.push('instructions = ?'); params.push(instructions); }
        if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active ? 1 : 0); }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'Güncellenecek alan gerekli' });
        }

        params.push(req.params.id);
        params.push(companyId);
        const result = db.prepare(`UPDATE ai_prompts SET ${updates.join(', ')} WHERE id = ? AND company_id = ?`).run(...params);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Prompt bulunamadı veya yetkiniz yok' });
        }

        const prompt = db.prepare('SELECT * FROM ai_prompts WHERE id = ?').get(req.params.id);
        res.json({ prompt });
    } catch (err) {
        res.status(500).json({ error: 'Prompt güncellenirken hata oluştu' });
    }
});

// DELETE /api/ai/prompts/:id
router.delete('/prompts/:id', authMiddleware, adminOnly, (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;
        const result = db.prepare('DELETE FROM ai_prompts WHERE id = ? AND company_id = ?').run(req.params.id, companyId);
        if (result.changes === 0) return res.status(404).json({ error: 'Prompt bulunamadı' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Prompt silinirken hata oluştu' });
    }
});

// POST /api/ai/categorize
router.post('/categorize', authMiddleware, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { customer_id } = req.body;
        const companyId = req.user.company_id;

        const customer = db.prepare('SELECT * FROM customers WHERE id = ? AND company_id = ?').get(customer_id, companyId);
        if (!customer) {
            return res.status(404).json({ error: 'Müşteri bulunamadı' });
        }

        const messages = db.prepare('SELECT * FROM messages WHERE customer_id = ? AND company_id = ? ORDER BY created_at ASC').all(customer_id, companyId);
        const result = await aiService.categorizeCustomer(messages, customer);

        // Müşteriyi güncelle
        db.prepare('UPDATE customers SET category = ?, lead_score = ?, updated_at = ? WHERE id = ? AND company_id = ?')
            .run(result.category, result.lead_score, new Date().toISOString(), customer_id, companyId);

        const updatedCustomer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customer_id);

        const io = req.app.locals.io;
        io.to(`company:${companyId}`).emit('customer:categorized', { customer: updatedCustomer });

        res.json({ ...result, customer: updatedCustomer });
    } catch (err) {
        console.error('Categorize error:', err);
        res.status(500).json({ error: 'Kategorize ederken hata oluştu' });
    }
});

// GET /api/ai/platform-settings — Platform bazlı AI ayarlarını getir
router.get('/platform-settings', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;
        const company = db.prepare('SELECT feature_ai, ai_instagram, ai_whatsapp, ai_messenger FROM companies WHERE id = ?').get(companyId);
        res.json({
            feature_ai: company?.feature_ai ?? 1,
            ai_instagram: company?.ai_instagram ?? 1,
            ai_whatsapp: company?.ai_whatsapp ?? 1,
            ai_messenger: company?.ai_messenger ?? 1,
        });
    } catch (err) {
        res.status(500).json({ error: 'Ayarlar yüklenirken hata' });
    }
});

// PATCH /api/ai/platform-settings — Platform bazlı AI ayarlarını güncelle
router.patch('/platform-settings', authMiddleware, adminOnly, (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;

        // SuperAdmin master switch kontrolü
        const company = db.prepare('SELECT feature_ai FROM companies WHERE id = ?').get(companyId);
        if (!company?.feature_ai) {
            return res.status(403).json({ error: 'Yapay zeka modülü süper admin tarafından kapatılmış' });
        }

        const { ai_instagram, ai_whatsapp, ai_messenger } = req.body;

        const updates = [];
        const params = [];
        if (ai_instagram !== undefined) { updates.push('ai_instagram = ?'); params.push(ai_instagram ? 1 : 0); }
        if (ai_whatsapp !== undefined) { updates.push('ai_whatsapp = ?'); params.push(ai_whatsapp ? 1 : 0); }
        if (ai_messenger !== undefined) { updates.push('ai_messenger = ?'); params.push(ai_messenger ? 1 : 0); }

        if (updates.length > 0) {
            params.push(companyId);
            db.prepare(`UPDATE companies SET ${updates.join(', ')} WHERE id = ?`).run(...params);
        }

        const updated = db.prepare('SELECT ai_instagram, ai_whatsapp, ai_messenger FROM companies WHERE id = ?').get(companyId);
        res.json({
            ai_instagram: updated?.ai_instagram ?? 1,
            ai_whatsapp: updated?.ai_whatsapp ?? 1,
            ai_messenger: updated?.ai_messenger ?? 1,
        });
    } catch (err) {
        console.error('Platform AI settings error:', err);
        res.status(500).json({ error: 'Ayarlar güncellenirken hata' });
    }
});

module.exports = router;
