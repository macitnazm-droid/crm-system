import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { appointmentsAPI } from '../lib/api';
import {
    CalendarDays, Plus, ChevronLeft, ChevronRight, Clock, User, Scissors,
    Trash2, Edit3, Check, X, AlertCircle, Users, DoorOpen, Save, Loader
} from 'lucide-react';

const DAYS_TR = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const MONTHS_TR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

const STATUS_MAP = {
    pending: { label: 'Bekliyor', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
    confirmed: { label: 'Onaylı', color: '#22c55e', bg: 'rgba(34,197,94,0.1)' },
    cancelled: { label: 'İptal', color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
    completed: { label: 'Tamamlandı', color: '#6366f1', bg: 'rgba(99,102,241,0.1)' },
    no_show: { label: 'Gelmedi', color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' },
};

function formatDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function AppointmentsPage() {
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

    const [tab, setTab] = useState('calendar');
    const [view, setView] = useState('day');
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [appointments, setAppointments] = useState([]);
    const [staff, setStaff] = useState([]);
    const [services, setServices] = useState([]);
    const [rooms, setRooms] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingAppt, setEditingAppt] = useState(null);
    const [filterStaff, setFilterStaff] = useState('');
    const [msg, setMsg] = useState(null);

    // Form state
    const [form, setForm] = useState({
        customer_name: '', phone: '', staff_id: '', service_id: '', room_id: '',
        appointment_date: '', start_time: '', end_time: '', notes: '', status: 'confirmed'
    });

    useEffect(() => { loadAll(); }, []);

    useEffect(() => {
        loadAppointments();
    }, [selectedDate, view, filterStaff]);

    const loadAll = async () => {
        setLoading(true);
        try {
            const [sRes, svRes, rRes] = await Promise.all([
                appointmentsAPI.getStaff(),
                appointmentsAPI.getServices(),
                appointmentsAPI.getRooms(),
            ]);
            setStaff(sRes.data.staff || []);
            setServices(svRes.data.services || []);
            setRooms(rRes.data.rooms || []);
        } catch (e) { }
        await loadAppointments();
        setLoading(false);
    };

    const loadAppointments = async () => {
        try {
            const params = {};
            if (view === 'day') {
                params.date = formatDate(selectedDate);
            } else {
                const start = new Date(selectedDate);
                start.setDate(start.getDate() - start.getDay() + 1);
                const end = new Date(start);
                end.setDate(end.getDate() + 6);
                params.start_date = formatDate(start);
                params.end_date = formatDate(end);
            }
            if (filterStaff) params.staff_id = filterStaff;
            const res = await appointmentsAPI.list(params);
            setAppointments(res.data.appointments || []);
        } catch (e) { }
    };

    const navigateDate = (dir) => {
        const d = new Date(selectedDate);
        d.setDate(d.getDate() + (view === 'day' ? dir : dir * 7));
        setSelectedDate(d);
    };

    const openNewAppt = (time) => {
        setEditingAppt(null);
        setForm({
            customer_name: '', phone: '', staff_id: '', service_id: '', room_id: '',
            appointment_date: formatDate(selectedDate), start_time: time || '10:00', end_time: '', notes: '', status: 'confirmed'
        });
        setShowModal(true);
    };

    const openEditAppt = (appt) => {
        if (!isAdmin) return;
        setEditingAppt(appt);
        setForm({
            customer_name: appt.customer_name || '', phone: appt.phone || '',
            staff_id: appt.staff_id || '', service_id: appt.service_id || '', room_id: appt.room_id || '',
            appointment_date: appt.appointment_date || '', start_time: appt.start_time || '',
            end_time: appt.end_time || '', notes: appt.notes || '', status: appt.status || 'confirmed'
        });
        setShowModal(true);
    };

    const saveAppt = async () => {
        try {
            if (editingAppt) {
                await appointmentsAPI.update(editingAppt.id, form);
                setMsg({ type: 'success', text: 'Randevu güncellendi' });
            } else {
                await appointmentsAPI.create(form);
                setMsg({ type: 'success', text: 'Randevu oluşturuldu' });
            }
            setShowModal(false);
            loadAppointments();
        } catch (err) {
            setMsg({ type: 'error', text: err.response?.data?.error || 'Hata oluştu' });
        }
    };

    const deleteAppt = async (id) => {
        if (!window.confirm('Randevuyu silmek istediğinize emin misiniz?')) return;
        try {
            await appointmentsAPI.delete(id);
            loadAppointments();
        } catch (e) { setMsg({ type: 'error', text: 'Silme hatası' }); }
    };

    const updateStatus = async (id, status) => {
        try {
            await appointmentsAPI.updateStatus(id, status);
            loadAppointments();
        } catch (e) { }
    };

    // Sürükle-bırak state
    const [dragging, setDragging] = useState(null); // { id, startY, origTop, appt }
    const justDragged = useRef(false); // sürükleme sonrası click'i engelle
    const gridRef = useRef(null);

    const HOUR_HEIGHT = 80;
    const START_HOUR = 8;
    const DRAG_THRESHOLD = 5; // px — bu kadar hareket etmeden sürükleme sayılmaz

    const pxToTime = (px) => {
        const totalMin = Math.round((px / HOUR_HEIGHT) * 60) + START_HOUR * 60;
        const snapped = Math.round(totalMin / 15) * 15; // 15dk'ya yuvarla
        const h = Math.floor(snapped / 60);
        const m = snapped % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };

    const handleDragStart = useCallback((e, appt) => {
        if (!isAdmin) return;
        e.preventDefault();
        e.stopPropagation();
        const [sh, sm] = appt.start_time.split(':').map(Number);
        const origTop = ((sh - START_HOUR) * HOUR_HEIGHT) + ((sm / 60) * HOUR_HEIGHT);
        setDragging({ id: appt.id, startY: e.clientY, origTop, appt, moved: false });
    }, [isAdmin]);

    useEffect(() => {
        if (!dragging) return;
        const handleMove = (e) => {
            const delta = e.clientY - dragging.startY;
            // Eşik kontrolü — küçük hareketlerde sürükleme başlatma
            if (Math.abs(delta) < DRAG_THRESHOLD && !dragging.moved) return;
            if (!dragging.moved) setDragging(prev => ({ ...prev, moved: true }));
            const el = document.getElementById(`appt-drag-${dragging.id}`);
            if (el) {
                const newTop = Math.max(0, dragging.origTop + delta);
                el.style.top = `${newTop}px`;
            }
        };
        const handleUp = async (e) => {
            const delta = e.clientY - dragging.startY;
            const wasDragged = Math.abs(delta) >= DRAG_THRESHOLD;
            const newTop = Math.max(0, dragging.origTop + delta);
            const newStart = pxToTime(newTop);
            const oldAppt = dragging.appt;

            // Süre farkını hesapla
            const [osh, osm] = oldAppt.start_time.split(':').map(Number);
            const [oeh, oem] = (oldAppt.end_time || `${osh + 1}:00`).split(':').map(Number);
            const duration = (oeh * 60 + oem) - (osh * 60 + osm);
            const [nsh, nsm] = newStart.split(':').map(Number);
            const endMin = nsh * 60 + nsm + duration;
            const newEnd = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;

            setDragging(null);

            if (wasDragged && newStart !== oldAppt.start_time) {
                justDragged.current = true;
                setTimeout(() => { justDragged.current = false; }, 300);
                try {
                    await appointmentsAPI.update(oldAppt.id, {
                        ...oldAppt,
                        start_time: newStart,
                        end_time: newEnd
                    });
                    setMsg({ type: 'success', text: `Randevu ${newStart}-${newEnd} olarak güncellendi` });
                    loadAppointments();
                } catch (err) {
                    setMsg({ type: 'error', text: 'Taşıma hatası' });
                    loadAppointments();
                }
            } else if (!wasDragged) {
                // Sürüklenmediyse — tıklama olarak işle, modal aç
                loadAppointments(); // pozisyonu sıfırla
            }
        };
        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleUp);
        return () => {
            window.removeEventListener('mousemove', handleMove);
            window.removeEventListener('mouseup', handleUp);
        };
    }, [dragging]);

    // Saat dilimleri (08:00 - 21:00)
    const hours = Array.from({ length: 14 }, (_, i) => `${String(i + START_HOUR).padStart(2, '0')}:00`);

    const dateLabel = `${selectedDate.getDate()} ${MONTHS_TR[selectedDate.getMonth()]} ${DAYS_TR[selectedDate.getDay()]}`;

    if (loading) return <div className="loading-center"><div className="loading-spinner" /></div>;

    return (
        <div style={{ padding: '20px 24px', maxWidth: 1400, margin: '0 auto' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <CalendarDays size={22} style={{ color: 'var(--accent-primary)' }} />
                    <h2 style={{ fontSize: 20, fontWeight: 700 }}>Randevular</h2>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    {['calendar', 'staff', 'services'].map(t => (
                        <button key={t} className={`btn btn-sm ${tab === t ? 'btn-primary' : 'btn-ghost'}`}
                            onClick={() => setTab(t)}>
                            {t === 'calendar' ? 'Takvim' : t === 'staff' ? 'Personel' : 'Hizmetler'}
                        </button>
                    ))}
                </div>
            </div>

            {msg && (
                <div style={{ padding: '10px 16px', borderRadius: 8, marginBottom: 16,
                    background: msg.type === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                    color: msg.type === 'success' ? '#22c55e' : '#ef4444', fontSize: 13 }}>
                    {msg.text}
                    <button onClick={() => setMsg(null)} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>&times;</button>
                </div>
            )}

            {/* ========= TAKVİM TAB ========= */}
            {tab === 'calendar' && (
                <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
                    {/* Toolbar */}
                    <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <button className="btn btn-ghost btn-sm" onClick={() => navigateDate(-1)}><ChevronLeft size={16} /></button>
                            <span style={{ fontSize: 15, fontWeight: 600, minWidth: 200, textAlign: 'center' }}>{dateLabel}</span>
                            <button className="btn btn-ghost btn-sm" onClick={() => navigateDate(1)}><ChevronRight size={16} /></button>
                            <button className="btn btn-ghost btn-sm" onClick={() => setSelectedDate(new Date())}>Bugün</button>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <select className="input" style={{ width: 160, fontSize: 12, padding: '4px 8px' }}
                                value={filterStaff} onChange={e => setFilterStaff(e.target.value)}>
                                <option value="">Tüm Personel</option>
                                {staff.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                            <select className="input" style={{ width: 100, fontSize: 12, padding: '4px 8px' }}
                                value={view} onChange={e => setView(e.target.value)}>
                                <option value="day">Günlük</option>
                                <option value="week">Haftalık</option>
                            </select>
                            {isAdmin && (
                                <button className="btn btn-primary btn-sm" onClick={() => openNewAppt()}>
                                    <Plus size={14} /> Randevu
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Günlük Takvim */}
                    {view === 'day' && (
                        <div style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 260px)' }}>
                            <div style={{ display: 'flex', minHeight: hours.length * HOUR_HEIGHT }}>
                                {/* Saat etiketleri */}
                                <div style={{ width: 60, flexShrink: 0, borderRight: '1px solid var(--border-color)' }}>
                                    {hours.map(h => (
                                        <div key={h} style={{ height: HOUR_HEIGHT, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', paddingRight: 8, paddingTop: 2, fontSize: 11, color: 'var(--text-tertiary)' }}>
                                            {h}
                                        </div>
                                    ))}
                                </div>
                                {/* Takvim alanı (randevular burada) */}
                                <div ref={gridRef} style={{ flex: 1, position: 'relative' }}>
                                    {/* Saat çizgileri + tıklanabilir alanlar */}
                                    {hours.map(h => (
                                        <div key={`cell-${h}`}
                                            style={{ height: HOUR_HEIGHT, borderBottom: '1px solid var(--border-color)', cursor: isAdmin ? 'pointer' : 'default' }}
                                            onClick={() => isAdmin && openNewAppt(h)}>
                                        </div>
                                    ))}
                                    {/* Randevu blokları */}
                                    {appointments.filter(a => a.status !== 'cancelled').map(a => {
                                        if (!a.start_time) return null;
                                        const [sh, sm] = a.start_time.split(':').map(Number);
                                        const [eh, em] = (a.end_time || `${sh + 1}:00`).split(':').map(Number);
                                        const topPx = ((sh - START_HOUR) * HOUR_HEIGHT) + ((sm / 60) * HOUR_HEIGHT);
                                        const heightPx = Math.max(((eh * 60 + em) - (sh * 60 + sm)) / 60 * HOUR_HEIGHT, 30);
                                        const sColor = a.service_color || a.staff_color || '#6366f1';

                                        return (
                                            <div key={a.id} id={`appt-drag-${a.id}`}
                                                onMouseDown={(e) => handleDragStart(e, a)}
                                                onClick={(e) => { e.stopPropagation(); if (!dragging && !justDragged.current) openEditAppt(a); }}
                                                style={{
                                                    position: 'absolute', top: topPx, left: 4, right: 4,
                                                    height: heightPx, background: sColor + '20', border: `2px solid ${sColor}60`,
                                                    borderLeft: `4px solid ${sColor}`, borderRadius: 6, padding: '4px 8px',
                                                    cursor: isAdmin ? 'grab' : 'pointer', overflow: 'hidden', fontSize: 12, zIndex: 2,
                                                    userSelect: 'none', transition: dragging?.id === a.id ? 'none' : 'top 0.2s'
                                                }}>
                                                <div style={{ fontWeight: 600, color: 'var(--text-primary)', display: 'flex', justifyContent: 'space-between' }}>
                                                    <span>{a.customer_name || '-'}</span>
                                                    <span style={{ fontSize: 10, fontWeight: 400, color: sColor }}>{a.start_time}-{a.end_time}</span>
                                                </div>
                                                <div style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
                                                    {a.service_name || a.notes || ''}
                                                </div>
                                                {a.staff_name && (
                                                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                                                        👤 {a.staff_name}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Haftalık Takvim */}
                    {view === 'week' && (
                        <div style={{ overflowX: 'auto' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '60px repeat(7, 1fr)', minWidth: 800 }}>
                                {/* Header */}
                                <div style={{ borderBottom: '2px solid var(--border-color)', padding: 8 }}></div>
                                {Array.from({ length: 7 }, (_, i) => {
                                    const d = new Date(selectedDate);
                                    d.setDate(d.getDate() - d.getDay() + 1 + i);
                                    const isToday = formatDate(d) === formatDate(new Date());
                                    return (
                                        <div key={i} style={{
                                            borderBottom: '2px solid var(--border-color)', padding: 8, textAlign: 'center',
                                            background: isToday ? 'rgba(99,102,241,0.05)' : 'transparent',
                                            cursor: 'pointer'
                                        }} onClick={() => { setSelectedDate(d); setView('day'); }}>
                                            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{DAYS_TR[(i + 1) % 7]}</div>
                                            <div style={{ fontSize: 18, fontWeight: isToday ? 700 : 500, color: isToday ? 'var(--accent-primary)' : 'var(--text-primary)' }}>{d.getDate()}</div>
                                        </div>
                                    );
                                })}
                                {/* Randevu listesi per gün */}
                                <div></div>
                                {Array.from({ length: 7 }, (_, i) => {
                                    const d = new Date(selectedDate);
                                    d.setDate(d.getDate() - d.getDay() + 1 + i);
                                    const dayStr = formatDate(d);
                                    const dayAppts = appointments.filter(a => a.appointment_date === dayStr && a.status !== 'cancelled');
                                    return (
                                        <div key={i} style={{ borderRight: '1px solid var(--border-color)', minHeight: 300, padding: 4 }}>
                                            {dayAppts.map(a => {
                                                const sColor = a.service_color || '#6366f1';
                                                return (
                                                    <div key={a.id} onClick={() => openEditAppt(a)}
                                                        style={{
                                                            background: sColor + '15', borderLeft: `3px solid ${sColor}`,
                                                            borderRadius: 4, padding: '4px 6px', marginBottom: 4,
                                                            cursor: 'pointer', fontSize: 11
                                                        }}>
                                                        <div style={{ fontWeight: 600 }}>{a.start_time} {a.customer_name}</div>
                                                        <div style={{ color: 'var(--text-secondary)', fontSize: 10 }}>{a.service_name || a.notes}</div>
                                                    </div>
                                                );
                                            })}
                                            {isAdmin && (
                                                <button onClick={() => { setSelectedDate(d); openNewAppt(); }}
                                                    style={{ width: '100%', padding: 4, border: '1px dashed var(--border-color)', borderRadius: 4, background: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--text-tertiary)' }}>
                                                    +
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {appointments.length === 0 && (
                        <div className="empty-state" style={{ padding: 60 }}>
                            <CalendarDays size={40} />
                            <p>Bu tarihte randevu yok</p>
                            {isAdmin && <button className="btn btn-primary btn-sm" onClick={() => openNewAppt()}><Plus size={14} /> Randevu Oluştur</button>}
                        </div>
                    )}
                </div>
            )}

            {/* ========= PERSONEL TAB ========= */}
            {tab === 'staff' && <StaffTab staff={staff} setStaff={setStaff} services={services} isAdmin={isAdmin} setMsg={setMsg} />}

            {/* ========= HİZMETLER TAB ========= */}
            {tab === 'services' && <ServicesTab services={services} setServices={setServices} rooms={rooms} setRooms={setRooms} isAdmin={isAdmin} setMsg={setMsg} />}

            {/* ========= RANDEVU MODAL ========= */}
            {showModal && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onClick={() => setShowModal(false)}>
                    <div className="glass-card" style={{ width: 520, maxHeight: '90vh', overflow: 'auto', padding: 24 }}
                        onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                            <h3 style={{ fontSize: 16, fontWeight: 600 }}>{editingAppt ? 'Randevu Düzenle' : 'Yeni Randevu'}</h3>
                            <button className="btn btn-ghost btn-sm" onClick={() => setShowModal(false)}><X size={16} /></button>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                <div>
                                    <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>Müşteri Adı *</label>
                                    <input className="input" placeholder="Ad Soyad" value={form.customer_name}
                                        onChange={e => setForm({ ...form, customer_name: e.target.value })} />
                                </div>
                                <div>
                                    <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>Telefon</label>
                                    <input className="input" placeholder="05XX XXX XX XX" value={form.phone}
                                        onChange={e => setForm({ ...form, phone: e.target.value })} />
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                <div>
                                    <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>Personel</label>
                                    <select className="input" value={form.staff_id} onChange={e => setForm({ ...form, staff_id: e.target.value })}>
                                        <option value="">Seçiniz</option>
                                        {staff.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>Hizmet</label>
                                    <select className="input" value={form.service_id}
                                        onChange={e => {
                                            const svc = services.find(s => s.id === Number(e.target.value));
                                            const newForm = { ...form, service_id: e.target.value };
                                            if (svc && form.start_time) {
                                                const [h, m] = form.start_time.split(':').map(Number);
                                                const total = h * 60 + m + svc.duration;
                                                newForm.end_time = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
                                            }
                                            setForm(newForm);
                                        }}>
                                        <option value="">Seçiniz</option>
                                        {services.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name} ({s.duration}dk)</option>)}
                                    </select>
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                                <div>
                                    <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>Tarih *</label>
                                    <input className="input" type="date" value={form.appointment_date}
                                        onChange={e => setForm({ ...form, appointment_date: e.target.value })} />
                                </div>
                                <div>
                                    <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>Başlangıç *</label>
                                    <input className="input" type="time" value={form.start_time}
                                        onChange={e => {
                                            const newForm = { ...form, start_time: e.target.value };
                                            if (form.service_id) {
                                                const svc = services.find(s => s.id === Number(form.service_id));
                                                if (svc) {
                                                    const [h, m] = e.target.value.split(':').map(Number);
                                                    const total = h * 60 + m + svc.duration;
                                                    newForm.end_time = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
                                                }
                                            }
                                            setForm(newForm);
                                        }} />
                                </div>
                                <div>
                                    <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>Bitiş</label>
                                    <input className="input" type="time" value={form.end_time}
                                        onChange={e => setForm({ ...form, end_time: e.target.value })} />
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                <div>
                                    <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>Oda</label>
                                    <select className="input" value={form.room_id} onChange={e => setForm({ ...form, room_id: e.target.value })}>
                                        <option value="">Seçiniz</option>
                                        {rooms.filter(r => r.is_active).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>Durum</label>
                                    <select className="input" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                                        {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>Not</label>
                                <textarea className="input" rows={2} placeholder="Randevu notu..." value={form.notes}
                                    onChange={e => setForm({ ...form, notes: e.target.value })} />
                            </div>

                            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                                {editingAppt && isAdmin && (
                                    <button className="btn btn-sm" style={{ color: '#ef4444' }} onClick={() => { deleteAppt(editingAppt.id); setShowModal(false); }}>
                                        <Trash2 size={14} /> Sil
                                    </button>
                                )}
                                <button className="btn btn-ghost btn-sm" onClick={() => setShowModal(false)}>İptal</button>
                                <button className="btn btn-primary btn-sm" onClick={saveAppt}>
                                    <Save size={14} /> {editingAppt ? 'Güncelle' : 'Kaydet'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ==================== PERSONEL TAB ====================
function StaffTab({ staff, setStaff, services, isAdmin, setMsg }) {
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState({ name: '', phone: '', role: '' });
    const [saving, setSaving] = useState(false);

    const addStaff = async () => {
        if (!form.name) return;
        setSaving(true);
        try {
            const colors = ['#6366f1', '#ec4899', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ef4444'];
            const color = colors[staff.length % colors.length];
            const res = await appointmentsAPI.createStaff({ ...form, avatar_color: color });
            setStaff([...staff, res.data.staff]);
            setForm({ name: '', phone: '', role: '' });
            setShowForm(false);
            setMsg({ type: 'success', text: 'Personel eklendi' });
        } catch (e) { setMsg({ type: 'error', text: 'Hata' }); }
        setSaving(false);
    };

    const deleteStaffItem = async (id) => {
        if (!window.confirm('Personeli silmek istediğinize emin misiniz?')) return;
        try {
            await appointmentsAPI.deleteStaff(id);
            setStaff(staff.filter(s => s.id !== id));
        } catch (e) { setMsg({ type: 'error', text: 'Silme hatası' }); }
    };

    return (
        <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Users size={18} style={{ color: 'var(--accent-primary)' }} />
                    <h3 style={{ fontSize: 15, fontWeight: 600 }}>Personel Yönetimi</h3>
                </div>
                {isAdmin && (
                    <button className="btn btn-sm btn-primary" onClick={() => setShowForm(true)}>
                        <Plus size={14} /> Personel Ekle
                    </button>
                )}
            </div>

            {showForm && isAdmin && (
                <div style={{ padding: 16, borderBottom: '1px solid var(--border-color)', background: 'rgba(99,102,241,0.04)' }}>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                        <input className="input" placeholder="Ad Soyad *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={{ flex: '1 1 180px' }} />
                        <input className="input" placeholder="Telefon" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} style={{ flex: '1 1 140px' }} />
                        <input className="input" placeholder="Uzmanlık" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} style={{ flex: '1 1 140px' }} />
                        <button className="btn btn-primary btn-sm" onClick={addStaff} disabled={saving}><Save size={14} /> Kaydet</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}>İptal</button>
                    </div>
                </div>
            )}

            <div style={{ padding: 0 }}>
                {staff.map(s => (
                    <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: '1px solid var(--border-color)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div style={{ width: 36, height: 36, borderRadius: '50%', background: s.avatar_color || '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 600, fontSize: 14 }}>
                                {s.name?.charAt(0)?.toUpperCase()}
                            </div>
                            <div>
                                <div style={{ fontWeight: 600, fontSize: 14 }}>{s.name}</div>
                                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{s.role || 'Personel'} {s.phone ? `· ${s.phone}` : ''}</div>
                            </div>
                        </div>
                        {isAdmin && (
                            <button className="btn btn-ghost btn-sm" onClick={() => deleteStaffItem(s.id)} style={{ color: 'var(--error)' }}>
                                <Trash2 size={14} />
                            </button>
                        )}
                    </div>
                ))}
                {staff.length === 0 && (
                    <div className="empty-state" style={{ padding: 40 }}>
                        <Users size={32} />
                        <p>Henüz personel eklenmemiş</p>
                    </div>
                )}
            </div>
        </div>
    );
}

// ==================== HİZMETLER TAB ====================
function ServicesTab({ services, setServices, rooms, setRooms, isAdmin, setMsg }) {
    const [showForm, setShowForm] = useState(false);
    const [showRoomForm, setShowRoomForm] = useState(false);
    const [form, setForm] = useState({ name: '', duration: 60, price: 0 });
    const [roomName, setRoomName] = useState('');

    const addService = async () => {
        if (!form.name) return;
        try {
            const colors = ['#6366f1', '#ec4899', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6'];
            const color = colors[services.length % colors.length];
            const res = await appointmentsAPI.createService({ ...form, color });
            setServices([...services, res.data.service]);
            setForm({ name: '', duration: 60, price: 0 });
            setShowForm(false);
            setMsg({ type: 'success', text: 'Hizmet eklendi' });
        } catch (e) { setMsg({ type: 'error', text: 'Hata' }); }
    };

    const addRoom = async () => {
        if (!roomName) return;
        try {
            const res = await appointmentsAPI.createRoom({ name: roomName });
            setRooms([...rooms, res.data.room]);
            setRoomName('');
            setShowRoomForm(false);
            setMsg({ type: 'success', text: 'Oda eklendi' });
        } catch (e) { setMsg({ type: 'error', text: 'Hata' }); }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Hizmetler */}
            <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Scissors size={18} style={{ color: 'var(--accent-primary)' }} />
                        <h3 style={{ fontSize: 15, fontWeight: 600 }}>Hizmetler</h3>
                    </div>
                    {isAdmin && (
                        <button className="btn btn-sm btn-primary" onClick={() => setShowForm(true)}>
                            <Plus size={14} /> Hizmet Ekle
                        </button>
                    )}
                </div>

                {showForm && isAdmin && (
                    <div style={{ padding: 16, borderBottom: '1px solid var(--border-color)', background: 'rgba(99,102,241,0.04)' }}>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                            <input className="input" placeholder="Hizmet Adı *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={{ flex: '1 1 180px' }} />
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Süre (dk)</label>
                                <input className="input" type="number" value={form.duration} onChange={e => setForm({ ...form, duration: Number(e.target.value) })} style={{ width: 80 }} />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Fiyat (₺)</label>
                                <input className="input" type="number" value={form.price} onChange={e => setForm({ ...form, price: Number(e.target.value) })} style={{ width: 100 }} />
                            </div>
                            <button className="btn btn-primary btn-sm" onClick={addService}><Save size={14} /> Kaydet</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}>İptal</button>
                        </div>
                    </div>
                )}

                <div>
                    {services.map(s => (
                        <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: '1px solid var(--border-color)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <div style={{ width: 8, height: 32, borderRadius: 4, background: s.color || '#6366f1' }} />
                                <div>
                                    <div style={{ fontWeight: 600, fontSize: 14 }}>{s.name}</div>
                                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                        {s.duration} dakika {s.price > 0 ? `· ${s.price}₺` : ''}
                                    </div>
                                </div>
                            </div>
                            {isAdmin && (
                                <button className="btn btn-ghost btn-sm" style={{ color: 'var(--error)' }}
                                    onClick={async () => {
                                        if (!window.confirm('Hizmeti silmek istediğinize emin misiniz?')) return;
                                        await appointmentsAPI.deleteService(s.id);
                                        setServices(services.filter(x => x.id !== s.id));
                                    }}>
                                    <Trash2 size={14} />
                                </button>
                            )}
                        </div>
                    ))}
                    {services.length === 0 && (
                        <div className="empty-state" style={{ padding: 40 }}>
                            <Scissors size={32} />
                            <p>Henüz hizmet eklenmemiş</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Odalar */}
            <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <DoorOpen size={18} style={{ color: 'var(--accent-primary)' }} />
                        <h3 style={{ fontSize: 15, fontWeight: 600 }}>Odalar / Kabinler</h3>
                    </div>
                    {isAdmin && (
                        <button className="btn btn-sm btn-primary" onClick={() => setShowRoomForm(true)}>
                            <Plus size={14} /> Oda Ekle
                        </button>
                    )}
                </div>

                {showRoomForm && isAdmin && (
                    <div style={{ padding: 16, borderBottom: '1px solid var(--border-color)', background: 'rgba(99,102,241,0.04)' }}>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                            <input className="input" placeholder="Oda Adı *" value={roomName} onChange={e => setRoomName(e.target.value)} style={{ flex: 1 }} />
                            <button className="btn btn-primary btn-sm" onClick={addRoom}><Save size={14} /> Kaydet</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => setShowRoomForm(false)}>İptal</button>
                        </div>
                    </div>
                )}

                <div>
                    {rooms.map(r => (
                        <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: '1px solid var(--border-color)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <DoorOpen size={16} style={{ color: 'var(--text-secondary)' }} />
                                <span style={{ fontSize: 14, fontWeight: 500 }}>{r.name}</span>
                            </div>
                            {isAdmin && (
                                <button className="btn btn-ghost btn-sm" style={{ color: 'var(--error)' }}
                                    onClick={async () => {
                                        await appointmentsAPI.deleteRoom(r.id);
                                        setRooms(rooms.filter(x => x.id !== r.id));
                                    }}>
                                    <Trash2 size={14} />
                                </button>
                            )}
                        </div>
                    ))}
                    {rooms.length === 0 && (
                        <div className="empty-state" style={{ padding: 30 }}>
                            <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Henüz oda eklenmemiş</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
