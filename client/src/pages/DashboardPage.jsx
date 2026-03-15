import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { reportsAPI, conversationsAPI } from '../lib/api';
import {
    MessageSquare, Bot, TrendingUp, ArrowRight, Zap, Clock, Target
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, AreaChart, Area, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';

export default function DashboardPage() {
    const [stats, setStats] = useState(null);
    const [dashboard, setDashboard] = useState(null);
    const [conversations, setConversations] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => { loadData(); }, []);

    const loadData = async () => {
        try {
            const [statsRes, dashRes, convRes] = await Promise.all([
                reportsAPI.today(),
                reportsAPI.dashboard().catch(() => ({ data: null })),
                conversationsAPI.list({ status: 'open' })
            ]);
            setStats(statsRes.data);
            setDashboard(dashRes.data);
            setConversations(convRes.data.conversations?.slice(0, 5) || []);
        } catch (err) {
            console.error('Dashboard data error:', err);
        } finally {
            setLoading(false);
        }
    };

    if (loading) return <div className="loading-center"><div className="loading-spinner" /></div>;

    const statCards = [
        { label: 'Bugün Mesaj', value: dashboard?.messages?.today || stats?.total_messages || 0, sub: `Hafta: ${dashboard?.messages?.week || 0}`, icon: MessageSquare, color: '#6366f1', bg: 'rgba(99,102,241,0.12)' },
        { label: 'AI Yanıtları', value: stats?.ai_responses || 0, sub: `Oran: %${stats?.ai_rate || 0}`, icon: Bot, color: '#a855f7', bg: 'rgba(168,85,247,0.12)' },
        { label: 'Ort. Yanıt Süresi', value: dashboard?.avg_response_time_min ? `${dashboard.avg_response_time_min}dk` : '-', sub: 'Son 7 gün', icon: Clock, color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
        { label: 'Aktif Konuşma', value: dashboard?.active_conversations || stats?.active_conversations || 0, sub: `Yeni: ${dashboard?.new_customers_week || 0}`, icon: TrendingUp, color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
        { label: 'Lead Dönüşüm', value: dashboard?.leads ? `%${dashboard.leads.conversion_rate}` : '-', sub: `${dashboard?.leads?.converted || 0}/${dashboard?.leads?.total || 0}`, icon: Target, color: '#06b6d4', bg: 'rgba(6,182,212,0.12)' },
    ];

    const pieData = dashboard?.categories ? [
        { name: 'Hot', value: dashboard.categories.hot || 0, color: '#ef4444' },
        { name: 'Warm', value: dashboard.categories.warm || 0, color: '#f59e0b' },
        { name: 'Cold', value: dashboard.categories.cold || 0, color: '#3b82f6' },
        { name: 'Belirsiz', value: dashboard.categories.unqualified || 0, color: '#6b7280' },
    ].filter(d => d.value > 0) : [];

    const channelData = (dashboard?.channels?.customers || []).map(c => {
        const labels = { instagram: 'Instagram', whatsapp: 'WhatsApp', messenger: 'Messenger', manual: 'Manuel', api: 'API' };
        const colors = { instagram: '#E1306C', whatsapp: '#25D366', messenger: '#006AFF', manual: '#6b7280', api: '#8b5cf6' };
        return { name: labels[c.source] || c.source, value: c.count, color: colors[c.source] || '#6b7280' };
    });

    const chartData = (dashboard?.daily_chart || []).map(d => ({
        date: d.date?.substring(5),
        Gelen: d.inbound,
        Giden: d.outbound,
        AI: d.ai,
    }));

    const getCategoryBadge = (cat) => {
        const map = { hot: 'badge-hot', warm: 'badge-warm', cold: 'badge-cold', unqualified: 'badge-unqualified' };
        const labels = { hot: 'Hot', warm: 'Warm', cold: 'Cold', unqualified: 'Belirsiz' };
        return <span className={`badge ${map[cat] || ''}`}>{labels[cat] || cat}</span>;
    };

    const timeAgo = (date) => {
        const diff = Math.floor((Date.now() - new Date(date)) / 1000);
        if (diff < 60) return `${diff}s`;
        if (diff < 3600) return `${Math.floor(diff / 60)}dk`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}sa`;
        return `${Math.floor(diff / 86400)}g`;
    };

    return (
        <div className="animate-fade-in">
            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1>Dashboard</h1>
                    <p>Genel durum ve istatistikler</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-tertiary)', fontSize: 13 }}>
                        <Zap size={14} style={{ color: 'var(--accent-primary)' }} />
                        AI: <strong style={{ color: 'var(--accent-primary-hover)' }}>%{stats?.ai_rate || 0}</strong>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        Bu ay: <strong>{dashboard?.messages?.month || 0}</strong> mesaj
                    </div>
                </div>
            </div>

            {/* Stat Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14, marginBottom: 20 }}>
                {statCards.map((s, i) => (
                    <div key={i} className="glass-card stat-card" style={{ animationDelay: `${i * 60}ms` }}>
                        <div className="stat-icon" style={{ background: s.bg, color: s.color }}>
                            <s.icon size={20} />
                        </div>
                        <div className="stat-value">{s.value}</div>
                        <div className="stat-label">{s.label}</div>
                        {s.sub && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{s.sub}</div>}
                    </div>
                ))}
            </div>

            {/* Charts Row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                {/* Daily Message Chart */}
                <div className="glass-card" style={{ padding: 20 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Mesaj Trendi (14 Gün)</h3>
                    {chartData.length > 0 ? (
                        <div style={{ height: 220 }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={chartData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                                    <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                                    <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 12 }} />
                                    <Area type="monotone" dataKey="Gelen" stackId="1" stroke="#6366f1" fill="rgba(99,102,241,0.3)" />
                                    <Area type="monotone" dataKey="Giden" stackId="1" stroke="#10b981" fill="rgba(16,185,129,0.3)" />
                                    <Area type="monotone" dataKey="AI" stackId="2" stroke="#a855f7" fill="rgba(168,85,247,0.2)" strokeDasharray="4 4" />
                                    <Legend wrapperStyle={{ fontSize: 11 }} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    ) : <div className="empty-state"><p>Veri yok</p></div>}
                </div>

                {/* Channel Distribution */}
                <div className="glass-card" style={{ padding: 20 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Kanal Dağılımı</h3>
                    {channelData.length > 0 ? (
                        <>
                            <div style={{ height: 180 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie data={channelData} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={4} dataKey="value" stroke="none">
                                            {channelData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                                        </Pie>
                                        <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 12 }} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                                {channelData.map((d, i) => (
                                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <div style={{ width: 10, height: 10, borderRadius: '50%', background: d.color }} />
                                            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{d.name}</span>
                                        </div>
                                        <span style={{ fontSize: 14, fontWeight: 600 }}>{d.value}</span>
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : <div className="empty-state"><p>Veri yok</p></div>}
                </div>
            </div>

            {/* Bottom Row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16 }}>
                {/* Recent Conversations */}
                <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h3 style={{ fontSize: 15, fontWeight: 600 }}>Son Konuşmalar</h3>
                        <Link to="/conversations" className="btn btn-ghost btn-sm" style={{ textDecoration: 'none', fontSize: 13 }}>
                            Tümü <ArrowRight size={14} />
                        </Link>
                    </div>
                    {conversations.length === 0 ? (
                        <div className="empty-state" style={{ padding: 40 }}><MessageSquare /><p>Henüz konuşma yok</p></div>
                    ) : conversations.map((conv, i) => (
                        <Link key={conv.id} to="/conversations" style={{
                            display: 'flex', alignItems: 'center', gap: 14, padding: '12px 20px', textDecoration: 'none', color: 'inherit',
                            borderBottom: i < conversations.length - 1 ? '1px solid var(--border-color)' : 'none', transition: 'background var(--transition-fast)',
                        }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                            <div style={{ width: 38, height: 38, borderRadius: 'var(--radius-md)', background: 'var(--accent-gradient)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
                                {conv.customer_name?.charAt(0)?.toUpperCase() || '?'}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span style={{ fontWeight: 600, fontSize: 14 }}>{conv.customer_name}</span>
                                    {getCategoryBadge(conv.customer_category)}
                                </div>
                                <p style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>
                                    {conv.last_message_preview}
                                </p>
                            </div>
                            <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{timeAgo(conv.updated_at)}</span>
                        </Link>
                    ))}
                </div>

                {/* Category Pie */}
                <div className="glass-card" style={{ padding: 20 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Müşteri Kategorileri</h3>
                    {pieData.length > 0 ? (
                        <>
                            <div style={{ height: 180 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={4} dataKey="value" stroke="none">
                                            {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                                        </Pie>
                                        <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 12 }} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                                {pieData.map((d, i) => (
                                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <div style={{ width: 10, height: 10, borderRadius: '50%', background: d.color }} />
                                            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{d.name}</span>
                                        </div>
                                        <span style={{ fontSize: 14, fontWeight: 600 }}>{d.value}</span>
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : <div className="empty-state"><p>Veri yok</p></div>}
                </div>
            </div>
        </div>
    );
}
