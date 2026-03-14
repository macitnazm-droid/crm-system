import { useState, useEffect, useMemo } from 'react';
import { reportsAPI, appointmentsAPI } from '../lib/api';
import { BarChart3, TrendingUp, Users, Bot, UserCheck, Percent, Calendar, CheckCircle, XCircle, Clock, Search, ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';

export default function ReportsPage() {
    const [stats, setStats] = useState(null);
    const [categories, setCategories] = useState(null);
    const [agents, setAgents] = useState([]);
    const [sources, setSources] = useState([]);
    const [appointments, setAppointments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [scanning, setScanning] = useState(false);
    const [scanResult, setScanResult] = useState(null);
    const [calMonth, setCalMonth] = useState(new Date().getMonth());
    const [calYear, setCalYear] = useState(new Date().getFullYear());
    const [apptPeriod, setApptPeriod] = useState('daily'); // daily, weekly, monthly

    useEffect(() => { loadData(); }, []);

    const loadData = async () => {
        try {
            const [sRes, cRes, aRes, srRes, apptRes] = await Promise.all([
                reportsAPI.today(),
                reportsAPI.categories(),
                reportsAPI.agents(),
                reportsAPI.sources(),
                appointmentsAPI.list(),
            ]);
            setStats(sRes.data);
            setCategories(cRes.data);
            setAgents(aRes.data.agents || []);
            setSources(srRes.data.sources || []);
            setAppointments(apptRes.data.appointments || []);
        } catch (err) { console.error(err); }
        finally { setLoading(false); }
    };

    const updateAppointmentStatus = async (id, status) => {
        try {
            await appointmentsAPI.updateStatus(id, status);
            setAppointments(prev => prev.map(a => a.id === id ? { ...a, status } : a));
        } catch (err) { console.error(err); }
    };

    const handleScan = async () => {
        setScanning(true);
        setScanResult(null);
        try {
            const res = await appointmentsAPI.scan();
            setScanResult(res.data);
            if (res.data.found > 0) {
                const apptRes = await appointmentsAPI.list();
                setAppointments(apptRes.data.appointments || []);
            }
        } catch (err) { console.error(err); }
        finally { setScanning(false); }
    };

    // ===== Randevu Takvimi Hesaplamaları (hook'lar loading check'ten ÖNCE olmalı) =====
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const firstDay = new Date(calYear, calMonth, 1);
    const lastDay = new Date(calYear, calMonth + 1, 0);
    const startWeekday = (firstDay.getDay() + 6) % 7; // Pazartesi = 0
    const daysInMonth = lastDay.getDate();

    const apptCountByDate = useMemo(() => {
        const counts = {};
        (appointments || []).forEach(a => {
            const d = a.appointment_date;
            if (d) counts[d] = (counts[d] || 0) + 1;
        });
        return counts;
    }, [appointments]);

    const apptStats = useMemo(() => {
        const now = new Date();
        let filtered = appointments || [];

        if (apptPeriod === 'daily') {
            filtered = filtered.filter(a => a.appointment_date === todayStr);
        } else if (apptPeriod === 'weekly') {
            const weekStart = new Date(now);
            weekStart.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1));
            const weekStartStr = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            const weekEndStr = `${weekEnd.getFullYear()}-${String(weekEnd.getMonth() + 1).padStart(2, '0')}-${String(weekEnd.getDate()).padStart(2, '0')}`;
            filtered = filtered.filter(a => a.appointment_date >= weekStartStr && a.appointment_date <= weekEndStr);
        } else {
            const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            filtered = filtered.filter(a => a.appointment_date?.startsWith(monthStr));
        }

        const total = filtered.length;
        const completed = filtered.filter(a => a.status === 'completed').length;
        const cancelled = filtered.filter(a => a.status === 'cancelled').length;

        const sourceCounts = {};
        filtered.forEach(a => {
            const src = a.source || a.customer_source || 'İşletme Tarafından';
            const label = src === 'ai' ? 'İşletme Tarafından' : src === 'manual' ? 'İşletme Tarafından' : src === 'website' ? 'İşletme Websitesi' : src === 'salon_randevu' ? 'SalonRandevu.com' : 'İşletme Tarafından';
            sourceCounts[label] = (sourceCounts[label] || 0) + 1;
        });

        return { total, completed, cancelled, sourceCounts };
    }, [appointments, apptPeriod, todayStr]);

    if (loading) return <div className="loading-center"><div className="loading-spinner" /></div>;

    const sourceColors = {
        'İşletme Tarafından': '#a855f7',
        'İşletme Websitesi': '#6b7280',
        'SalonRandevu.com': '#f59e0b'
    };

    const sourcePieData = Object.entries(apptStats.sourceCounts).map(([name, value]) => ({
        name, value, fill: sourceColors[name] || '#6366f1'
    }));

    const totalSourceCount = sourcePieData.reduce((s, d) => s + d.value, 0);

    const monthNames = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
    const dayNames = ['Pts', 'Sal', 'Çar', 'Per', 'Cum', 'Cts', 'Paz'];

    const prevMonth = () => {
        if (calMonth === 0) { setCalMonth(11); setCalYear(calYear - 1); }
        else setCalMonth(calMonth - 1);
    };
    const nextMonth = () => {
        if (calMonth === 11) { setCalMonth(0); setCalYear(calYear + 1); }
        else setCalMonth(calMonth + 1);
    };

    const periodTabs = [
        { key: 'daily', label: 'Günlük' },
        { key: 'weekly', label: 'Son 7 gün' },
        { key: 'monthly', label: 'Son 30 gün' },
    ];

    const catChartData = categories ? [
        { name: 'Hot', value: categories.categories.hot, fill: '#ef4444' },
        { name: 'Warm', value: categories.categories.warm, fill: '#f59e0b' },
        { name: 'Cold', value: categories.categories.cold, fill: '#3b82f6' },
        { name: 'Belirsiz', value: categories.categories.unqualified, fill: '#6b7280' },
    ].filter(d => d.value > 0) : [];

    const aiVsManual = [
        { name: 'AI Yanıt', value: stats?.ai_responses || 0, fill: '#a855f7' },
        { name: 'Manuel', value: stats?.manual_responses || 0, fill: '#06b6d4' },
    ].filter(d => d.value > 0);

    const sourceData = sources.map(s => ({
        name: s.source === 'instagram' ? 'Instagram' : s.source === 'whatsapp' ? 'WhatsApp' : s.source === 'messenger' ? 'Messenger' : s.source,
        value: s.count,
        fill: s.source === 'instagram' ? '#e1306c' : s.source === 'whatsapp' ? '#25d366' : s.source === 'messenger' ? '#006AFF' : '#6366f1'
    }));

    const tooltipStyle = {
        contentStyle: {
            background: 'var(--bg-card)', border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 13
        }
    };

    const sourceLabel = (s) => s === 'instagram' ? 'Instagram' : s === 'whatsapp' ? 'WhatsApp' : s || '-';
    const sourceColor = (s) => s === 'instagram' ? { bg: 'rgba(225,48,108,0.15)', color: '#e1306c' } : s === 'whatsapp' ? { bg: 'rgba(37,211,102,0.15)', color: '#25d366' } : { bg: 'var(--bg-tertiary)', color: 'var(--text-secondary)' };

    return (
        <div className="animate-fade-in">
            <div className="page-header">
                <h1>Raporlar</h1>
                <p>Performans metrikleri ve analitik veriler</p>
            </div>

            {/* Randevu Özet: Takvim + Ayrıntılar + İstatistikler */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20, marginBottom: 24 }}>
                {/* Randevu Takvimi */}
                <div className="glass-card" style={{ padding: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
                        <h3 style={{ fontSize: 15, fontWeight: 600 }}>Randevu Takvimi</h3>
                        <Info size={14} style={{ color: 'var(--accent-primary)', cursor: 'pointer' }} title="Tarihlerdeki sayılar o günkü randevu adedini gösterir" />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                        <button onClick={prevMonth} className="btn btn-ghost btn-sm" style={{ padding: 4 }}><ChevronLeft size={16} /></button>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>{monthNames[calMonth]} {calYear}</span>
                        <button onClick={nextMonth} className="btn btn-ghost btn-sm" style={{ padding: 4 }}><ChevronRight size={16} /></button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, textAlign: 'center' }}>
                        {dayNames.map(d => (
                            <div key={d} style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', padding: '4px 0' }}>{d}</div>
                        ))}
                        {Array.from({ length: startWeekday }).map((_, i) => <div key={`e${i}`} />)}
                        {Array.from({ length: daysInMonth }).map((_, i) => {
                            const day = i + 1;
                            const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                            const count = apptCountByDate[dateStr] || 0;
                            const isToday = dateStr === todayStr;
                            return (
                                <div key={day} style={{
                                    position: 'relative',
                                    padding: '6px 0',
                                    borderRadius: 'var(--radius-sm)',
                                    background: isToday ? 'var(--accent-primary)' : 'transparent',
                                    color: isToday ? 'white' : 'var(--text-primary)',
                                    fontWeight: isToday ? 700 : 400,
                                    fontSize: 13,
                                    cursor: count > 0 ? 'pointer' : 'default',
                                }}>
                                    {day}
                                    {count > 0 && (
                                        <span style={{
                                            position: 'absolute',
                                            top: 0,
                                            right: 2,
                                            fontSize: 9,
                                            fontWeight: 700,
                                            background: isToday ? 'white' : 'var(--accent-primary)',
                                            color: isToday ? 'var(--accent-primary)' : 'white',
                                            borderRadius: '50%',
                                            width: 15,
                                            height: 15,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            lineHeight: 1,
                                        }}>
                                            {count}
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Randevu Ayrıntıları */}
                <div className="glass-card" style={{ padding: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
                        <h3 style={{ fontSize: 15, fontWeight: 600 }}>Randevu Ayrıntıları</h3>
                        <Info size={14} style={{ color: 'var(--accent-primary)' }} />
                    </div>
                    <div style={{ display: 'flex', gap: 0, marginBottom: 20, background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', padding: 3 }}>
                        {periodTabs.map(t => (
                            <button key={t.key} onClick={() => setApptPeriod(t.key)}
                                style={{
                                    flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
                                    borderRadius: 'var(--radius-sm)',
                                    background: apptPeriod === t.key ? 'var(--accent-primary)' : 'transparent',
                                    color: apptPeriod === t.key ? 'white' : 'var(--text-secondary)',
                                    transition: 'all var(--transition-fast)',
                                }}>{t.label}</button>
                        ))}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                            <div style={{ width: 44, height: 44, borderRadius: 'var(--radius-md)', background: 'rgba(245,158,11,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Clock size={20} style={{ color: '#f59e0b' }} />
                            </div>
                            <div>
                                <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Oluşturulanlar</div>
                                <div style={{ fontSize: 28, fontWeight: 700 }}>{apptStats.total}</div>
                            </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                            <div style={{ width: 44, height: 44, borderRadius: 'var(--radius-md)', background: 'rgba(16,185,129,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <CheckCircle size={20} style={{ color: '#10b981' }} />
                            </div>
                            <div>
                                <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Sonuçlananlar</div>
                                <div style={{ fontSize: 28, fontWeight: 700 }}>{apptStats.completed}</div>
                            </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                            <div style={{ width: 44, height: 44, borderRadius: 'var(--radius-md)', background: 'rgba(239,68,68,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <XCircle size={20} style={{ color: '#ef4444' }} />
                            </div>
                            <div>
                                <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Sonuçlanmayanlar</div>
                                <div style={{ fontSize: 28, fontWeight: 700 }}>{apptStats.cancelled}</div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Randevu İstatistikleri */}
                <div className="glass-card" style={{ padding: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
                        <h3 style={{ fontSize: 15, fontWeight: 600 }}>Randevu İstatistikleri</h3>
                        <Info size={14} style={{ color: 'var(--accent-primary)' }} />
                    </div>
                    <div style={{ display: 'flex', gap: 0, marginBottom: 20, background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', padding: 3 }}>
                        {periodTabs.map(t => (
                            <button key={t.key} onClick={() => setApptPeriod(t.key)}
                                style={{
                                    flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
                                    borderRadius: 'var(--radius-sm)',
                                    background: apptPeriod === t.key ? 'var(--accent-primary)' : 'transparent',
                                    color: apptPeriod === t.key ? 'white' : 'var(--text-secondary)',
                                    transition: 'all var(--transition-fast)',
                                }}>{t.label}</button>
                        ))}
                    </div>
                    <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
                        {/* Donut chart */}
                        <div style={{ width: 140, height: 140, flexShrink: 0 }}>
                            {totalSourceCount > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie data={sourcePieData} cx="50%" cy="50%" innerRadius={40} outerRadius={60} paddingAngle={3} dataKey="value" stroke="none">
                                            {sourcePieData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                                        </Pie>
                                    </PieChart>
                                </ResponsiveContainer>
                            ) : (
                                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <div style={{ width: 120, height: 120, borderRadius: '50%', border: '12px solid var(--border-color)', opacity: 0.4 }} />
                                </div>
                            )}
                        </div>
                        {/* Legend */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
                            {['İşletme Tarafından', 'İşletme Websitesi', 'SalonRandevu.com'].map(label => {
                                const val = apptStats.sourceCounts[label] || 0;
                                const color = sourceColors[label];
                                const pct = totalSourceCount > 0 ? Math.round((val / totalSourceCount) * 100) : 0;
                                return (
                                    <div key={label}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</span>
                                            <span style={{ fontSize: 13, fontWeight: 700 }}>{val}</span>
                                        </div>
                                        <div style={{ height: 6, background: 'var(--bg-tertiary)', borderRadius: 3, overflow: 'hidden' }}>
                                            <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.3s' }} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>

            {/* Randevular - Tablo */}
            <div className="glass-card" style={{ padding: 0, overflow: 'hidden', marginBottom: 24 }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Calendar size={18} style={{ color: 'var(--accent-primary)' }} />
                    <h3 style={{ fontSize: 15, fontWeight: 600 }}>AI Tespit Edilen Randevular</h3>
                    {scanResult && <span style={{ fontSize: 12, color: scanResult.found > 0 ? '#22c55e' : 'var(--text-muted)' }}>{scanResult.found > 0 ? `${scanResult.found} yeni randevu bulundu!` : `${scanResult.scanned} konuşma tarandı, yeni randevu yok`}</span>}
                    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button className="btn btn-sm btn-ghost" onClick={handleScan} disabled={scanning} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Search size={13} /> {scanning ? 'Taranıyor...' : 'Randevuları Tara'}
                        </button>
                        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{appointments.length} randevu</span>
                    </span>
                </div>
                {appointments.length === 0 ? (
                    <div className="empty-state" style={{ padding: 40 }}>
                        <Calendar size={32} />
                        <p>Henüz randevu tespit edilmedi</p>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Konuşmalardan otomatik tespit edilir veya "Randevuları Tara" ile taratın</span>
                    </div>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                {['Müşteri', 'Kaynak', 'Telefon', 'Randevu Zamanı', 'Notlar', 'Durum', 'İşlem'].map(h => (
                                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {appointments.map(a => {
                                const src = a.customer_source;
                                const sc = sourceColor(src);
                                return (
                                    <tr key={a.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                        <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 500 }}>{a.customer_name || a.customer_db_name || '-'}</td>
                                        <td style={{ padding: '12px 16px' }}>
                                            <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: sc.bg, color: sc.color }}>
                                                {sourceLabel(src)}
                                            </span>
                                        </td>
                                        <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-secondary)' }}>{a.phone || a.customer_db_phone || '-'}</td>
                                        <td style={{ padding: '12px 16px', fontSize: 13 }}>{a.appointment_time || '-'}</td>
                                        <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-secondary)', maxWidth: 200 }}>{a.notes || '-'}</td>
                                        <td style={{ padding: '12px 16px' }}>
                                            <span style={{
                                                fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20,
                                                background: a.status === 'confirmed' ? 'rgba(16,185,129,0.15)' : a.status === 'cancelled' ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)',
                                                color: a.status === 'confirmed' ? '#10b981' : a.status === 'cancelled' ? '#ef4444' : '#f59e0b'
                                            }}>
                                                {a.status === 'confirmed' ? 'Onaylandı' : a.status === 'cancelled' ? 'İptal' : 'Bekliyor'}
                                            </span>
                                        </td>
                                        <td style={{ padding: '12px 16px' }}>
                                            <div style={{ display: 'flex', gap: 6 }}>
                                                {a.status !== 'confirmed' && (
                                                    <button className="btn btn-sm btn-ghost" onClick={() => updateAppointmentStatus(a.id, 'confirmed')} title="Onayla" style={{ color: '#10b981' }}>
                                                        <CheckCircle size={14} />
                                                    </button>
                                                )}
                                                {a.status !== 'cancelled' && (
                                                    <button className="btn btn-sm btn-ghost" onClick={() => updateAppointmentStatus(a.id, 'cancelled')} title="İptal" style={{ color: '#ef4444' }}>
                                                        <XCircle size={14} />
                                                    </button>
                                                )}
                                                {a.status !== 'pending' && (
                                                    <button className="btn btn-sm btn-ghost" onClick={() => updateAppointmentStatus(a.id, 'pending')} title="Bekleyene al" style={{ color: '#f59e0b' }}>
                                                        <Clock size={14} />
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Top Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
                {[
                    { label: 'Gelen Mesajlar', value: stats?.inbound_messages || 0, icon: TrendingUp, color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
                    { label: 'AI Otomasyon', value: `${stats?.ai_rate || 0}%`, icon: Bot, color: '#a855f7', bg: 'rgba(168,85,247,0.12)' },
                    { label: 'Yeni Müşteri', value: stats?.new_customers || 0, icon: Users, color: '#06b6d4', bg: 'rgba(6,182,212,0.12)' },
                    { label: 'Aktif Görüşme', value: stats?.active_conversations || 0, icon: Percent, color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
                ].map((s, i) => (
                    <div key={i} className="glass-card stat-card">
                        <div className="stat-icon" style={{ background: s.bg, color: s.color }}><s.icon size={20} /></div>
                        <div className="stat-value">{s.value}</div>
                        <div className="stat-label">{s.label}</div>
                    </div>
                ))}
            </div>

            {/* Charts Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
                {/* AI vs Manual */}
                <div className="glass-card" style={{ padding: 20 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>AI vs Manuel Yanıtlar</h3>
                    {aiVsManual.length > 0 ? (
                        <div style={{ height: 200 }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie data={aiVsManual} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} dataKey="value" stroke="none">
                                        {aiVsManual.map((e, i) => <Cell key={i} fill={e.fill} />)}
                                    </Pie>
                                    <Tooltip {...tooltipStyle} />
                                    <Legend />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    ) : <div className="empty-state" style={{ padding: 40 }}><p>Veri yok</p></div>}
                </div>

                {/* Categories */}
                <div className="glass-card" style={{ padding: 20 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Müşteri Kategorileri</h3>
                    {catChartData.length > 0 ? (
                        <div style={{ height: 200 }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={catChartData}>
                                    <XAxis dataKey="name" tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} />
                                    <Tooltip {...tooltipStyle} />
                                    <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                                        {catChartData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    ) : <div className="empty-state" style={{ padding: 40 }}><p>Veri yok</p></div>}
                </div>
            </div>

            {/* Bottom: Agent Performance + Sources */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 20 }}>
                {/* Agents */}
                <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)' }}>
                        <h3 style={{ fontSize: 15, fontWeight: 600 }}>Temsilci Performansı</h3>
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                {['Temsilci', 'Aktif', 'Manuel Mesaj', 'Toplam'].map(h => (
                                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {agents.map(a => (
                                <tr key={a.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                    <td style={{ padding: '10px 16px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                            <div style={{ width: 32, height: 32, borderRadius: 'var(--radius-sm)', background: a.avatar_color || 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 12 }}>
                                                {a.name?.charAt(0)?.toUpperCase()}
                                            </div>
                                            <span style={{ fontWeight: 500, fontSize: 13 }}>{a.name}</span>
                                        </div>
                                    </td>
                                    <td style={{ padding: '10px 16px', fontSize: 13, fontWeight: 600, color: a.active_conversations > 0 ? 'var(--success)' : 'var(--text-secondary)' }}>
                                        {a.active_conversations}
                                    </td>
                                    <td style={{ padding: '10px 16px', fontSize: 13 }}>{a.manual_messages}</td>
                                    <td style={{ padding: '10px 16px', fontSize: 13 }}>{a.total_conversations}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Sources */}
                <div className="glass-card" style={{ padding: 20 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Kaynak Dağılımı</h3>
                    {sourceData.length > 0 ? (
                        <>
                            <div style={{ height: 180 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie data={sourceData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={4} dataKey="value" stroke="none">
                                            {sourceData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                                        </Pie>
                                        <Tooltip {...tooltipStyle} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                                {sourceData.map((d, i) => (
                                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <div style={{ width: 8, height: 8, borderRadius: '50%', background: d.fill }} />
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
