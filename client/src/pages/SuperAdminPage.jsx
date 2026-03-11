import React, { useState, useEffect } from 'react';
import { superAdminAPI } from '../lib/api';
import {
    Building2, Users, MessageSquare,
    Plus, Search, CheckCircle2, XCircle,
    Star, Zap, Crown,
    Activity, ChevronRight, UserPlus, Trash2
} from 'lucide-react';
import './SuperAdminPage.css';

const PLANS = {
    free:  { label: 'Free',  icon: Star,  color: 'plan-free',  messages: 500,   users: 3 },
    basic: { label: 'Basic', icon: Zap,   color: 'plan-basic', messages: 2000,  users: 10 },
    pro:   { label: 'Pro',   icon: Crown, color: 'plan-pro',   messages: 10000, users: 999 },
};

function timeAgo(dateStr) {
    if (!dateStr) return 'Hiç';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Az önce';
    if (mins < 60) return `${mins}dk önce`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}s önce`;
    const days = Math.floor(hours / 24);
    return `${days}g önce`;
}

const defaultNewCompany = {
    name: '', domain: '', adminName: '', adminEmail: '', adminPassword: '',
    subscription_plan: 'free', subscription_expires_at: ''
};

export default function SuperAdminPage() {
    const [activeTab, setActiveTab] = useState('companies');
    const [companies, setCompanies] = useState([]);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');

    // Modals
    const [showAddModal, setShowAddModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [editingCompany, setEditingCompany] = useState(null);
    const [newCompany, setNewCompany] = useState(defaultNewCompany);
    const [saving, setSaving] = useState(false);

    // Users tab
    const [selectedCompanyId, setSelectedCompanyId] = useState(null);
    const [companyUsers, setCompanyUsers] = useState([]);
    const [usersLoading, setUsersLoading] = useState(false);
    const [showAddUserModal, setShowAddUserModal] = useState(false);
    const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'agent' });

    useEffect(() => { fetchData(); }, []);

    useEffect(() => {
        if (activeTab === 'users' && companies.length && !selectedCompanyId) {
            setSelectedCompanyId(companies[0].id);
        }
    }, [activeTab, companies]);

    useEffect(() => {
        if (selectedCompanyId) fetchCompanyUsers(selectedCompanyId);
    }, [selectedCompanyId]);

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
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const fetchCompanyUsers = async (companyId) => {
        setUsersLoading(true);
        try {
            const res = await superAdminAPI.getCompanyUsers(companyId);
            setCompanyUsers(res.data.users);
        } catch (err) {
            console.error(err);
        } finally {
            setUsersLoading(false);
        }
    };

    const handleToggleStatus = async (id, currentStatus) => {
        try {
            await superAdminAPI.updateCompanyStatus(id, !currentStatus);
            setCompanies(prev => prev.map(c => c.id === id ? { ...c, is_active: currentStatus ? 0 : 1 } : c));
        } catch (err) {
            alert('Durum güncellenemedi');
        }
    };

    const handleCreateCompany = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            await superAdminAPI.createCompany(newCompany);
            setShowAddModal(false);
            setNewCompany(defaultNewCompany);
            fetchData();
        } catch (err) {
            alert('Şirket oluşturulamadı: ' + (err.response?.data?.error || err.message));
        } finally {
            setSaving(false);
        }
    };

    const handleUpdateCompany = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            await superAdminAPI.updateCompany(editingCompany.id, editingCompany);
            setShowEditModal(false);
            fetchData();
        } catch (err) {
            alert('Güncelleme başarısız: ' + (err.response?.data?.error || err.message));
        } finally {
            setSaving(false);
        }
    };

    const handleAddUser = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            await superAdminAPI.addCompanyUser(selectedCompanyId, newUser);
            setShowAddUserModal(false);
            setNewUser({ name: '', email: '', password: '', role: 'agent' });
            fetchCompanyUsers(selectedCompanyId);
            fetchData();
        } catch (err) {
            alert('Kullanıcı eklenemedi: ' + (err.response?.data?.error || err.message));
        } finally {
            setSaving(false);
        }
    };

    const handleRemoveUser = async (userId) => {
        if (!confirm('Kullanıcıyı deaktif etmek istediğinize emin misiniz?')) return;
        try {
            await superAdminAPI.removeCompanyUser(selectedCompanyId, userId);
            fetchCompanyUsers(selectedCompanyId);
            fetchData();
        } catch (err) {
            alert('İşlem başarısız');
        }
    };

    const filteredCompanies = companies.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        (c.domain || '').toLowerCase().includes(search.toLowerCase())
    );

    const selectedCompany = companies.find(c => c.id === selectedCompanyId);

    if (loading) return <div className="sa-loading">Yükleniyor...</div>;

    return (
        <div className="sa-page">
            {/* Header */}
            <header className="sa-header">
                <div>
                    <h1 className="sa-title">Sistem Yönetimi</h1>
                    <p className="sa-subtitle">Tüm şirketler ve abonelikleri buradan yönetin</p>
                </div>
                <button className="sa-btn-primary" onClick={() => setShowAddModal(true)}>
                    <Plus size={16} /> Yeni Şirket
                </button>
            </header>

            {/* Stats */}
            <div className="sa-stats">
                <div className="sa-stat-card">
                    <div className="sa-stat-icon sa-icon-purple"><Building2 size={20} /></div>
                    <div>
                        <span className="sa-stat-label">Toplam Şirket</span>
                        <span className="sa-stat-value">{stats?.total_companies || 0}</span>
                    </div>
                </div>
                <div className="sa-stat-card">
                    <div className="sa-stat-icon sa-icon-green"><CheckCircle2 size={20} /></div>
                    <div>
                        <span className="sa-stat-label">Aktif Şirket</span>
                        <span className="sa-stat-value">{stats?.active_companies || 0}</span>
                    </div>
                </div>
                <div className="sa-stat-card">
                    <div className="sa-stat-icon sa-icon-blue"><Users size={20} /></div>
                    <div>
                        <span className="sa-stat-label">Toplam Kullanıcı</span>
                        <span className="sa-stat-value">{stats?.total_users || 0}</span>
                    </div>
                </div>
                <div className="sa-stat-card">
                    <div className="sa-stat-icon sa-icon-yellow"><MessageSquare size={20} /></div>
                    <div>
                        <span className="sa-stat-label">Toplam Mesaj</span>
                        <span className="sa-stat-value">{stats?.total_messages || 0}</span>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="sa-tabs">
                <button
                    className={`sa-tab ${activeTab === 'companies' ? 'active' : ''}`}
                    onClick={() => setActiveTab('companies')}
                >
                    <Building2 size={16} /> Şirketler
                </button>
                <button
                    className={`sa-tab ${activeTab === 'users' ? 'active' : ''}`}
                    onClick={() => setActiveTab('users')}
                >
                    <Users size={16} /> Kullanıcılar
                </button>
            </div>

            {/* Companies Tab */}
            {activeTab === 'companies' && (
                <div className="sa-card">
                    <div className="sa-card-header">
                        <span className="sa-card-title">Şirketler ({filteredCompanies.length})</span>
                        <div className="sa-search">
                            <Search size={14} />
                            <input
                                type="text"
                                placeholder="Şirket ara..."
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                            />
                        </div>
                    </div>
                    <table className="sa-table">
                        <thead>
                            <tr>
                                <th>Şirket</th>
                                <th>Plan</th>
                                <th>Mesaj Kullanımı</th>
                                <th>Kullanıcılar</th>
                                <th>Son Aktivite</th>
                                <th>Durum</th>
                                <th>İşlemler</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredCompanies.map(company => {
                                const plan = PLANS[company.subscription_plan] || PLANS.free;
                                const PlanIcon = plan.icon;
                                const msgUsed = company.total_messages || 0;
                                const msgLimit = company.message_limit || 500;
                                const msgPct = Math.min((msgUsed / msgLimit) * 100, 100);
                                const msgWarning = msgPct >= 80;
                                return (
                                    <tr key={company.id}>
                                        <td>
                                            <div className="sa-company-cell">
                                                <div className="sa-company-avatar">
                                                    {company.name.charAt(0).toUpperCase()}
                                                </div>
                                                <div>
                                                    <div className="sa-company-name">{company.name}</div>
                                                    <div className="sa-company-domain">{company.domain || '—'}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td>
                                            <span className={`sa-plan-badge ${plan.color}`}>
                                                <PlanIcon size={11} />
                                                {plan.label}
                                            </span>
                                        </td>
                                        <td>
                                            <div className="sa-usage">
                                                <div className="sa-usage-bar">
                                                    <div
                                                        className={`sa-usage-fill ${msgWarning ? 'warning' : ''}`}
                                                        style={{ width: `${msgPct}%` }}
                                                    />
                                                </div>
                                                <span className="sa-usage-text">
                                                    {msgUsed.toLocaleString()} / {msgLimit.toLocaleString()}
                                                </span>
                                            </div>
                                        </td>
                                        <td>
                                            <div className={`sa-quota ${company.user_count >= company.user_limit ? 'full' : ''}`}>
                                                <Users size={12} />
                                                {company.user_count} / {company.user_limit}
                                            </div>
                                        </td>
                                        <td>
                                            <div className="sa-activity">
                                                <Activity size={12} />
                                                {timeAgo(company.last_activity_at)}
                                            </div>
                                        </td>
                                        <td>
                                            {company.is_active
                                                ? <span className="sa-status active"><CheckCircle2 size={12} /> Aktif</span>
                                                : <span className="sa-status inactive"><XCircle size={12} /> Pasif</span>
                                            }
                                        </td>
                                        <td>
                                            <div className="sa-actions">
                                                <button
                                                    className="sa-action-btn edit"
                                                    onClick={() => { setEditingCompany({ ...company }); setShowEditModal(true); }}
                                                >
                                                    Düzenle
                                                </button>
                                                <button
                                                    className={`sa-action-btn ${company.is_active ? 'deactivate' : 'activate'}`}
                                                    onClick={() => handleToggleStatus(company.id, company.is_active)}
                                                >
                                                    {company.is_active ? 'Dondur' : 'Aktif Et'}
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {filteredCompanies.length === 0 && (
                        <div className="sa-empty">Şirket bulunamadı</div>
                    )}
                </div>
            )}

            {/* Users Tab */}
            {activeTab === 'users' && (
                <div className="sa-users-layout">
                    {/* Company List */}
                    <div className="sa-company-list">
                        <div className="sa-company-list-header">Şirketler</div>
                        {companies.map(c => (
                            <button
                                key={c.id}
                                className={`sa-company-list-item ${selectedCompanyId === c.id ? 'active' : ''}`}
                                onClick={() => setSelectedCompanyId(c.id)}
                            >
                                <div className="sa-company-list-avatar">
                                    {c.name.charAt(0).toUpperCase()}
                                </div>
                                <div className="sa-company-list-info">
                                    <span className="sa-company-list-name">{c.name}</span>
                                    <span className="sa-company-list-count">{c.user_count} kullanıcı</span>
                                </div>
                                <ChevronRight size={14} className="sa-chevron" />
                            </button>
                        ))}
                    </div>

                    {/* Users Panel */}
                    <div className="sa-users-panel">
                        {selectedCompany && (
                            <>
                                <div className="sa-users-panel-header">
                                    <div>
                                        <h3 className="sa-users-panel-title">{selectedCompany.name}</h3>
                                        <span className="sa-users-panel-sub">
                                            {companyUsers.length} / {selectedCompany.user_limit} kullanıcı
                                        </span>
                                    </div>
                                    <button
                                        className="sa-btn-primary"
                                        onClick={() => setShowAddUserModal(true)}
                                        disabled={companyUsers.filter(u => u.is_active).length >= selectedCompany.user_limit}
                                    >
                                        <UserPlus size={14} /> Kullanıcı Ekle
                                    </button>
                                </div>
                                {usersLoading ? (
                                    <div className="sa-loading-sm">Yükleniyor...</div>
                                ) : (
                                    <table className="sa-table">
                                        <thead>
                                            <tr>
                                                <th>Kullanıcı</th>
                                                <th>E-posta</th>
                                                <th>Rol</th>
                                                <th>Durum</th>
                                                <th>Kayıt Tarihi</th>
                                                <th></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {companyUsers.map(user => (
                                                <tr key={user.id}>
                                                    <td>
                                                        <div className="sa-user-cell">
                                                            <div
                                                                className="sa-user-avatar"
                                                                style={{ background: user.avatar_color }}
                                                            >
                                                                {user.name.charAt(0).toUpperCase()}
                                                            </div>
                                                            <span className="sa-user-name">{user.name}</span>
                                                        </div>
                                                    </td>
                                                    <td className="sa-user-email">{user.email}</td>
                                                    <td>
                                                        <span className={`sa-role-badge role-${user.role}`}>
                                                            {user.role}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        {user.is_active
                                                            ? <span className="sa-status active"><CheckCircle2 size={12} /> Aktif</span>
                                                            : <span className="sa-status inactive"><XCircle size={12} /> Pasif</span>
                                                        }
                                                    </td>
                                                    <td className="sa-user-date">
                                                        {new Date(user.created_at).toLocaleDateString('tr-TR')}
                                                    </td>
                                                    <td>
                                                        {user.is_active && (
                                                            <button
                                                                className="sa-remove-btn"
                                                                onClick={() => handleRemoveUser(user.id)}
                                                                title="Deaktif et"
                                                            >
                                                                <Trash2 size={14} />
                                                            </button>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                                {companyUsers.length === 0 && !usersLoading && (
                                    <div className="sa-empty">Bu şirkete ait kullanıcı yok</div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Add Company Modal */}
            {showAddModal && (
                <div className="sa-modal-overlay" onClick={() => setShowAddModal(false)}>
                    <div className="sa-modal" onClick={e => e.stopPropagation()}>
                        <div className="sa-modal-header">
                            <h2>Yeni Şirket Oluştur</h2>
                            <button className="sa-modal-close" onClick={() => setShowAddModal(false)}>×</button>
                        </div>
                        <form onSubmit={handleCreateCompany}>
                            <div className="sa-form-grid">
                                <div className="sa-form-group sa-full">
                                    <label>Şirket Adı *</label>
                                    <input
                                        type="text"
                                        value={newCompany.name}
                                        onChange={e => setNewCompany({ ...newCompany, name: e.target.value })}
                                        placeholder="ABC Teknoloji"
                                        required
                                    />
                                </div>
                                <div className="sa-form-group">
                                    <label>Domain</label>
                                    <input
                                        type="text"
                                        value={newCompany.domain}
                                        onChange={e => setNewCompany({ ...newCompany, domain: e.target.value })}
                                        placeholder="abctech.com"
                                    />
                                </div>
                                <div className="sa-form-group">
                                    <label>Abonelik Bitiş</label>
                                    <input
                                        type="date"
                                        value={newCompany.subscription_expires_at}
                                        onChange={e => setNewCompany({ ...newCompany, subscription_expires_at: e.target.value })}
                                    />
                                </div>

                                <div className="sa-form-group sa-full">
                                    <label>Plan Seç</label>
                                    <div className="sa-plan-selector">
                                        {Object.entries(PLANS).map(([key, p]) => {
                                            const Icon = p.icon;
                                            return (
                                                <button
                                                    key={key}
                                                    type="button"
                                                    className={`sa-plan-option ${p.color} ${newCompany.subscription_plan === key ? 'selected' : ''}`}
                                                    onClick={() => setNewCompany({ ...newCompany, subscription_plan: key })}
                                                >
                                                    <Icon size={18} />
                                                    <span className="sa-plan-option-name">{p.label}</span>
                                                    <span className="sa-plan-option-detail">{p.messages.toLocaleString()} mesaj</span>
                                                    <span className="sa-plan-option-detail">{p.users === 999 ? 'Sınırsız' : p.users} kullanıcı</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="sa-form-divider">Yönetici Bilgileri</div>
                                <div className="sa-form-group">
                                    <label>Ad Soyad *</label>
                                    <input
                                        type="text"
                                        value={newCompany.adminName}
                                        onChange={e => setNewCompany({ ...newCompany, adminName: e.target.value })}
                                        placeholder="Ad Soyad"
                                        required
                                    />
                                </div>
                                <div className="sa-form-group">
                                    <label>E-posta *</label>
                                    <input
                                        type="email"
                                        value={newCompany.adminEmail}
                                        onChange={e => setNewCompany({ ...newCompany, adminEmail: e.target.value })}
                                        placeholder="admin@mail.com"
                                        required
                                    />
                                </div>
                                <div className="sa-form-group sa-full">
                                    <label>Şifre *</label>
                                    <input
                                        type="password"
                                        value={newCompany.adminPassword}
                                        onChange={e => setNewCompany({ ...newCompany, adminPassword: e.target.value })}
                                        placeholder="••••••••"
                                        required
                                    />
                                </div>
                            </div>
                            <div className="sa-modal-actions">
                                <button type="button" className="sa-btn-secondary" onClick={() => setShowAddModal(false)}>Vazgeç</button>
                                <button type="submit" className="sa-btn-primary" disabled={saving}>
                                    {saving ? 'Oluşturuluyor...' : 'Şirketi Oluştur'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Edit Company Modal */}
            {showEditModal && editingCompany && (
                <div className="sa-modal-overlay" onClick={() => setShowEditModal(false)}>
                    <div className="sa-modal" onClick={e => e.stopPropagation()}>
                        <div className="sa-modal-header">
                            <h2>Şirketi Düzenle</h2>
                            <button className="sa-modal-close" onClick={() => setShowEditModal(false)}>×</button>
                        </div>
                        <form onSubmit={handleUpdateCompany}>
                            <div className="sa-form-grid">
                                <div className="sa-form-group sa-full">
                                    <label>Şirket Adı</label>
                                    <input
                                        type="text"
                                        value={editingCompany.name}
                                        onChange={e => setEditingCompany({ ...editingCompany, name: e.target.value })}
                                        required
                                    />
                                </div>
                                <div className="sa-form-group">
                                    <label>Domain</label>
                                    <input
                                        type="text"
                                        value={editingCompany.domain || ''}
                                        onChange={e => setEditingCompany({ ...editingCompany, domain: e.target.value })}
                                    />
                                </div>
                                <div className="sa-form-group">
                                    <label>Abonelik Bitiş</label>
                                    <input
                                        type="date"
                                        value={editingCompany.subscription_expires_at ? editingCompany.subscription_expires_at.split('T')[0] : ''}
                                        onChange={e => setEditingCompany({ ...editingCompany, subscription_expires_at: e.target.value })}
                                    />
                                </div>
                                <div className="sa-form-group sa-full">
                                    <label>Plan</label>
                                    <div className="sa-plan-selector">
                                        {Object.entries(PLANS).map(([key, p]) => {
                                            const Icon = p.icon;
                                            return (
                                                <button
                                                    key={key}
                                                    type="button"
                                                    className={`sa-plan-option ${p.color} ${editingCompany.subscription_plan === key ? 'selected' : ''}`}
                                                    onClick={() => setEditingCompany({ ...editingCompany, subscription_plan: key })}
                                                >
                                                    <Icon size={18} />
                                                    <span className="sa-plan-option-name">{p.label}</span>
                                                    <span className="sa-plan-option-detail">{p.messages.toLocaleString()} mesaj</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                            <div className="sa-modal-actions">
                                <button type="button" className="sa-btn-secondary" onClick={() => setShowEditModal(false)}>Vazgeç</button>
                                <button type="submit" className="sa-btn-primary" disabled={saving}>
                                    {saving ? 'Kaydediliyor...' : 'Kaydet'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Add User Modal */}
            {showAddUserModal && (
                <div className="sa-modal-overlay" onClick={() => setShowAddUserModal(false)}>
                    <div className="sa-modal sa-modal-sm" onClick={e => e.stopPropagation()}>
                        <div className="sa-modal-header">
                            <h2>Kullanıcı Ekle</h2>
                            <button className="sa-modal-close" onClick={() => setShowAddUserModal(false)}>×</button>
                        </div>
                        <p className="sa-modal-company">{selectedCompany?.name}</p>
                        <form onSubmit={handleAddUser}>
                            <div className="sa-form-grid">
                                <div className="sa-form-group sa-full">
                                    <label>Ad Soyad *</label>
                                    <input
                                        type="text"
                                        value={newUser.name}
                                        onChange={e => setNewUser({ ...newUser, name: e.target.value })}
                                        placeholder="Ad Soyad"
                                        required
                                    />
                                </div>
                                <div className="sa-form-group sa-full">
                                    <label>E-posta *</label>
                                    <input
                                        type="email"
                                        value={newUser.email}
                                        onChange={e => setNewUser({ ...newUser, email: e.target.value })}
                                        placeholder="user@mail.com"
                                        required
                                    />
                                </div>
                                <div className="sa-form-group sa-full">
                                    <label>Şifre *</label>
                                    <input
                                        type="password"
                                        value={newUser.password}
                                        onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                                        placeholder="••••••••"
                                        required
                                    />
                                </div>
                                <div className="sa-form-group sa-full">
                                    <label>Rol</label>
                                    <select
                                        value={newUser.role}
                                        onChange={e => setNewUser({ ...newUser, role: e.target.value })}
                                    >
                                        <option value="agent">Agent</option>
                                        <option value="manager">Manager</option>
                                        <option value="admin">Admin</option>
                                    </select>
                                </div>
                            </div>
                            <div className="sa-modal-actions">
                                <button type="button" className="sa-btn-secondary" onClick={() => setShowAddUserModal(false)}>Vazgeç</button>
                                <button type="submit" className="sa-btn-primary" disabled={saving}>
                                    {saving ? 'Ekleniyor...' : 'Kullanıcı Ekle'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
