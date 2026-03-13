const Database = require('better-sqlite3');
const path = require('path');

function initDB() {
  const dbPath = process.env.NODE_ENV === 'production'
    ? '/var/data/crm.db'
    : path.join(__dirname, '..', 'crm.db');
  const db = new Database(dbPath);

  // WAL modu — daha iyi performans
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // 1. Şirketler tablosunu en başta oluştur
  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      domain TEXT UNIQUE,
      user_limit INTEGER DEFAULT 10,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  // 2. Migration: Mevcut tabloları kontrol et ve company_id ekle
  const tablesToUpdate = ['users', 'customers', 'conversations', 'messages', 'ai_prompts', 'integration_settings'];
  tablesToUpdate.forEach(table => {
    try {
      const info = db.prepare(`PRAGMA table_info(${table})`).all();
      if (info.length > 0 && !info.some(c => c.name === 'company_id')) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN company_id INTEGER REFERENCES companies(id)`);
      }
    } catch (err) { }
  });

  // Migration: customers tablosuna unipile_chat_id, profile_pic, instagram_username, messenger_id ekle
  try {
    const custInfo = db.prepare(`PRAGMA table_info(customers)`).all();
    if (custInfo.length > 0 && !custInfo.some(c => c.name === 'unipile_chat_id')) {
      db.exec(`ALTER TABLE customers ADD COLUMN unipile_chat_id TEXT DEFAULT ''`);
    }
    if (custInfo.length > 0 && !custInfo.some(c => c.name === 'profile_pic')) {
      db.exec(`ALTER TABLE customers ADD COLUMN profile_pic TEXT DEFAULT ''`);
    }
    if (custInfo.length > 0 && !custInfo.some(c => c.name === 'instagram_username')) {
      db.exec(`ALTER TABLE customers ADD COLUMN instagram_username TEXT DEFAULT ''`);
    }
    if (custInfo.length > 0 && !custInfo.some(c => c.name === 'messenger_id')) {
      db.exec(`ALTER TABLE customers ADD COLUMN messenger_id TEXT DEFAULT ''`);
    }
  } catch (err) { }

  // Migration: Messenger platform desteği — CHECK constraint'leri güncelle
  try {
    const custTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='customers'").get();
    if (custTableSql && !custTableSql.sql.includes('messenger')) {
      console.log('🔄 Customers tablosu güncelleniyor (messenger desteği)...');
      db.pragma('foreign_keys = OFF');
      db.transaction(() => {
        const cols = db.prepare('PRAGMA table_info(customers)').all();
        const colNames = cols.map(c => c.name).join(', ');
        db.exec(`ALTER TABLE customers RENAME TO customers_old`);
        db.exec(`
          CREATE TABLE customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER REFERENCES companies(id),
            phone TEXT,
            instagram_id TEXT,
            whatsapp_id TEXT,
            messenger_id TEXT DEFAULT '',
            name TEXT NOT NULL,
            email TEXT,
            category TEXT DEFAULT 'cold' CHECK(category IN ('hot', 'warm', 'cold', 'unqualified')),
            lead_score INTEGER DEFAULT 0,
            source TEXT DEFAULT 'instagram' CHECK(source IN ('instagram', 'whatsapp', 'messenger', 'api', 'manual')),
            last_message_at DATETIME,
            unipile_chat_id TEXT DEFAULT '',
            profile_pic TEXT DEFAULT '',
            instagram_username TEXT DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);
        // Eski kolonları yeniye kopyala (ortak kolonları bul)
        const newCols = db.prepare('PRAGMA table_info(customers)').all().map(c => c.name);
        const commonCols = cols.map(c => c.name).filter(c => newCols.includes(c)).join(', ');
        db.exec(`INSERT INTO customers (${commonCols}) SELECT ${commonCols} FROM customers_old`);
        db.exec(`DROP TABLE customers_old`);
      })();
      db.pragma('foreign_keys = ON');
    }
  } catch (err) {
    console.error('Customers messenger migration error:', err.message);
    db.pragma('foreign_keys = ON');
  }

  // Migration: Messages tablosu — source CHECK'e messenger ekle (zorla)
  try {
    const msgTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='messages'").get();
    console.log('📋 Messages table SQL check:', msgTableSql ? msgTableSql.sql.substring(0, 200) : 'TABLE NOT FOUND');
    console.log('📋 Includes messenger?', msgTableSql?.sql?.includes('messenger'));

    // Eski başarısız migration'dan kalan tablo varsa temizle
    const oldExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='messages_old'").get();
    if (oldExists) {
      console.log('🧹 Eski messages_old tablosu bulundu, temizleniyor...');
      db.exec('DROP TABLE IF EXISTS messages_old');
    }

    if (msgTableSql && !msgTableSql.sql.includes('messenger')) {
      console.log('🔄 Messages tablosu güncelleniyor (messenger desteği)...');
      db.pragma('foreign_keys = OFF');
      db.transaction(() => {
        const oldCols = db.prepare('PRAGMA table_info(messages)').all().map(c => c.name);
        console.log('📋 Eski kolonlar:', oldCols.join(', '));
        db.exec(`ALTER TABLE messages RENAME TO messages_old`);
        db.exec(`
          CREATE TABLE messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER REFERENCES companies(id),
            conversation_id INTEGER NOT NULL REFERENCES conversations(id),
            customer_id INTEGER NOT NULL REFERENCES customers(id),
            user_id INTEGER REFERENCES users(id),
            content TEXT NOT NULL,
            source TEXT DEFAULT 'instagram' CHECK(source IN ('instagram', 'whatsapp', 'messenger', 'api', 'manual')),
            direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound')),
            is_ai_generated INTEGER DEFAULT 0,
            ai_model TEXT,
            is_manual_override INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);
        const newCols = db.prepare('PRAGMA table_info(messages)').all().map(c => c.name);
        const commonCols = oldCols.filter(c => newCols.includes(c)).join(', ');
        console.log('📋 Ortak kolonlar:', commonCols);
        db.exec(`INSERT INTO messages (${commonCols}) SELECT ${commonCols} FROM messages_old`);
        db.exec(`DROP TABLE messages_old`);
        console.log('✅ Messages migration transaction tamamlandı');
      })();
      db.pragma('foreign_keys = ON');
      console.log('✅ Messages tablosu messenger desteği eklendi');
    } else {
      console.log('ℹ️ Messages tablosu zaten messenger destekli veya bulunamadı');
    }
  } catch (err) {
    console.error('❌ Messages messenger migration error:', err.message);
    console.error('Stack:', err.stack);
    db.pragma('foreign_keys = ON');
  }

  // Migration: integration_settings tablosu — platform CHECK'e messenger ekle
  try {
    const intTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='integration_settings'").get();
    if (intTableSql && !intTableSql.sql.includes('messenger')) {
      console.log('🔄 Integration_settings tablosu güncelleniyor (messenger desteği)...');
      db.pragma('foreign_keys = OFF');
      db.transaction(() => {
        const cols = db.prepare('PRAGMA table_info(integration_settings)').all();
        const colNames = cols.map(c => c.name).join(', ');
        db.exec(`ALTER TABLE integration_settings RENAME TO integration_settings_old`);
        db.exec(`
          CREATE TABLE integration_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER REFERENCES companies(id),
            platform TEXT NOT NULL CHECK(platform IN ('instagram', 'whatsapp', 'messenger')),
            api_key TEXT DEFAULT '',
            api_secret TEXT DEFAULT '',
            webhook_url TEXT DEFAULT '',
            phone_number_id TEXT DEFAULT '',
            page_id TEXT DEFAULT '',
            verify_token TEXT DEFAULT '',
            is_active INTEGER DEFAULT 0,
            provider TEXT DEFAULT 'meta',
            dsn_url TEXT DEFAULT '',
            unipile_account_id TEXT DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);
        const newCols = db.prepare('PRAGMA table_info(integration_settings)').all().map(c => c.name);
        const commonCols = cols.map(c => c.name).filter(c => newCols.includes(c)).join(', ');
        db.exec(`INSERT INTO integration_settings (${commonCols}) SELECT ${commonCols} FROM integration_settings_old`);
        db.exec(`DROP TABLE integration_settings_old`);
      })();
      db.pragma('foreign_keys = ON');
    }
  } catch (err) {
    console.error('Integration_settings messenger migration error:', err.message);
    db.pragma('foreign_keys = ON');
  }

  // Migration: integration_settings tablosuna provider, dsn_url, unipile_account_id ekle
  try {
    const intInfo = db.prepare(`PRAGMA table_info(integration_settings)`).all();
    if (intInfo.length > 0 && !intInfo.some(c => c.name === 'provider')) {
      db.exec(`ALTER TABLE integration_settings ADD COLUMN provider TEXT DEFAULT 'meta'`);
    }
    if (intInfo.length > 0 && !intInfo.some(c => c.name === 'dsn_url')) {
      db.exec(`ALTER TABLE integration_settings ADD COLUMN dsn_url TEXT DEFAULT ''`);
    }
    if (intInfo.length > 0 && !intInfo.some(c => c.name === 'unipile_account_id')) {
      db.exec(`ALTER TABLE integration_settings ADD COLUMN unipile_account_id TEXT DEFAULT ''`);
    }
  } catch (err) { }

  // 2.0 Migration: Companies tablosuna user_limit ekle
  try {
    const companyInfo = db.prepare(`PRAGMA table_info(companies)`).all();
    if (companyInfo.length > 0 && !companyInfo.some(c => c.name === 'user_limit')) {
      db.exec(`ALTER TABLE companies ADD COLUMN user_limit INTEGER DEFAULT 10`);
      console.log('✅ Companies tablosuna user_limit eklendi.');
    }
    if (companyInfo.length > 0 && !companyInfo.some(c => c.name === 'subscription_plan')) {
      db.exec(`ALTER TABLE companies ADD COLUMN subscription_plan TEXT DEFAULT 'free'`);
    }
    if (companyInfo.length > 0 && !companyInfo.some(c => c.name === 'subscription_expires_at')) {
      db.exec(`ALTER TABLE companies ADD COLUMN subscription_expires_at DATETIME`);
    }
    if (companyInfo.length > 0 && !companyInfo.some(c => c.name === 'message_limit')) {
      db.exec(`ALTER TABLE companies ADD COLUMN message_limit INTEGER DEFAULT 500`);
    }
    if (companyInfo.length > 0 && !companyInfo.some(c => c.name === 'messages_used')) {
      db.exec(`ALTER TABLE companies ADD COLUMN messages_used INTEGER DEFAULT 0`);
    }
  } catch (err) { }

  // 2.1 Special Migration: Users tablosundaki ROLE kısıtlamasını güncelle
  try {
    const userTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
    if (userTableSql && !userTableSql.sql.includes('super_admin')) {
      console.log('🔄 Users tablosu güncelleniyor (super_admin rolü ekleniyor)...');

      // Foreign key kontrolünü geçici olarak kapat
      db.pragma('foreign_keys = OFF');

      db.transaction(() => {
        db.exec(`
          ALTER TABLE users RENAME TO users_old;
          CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER REFERENCES companies(id),
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            name TEXT NOT NULL,
            role TEXT DEFAULT 'agent' CHECK(role IN ('super_admin', 'admin', 'agent', 'manager')),
            avatar_color TEXT DEFAULT '#6366f1',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_active INTEGER DEFAULT 1
          );
          INSERT INTO users (id, company_id, email, password_hash, name, role, avatar_color, created_at, is_active)
          SELECT id, company_id, email, password_hash, name, role, avatar_color, created_at, is_active FROM users_old;
          DROP TABLE users_old;
        `);
      })();

      db.pragma('foreign_keys = ON');
    }
  } catch (err) {
    console.error('Users migration error:', err.message);
    db.pragma('foreign_keys = ON');
  }

  // 3. Tabloları ve bağlantılı yapıları oluştur
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER REFERENCES companies(id),
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'agent' CHECK(role IN ('super_admin', 'admin', 'agent', 'manager')),
      avatar_color TEXT DEFAULT '#6366f1',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER REFERENCES companies(id),
      phone TEXT,
      instagram_id TEXT,
      whatsapp_id TEXT,
      name TEXT NOT NULL,
      email TEXT,
      category TEXT DEFAULT 'cold' CHECK(category IN ('hot', 'warm', 'cold', 'unqualified')),
      lead_score INTEGER DEFAULT 0,
      messenger_id TEXT,
      source TEXT DEFAULT 'instagram' CHECK(source IN ('instagram', 'whatsapp', 'messenger', 'api', 'manual')),
      last_message_at DATETIME,
      unipile_chat_id TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER REFERENCES companies(id),
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      assigned_agent_id INTEGER REFERENCES users(id),
      status TEXT DEFAULT 'open' CHECK(status IN ('open', 'closed', 'paused')),
      ai_enabled INTEGER DEFAULT 1,
      ai_stopped_at DATETIME,
      last_message_preview TEXT,
      unread_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER REFERENCES companies(id),
      conversation_id INTEGER NOT NULL REFERENCES conversations(id),
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      user_id INTEGER REFERENCES users(id),
      content TEXT NOT NULL,
      source TEXT DEFAULT 'instagram' CHECK(source IN ('instagram', 'whatsapp', 'messenger', 'api', 'manual')),
      direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound')),
      is_ai_generated INTEGER DEFAULT 0,
      ai_model TEXT,
      is_manual_override INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ai_prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER REFERENCES companies(id),
      name TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      instructions TEXT,
      version INTEGER DEFAULT 1,
      created_by INTEGER REFERENCES users(id),
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS integration_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER REFERENCES companies(id),
      platform TEXT NOT NULL CHECK(platform IN ('instagram', 'whatsapp', 'messenger')),
      api_key TEXT DEFAULT '',
      api_secret TEXT DEFAULT '',
      webhook_url TEXT DEFAULT '',
      phone_number_id TEXT DEFAULT '',
      page_id TEXT DEFAULT '',
      verify_token TEXT DEFAULT '',
      is_active INTEGER DEFAULT 0,
      provider TEXT DEFAULT 'meta',
      dsn_url TEXT DEFAULT '',
      unipile_account_id TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER REFERENCES companies(id),
      customer_id INTEGER REFERENCES customers(id),
      conversation_id INTEGER REFERENCES conversations(id),
      customer_name TEXT,
      phone TEXT,
      appointment_time TEXT,
      notes TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'cancelled')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);
    CREATE INDEX IF NOT EXISTS idx_customers_company ON customers(company_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_company ON conversations(company_id);
    CREATE INDEX IF NOT EXISTS idx_messages_company ON messages(company_id);
  `);

  // 4. Varsayılan şirket oluştur (eğer yoksa)
  try {
    const companyCount = db.prepare('SELECT COUNT(*) as count FROM companies').get();
    if (companyCount.count === 0) {
      db.prepare('INSERT INTO companies (id, name) VALUES (1, ?)').run('Ana Firma');
      console.log('🏢 Varsayılan şirket oluşturuldu.');

      // Mevcut verileri varsayılan şirkete ata
      const tables = ['users', 'customers', 'conversations', 'messages', 'ai_prompts', 'integration_settings'];
      tables.forEach(table => {
        try {
          db.prepare(`UPDATE ${table} SET company_id = 1 WHERE company_id IS NULL`).run();
        } catch (e) { /* Tablo yoksa atla */ }
      });
    }
  } catch (err) {
    console.error('Şirket oluşturma hatası:', err.message);
  }

  // Varsayılan AI prompt'u ekle (yoksa)
  const promptCount = db.prepare('SELECT COUNT(*) as count FROM ai_prompts').get();
  if (promptCount.count === 0) {
    db.prepare(`
      INSERT INTO ai_prompts (company_id, name, system_prompt, instructions, created_by, is_active)
      VALUES (?, ?, ?, ?, NULL, 1)
    `).run(
      1,
      'Varsayılan Satış Asistanı',
      `Sen bir satış asistanısın. Müşterilere yardımcı ol, ürünler hakkında bilgi ver ve satışa yönlendir...`,
      `Müşteriyi kategorize et...`
    );
  }

  // Demo veri kontrol — seed.js ile ayrıca da çalıştırılabilir
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
  if (userCount.count === 0) {
    const { seedDatabase } = require('./seed');
    seedDatabase(db);
  }

  // Migration: company_id'si NULL olan kayıtları düzelt
  try {
    const tables = ['users', 'customers', 'conversations', 'messages', 'ai_prompts', 'integration_settings'];
    tables.forEach(table => {
      try {
        db.prepare(`UPDATE ${table} SET company_id = 1 WHERE company_id IS NULL`).run();
      } catch (e) { /* tablo yoksa atla */ }
    });
  } catch (err) { }

  // Super Admin yoksa oluştur
  try {
    const superAdmin = db.prepare("SELECT id FROM users WHERE role = 'super_admin'").get();
    if (!superAdmin) {
      const bcrypt = require('bcryptjs');
      const hash = bcrypt.hashSync('superadmin123', 10);
      db.prepare(`
        INSERT INTO users (company_id, email, password_hash, name, role, avatar_color, is_active)
        VALUES (1, 'superadmin@crm.com', ?, 'Süper Admin', 'super_admin', '#8b5cf6', 1)
      `).run(hash);
      console.log('👑 Super Admin oluşturuldu: superadmin@crm.com / superadmin123');
    }
  } catch (err) {
    console.error('Super admin oluşturma hatası:', err.message);
  }

  return db;
}

module.exports = { initDB };
