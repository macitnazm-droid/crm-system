import { useState, useEffect } from 'react';
import { webhooksAPI, superAdminAPI } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Radio, Send, Instagram, MessageCircle, CheckCircle, Loader, Zap, Building2 } from 'lucide-react';

export default function SimulatorPage() {
    const { user } = useAuth();
    const [companies, setCompanies] = useState([]);
    const [form, setForm] = useState({
        customer_name: '',
        message: '',
        source: 'instagram',
        phone: '',
        instagram_id: '',
        company_id: user?.company_id || 1
    });
    const [sending, setSending] = useState(false);
    const [result, setResult] = useState(null);
    const [history, setHistory] = useState([]);

    useEffect(() => {
        if (user?.role === 'super_admin') {
            superAdminAPI.listCompanies().then(res => {
                setCompanies(res.data.companies);
            });
        }
    }, [user]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.message.trim()) return;
        setSending(true);
        setResult(null);
        try {
            const res = await webhooksAPI.simulate(form);
            setResult(res.data);
            setHistory(prev => [{
                ...form,
                timestamp: new Date().toISOString(),
                ai_response: res.data.ai_message?.content,
                category: res.data.customer?.category,
                lead_score: res.data.customer?.lead_score,
                company_name: companies.find(c => c.id === parseInt(form.company_id))?.name || 'Ana Firma'
            }, ...prev]);
            setForm(prev => ({ ...prev, message: '' }));
        } catch (err) {
            console.error(err);
            setResult({ error: 'Simülasyon başarısız' });
        } finally {
            setSending(false);
        }
    };

    const quickMessages = [
        'Merhaba, ürünleriniz hakkında bilgi alabilir miyim?',
        'Fiyatı ne kadar?',
        'Hemen sipariş vermek istiyorum!',
        'Kargo ücretsiz mi?',
        'İndirim var mı?',
        'Toptan fiyat alabilir miyim?',
        'XL beden siyah renk var mı?',
        'Teşekkürler, düşüneceğim',
    ];

    return (
        <div className="animate-fade-in">
            <div className="page-header">
                <h1>Mesaj Simülatörü</h1>
                <p>Gerçek API olmadan Instagram/WhatsApp mesajlarını test edin</p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                {/* Send Form */}
                <div className="glass-card" style={{ padding: 24 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                        <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-md)', background: 'rgba(99,102,241,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-primary)' }}>
                            <Radio size={18} />
                        </div>
                        <div>
                            <h3 style={{ fontSize: 15, fontWeight: 600 }}>Mesaj Gönder</h3>
                            <p style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Sahte müşteri mesajı gönder</p>
                        </div>
                    </div>

                    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        {user?.role === 'super_admin' && (
                            <div>
                                <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--accent-primary)', marginBottom: 4, display: 'block' }}>Simüle Edilecek Şirket</label>
                                <select
                                    className="input"
                                    value={form.company_id}
                                    onChange={e => setForm(prev => ({ ...prev, company_id: e.target.value }))}
                                    style={{ border: '1px solid rgba(139, 92, 246, 0.3)', color: '#8b5cf6' }}
                                >
                                    {companies.map(c => (
                                        <option key={c.id} value={c.id}>{c.name}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <div>
                            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>Kaynak</label>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button type="button" className={`btn btn-sm ${form.source === 'instagram' ? '' : 'btn-ghost'}`}
                                    style={form.source === 'instagram' ? { background: 'var(--instagram-bg)', color: 'var(--instagram)', border: '1px solid rgba(225,48,108,0.3)' } : {}}
                                    onClick={() => setForm(prev => ({ ...prev, source: 'instagram' }))}>
                                    <Instagram size={14} /> Instagram
                                </button>
                                <button type="button" className={`btn btn-sm ${form.source === 'whatsapp' ? '' : 'btn-ghost'}`}
                                    style={form.source === 'whatsapp' ? { background: 'var(--whatsapp-bg)', color: 'var(--whatsapp)', border: '1px solid rgba(37,211,102,0.3)' } : {}}
                                    onClick={() => setForm(prev => ({ ...prev, source: 'whatsapp' }))}>
                                    <MessageCircle size={14} /> WhatsApp
                                </button>
                            </div>
                        </div>

                        <div>
                            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>Müşteri Adı</label>
                            <input className="input" placeholder="Örn: Ali Yılmaz" value={form.customer_name}
                                onChange={e => setForm(prev => ({ ...prev, customer_name: e.target.value }))} />
                        </div>

                        <div>
                            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>Mesaj *</label>
                            <textarea className="input" placeholder="Müşteri mesajını yazın..." value={form.message}
                                onChange={e => setForm(prev => ({ ...prev, message: e.target.value }))}
                                rows={3} required />
                        </div>

                        {/* Quick Messages */}
                        <div>
                            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>Hızlı Mesajlar</label>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                {quickMessages.map((msg, i) => (
                                    <button key={i} type="button" className="btn btn-ghost btn-sm"
                                        style={{ fontSize: 11, padding: '4px 10px', border: '1px solid var(--border-color)' }}
                                        onClick={() => setForm(prev => ({ ...prev, message: msg }))}>
                                        {msg.length > 30 ? msg.substring(0, 30) + '...' : msg}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <button type="submit" className="btn btn-primary" disabled={sending || !form.message.trim()}>
                            {sending ? <><Loader size={16} className="spinning" /> Gönderiliyor...</> : <><Send size={16} /> Mesaj Gönder</>}
                        </button>
                    </form>
                </div>

                {/* Results */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {/* Last Result */}
                    {result && !result.error && (
                        <div className="glass-card animate-fade-in" style={{ padding: 20, borderColor: 'rgba(16,185,129,0.3)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                                <CheckCircle size={18} style={{ color: 'var(--success)' }} />
                                <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--success)' }}>Mesaj İşlendi</h3>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                <div style={{ padding: 12, background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
                                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 4 }}>Müşteri</div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <span style={{ fontWeight: 600, fontSize: 14 }}>{result.customer?.name}</span>
                                        <span className={`badge badge-${result.customer?.category}`}>
                                            {result.customer?.category?.toUpperCase()} ({result.customer?.lead_score})
                                        </span>
                                    </div>
                                </div>

                                {result.ai_message && (
                                    <div style={{ padding: 12, background: 'rgba(139,92,246,0.08)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(139,92,246,0.2)' }}>
                                        <div style={{ fontSize: 11, color: 'var(--accent-primary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                            <Zap size={10} /> AI Yanıtı
                                        </div>
                                        <p style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-primary)' }}>{result.ai_message.content}</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {result?.error && (
                        <div className="glass-card" style={{ padding: 20, borderColor: 'rgba(239,68,68,0.3)' }}>
                            <p style={{ color: 'var(--error)' }}>{result.error}</p>
                        </div>
                    )}

                    {/* History */}
                    {history.length > 0 && (
                        <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
                            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color)' }}>
                                <h3 style={{ fontSize: 14, fontWeight: 600 }}>Simülasyon Geçmişi</h3>
                            </div>
                            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                                {history.map((h, i) => (
                                    <div key={i} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color)', fontSize: 13 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                            <span style={{ fontWeight: 600 }}>{h.customer_name || 'Anonim'}</span>
                                            <div style={{ display: 'flex', gap: 4 }}>
                                                {h.company_name && <span className="badge" style={{ fontSize: 9, background: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6' }}>{h.company_name}</span>}
                                                <span className={`badge badge-${h.source}`} style={{ fontSize: 9 }}>{h.source}</span>
                                            </div>
                                        </div>
                                        <p style={{ color: 'var(--text-secondary)', marginBottom: 4 }}>📩 {h.message}</p>
                                        {h.ai_response && <p style={{ color: 'var(--accent-primary-hover)', fontSize: 12 }}>🤖 {h.ai_response.substring(0, 100)}...</p>}
                                        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                                            <span className={`badge badge-${h.category}`} style={{ fontSize: 9 }}>{h.category?.toUpperCase()}</span>
                                            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Skor: {h.lead_score}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <style>{`
        .spinning { animation: spin 1s linear infinite; }
      `}</style>
        </div>
    );
}
