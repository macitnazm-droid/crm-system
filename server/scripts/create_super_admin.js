const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const dbPath = path.join(__dirname, '../crm.db');
const db = new Database(dbPath);

async function createSuperAdmin() {
    try {
        const email = 'superadmin@crm.com';
        const password = 'superpassword123';
        const name = 'SaaS Yöneticisi';

        // Şirket kontrolü (Ana Firma ID=1 olmalı)
        const company = db.prepare('SELECT id FROM companies WHERE id = 1').get();
        if (!company) {
            console.error('Hata: Ana Firma (ID=1) bulunamadı. Lütfen önce veritabanını başlatın.');
            return;
        }

        const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
        if (existing) {
            console.log('Bilgi: Süper Admin zaten mevcut.');
        } else {
            const passwordHash = bcrypt.hashSync(password, 10);
            db.prepare(`
                INSERT INTO users (company_id, email, password_hash, name, role, avatar_color, is_active)
                VALUES (1, ?, ?, ?, 'super_admin', '#4f46e5', 1)
            `).run(email, passwordHash, name);
            console.log('✅ Süper Admin başarıyla oluşturuldu!');
        }

        console.log('\n--- Giriş Bilgileri ---');
        console.log(`URL: http://localhost:5173/login`);
        console.log(`E-posta: ${email}`);
        console.log(`Şifre: ${password}`);
        console.log('----------------------\n');

    } catch (err) {
        console.error('Hata oluştu:', err);
    } finally {
        db.close();
    }
}

createSuperAdmin();
