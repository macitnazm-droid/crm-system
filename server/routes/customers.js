const express = require('express');
const multer = require('multer');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// GET /api/customers
router.get('/', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const { category, search, sort } = req.query;
        const companyId = req.user.company_id;

        let query = 'SELECT * FROM customers WHERE company_id = ?';
        const params = [companyId];

        if (category && category !== 'all') {
            query += ' AND category = ?';
            params.push(category);
        }

        if (search) {
            query += ' AND (name LIKE ? OR email LIKE ? OR phone LIKE ?)';
            const s = `%${search}%`;
            params.push(s, s, s);
        }

        query += ' ORDER BY ' + (sort === 'score' ? 'lead_score DESC' : 'last_message_at DESC');

        const customers = db.prepare(query).all(...params);
        res.json({ customers });
    } catch (err) {
        console.error('Get customers error:', err);
        res.status(500).json({ error: 'Müşteriler yüklenirken hata oluştu' });
    }
});

// GET /api/customers/import/sample — Örnek CSV dosyası indir (/:id'den önce olmalı)
router.get('/import/sample', authMiddleware, (req, res) => {
    const bom = '\uFEFF';
    const header = 'ad,telefon,email,kaynak,kategori,notlar';
    const rows = [
        'Ahmet Yılmaz,+905551234567,ahmet@email.com,whatsapp,warm,VIP müşteri',
        'Ayşe Kaya,+905559876543,ayse@email.com,instagram,hot,Randevu aldı',
        'Mehmet Demir,+905553456789,,manual,cold,',
    ];
    const csv = bom + header + '\n' + rows.join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=musteri-import-ornegi.csv');
    res.send(csv);
});

// POST /api/customers/import — CSV ile toplu müşteri ekle
router.post('/import', authMiddleware, upload.single('file'), (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;

        if (!req.file) {
            return res.status(400).json({ error: 'Dosya yüklenmedi' });
        }

        let content = req.file.buffer.toString('utf-8');
        if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);

        const lines = content.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) {
            return res.status(400).json({ error: 'Dosya boş veya sadece başlık satırı var' });
        }

        const headers = lines[0].toLowerCase().trim().split(',').map(h => h.trim());

        const colMap = {
            name: headers.findIndex(h => ['ad', 'isim', 'name', 'müşteri', 'musteri'].includes(h)),
            phone: headers.findIndex(h => ['telefon', 'phone', 'tel', 'numara'].includes(h)),
            email: headers.findIndex(h => ['email', 'e-posta', 'eposta', 'mail'].includes(h)),
            source: headers.findIndex(h => ['kaynak', 'source', 'kanal', 'platform'].includes(h)),
            category: headers.findIndex(h => ['kategori', 'category', 'cat'].includes(h)),
            notes: headers.findIndex(h => ['notlar', 'notes', 'not', 'açıklama'].includes(h)),
        };

        if (colMap.name === -1) {
            return res.status(400).json({ error: 'CSV dosyasında "ad" veya "name" kolonu bulunamadı' });
        }

        const validSources = ['instagram', 'whatsapp', 'messenger', 'api', 'manual'];
        const validCategories = ['hot', 'warm', 'cold', 'unqualified'];
        const now = new Date().toISOString();

        const insert = db.prepare(`
            INSERT INTO customers (company_id, name, phone, email, source, category, notes, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        let imported = 0;
        let skipped = 0;
        const errors = [];

        const importMany = db.transaction(() => {
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;

                const cols = line.match(/(".*?"|[^",]+|(?<=,)(?=,)|(?<=,)$)/g)?.map(c => c.replace(/^"|"$/g, '').trim()) || line.split(',').map(c => c.trim());

                const name = colMap.name >= 0 ? cols[colMap.name] : '';
                const phone = colMap.phone >= 0 ? cols[colMap.phone] || '' : '';
                const email = colMap.email >= 0 ? cols[colMap.email] || '' : '';
                const sourceRaw = colMap.source >= 0 ? (cols[colMap.source] || '').toLowerCase() : 'manual';
                const catRaw = colMap.category >= 0 ? (cols[colMap.category] || '').toLowerCase() : 'cold';
                const notes = colMap.notes >= 0 ? cols[colMap.notes] || '' : '';

                if (!name) {
                    skipped++;
                    errors.push(`Satır ${i + 1}: İsim boş, atlandı`);
                    continue;
                }

                const source = validSources.includes(sourceRaw) ? sourceRaw : 'manual';
                const category = validCategories.includes(catRaw) ? catRaw : 'cold';

                try {
                    insert.run(companyId, name, phone, email, source, category, notes, now, now);
                    imported++;
                } catch (err) {
                    skipped++;
                    errors.push(`Satır ${i + 1}: ${err.message}`);
                }
            }
        });

        importMany();

        res.json({ success: true, imported, skipped, total: lines.length - 1, errors: errors.slice(0, 10) });
    } catch (err) {
        console.error('Import customers error:', err);
        res.status(500).json({ error: 'İçe aktarma sırasında hata: ' + err.message });
    }
});

// GET /api/customers/:id
router.get('/:id', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;
        const customer = db.prepare('SELECT * FROM customers WHERE id = ? AND company_id = ?').get(req.params.id, companyId);

        if (!customer) {
            return res.status(404).json({ error: 'Müşteri bulunamadı' });
        }

        const conversations = db.prepare('SELECT * FROM conversations WHERE customer_id = ? AND company_id = ? ORDER BY updated_at DESC').all(customer.id, companyId);

        res.json({ customer, conversations });
    } catch (err) {
        console.error('Get customer error:', err);
        res.status(500).json({ error: 'Müşteri yüklenirken hata oluştu' });
    }
});

// PATCH /api/customers/:id/name
router.patch('/:id/name', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const companyId = req.user.company_id;
        const { name } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'İsim boş olamaz' });
        }

        const result = db.prepare('UPDATE customers SET name = ?, updated_at = ? WHERE id = ? AND company_id = ?')
            .run(name.trim(), new Date().toISOString(), req.params.id, companyId);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Müşteri bulunamadı' });
        }

        const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);

        const io = req.app.locals.io;
        io.to(`company:${companyId}`).emit('customer:updated', { customer });

        res.json({ customer });
    } catch (err) {
        console.error('Update customer name error:', err);
        res.status(500).json({ error: 'İsim güncellenirken hata oluştu' });
    }
});

// PATCH /api/customers/:id/category
router.patch('/:id/category', authMiddleware, (req, res) => {
    try {
        const db = req.app.locals.db;
        const { category, lead_score } = req.body;
        const companyId = req.user.company_id;

        if (category && !['hot', 'warm', 'cold', 'unqualified'].includes(category)) {
            return res.status(400).json({ error: 'Geçersiz kategori' });
        }

        const updates = [];
        const params = [];

        if (category) {
            updates.push('category = ?');
            params.push(category);
        }
        if (lead_score !== undefined) {
            updates.push('lead_score = ?');
            params.push(lead_score);
        }

        updates.push('updated_at = ?');
        params.push(new Date().toISOString());

        params.push(req.params.id);
        params.push(companyId);

        const result = db.prepare(`UPDATE customers SET ${updates.join(', ')} WHERE id = ? AND company_id = ?`).run(...params);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Müşteri bulunamadı veya yetkiniz yok' });
        }

        const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);

        const io = req.app.locals.io;
        io.to(`company:${companyId}`).emit('customer:categorized', { customer });

        res.json({ customer });
    } catch (err) {
        console.error('Update category error:', err);
        res.status(500).json({ error: 'Kategori güncellenirken hata oluştu' });
    }
});

module.exports = router;
