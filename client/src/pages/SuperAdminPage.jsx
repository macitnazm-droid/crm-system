import React, { useState, useEffect } from 'react';
import { superAdminAPI } from '../lib/api';
import {
    Building2, Users, MessageSquare, ShieldCheck,
    Plus, Search, CheckCircle2, XCircle, BarChart3,
    Globe, Mail, User, Lock
} from 'lucide-react';
import './SuperAdminPage.css';

export default function SuperAdminPage() {
    const [companies, setCompanies] = useState([]);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [editingCompany, setEditingCompany] = useState(null);
    const [newCompany, setNewCompany] = useState({
        name: '',
        domain: '',
        adminName: '',
        adminEmail: '',
        adminPassword: '',
        userLimit: 10
    });

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            setLoading(true);
            const [compRes, statsRes] = await Promise.all([
                superAdminAPI.listCompanies(),
                superAdminAPI.getStats()
            ]);
            setCompanies(compRes.data.companies);
            setStats(statsRes.data.stats);
        } catch (err) {
            console.error('Data fetch error:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleToggleStatus = async (id, currentStatus) => {
        try {
            await superAdminAPI.updateCompanyStatus(id, !currentStatus);
            setCompanies(companies.map(c =>
                c.id === id ? { ...c, is_active: !currentStatus ? 1 : 0 } : c
            ));
        } catch (err) {
            alert('Durum güncellenemedi');
        }
    };

    const handleCreateCompany = async (e) => {
        e.preventDefault();
        try {
            await superAdminAPI.createCompany(newCompany);
            setShowAddModal(false);
            fetchData();
            setNewCompany({ name: '', domain: '', adminName: '', adminEmail: '', adminPassword: '', userLimit: 10 });
        } catch (err) {
            alert('Şirket oluşturulamadı: ' + (err.response?.data?.error || err.message));
        }
    };

    const handleUpdateCompany = async (e) => {
        e.preventDefault();
        try {
            await superAdminAPI.updateCompany(editingCompany.id, editingCompany);
            setShowEditModal(false);
            fetchData();
        } catch (err) {
            alert('Güncelleme başarısız: ' + (err.response?.data?.error || err.message));
        }
    };

    if (loading && !companies.length) {
        return <div className="loading-state">Yükleniyor...</div>;
    }

    return (
        <div className="superadmin-page">
            <header className="page-header">
                <div className="header-content">
                    <h1 className="page-title">Sistem Yönetimi (SaaS)</h1>
                    <p className="page-subtitle">Tüm şirketleri ve sistem kaynaklarını buradan yönetin.</p>
                </div>
                <button className="btn-primary" onClick={() => setShowAddModal(true)}>
                    <Plus size={18} />
                    <span>Yeni Şirket Ekle</span>
                </button>
            </header>

            <section className="stats-grid">
                <div className="stat-card">
                    <div className="stat-icon purple"><Building2 size={24} /></div>
                    <div className="stat-info">
                        <span className="stat-label">Toplam Şirket</span>
                        <span className="stat-value">{stats?.total_companies || 0}</span>
                    </div>
                </div>
                <div className="stat-card">
                    <div className="stat-icon blue"><Users size={24} /></div>
                    <div className="stat-info">
                        <span className="stat-label">Toplam Kullanıcı</span>
                        <span className="stat-value">{stats?.total_users || 0}</span>
                    </div>
                </div>
                <div className="stat-card">
                    <div className="stat-icon green"><ShieldCheck size={24} /></div>
                    <div className="stat-info">
                        <span className="stat-label">Müşteri Sayısı</span>
                        <span className="stat-value">{stats?.total_customers || 0}</span>
                    </div>
                </div>
                <div className="stat-card">
                    <div className="stat-icon yellow"><MessageSquare size={24} /></div>
                    <div className="stat-info">
                        <span className="stat-label">Toplam Mesaj</span>
                        <span className="stat-value">{stats?.total_messages || 0}</span>
                    </div>
                </div>
            </section>

            <section className="companies-section">
                <div className="section-header">
                    <h2 className="section-title">Şirketler ({companies.length})</h2>
                    <div className="search-bar">
                        <Search size={18} />
                        <input type="text" placeholder="Şirket ara..." />
                    </div>
                </div>

                <div className="companies-list">
                    <table className="admin-table">
                        <thead>
                            <tr>
                                <th>Şirket Adı</th>
                                <th>Kullanıcı Kotası</th>
                                <th>Müşteri</th>
                                <th>Oluşturulma</th>
                                <th>Durum</th>
                                <th>İşlemler</th>
                            </tr>
                        </thead>
                        <tbody>
                            {companies.map(company => (
                                <tr key={company.id}>
                                    <td>
                                        <div className="company-cell">
                                            <div className="company-icon">
                                                {company.name.charAt(0).toUpperCase()}
                                            </div>
                                            <div className="company-info">
                                                <span className="name">{company.name}</span>
                                                <span className="domain">{company.domain || 'no-domain.com'}</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td>
                                        <div className={`quota-badge ${company.user_count >= company.user_limit ? 'limit-reached' : ''}`}>
                                            <Users size={12} />
                                            <span>{company.user_count} / {company.user_limit}</span>
                                        </div>
                                    </td>
                                    <td>
                                        <div className="count-badges">
                                            <span className="badge green">{company.customer_count} Müşteri</span>
                                        </div>
                                    </td>
                                    <td>{new Date(company.created_at).toLocaleDateString('tr-TR')}</td>
                                    <td>
                                        {company.is_active ?
                                            <span className="status-badge active"><CheckCircle2 size={14} /> Aktif</span> :
                                            <span className="status-badge inactive"><XCircle size={14} /> Pasif</span>
                                        }
                                    </td>
                                    <td>
                                        <div className="actions">
                                            <button
                                                className="btn-action edit"
                                                onClick={() => {
                                                    setEditingCompany(company);
                                                    setShowEditModal(true);
                                                }}
                                            >
                                                Düzenle
                                            </button>
                                            <button
                                                className={`btn-action ${company.is_active ? 'deactivate' : 'activate'}`}
                                                onClick={() => handleToggleStatus(company.id, company.is_active)}
                                            >
                                                {company.is_active ? 'Dondur' : 'Aktif Et'}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            {showAddModal && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        <div className="modal-header">
                            <h2>Yeni Şirket Oluştur</h2>
                            <button className="btn-close" onClick={() => setShowAddModal(false)}>×</button>
                        </div>
                        <form onSubmit={handleCreateCompany}>
                            <div className="form-grid">
                                <div className="form-group full">
                                    <label>Şirket Adı</label>
                                    <div className="input-with-icon">
                                        <Building2 size={18} />
                                        <input
                                            type="text"
                                            value={newCompany.name}
                                            onChange={e => setNewCompany({ ...newCompany, name: e.target.value })}
                                            placeholder="Örn: ABC Teknoloji"
                                            required
                                        />
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label>Alan Adı (Domain)</label>
                                    <div className="input-with-icon">
                                        <Globe size={18} />
                                        <input
                                            type="text"
                                            value={newCompany.domain}
                                            onChange={e => setNewCompany({ ...newCompany, domain: e.target.value })}
                                            placeholder="abctech.com"
                                        />
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label>Kullanıcı Limiti</label>
                                    <div className="input-with-icon">
                                        <Users size={18} />
                                        <input
                                            type="number"
                                            value={newCompany.userLimit}
                                            onChange={e => setNewCompany({ ...newCompany, userLimit: parseInt(e.target.value) })}
                                            min="1"
                                        />
                                    </div>
                                </div>
                                <div className="form-divider">Yönetici Bilgileri</div>
                                <div className="form-group">
                                    <label>Ad Soyad</label>
                                    <div className="input-with-icon">
                                        <User size={18} />
                                        <input
                                            type="text"
                                            value={newCompany.adminName}
                                            onChange={e => setNewCompany({ ...newCompany, adminName: e.target.value })}
                                            placeholder="Admin Adı"
                                            required
                                        />
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label>E-posta</label>
                                    <div className="input-with-icon">
                                        <Mail size={18} />
                                        <input
                                            type="email"
                                            value={newCompany.adminEmail}
                                            onChange={e => setNewCompany({ ...newCompany, adminEmail: e.target.value })}
                                            placeholder="admin@mail.com"
                                            required
                                        />
                                    </div>
                                </div>
                                <div className="form-group full">
                                    <label>Şifre</label>
                                    <div className="input-with-icon">
                                        <Lock size={18} />
                                        <input
                                            type="password"
                                            value={newCompany.adminPassword}
                                            onChange={e => setNewCompany({ ...newCompany, adminPassword: e.target.value })}
                                            placeholder="••••••••"
                                            required
                                        />
                                    </div>
                                </div>
                            </div>
                            <div className="modal-actions">
                                <button type="button" className="btn-secondary" onClick={() => setShowAddModal(false)}>Vazgeç</button>
                                <button type="submit" className="btn-primary">Şirketi Oluştur</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
            {showEditModal && editingCompany && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        <div className="modal-header">
                            <h2>Şirket Bilgilerini Düzenle</h2>
                            <button className="btn-close" onClick={() => setShowEditModal(false)}>×</button>
                        </div>
                        <form onSubmit={handleUpdateCompany}>
                            <div className="form-grid">
                                <div className="form-group full">
                                    <label>Şirket Adı</label>
                                    <div className="input-with-icon">
                                        <Building2 size={18} />
                                        <input
                                            type="text"
                                            value={editingCompany.name}
                                            onChange={e => setEditingCompany({ ...editingCompany, name: e.target.value })}
                                            required
                                        />
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label>Alan Adı (Domain)</label>
                                    <div className="input-with-icon">
                                        <Globe size={18} />
                                        <input
                                            type="text"
                                            value={editingCompany.domain || ''}
                                            onChange={e => setEditingCompany({ ...editingCompany, domain: e.target.value })}
                                        />
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label>Kullanıcı Limiti</label>
                                    <div className="input-with-icon">
                                        <Users size={18} />
                                        <input
                                            type="number"
                                            value={editingCompany.user_limit}
                                            onChange={e => setEditingCompany({ ...editingCompany, user_limit: parseInt(e.target.value) })}
                                            min="1"
                                            required
                                        />
                                    </div>
                                </div>
                            </div>
                            <div className="modal-actions">
                                <button type="button" className="btn-secondary" onClick={() => setShowEditModal(false)}>Vazgeç</button>
                                <button type="submit" className="btn-primary">Değişiklikleri Kaydet</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
