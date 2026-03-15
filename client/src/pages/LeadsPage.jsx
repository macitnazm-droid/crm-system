import { useState, useEffect } from 'react';
import { leadsAPI, appointmentsAPI } from '../lib/api';
import { useSocket } from '../context/SocketContext';
import {
    Search, Plus, Phone, Mail, Calendar, ChevronDown, Trash2, UserPlus,
    Target, ArrowRight, Filter, Download, Clock, X, Check
} from 'lucide-react';

const STATUS_CONFIG = {
    new: { label: 'Yeni', color: '#6366f1', bg: 'rgba(99,102,241,0.12)' },
    contacted: { label: 'İletişime Geçildi', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
    appointment: { label: 'Randevuya Dönüştü', color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
    converted: { label: 'Dönüştürüldü', color: '#06b6d4', bg: 'rgba(6,182,212,0.12)' },
    lost: { label: 'Kaybedildi', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
};

export default function LeadsPage() {
    const socket = useSocket();
    const [leads, setLeads] = useState([]);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [showAddModal, setShowAddModal] = useState(false);
    const [showApptModal, setShowApptModal] = useState(null);
    const [services, setServices] = useState([]);
    const [staffList, setStaffList] = useState([]);
    const [newLead, setNewLead] = useState({ name: '', phone: '', email: '', source: 'manual', notes: '' });
    const [apptForm, setApptForm] = useState({ appointment_date: '', start_time: '', service_id: '', staff_id: '', notes: '' });

    useEffect(() => { loadData(); }, [statusFilter]);

    useEffect(() => {
        if (!socket) return;
        const refresh = () => loadData();
        socket.on('lead:new', refresh);
        socket.on('lead:updated', refresh);
        socket.on('lead:deleted', refresh);
        return () => {
            socket.off('lead:new', refresh);
            socket.off('lead:updated', refresh);
            socket.off('lead:deleted', refresh);
        };
    }, [socket]);

    const loadData = async () => {
        try {
            const [leadsRes, statsRes] = await Promise.all([
                leadsAPI.list({ status: statusFilter !== 'all' ? statusFilter : undefined, search: search || undefined }),
                leadsAPI.stats(),
            ]);
            setLeads(leadsRes.data.leads || []);
            setStats(statsRes.data);
        } catch (err) { console.error(err); }
        finally { setLoading(false); }
    };

    const handleSearch = () => loadData();

    const updateStatus = async (id, status) => {
        try {
            await leadsAPI.updateStatus(id, status);
        } catch (err) { console.error(err); }
    };

    const deleteLead = async (id) => {
        if (!confirm('Bu lead silinecek, emin misiniz?')) return;
        try { await leadsAPI.delete(id); } catch (err) { console.error(err); }
    };

    const createLead = async () => {
        if (!newLead.name.trim()) return;
        try {
            await leadsAPI.create(newLead);
            setShowAddModal(false);
            setNewLead({ name: '', phone: '', email: '', source: 'manual', notes: '' });
        } catch (err) { console.error(err); }
    };

    const openApptModal = async (lead) => {
        setShowApptModal(lead);
        setApptForm({ appointment_date: '', start_time: '', service_id: '', staff_id: '', notes: lead.notes || '' });
        try {
            const [sRes, stRes] = await Promise.all([appointmentsAPI.getServices(), appointmentsAPI.getStaff()]);
            setServices(sRes.data.services || []);
            setStaffList(stRes.data.staff || []);
        } catch (err) { console.error(err); }
    };

    const createAppointment = async () => {
        if (!apptForm.appointment_date || !apptForm.start_time) return;
        try {
            await leadsAPI.createAppointment(showApptModal.id, apptForm);
            setShowApptModal(null);
        } catch (err) { console.error(err); }
    };

    const exportLeads = () => {
        window.open(`${import.meta.env.VITE_API_URL || ''}/api/reports/export/leads?token=${localStorage.getItem('crm_token')}`, '_blank');
    };

    const timeAgo = (d) => {
        const diff = Math.floor((Date.now() - new Date(d)) / 1000);
        if (diff < 60) return `${diff}s`;
        if (diff < 3600) return `${Math.floor(diff / 60)}dk`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}sa`;
        return `${Math.floor(diff / 86400)}g`;
    };

    if (loading) return <div className="loading-center"><div className="loading-spinner" /></div>;

    return (
        <div className="animate-fade-in">
            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1>Lead Yönetimi</h1>
                    <p>Facebook/Instagram reklamlarından gelen talepler</p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-secondary btn-sm" onClick={exportLeads} style={{ fontSize: 12 }}>
                        <Download size={14} /> Dışa Aktar
                    </button>
                    <button className="btn btn-primary btn-sm" onClick={() => setShowAddModal(true)} style={{ fontSize: 12 }}>
                        <Plus size={14} /> Yeni Lead
                    </button>
                </div>
            </div>

            {/* Stats */}
            {stats && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 20 }}>
                    {[
                        { label: 'Toplam', value: stats.total, color: '#6366f1' },
                        { label: 'Bugün', value: stats.today, color: '#10b981' },
                        { label: 'Bu Hafta', value: stats.this_week, color: '#f59e0b' },
                        { label: 'Dönüşüm', value: `%${stats.conversion_rate}`, color: '#06b6d4' },
                        { label: 'Kaybedilen', value: stats.by_status?.lost || 0, color: '#ef4444' },
                    ].map((s, i) => (
                        <div key={i} className="glass-card" style={{ padding: '14px 16px', textAlign: 'center' }}>
                            <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{s.label}</div>
                        </div>
                    ))}
                </div>
            )}

            {/* Filters */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: 1, maxWidth: 300 }}>
                    <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input className="input" placeholder="Lead ara..." value={search}
                        onChange={e => setSearch(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSearch()}
                        style={{ paddingLeft: 36, fontSize: 13 }} />
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                    {['all', 'new', 'contacted', 'appointment', 'converted', 'lost'].map(s => (
                        <button key={s} className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-ghost'}`}
                            onClick={() => setStatusFilter(s)} style={{ fontSize: 11 }}>
                            {s === 'all' ? 'Tümü' : STATUS_CONFIG[s]?.label || s}
                        </button>
                    ))}
                </div>
            </div>

            {/* Leads Table */}
            <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}>
                            <th style={thStyle}>Ad</th>
                            <th style={thStyle}>İletişim</th>
                            <th style={thStyle}>Kaynak</th>
                            <th style={thStyle}>Durum</th>
                            <th style={thStyle}>Tarih</th>
                            <th style={{ ...thStyle, textAlign: 'right' }}>İşlemler</th>
                        </tr>
                    </thead>
                    <tbody>
                        {leads.length === 0 ? (
                            <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                                <Target size={32} style={{ opacity: 0.3, marginBottom: 8 }} /><br />Henüz lead yok
                            </td></tr>
                        ) : leads.map(lead => (
                            <tr key={lead.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                <td style={tdStyle}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <div style={{
                                            width: 36, height: 36, borderRadius: 'var(--radius-md)',
                                            background: STATUS_CONFIG[lead.status]?.bg || 'var(--bg-tertiary)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            color: STATUS_CONFIG[lead.status]?.color || 'var(--text-secondary)',
                                            fontWeight: 700, fontSize: 14, flexShrink: 0
                                        }}>
                                            {lead.name?.charAt(0)?.toUpperCase() || '?'}
                                        </div>
                                        <div>
                                            <div style={{ fontWeight: 600, fontSize: 13 }}>{lead.name}</div>
                                            {lead.campaign_name && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{lead.campaign_name}</div>}
                                        </div>
                                    </div>
                                </td>
                                <td style={tdStyle}>
                                    <div style={{ fontSize: 12 }}>
                                        {lead.phone && <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Phone size={11} /> {lead.phone}</div>}
                                        {lead.email && <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}><Mail size={11} /> {lead.email}</div>}
                                    </div>
                                </td>
                                <td style={tdStyle}>
                                    <span className="badge" style={{ fontSize: 10 }}>
                                        {lead.source === 'facebook' ? 'Facebook' : lead.source === 'instagram' ? 'Instagram' : 'Manuel'}
                                    </span>
                                    {lead.form_name && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{lead.form_name}</div>}
                                </td>
                                <td style={tdStyle}>
                                    <select
                                        value={lead.status}
                                        onChange={e => updateStatus(lead.id, e.target.value)}
                                        style={{
                                            background: STATUS_CONFIG[lead.status]?.bg || 'var(--bg-tertiary)',
                                            color: STATUS_CONFIG[lead.status]?.color || 'var(--text-primary)',
                                            border: `1px solid ${STATUS_CONFIG[lead.status]?.color || 'var(--border-color)'}33`,
                                            borderRadius: 6, padding: '4px 8px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                                        }}
                                    >
                                        {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                                            <option key={key} value={key}>{cfg.label}</option>
                                        ))}
                                    </select>
                                </td>
                                <td style={tdStyle}>
                                    <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <Clock size={11} /> {timeAgo(lead.created_at)}
                                    </div>
                                </td>
                                <td style={{ ...tdStyle, textAlign: 'right' }}>
                                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                                        {lead.status !== 'appointment' && lead.status !== 'converted' && (
                                            <button className="btn btn-sm btn-secondary" onClick={() => openApptModal(lead)}
                                                style={{ fontSize: 11, padding: '4px 8px' }} title="Randevu Oluştur">
                                                <Calendar size={12} /> Randevu
                                            </button>
                                        )}
                                        <button className="btn btn-sm btn-ghost" onClick={() => deleteLead(lead.id)}
                                            style={{ fontSize: 11, padding: '4px 6px', color: 'var(--text-muted)' }} title="Sil">
                                            <Trash2 size={13} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Add Lead Modal */}
            {showAddModal && (
                <div style={overlayStyle} onClick={() => setShowAddModal(false)}>
                    <div style={modalStyle} onClick={e => e.stopPropagation()}>
                        <h3 style={{ marginBottom: 16 }}>Yeni Lead Ekle</h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <input className="input" placeholder="Ad Soyad *" value={newLead.name} onChange={e => setNewLead({ ...newLead, name: e.target.value })} />
                            <input className="input" placeholder="Telefon" value={newLead.phone} onChange={e => setNewLead({ ...newLead, phone: e.target.value })} />
                            <input className="input" placeholder="Email" value={newLead.email} onChange={e => setNewLead({ ...newLead, email: e.target.value })} />
                            <select className="input" value={newLead.source} onChange={e => setNewLead({ ...newLead, source: e.target.value })}>
                                <option value="manual">Manuel</option>
                                <option value="facebook">Facebook</option>
                                <option value="instagram">Instagram</option>
                                <option value="whatsapp">WhatsApp</option>
                            </select>
                            <textarea className="input" placeholder="Notlar" value={newLead.notes} onChange={e => setNewLead({ ...newLead, notes: e.target.value })} rows={2} />
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
                            <button className="btn btn-ghost" onClick={() => setShowAddModal(false)}>Vazgeç</button>
                            <button className="btn btn-primary" onClick={createLead}>Kaydet</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Appointment Modal */}
            {showApptModal && (
                <div style={overlayStyle} onClick={() => setShowApptModal(null)}>
                    <div style={modalStyle} onClick={e => e.stopPropagation()}>
                        <h3 style={{ marginBottom: 4 }}>Randevu Oluştur</h3>
                        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>{showApptModal.name} — {showApptModal.phone || 'Telefon yok'}</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <div>
                                <label style={labelStyle}>Tarih *</label>
                                <input className="input" type="date" value={apptForm.appointment_date} onChange={e => setApptForm({ ...apptForm, appointment_date: e.target.value })} />
                            </div>
                            <div>
                                <label style={labelStyle}>Saat *</label>
                                <input className="input" type="time" value={apptForm.start_time} onChange={e => setApptForm({ ...apptForm, start_time: e.target.value })} />
                            </div>
                            {services.length > 0 && (
                                <div>
                                    <label style={labelStyle}>Hizmet</label>
                                    <select className="input" value={apptForm.service_id} onChange={e => setApptForm({ ...apptForm, service_id: e.target.value })}>
                                        <option value="">Seçiniz</option>
                                        {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                    </select>
                                </div>
                            )}
                            {staffList.length > 0 && (
                                <div>
                                    <label style={labelStyle}>Personel</label>
                                    <select className="input" value={apptForm.staff_id} onChange={e => setApptForm({ ...apptForm, staff_id: e.target.value })}>
                                        <option value="">Seçiniz</option>
                                        {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                    </select>
                                </div>
                            )}
                            <div>
                                <label style={labelStyle}>Notlar</label>
                                <textarea className="input" value={apptForm.notes} onChange={e => setApptForm({ ...apptForm, notes: e.target.value })} rows={2} />
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
                            <button className="btn btn-ghost" onClick={() => setShowApptModal(null)}>Vazgeç</button>
                            <button className="btn btn-primary" onClick={createAppointment}>Randevu Oluştur</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

const thStyle = { padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 };
const tdStyle = { padding: '12px 16px', fontSize: 13 };
const labelStyle = { fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' };
const overlayStyle = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const modalStyle = { background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', padding: 24, width: 420, maxHeight: '80vh', overflowY: 'auto', border: '1px solid var(--border-color)' };
