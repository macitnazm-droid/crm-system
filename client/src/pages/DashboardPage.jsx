import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { reportsAPI, conversationsAPI } from '../lib/api';
import { MessageSquare, Bot, UserCheck, Users, TrendingUp, ArrowRight, Zap, Clock } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

export default function DashboardPage() {
    const [stats, setStats] = useState(null);
    const [categories, setCategories] = useState(null);
    const [conversations, setConversations] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            const [statsRes, catRes, convRes] = await Promise.all([
                reportsAPI.today(),
                reportsAPI.categories(),
                conversationsAPI.list({ status: 'open' })
            ]);
            setStats(statsRes.data);
            setCategories(catRes.data);
            setConversations(convRes.data.conversations?.slice(0, 5) || []);
        } catch (err) {
            console.error('Dashboard data error:', err);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return <div className="loading-center"><div className="loading-spinner" /></div>;
    }

    const statCards = [
        { label: 'Toplam Mesaj', value: stats?.total_messages || 0, icon: MessageSquare, color: '#6366f1', bg: 'rgba(99,102,241,0.12)' },
        { label: 'AI Yanıtları', value: stats?.ai_responses || 0, icon: Bot, color: '#a855f7', bg: 'rgba(168,85,247,0.12)' },
        { label: 'Manuel Yanıtlar', value: stats?.manual_responses || 0, icon: UserCheck, color: '#06b6d4', bg: 'rgba(6,182,212,0.12)' },
        { label: 'Aktif Konuşma', value: stats?.active_conversations || 0, icon: TrendingUp, color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
    ];

    const pieData = categories ? [
        { name: 'Hot 🔥', value: categories.categories.hot || 0, color: '#ef4444' },
        { name: 'Warm ☀️', value: categories.categories.warm || 0, color: '#f59e0b' },
        { name: 'Cold ❄️', value: categories.categories.cold || 0, color: '#3b82f6' },
        { name: 'Belirsiz', value: categories.categories.unqualified || 0, color: '#6b7280' },
    ].filter(d => d.value > 0) : [];

    const getCategoryBadge = (cat) => {
        const map = { hot: 'badge-hot', warm: 'badge-warm', cold: 'badge-cold', unqualified: 'badge-unqualified' };
        const labels = { hot: '🔥 Hot', warm: '☀️ Warm', cold: '❄️ Cold', unqualified: 'Belirsiz' };
        return <span className={`badge ${map[cat] || ''}`}>{labels[cat] || cat}</span>;
    };

    const getSourceBadge = (src) => {
        if (src === 'instagram') return <span className="badge badge-instagram">📸 Instagram</span>;
        if (src === 'whatsapp') return <span className="badge badge-whatsapp">💬 WhatsApp</span>;
        return <span className="badge">{src}</span>;
    };

    const timeAgo = (date) => {
        const now = new Date();
        const d = new Date(date);
        const diff = Math.floor((now - d) / 1000);
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
                    <p>Bugünün özeti ve güncel durumu</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-tertiary)', fontSize: 13 }}>
                    <Zap size={14} style={{ color: 'var(--accent-primary)' }} />
                    AI Otomasyon Oranı: <strong style={{ color: 'var(--accent-primary-hover)' }}>{stats?.ai_rate || 0}%</strong>
                </div>
            </div>

            {/* Stat Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
                {statCards.map((s, i) => (
                    <div key={i} className="glass-card stat-card" style={{ animationDelay: `${i * 80}ms` }}>
                        <div className="stat-icon" style={{ background: s.bg, color: s.color }}>
                            <s.icon size={20} />
                        </div>
                        <div className="stat-value">{s.value}</div>
                        <div className="stat-label">{s.label}</div>
                    </div>
                ))}
            </div>

            {/* Two Columns */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 20 }}>
                {/* Recent Conversations */}
                <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h3 style={{ fontSize: 15, fontWeight: 600 }}>Son Konuşmalar</h3>
                        <Link to="/conversations" className="btn btn-ghost btn-sm" style={{ textDecoration: 'none', fontSize: 13 }}>
                            Tümü <ArrowRight size={14} />
                        </Link>
                    </div>
                    <div>
                        {conversations.length === 0 ? (
                            <div className="empty-state" style={{ padding: 40 }}>
                                <MessageSquare />
                                <p>Henüz konuşma yok</p>
                            </div>
                        ) : (
                            conversations.map((conv, i) => (
                                <Link
                                    key={conv.id}
                                    to="/conversations"
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 14,
                                        padding: '14px 20px',
                                        textDecoration: 'none',
                                        color: 'inherit',
                                        borderBottom: i < conversations.length - 1 ? '1px solid var(--border-color)' : 'none',
                                        transition: 'background var(--transition-fast)',
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                >
                                    <div style={{
                                        width: 40, height: 40, borderRadius: 'var(--radius-md)',
                                        background: 'var(--accent-gradient)', display: 'flex', alignItems: 'center',
                                        justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 14, flexShrink: 0
                                    }}>
                                        {conv.customer_name?.charAt(0)?.toUpperCase() || '?'}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <span style={{ fontWeight: 600, fontSize: 14 }}>{conv.customer_name}</span>
                                            {getCategoryBadge(conv.customer_category)}
                                        </div>
                                        <p style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>
                                            {conv.last_message_preview}
                                        </p>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}><Clock size={10} /> {timeAgo(conv.updated_at)}</span>
                                        {conv.unread_count > 0 && (
                                            <span style={{
                                                background: 'var(--accent-primary)', color: 'white', fontSize: 11, fontWeight: 700,
                                                padding: '2px 7px', borderRadius: 'var(--radius-full)', minWidth: 20, textAlign: 'center'
                                            }}>
                                                {conv.unread_count}
                                            </span>
                                        )}
                                    </div>
                                </Link>
                            ))
                        )}
                    </div>
                </div>

                {/* Category Pie */}
                <div className="glass-card" style={{ padding: 20 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Müşteri Kategorileri</h3>
                    {pieData.length > 0 ? (
                        <>
                            <div style={{ height: 200 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={pieData}
                                            cx="50%" cy="50%"
                                            innerRadius={55} outerRadius={85}
                                            paddingAngle={4}
                                            dataKey="value"
                                            stroke="none"
                                        >
                                            {pieData.map((entry, i) => (
                                                <Cell key={i} fill={entry.color} />
                                            ))}
                                        </Pie>
                                        <Tooltip
                                            contentStyle={{
                                                background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                                                borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 13
                                            }}
                                        />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
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
                    ) : (
                        <div className="empty-state"><p>Veri yok</p></div>
                    )}
                </div>
            </div>
        </div>
    );
}
