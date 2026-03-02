import { useState, useEffect } from 'react';
import { customersAPI } from '../lib/api';
import { Users, Search, Filter, Edit3, Save, X } from 'lucide-react';

export default function CustomersPage() {
    const [customers, setCustomers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [catFilter, setCatFilter] = useState('all');
    const [editing, setEditing] = useState(null);
    const [editCat, setEditCat] = useState('');

    useEffect(() => { loadCustomers(); }, [catFilter, search]);

    const loadCustomers = async () => {
        try {
            const res = await customersAPI.list({ category: catFilter !== 'all' ? catFilter : undefined, search: search || undefined });
            setCustomers(res.data.customers || []);
        } catch (err) { console.error(err); }
        finally { setLoading(false); }
    };

    const saveCategory = async (id) => {
        try {
            await customersAPI.updateCategory(id, editCat);
            setEditing(null);
            loadCustomers();
        } catch (err) { console.error(err); }
    };

    const getCatBadge = (c) => {
        const cls = { hot: 'badge-hot', warm: 'badge-warm', cold: 'badge-cold', unqualified: 'badge-unqualified' };
        const lbl = { hot: '🔥 Hot', warm: '☀️ Warm', cold: '❄️ Cold', unqualified: 'Belirsiz' };
        return <span className={`badge ${cls[c] || ''}`}>{lbl[c] || c}</span>;
    };

    const getSourceBadge = (s) => {
        if (s === 'instagram') return <span className="badge badge-instagram" style={{ fontSize: 10 }}>📸 Instagram</span>;
        if (s === 'whatsapp') return <span className="badge badge-whatsapp" style={{ fontSize: 10 }}>💬 WhatsApp</span>;
        return <span className="badge" style={{ fontSize: 10 }}>{s}</span>;
    };

    const formatDate = (d) => d ? new Date(d).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';

    const getScoreColor = (score) => {
        if (score >= 75) return '#ef4444';
        if (score >= 40) return '#f59e0b';
        return '#3b82f6';
    };

    if (loading) return <div className="loading-center"><div className="loading-spinner" /></div>;

    return (
        <div className="animate-fade-in">
            <div className="page-header">
                <h1>Müşteriler</h1>
                <p>Tüm müşterilerinizi görüntüleyin ve kategorize edin</p>
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: 1, maxWidth: 350 }}>
                    <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input className="input" placeholder="Müşteri ara..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 36 }} />
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                    {['all', 'hot', 'warm', 'cold', 'unqualified'].map(f => (
                        <button key={f} className={`btn btn-sm ${catFilter === f ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setCatFilter(f)}>
                            {f === 'all' ? 'Tümü' : f === 'hot' ? '🔥 Hot' : f === 'warm' ? '☀️ Warm' : f === 'cold' ? '❄️ Cold' : 'Belirsiz'}
                        </button>
                    ))}
                </div>
            </div>

            {/* Table */}
            <div className="glass-card" style={{ overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                            {['Müşteri', 'Kategori', 'Lead Skor', 'Kaynak', 'Telefon', 'Son Mesaj', 'İşlem'].map(h => (
                                <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                    {h}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {customers.map((c, i) => (
                            <tr key={c.id} style={{ borderBottom: '1px solid var(--border-color)', transition: 'background var(--transition-fast)' }}
                                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                            >
                                <td style={{ padding: '12px 16px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <div style={{
                                            width: 36, height: 36, borderRadius: 'var(--radius-md)',
                                            background: c.category === 'hot' ? 'var(--hot-bg)' : c.category === 'warm' ? 'var(--warm-bg)' : 'var(--bg-tertiary)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            color: c.category === 'hot' ? 'var(--hot)' : c.category === 'warm' ? 'var(--warm)' : 'var(--text-secondary)',
                                            fontWeight: 700, fontSize: 14
                                        }}>
                                            {c.name?.charAt(0)?.toUpperCase()}
                                        </div>
                                        <div>
                                            <div style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</div>
                                            {c.email && <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{c.email}</div>}
                                        </div>
                                    </div>
                                </td>
                                <td style={{ padding: '12px 16px' }}>
                                    {editing === c.id ? (
                                        <select value={editCat} onChange={e => setEditCat(e.target.value)}
                                            style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-accent)', borderRadius: 'var(--radius-sm)', padding: '4px 8px', fontSize: 12 }}>
                                            <option value="hot">🔥 Hot</option>
                                            <option value="warm">☀️ Warm</option>
                                            <option value="cold">❄️ Cold</option>
                                            <option value="unqualified">Belirsiz</option>
                                        </select>
                                    ) : getCatBadge(c.category)}
                                </td>
                                <td style={{ padding: '12px 16px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <div style={{ width: 60, height: 6, borderRadius: 'var(--radius-full)', background: 'var(--bg-tertiary)', overflow: 'hidden' }}>
                                            <div style={{ width: `${c.lead_score}%`, height: '100%', borderRadius: 'var(--radius-full)', background: getScoreColor(c.lead_score), transition: 'width 0.3s ease' }} />
                                        </div>
                                        <span style={{ fontSize: 13, fontWeight: 600, color: getScoreColor(c.lead_score) }}>{c.lead_score}</span>
                                    </div>
                                </td>
                                <td style={{ padding: '12px 16px' }}>{getSourceBadge(c.source)}</td>
                                <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-secondary)' }}>{c.phone || '-'}</td>
                                <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-tertiary)' }}>{formatDate(c.last_message_at)}</td>
                                <td style={{ padding: '12px 16px' }}>
                                    {editing === c.id ? (
                                        <div style={{ display: 'flex', gap: 4 }}>
                                            <button className="btn btn-sm btn-primary" onClick={() => saveCategory(c.id)} style={{ padding: '4px 8px' }}><Save size={13} /></button>
                                            <button className="btn btn-sm btn-ghost" onClick={() => setEditing(null)} style={{ padding: '4px 8px' }}><X size={13} /></button>
                                        </div>
                                    ) : (
                                        <button className="btn btn-sm btn-ghost" onClick={() => { setEditing(c.id); setEditCat(c.category); }} style={{ padding: '4px 8px' }}>
                                            <Edit3 size={13} />
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {customers.length === 0 && (
                    <div className="empty-state"><Users /><p>Müşteri bulunamadı</p></div>
                )}
            </div>
        </div>
    );
}
