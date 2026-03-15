import { useState, useEffect } from 'react';
import { aiAPI, integrationsAPI, appointmentsAPI, leadsAPI } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import {
    Settings, Bot, Save, Plus, Eye, EyeOff, AlertCircle,
    Instagram, MessageCircle, Link2, CheckCircle, X, Loader,
    Webhook, Globe, Key, Phone, Shield, Trash2, QrCode, Wifi, WifiOff, Smartphone, Bell, MessageSquare, Target
} from 'lucide-react';

export default function SettingsPage() {
    const { user } = useAuth();
    const [tab, setTab] = useState('integrations');
    const [prompts, setPrompts] = useState([]);
    const [integrations, setIntegrations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editingPrompt, setEditingPrompt] = useState(null);
    const [showNew, setShowNew] = useState(false);
    const [newPrompt, setNewPrompt] = useState({ name: '', system_prompt: '', instructions: '' });
    const [saving, setSaving] = useState(false);
    const [testResult, setTestResult] = useState(null);

    // Integration form state — her provider ayrı form
    const [igMetaForm, setIgMetaForm] = useState({ platform: 'instagram', provider: 'meta', api_key: '', api_secret: '', page_id: '', verify_token: '', is_active: false });
    const [igUnipileForm, setIgUnipileForm] = useState({ platform: 'instagram', provider: 'unipile', api_key: '', dsn_url: '', unipile_account_id: '', is_active: false });
    const [waMetaForm, setWaMetaForm] = useState({ platform: 'whatsapp', provider: 'meta', api_key: '', api_secret: '', phone_number_id: '', verify_token: '', is_active: false });
    const [waUnipileForm, setWaUnipileForm] = useState({ platform: 'whatsapp', provider: 'unipile', api_key: '', dsn_url: '', unipile_account_id: '', is_active: false });
    const [msgMetaForm, setMsgMetaForm] = useState({ platform: 'messenger', provider: 'meta', api_key: '', api_secret: '', page_id: '', verify_token: '', is_active: false });
    const [igProvider, setIgProvider] = useState('meta');
    const [waProvider, setWaProvider] = useState('meta');

    // WhatsApp Web.js state
    const [waWebStatus, setWaWebStatus] = useState({ status: 'disconnected', phone: null, name: null });
    const [waWebQR, setWaWebQR] = useState(null);
    const [waWebLoading, setWaWebLoading] = useState(false);

    // Platform bazlı AI toggle
    const [platformAI, setPlatformAI] = useState({ feature_ai: 1, ai_instagram: 1, ai_whatsapp: 1, ai_messenger: 1 });

    // Randevu bildirim ayarları
    const [notifySettings, setNotifySettings] = useState({
        appointment_whatsapp_notify: 0,
        appointment_sms_notify: 0,
        sms_usercode: '',
        sms_password: '',
        sms_msgheader: '',
        appointment_reminder_minutes: 60
    });

    // Lead otomasyon ayarları
    const [leadSettings, setLeadSettings] = useState({
        feature_lead: 0,
        lead_auto_message: 0,
        lead_message_template: '',
        lead_message_delay: 0
    });

    useEffect(() => {
        loadData();
        // WhatsApp Web durumunu yükle
        integrationsAPI.waWebStatus().then(res => setWaWebStatus(res.data)).catch(() => {});
        // Platform AI ayarlarını yükle
        aiAPI.getPlatformSettings().then(res => setPlatformAI(res.data)).catch(() => {});
        // Bildirim ayarlarını yükle
        appointmentsAPI.getNotificationSettings().then(res => setNotifySettings(res.data)).catch(() => {});
        // Lead otomasyon ayarlarını yükle
        leadsAPI.getSettings().then(res => setLeadSettings(res.data)).catch(() => {});
    }, []);

    const loadData = async () => {
        try {
            const [pRes, iRes] = await Promise.all([
                aiAPI.getPrompts(),
                integrationsAPI.list()
            ]);
            setPrompts(pRes.data.prompts || []);
            const ints = iRes.data.integrations || [];
            setIntegrations(ints);

            // Her platform+provider kombinasyonu için form doldur
            const igMeta = ints.find(i => i.platform === 'instagram' && i.provider === 'meta');
            const igUni = ints.find(i => i.platform === 'instagram' && i.provider === 'unipile');
            const waMeta = ints.find(i => i.platform === 'whatsapp' && i.provider === 'meta');
            const waUni = ints.find(i => i.platform === 'whatsapp' && i.provider === 'unipile');

            if (igMeta) setIgMetaForm(prev => ({ ...prev, api_key: igMeta.api_key || '', api_secret: igMeta.api_secret || '', page_id: igMeta.page_id || '', verify_token: igMeta.verify_token || '', is_active: !!igMeta.is_active }));
            if (igUni) setIgUnipileForm(prev => ({ ...prev, api_key: igUni.api_key || '', dsn_url: igUni.dsn_url || '', unipile_account_id: igUni.unipile_account_id || '', is_active: !!igUni.is_active }));
            if (waMeta) setWaMetaForm(prev => ({ ...prev, api_key: waMeta.api_key || '', api_secret: waMeta.api_secret || '', phone_number_id: waMeta.phone_number_id || '', verify_token: waMeta.verify_token || '', is_active: !!waMeta.is_active }));
            if (waUni) setWaUnipileForm(prev => ({ ...prev, api_key: waUni.api_key || '', dsn_url: waUni.dsn_url || '', unipile_account_id: waUni.unipile_account_id || '', is_active: !!waUni.is_active }));

            const msgMeta = ints.find(i => i.platform === 'messenger' && i.provider === 'meta');
            if (msgMeta) setMsgMetaForm(prev => ({ ...prev, api_key: msgMeta.api_key || '', api_secret: msgMeta.api_secret || '', page_id: msgMeta.page_id || '', verify_token: msgMeta.verify_token || '', is_active: !!msgMeta.is_active }));

        } catch (err) { console.error(err); }
        finally { setLoading(false); }
    };

    const saveIntegration = async (formData) => {
        setSaving(true);
        try {
            await integrationsAPI.save(formData);
            setTestResult({ success: true, message: 'Ayarlar başarıyla kaydedildi!' });
            loadData();
        } catch (err) {
            setTestResult({ success: false, message: 'Kaydetme hatası: ' + (err.response?.data?.error || err.message) });
        } finally { setSaving(false); }
    };

    const testConnection = async (platform, provider) => {
        setSaving(true);
        try {
            const res = await integrationsAPI.test(platform, provider);
            setTestResult(res.data);
        } catch (err) {
            setTestResult({ success: false, message: 'Test hatası' });
        } finally { setSaving(false); }
    };

    const savePrompt = async (id, data) => {
        setSaving(true);
        try { await aiAPI.updatePrompt(id, data); setEditingPrompt(null); loadData(); }
        catch (err) { console.error(err); }
        finally { setSaving(false); }
    };

    const deletePrompt = async (id) => {
        if (!window.confirm('Bu promptu silmek istediğinize emin misiniz?')) return;
        try { await aiAPI.deletePrompt(id); loadData(); }
        catch (err) { console.error(err); }
    };

    const createPrompt = async () => {
        if (!newPrompt.name || !newPrompt.system_prompt) return;
        setSaving(true);
        try { await aiAPI.createPrompt(newPrompt); setShowNew(false); setNewPrompt({ name: '', system_prompt: '', instructions: '' }); loadData(); }
        catch (err) { console.error(err); }
        finally { setSaving(false); }
    };

    if (loading) return <div className="loading-center"><div className="loading-spinner" /></div>;

    const serverUrl = window.location.origin.replace(':5173', ':3001');
    const unipileWebhookUrl = `${serverUrl}/api/webhooks/unipile/${user?.company_id}`;

    return (
        <div className="animate-fade-in">
            <div className="page-header">
                <h1>Ayarlar</h1>
                <p>Entegrasyonlar, AI promptları ve sistem ayarları</p>
            </div>

            {/* Profile Card */}
            <div className="glass-card" style={{ padding: 20, marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{
                        width: 56, height: 56, borderRadius: 'var(--radius-lg)',
                        background: user?.avatar_color || 'var(--accent-primary)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: 'white', fontWeight: 800, fontSize: 22
                    }}>
                        {user?.name?.charAt(0)?.toUpperCase()}
                    </div>
                    <div>
                        <div style={{ fontWeight: 600, fontSize: 16 }}>{user?.name}</div>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{user?.email}</div>
                        <span className="badge" style={{ marginTop: 4, display: 'inline-flex', background: 'rgba(99,102,241,0.12)', color: 'var(--accent-primary-hover)', border: '1px solid rgba(99,102,241,0.3)', fontSize: 10 }}>
                            {user?.role === 'admin' ? 'Yönetici' : user?.role === 'manager' ? 'Müdür' : 'Temsilci'}
                        </span>
                    </div>
                </div>
            </div>

            {/* Tab Navigation */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'var(--bg-secondary)', padding: 4, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', width: 'fit-content' }}>
                {[
                    { key: 'integrations', label: 'Entegrasyonlar', icon: Link2 },
                    { key: 'ai', label: 'AI Promptları', icon: Bot },
                    { key: 'leads', label: 'Lead Ayarları', icon: Target },
                    { key: 'notifications', label: 'Bildirimler', icon: Bell },
                ].map(t => (
                    <button key={t.key}
                        className={`btn btn-sm ${tab === t.key ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => setTab(t.key)}
                        style={{ gap: 6 }}
                    >
                        <t.icon size={14} /> {t.label}
                    </button>
                ))}
            </div>

            {/* Test Result Toast */}
            {testResult && (
                <div className="animate-fade-in" style={{
                    padding: '12px 16px', marginBottom: 16, borderRadius: 'var(--radius-md)',
                    background: testResult.success ? 'var(--success-bg)' : 'rgba(239,68,68,0.1)',
                    border: `1px solid ${testResult.success ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {testResult.success ? <CheckCircle size={16} style={{ color: 'var(--success)' }} /> : <AlertCircle size={16} style={{ color: 'var(--error)' }} />}
                        <span style={{ fontSize: 13, color: testResult.success ? 'var(--success)' : 'var(--error)' }}>{testResult.message}</span>
                    </div>
                    <button className="btn btn-ghost btn-icon" onClick={() => setTestResult(null)} style={{ padding: 4 }}><X size={14} /></button>
                </div>
            )}

            {/* ========= INTEGRATIONS TAB ========= */}
            {tab === 'integrations' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

                    {/* Instagram */}
                    <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
                        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-md)', background: 'var(--instagram-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--instagram)' }}>
                                    <Instagram size={18} />
                                </div>
                                <div>
                                    <h3 style={{ fontSize: 15, fontWeight: 600 }}>Instagram Business API</h3>
                                    <p style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Instagram DM mesajlarını alıp yanıtlayın</p>
                                </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                {igMetaForm.is_active && (
                                    <span className="badge" style={{ fontSize: 10, background: 'rgba(59,130,246,0.12)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.3)' }}>Meta</span>
                                )}
                                {igUnipileForm.is_active && (
                                    <span className="badge" style={{ fontSize: 10, background: 'rgba(139,92,246,0.12)', color: '#8b5cf6', border: '1px solid rgba(139,92,246,0.3)' }}>Unipile</span>
                                )}
                                {!igMetaForm.is_active && !igUnipileForm.is_active && (
                                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Pasif</span>
                                )}
                            </div>
                        </div>
                        <div style={{ padding: 20 }}>
                            {/* Provider Seçici Tab */}
                            <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
                                {['meta', 'unipile'].map(p => (
                                    <button key={p}
                                        className={`btn btn-sm ${igProvider === p ? 'btn-primary' : 'btn-ghost'}`}
                                        onClick={() => setIgProvider(p)}
                                        style={{ textTransform: 'capitalize', minWidth: 90 }}>
                                        {p === 'meta' ? 'Meta (Resmi)' : 'Unipile'}
                                    </button>
                                ))}
                            </div>

                            {/* Per-provider aktif/pasif toggle */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                                <span style={{ fontSize: 12, color: (igProvider === 'meta' ? igMetaForm.is_active : igUnipileForm.is_active) ? 'var(--success)' : 'var(--text-muted)' }}>
                                    {igProvider === 'meta' ? 'Meta' : 'Unipile'}: {(igProvider === 'meta' ? igMetaForm.is_active : igUnipileForm.is_active) ? 'Aktif' : 'Pasif'}
                                </span>
                                <div className={`toggle ${(igProvider === 'meta' ? igMetaForm.is_active : igUnipileForm.is_active) ? 'active' : ''}`}
                                    onClick={() => igProvider === 'meta'
                                        ? setIgMetaForm(prev => ({ ...prev, is_active: !prev.is_active }))
                                        : setIgUnipileForm(prev => ({ ...prev, is_active: !prev.is_active }))} />
                            </div>

                            {igProvider === 'meta' ? (
                                <>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                                        <div>
                                            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <Key size={12} /> Access Token
                                            </label>
                                            <input className="input" type="password" placeholder="Instagram Access Token" value={igMetaForm.api_key}
                                                onChange={e => setIgMetaForm(prev => ({ ...prev, api_key: e.target.value }))} />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <Shield size={12} /> App Secret
                                            </label>
                                            <input className="input" type="password" placeholder="App Secret" value={igMetaForm.api_secret}
                                                onChange={e => setIgMetaForm(prev => ({ ...prev, api_secret: e.target.value }))} />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <Globe size={12} /> Page ID
                                            </label>
                                            <input className="input" placeholder="Facebook Page ID" value={igMetaForm.page_id}
                                                onChange={e => setIgMetaForm(prev => ({ ...prev, page_id: e.target.value }))} />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <Shield size={12} /> Verify Token
                                            </label>
                                            <input className="input" placeholder="Webhook Verify Token" value={igMetaForm.verify_token}
                                                onChange={e => setIgMetaForm(prev => ({ ...prev, verify_token: e.target.value }))} />
                                        </div>
                                    </div>
                                    <div style={{ marginBottom: 14 }}>
                                        <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                            <Webhook size={12} /> Webhook URL (Meta Dashboard'a yapıştırın)
                                        </label>
                                        <input className="input" readOnly value={`${serverUrl}/api/webhooks/instagram`}
                                            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', cursor: 'text' }}
                                            onClick={e => { e.target.select(); navigator.clipboard?.writeText(e.target.value); }} />
                                        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                                            Bu URL'yi Meta Developer Dashboard → Webhooks → Callback URL alanına yapıştırın
                                        </p>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 'var(--radius-md)', background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)', fontSize: 12, color: 'var(--text-secondary)' }}>
                                        Unipile üzerinden Instagram DM entegrasyonu. API anahtarınızı Unipile Dashboard → Settings → API Keys bölümünden alın.
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                                        <div>
                                            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <Key size={12} /> Unipile API Key
                                            </label>
                                            <input className="input" type="password" placeholder="Unipile API Key" value={igUnipileForm.api_key}
                                                onChange={e => setIgUnipileForm(prev => ({ ...prev, api_key: e.target.value }))} />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <Globe size={12} /> DSN URL
                                            </label>
                                            <input className="input" placeholder="https://api1.unipile.com:13433" value={igUnipileForm.dsn_url}
                                                onChange={e => setIgUnipileForm(prev => ({ ...prev, dsn_url: e.target.value }))} />
                                        </div>
                                    </div>
                                    <div style={{ marginBottom: 14 }}>
                                        <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                            <Instagram size={18} /> Unipile Account ID
                                        </label>
                                        <input className="input" placeholder="Unipile Dashboard → Accounts → Account ID" value={igUnipileForm.unipile_account_id}
                                            onChange={e => setIgUnipileForm(prev => ({ ...prev, unipile_account_id: e.target.value }))} />
                                        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                                            Unipile Dashboard → Accounts sayfasından Instagram hesabınızın ID'sini kopyalayın
                                        </p>
                                    </div>
                                    <div style={{ marginBottom: 14 }}>
                                        <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                            <Webhook size={12} /> Webhook URL (Unipile Dashboard'a yapıştırın)
                                        </label>
                                        <input className="input" readOnly value={unipileWebhookUrl}
                                            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', cursor: 'text' }}
                                            onClick={e => { e.target.select(); navigator.clipboard?.writeText(e.target.value); }} />
                                        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                                            Bu URL'yi Unipile Dashboard → Webhooks bölümüne yapıştırın
                                        </p>
                                    </div>
                                    {/* QR ile Instagram Bağla */}
                                    <div style={{ marginBottom: 14, padding: '12px 14px', borderRadius: 'var(--radius-md)', background: 'rgba(225,48,108,0.08)', border: '1px dashed rgba(225,48,108,0.3)' }}>
                                        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
                                            Unipile ile Instagram Bağla
                                        </p>
                                        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
                                            Instagram hesabınızı Unipile üzerinden bağlayın. Önce yukarıdaki API Key ve DSN URL'yi kaydedin.
                                        </p>
                                        <button className="btn btn-sm" disabled={saving || !igUnipileForm.api_key || !igUnipileForm.dsn_url}
                                            style={{ background: 'linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)', color: '#fff', border: 'none' }}
                                            onClick={async () => {
                                                setSaving(true);
                                                try {
                                                    await integrationsAPI.save(igUnipileForm);
                                                    const res = await integrationsAPI.unipileConnect('INSTAGRAM');
                                                    if (res.data.url) {
                                                        window.open(res.data.url, '_blank');
                                                        setTestResult({ success: true, message: 'Instagram bağlantı sayfası açıldı!' });
                                                    } else {
                                                        setTestResult({ success: false, message: 'Bağlantı URL\'si alınamadı' });
                                                    }
                                                } catch (err) {
                                                    setTestResult({ success: false, message: 'Bağlantı hatası: ' + (err.response?.data?.error || err.message) });
                                                } finally { setSaving(false); }
                                            }}>
                                            <Instagram size={14} /> Hesap Bağla
                                        </button>
                                    </div>
                                </>
                            )}

                            <div style={{ display: 'flex', gap: 8 }}>
                                <button className="btn btn-primary btn-sm" onClick={() => saveIntegration(igProvider === 'meta' ? igMetaForm : igUnipileForm)} disabled={saving}>
                                    {saving ? <Loader size={14} className="spinning" /> : <Save size={14} />} Kaydet
                                </button>
                                <button className="btn btn-secondary btn-sm" onClick={() => testConnection('instagram', igProvider)} disabled={saving}>
                                    Bağlantıyı Test Et
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* WhatsApp */}
                    <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
                        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-md)', background: 'var(--whatsapp-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--whatsapp)' }}>
                                    <MessageCircle size={18} />
                                </div>
                                <div>
                                    <h3 style={{ fontSize: 15, fontWeight: 600 }}>WhatsApp Business API</h3>
                                    <p style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>WhatsApp mesajlarını alıp yanıtlayın</p>
                                </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                {waWebStatus.status === 'connected' && (
                                    <span className="badge" style={{ fontSize: 10, background: 'rgba(37,211,102,0.12)', color: '#25D366', border: '1px solid rgba(37,211,102,0.3)' }}>WA Web</span>
                                )}
                                {waMetaForm.is_active && (
                                    <span className="badge" style={{ fontSize: 10, background: 'rgba(59,130,246,0.12)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.3)' }}>Meta</span>
                                )}
                                {waUnipileForm.is_active && (
                                    <span className="badge" style={{ fontSize: 10, background: 'rgba(139,92,246,0.12)', color: '#8b5cf6', border: '1px solid rgba(139,92,246,0.3)' }}>Unipile</span>
                                )}
                                {!waMetaForm.is_active && !waUnipileForm.is_active && waWebStatus.status !== 'connected' && (
                                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Pasif</span>
                                )}
                            </div>
                        </div>
                        <div style={{ padding: 20 }}>
                            {/* Provider Seçici Tab */}
                            <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
                                {['whatsapp-web', 'meta', 'unipile'].map(p => (
                                    <button key={p}
                                        className={`btn btn-sm ${waProvider === p ? 'btn-primary' : 'btn-ghost'}`}
                                        onClick={() => setWaProvider(p)}
                                        style={{ textTransform: 'capitalize', minWidth: 90 }}>
                                        {p === 'meta' ? 'Meta (Resmi)' : p === 'unipile' ? 'Unipile' : 'WA Web (QR)'}
                                    </button>
                                ))}
                            </div>

                            {/* Per-provider aktif/pasif toggle (whatsapp-web hariç — o otomatik) */}
                            {waProvider !== 'whatsapp-web' && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                                <span style={{ fontSize: 12, color: (waProvider === 'meta' ? waMetaForm.is_active : waUnipileForm.is_active) ? 'var(--success)' : 'var(--text-muted)' }}>
                                    {waProvider === 'meta' ? 'Meta' : 'Unipile'}: {(waProvider === 'meta' ? waMetaForm.is_active : waUnipileForm.is_active) ? 'Aktif' : 'Pasif'}
                                </span>
                                <div className={`toggle ${(waProvider === 'meta' ? waMetaForm.is_active : waUnipileForm.is_active) ? 'active' : ''}`}
                                    onClick={() => waProvider === 'meta'
                                        ? setWaMetaForm(prev => ({ ...prev, is_active: !prev.is_active }))
                                        : setWaUnipileForm(prev => ({ ...prev, is_active: !prev.is_active }))} />
                            </div>
                            )}

                            {waProvider === 'whatsapp-web' ? (
                                <div style={{ padding: '16px', borderRadius: 'var(--radius-md)', background: 'rgba(37,211,102,0.06)', border: '1px solid rgba(37,211,102,0.2)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                                        <Smartphone size={20} style={{ color: '#25D366' }} />
                                        <div>
                                            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                                                WhatsApp Web Bağlantısı (Ücretsiz)
                                            </p>
                                            <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                                QR kod okutarak kişisel veya iş WhatsApp numaranızı bağlayın. Meta veya Unipile hesabı gerekmez.
                                            </p>
                                        </div>
                                    </div>

                                    {/* Durum Göstergesi */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, padding: '10px 14px', borderRadius: 'var(--radius-md)',
                                        background: waWebStatus.status === 'connected' ? 'rgba(34,197,94,0.1)' : waWebStatus.status === 'qr_ready' ? 'rgba(234,179,8,0.1)' : 'rgba(239,68,68,0.1)',
                                        border: `1px solid ${waWebStatus.status === 'connected' ? 'rgba(34,197,94,0.3)' : waWebStatus.status === 'qr_ready' ? 'rgba(234,179,8,0.3)' : 'rgba(239,68,68,0.3)'}` }}>
                                        {waWebStatus.status === 'connected' ? <Wifi size={16} style={{ color: '#22c55e' }} /> :
                                         waWebStatus.status === 'qr_ready' || waWebStatus.status === 'initializing' ? <Loader size={16} className="spinning" style={{ color: '#eab308' }} /> :
                                         <WifiOff size={16} style={{ color: '#ef4444' }} />}
                                        <div>
                                            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                                                {waWebStatus.status === 'connected' ? 'Bağlı' :
                                                 waWebStatus.status === 'qr_ready' ? 'QR Kod Hazır — Telefondan Okutun' :
                                                 waWebStatus.status === 'initializing' ? 'Başlatılıyor... (30-60 sn sürebilir)' :
                                                 waWebStatus.status === 'auth_failed' ? 'Kimlik Doğrulama Hatası' :
                                                 waWebStatus.status === 'error' ? 'Başlatma Hatası' :
                                                 'Bağlı Değil'}
                                            </span>
                                            {waWebStatus.phone && (
                                                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
                                                    {waWebStatus.name && `${waWebStatus.name} — `}+{waWebStatus.phone}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* QR Kod */}
                                    {waWebQR && waWebStatus.status !== 'connected' && (
                                        <div style={{ textAlign: 'center', marginBottom: 16 }}>
                                            <img src={waWebQR} alt="WhatsApp QR" style={{ width: 280, height: 280, borderRadius: 'var(--radius-md)', border: '2px solid var(--border-color)' }} />
                                            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
                                                WhatsApp &gt; Bağlı Cihazlar &gt; Cihaz Bağla ile okutun
                                            </p>
                                        </div>
                                    )}

                                    {/* Butonlar */}
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        {waWebStatus.status !== 'connected' ? (
                                            <button className="btn btn-sm" disabled={waWebLoading}
                                                style={{ background: '#25D366', color: '#fff', border: 'none' }}
                                                onClick={async () => {
                                                    setWaWebLoading(true);
                                                    setWaWebQR(null);
                                                    try {
                                                        await integrationsAPI.waWebConnect();
                                                        setTestResult({ success: true, message: 'WhatsApp başlatılıyor, QR kod bekleniyor...' });
                                                        // QR kodu poll et
                                                        const pollQR = setInterval(async () => {
                                                            try {
                                                                const qrRes = await integrationsAPI.waWebQR();
                                                                if (qrRes.data.qr) {
                                                                    setWaWebQR(qrRes.data.qr);
                                                                    setWaWebStatus(prev => ({ ...prev, status: 'qr_ready' }));
                                                                }
                                                                const stRes = await integrationsAPI.waWebStatus();
                                                                setWaWebStatus(stRes.data);
                                                                if (stRes.data.status === 'connected') {
                                                                    clearInterval(pollQR);
                                                                    setWaWebQR(null);
                                                                    setWaWebLoading(false);
                                                                    setTestResult({ success: true, message: 'WhatsApp başarıyla bağlandı!' });
                                                                }
                                                                if (stRes.data.status === 'error') {
                                                                    clearInterval(pollQR);
                                                                    setWaWebLoading(false);
                                                                    setTestResult({ success: false, message: 'WhatsApp başlatılamadı: ' + (stRes.data.error || 'Chromium hatası') });
                                                                }
                                                            } catch (e) { }
                                                        }, 3000);
                                                        // 2 dakika sonra polling'i durdur
                                                        setTimeout(() => { clearInterval(pollQR); setWaWebLoading(false); }, 120000);
                                                    } catch (err) {
                                                        setTestResult({ success: false, message: 'Bağlantı hatası: ' + (err.response?.data?.error || err.message) });
                                                        setWaWebLoading(false);
                                                    }
                                                }}>
                                                {waWebLoading ? <Loader size={14} className="spinning" /> : <QrCode size={14} />}
                                                {' '}QR Kod ile Bağlan
                                            </button>
                                        ) : (
                                            <button className="btn btn-sm" disabled={waWebLoading}
                                                style={{ background: '#ef4444', color: '#fff', border: 'none' }}
                                                onClick={async () => {
                                                    if (!window.confirm('WhatsApp bağlantısını kesmek istediğinize emin misiniz?')) return;
                                                    setWaWebLoading(true);
                                                    try {
                                                        await integrationsAPI.waWebDisconnect();
                                                        setWaWebStatus({ status: 'disconnected', phone: null, name: null });
                                                        setTestResult({ success: true, message: 'WhatsApp bağlantısı kesildi' });
                                                    } catch (err) {
                                                        setTestResult({ success: false, message: 'Bağlantı kesme hatası: ' + (err.response?.data?.error || err.message) });
                                                    } finally { setWaWebLoading(false); }
                                                }}>
                                                <WifiOff size={14} /> Bağlantıyı Kes
                                            </button>
                                        )}
                                        <button className="btn btn-secondary btn-sm" disabled={waWebLoading}
                                            onClick={async () => {
                                                try {
                                                    const res = await integrationsAPI.waWebStatus();
                                                    setWaWebStatus(res.data);
                                                    setTestResult({ success: true, message: `Durum: ${res.data.status}${res.data.phone ? ` — +${res.data.phone}` : ''}` });
                                                } catch (err) {
                                                    setTestResult({ success: false, message: 'Durum sorgulanamadı' });
                                                }
                                            }}>
                                            Durumu Kontrol Et
                                        </button>
                                    </div>
                                </div>
                            ) : waProvider === 'meta' ? (
                                <>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                                        <div>
                                            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <Key size={12} /> Access Token
                                            </label>
                                            <input className="input" type="password" placeholder="WhatsApp Access Token" value={waMetaForm.api_key}
                                                onChange={e => setWaMetaForm(prev => ({ ...prev, api_key: e.target.value }))} />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <Shield size={12} /> App Secret
                                            </label>
                                            <input className="input" type="password" placeholder="App Secret" value={waMetaForm.api_secret}
                                                onChange={e => setWaMetaForm(prev => ({ ...prev, api_secret: e.target.value }))} />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <Phone size={12} /> Phone Number ID
                                            </label>
                                            <input className="input" placeholder="WhatsApp Phone Number ID" value={waMetaForm.phone_number_id}
                                                onChange={e => setWaMetaForm(prev => ({ ...prev, phone_number_id: e.target.value }))} />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <Shield size={12} /> Verify Token
                                            </label>
                                            <input className="input" placeholder="Webhook Verify Token" value={waMetaForm.verify_token}
                                                onChange={e => setWaMetaForm(prev => ({ ...prev, verify_token: e.target.value }))} />
                                        </div>
                                    </div>
                                    <div style={{ marginBottom: 14 }}>
                                        <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                            <Webhook size={12} /> Webhook URL (Meta Dashboard'a yapıştırın)
                                        </label>
                                        <input className="input" readOnly value={`${serverUrl}/api/webhooks/whatsapp`}
                                            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', cursor: 'text' }}
                                            onClick={e => { e.target.select(); navigator.clipboard?.writeText(e.target.value); }} />
                                        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                                            Bu URL'yi Meta Developer Dashboard → WhatsApp → Configuration → Webhook URL alanına yapıştırın
                                        </p>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 'var(--radius-md)', background: 'rgba(37,211,102,0.06)', border: '1px solid rgba(37,211,102,0.2)', fontSize: 12, color: 'var(--text-secondary)' }}>
                                        Unipile üzerinden WhatsApp entegrasyonu. API anahtarınızı Unipile Dashboard → Settings → API Keys bölümünden alın.
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                                        <div>
                                            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <Key size={12} /> Unipile API Key
                                            </label>
                                            <input className="input" type="password" placeholder="Unipile API Key" value={waUnipileForm.api_key}
                                                onChange={e => setWaUnipileForm(prev => ({ ...prev, api_key: e.target.value }))} />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <Globe size={12} /> DSN URL
                                            </label>
                                            <input className="input" placeholder="https://api1.unipile.com:13433" value={waUnipileForm.dsn_url}
                                                onChange={e => setWaUnipileForm(prev => ({ ...prev, dsn_url: e.target.value }))} />
                                        </div>
                                    </div>
                                    <div style={{ marginBottom: 14 }}>
                                        <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                            <MessageCircle size={14} /> Unipile Account ID
                                        </label>
                                        <input className="input" placeholder="Unipile Dashboard → Accounts → Account ID" value={waUnipileForm.unipile_account_id}
                                            onChange={e => setWaUnipileForm(prev => ({ ...prev, unipile_account_id: e.target.value }))} />
                                        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                                            Unipile Dashboard → Accounts sayfasından WhatsApp hesabınızın ID'sini kopyalayın
                                        </p>
                                    </div>
                                    <div style={{ marginBottom: 14 }}>
                                        <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                            <Webhook size={12} /> Webhook URL (Unipile Dashboard'a yapıştırın)
                                        </label>
                                        <input className="input" readOnly value={unipileWebhookUrl}
                                            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', cursor: 'text' }}
                                            onClick={e => { e.target.select(); navigator.clipboard?.writeText(e.target.value); }} />
                                        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                                            Bu URL'yi Unipile Dashboard → Webhooks bölümüne yapıştırın
                                        </p>
                                    </div>
                                    {/* QR ile WhatsApp Bağla */}
                                    <div style={{ marginBottom: 14, padding: '12px 14px', borderRadius: 'var(--radius-md)', background: 'rgba(37,211,102,0.08)', border: '1px dashed rgba(37,211,102,0.3)' }}>
                                        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
                                            QR Kod ile WhatsApp Bağla
                                        </p>
                                        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
                                            Kişisel WhatsApp numaranızı QR kod okutarak bağlayın. Önce yukarıdaki API Key ve DSN URL'yi kaydedin.
                                        </p>
                                        <button className="btn btn-sm" disabled={saving || !waUnipileForm.api_key || !waUnipileForm.dsn_url}
                                            style={{ background: '#25D366', color: '#fff', border: 'none' }}
                                            onClick={async () => {
                                                setSaving(true);
                                                try {
                                                    // Önce formu kaydet
                                                    await integrationsAPI.save(waUnipileForm);
                                                    const res = await integrationsAPI.unipileConnect('WHATSAPP');
                                                    if (res.data.url) {
                                                        window.open(res.data.url, '_blank');
                                                        setTestResult({ success: true, message: 'QR kod sayfası açıldı! Tarayıcıda WhatsApp QR kodunu okutun.' });
                                                    } else {
                                                        setTestResult({ success: false, message: 'Bağlantı URL\'si alınamadı' });
                                                    }
                                                } catch (err) {
                                                    setTestResult({ success: false, message: 'QR bağlantı hatası: ' + (err.response?.data?.error || err.message) });
                                                } finally { setSaving(false); }
                                            }}>
                                            <Phone size={14} /> QR ile Bağla
                                        </button>
                                    </div>
                                </>
                            )}

                            {waProvider !== 'whatsapp-web' && (
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button className="btn btn-primary btn-sm" onClick={() => saveIntegration(waProvider === 'meta' ? waMetaForm : waUnipileForm)} disabled={saving}>
                                    {saving ? <Loader size={14} className="spinning" /> : <Save size={14} />} Kaydet
                                </button>
                                <button className="btn btn-secondary btn-sm" onClick={() => testConnection('whatsapp', waProvider)} disabled={saving}>
                                    Bağlantıyı Test Et
                                </button>
                            </div>
                            )}
                        </div>
                    </div>

                    {/* Messenger */}
                    <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
                        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-md)', background: 'linear-gradient(135deg, #00B2FF, #006AFF)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                                    <MessageCircle size={18} />
                                </div>
                                <div>
                                    <h3 style={{ fontSize: 15, fontWeight: 600 }}>Facebook Messenger</h3>
                                    <p style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Messenger mesajlarını alıp yanıtlayın</p>
                                </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                {msgMetaForm.is_active ? (
                                    <span className="badge" style={{ fontSize: 10, background: 'rgba(59,130,246,0.12)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.3)' }}>Aktif</span>
                                ) : (
                                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Pasif</span>
                                )}
                            </div>
                        </div>
                        <div style={{ padding: 20 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                                <span style={{ fontSize: 12, color: msgMetaForm.is_active ? 'var(--success)' : 'var(--text-muted)' }}>
                                    {msgMetaForm.is_active ? 'Aktif' : 'Pasif'}
                                </span>
                                <div className={`toggle ${msgMetaForm.is_active ? 'active' : ''}`}
                                    onClick={() => setMsgMetaForm(prev => ({ ...prev, is_active: !prev.is_active }))} />
                            </div>

                            <div style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 'var(--radius-md)', background: 'rgba(0,106,255,0.06)', border: '1px solid rgba(0,106,255,0.2)', fontSize: 12, color: 'var(--text-secondary)' }}>
                                Facebook sayfanıza gelen Messenger mesajlarını CRM'de yönetin. Instagram ile aynı Meta uygulamasını kullanabilirsiniz.
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                                <div>
                                    <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <Key size={12} /> Access Token
                                    </label>
                                    <input className="input" type="password" placeholder="Page Access Token" value={msgMetaForm.api_key}
                                        onChange={e => setMsgMetaForm(prev => ({ ...prev, api_key: e.target.value }))} />
                                </div>
                                <div>
                                    <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <Shield size={12} /> App Secret
                                    </label>
                                    <input className="input" type="password" placeholder="App Secret" value={msgMetaForm.api_secret}
                                        onChange={e => setMsgMetaForm(prev => ({ ...prev, api_secret: e.target.value }))} />
                                </div>
                                <div>
                                    <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <Globe size={12} /> Page ID
                                    </label>
                                    <input className="input" placeholder="Facebook Page ID" value={msgMetaForm.page_id}
                                        onChange={e => setMsgMetaForm(prev => ({ ...prev, page_id: e.target.value }))} />
                                </div>
                                <div>
                                    <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <Shield size={12} /> Verify Token
                                    </label>
                                    <input className="input" placeholder="Webhook Verify Token" value={msgMetaForm.verify_token}
                                        onChange={e => setMsgMetaForm(prev => ({ ...prev, verify_token: e.target.value }))} />
                                </div>
                            </div>
                            <div style={{ marginBottom: 14 }}>
                                <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <Webhook size={12} /> Webhook URL (Meta Dashboard'a yapıştırın)
                                </label>
                                <input className="input" readOnly value={`${serverUrl}/api/webhooks/messenger`}
                                    style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', cursor: 'text' }}
                                    onClick={e => { e.target.select(); navigator.clipboard?.writeText(e.target.value); }} />
                                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                                    Bu URL'yi Meta Developer Dashboard → Messenger → Webhooks → Callback URL alanına yapıştırın
                                </p>
                            </div>

                            <div style={{ display: 'flex', gap: 8 }}>
                                <button className="btn btn-primary btn-sm" onClick={() => saveIntegration(msgMetaForm)} disabled={saving}>
                                    {saving ? <Loader size={14} className="spinning" /> : <Save size={14} />} Kaydet
                                </button>
                                <button className="btn btn-secondary btn-sm" onClick={() => testConnection('messenger', 'meta')} disabled={saving}>
                                    Bağlantıyı Test Et
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* How-to Guide */}
                    <div className="glass-card" style={{ padding: 20 }}>
                        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>📖 Nasıl Bağlanır?</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20 }}>
                            <div>
                                <h4 style={{ fontSize: 13, fontWeight: 600, color: 'var(--instagram)', marginBottom: 8 }}>Instagram Kurulumu</h4>
                                <ol style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.8, paddingLeft: 16 }}>
                                    <li><a href="https://developers.facebook.com" target="_blank" rel="noopener" style={{ color: 'var(--accent-primary-hover)' }}>Meta Developer Dashboard</a>'a gidin</li>
                                    <li>"Create App" ile yeni uygulama oluşturun</li>
                                    <li>Instagram Graph API'yi etkinleştirin</li>
                                    <li>Access Token ve Page ID'yi kopyalayın</li>
                                    <li>Webhooks bölümünde yukarıdaki URL'yi yapıştırın</li>
                                    <li>Verify Token'ı girin ve doğrulayın</li>
                                    <li>"messages" subscription'ı etkinleştirin</li>
                                </ol>
                            </div>
                            <div>
                                <h4 style={{ fontSize: 13, fontWeight: 600, color: 'var(--whatsapp)', marginBottom: 8 }}>WhatsApp Kurulumu</h4>
                                <ol style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.8, paddingLeft: 16 }}>
                                    <li><a href="https://developers.facebook.com" target="_blank" rel="noopener" style={{ color: 'var(--accent-primary-hover)' }}>Meta Developer Dashboard</a>'a gidin</li>
                                    <li>WhatsApp Business ürününü ekleyin</li>
                                    <li>Telefon numarası ekleyin/doğrulayın</li>
                                    <li>Access Token ve Phone Number ID'yi kopyalayın</li>
                                    <li>Configuration → Webhook URL'ye yukarıdaki URL'yi yapıştırın</li>
                                    <li>Verify Token'ı girin</li>
                                    <li>"messages" webhook field'ını subscribe edin</li>
                                </ol>
                            </div>
                            <div>
                                <h4 style={{ fontSize: 13, fontWeight: 600, color: '#006AFF', marginBottom: 8 }}>Messenger Kurulumu</h4>
                                <ol style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.8, paddingLeft: 16 }}>
                                    <li><a href="https://developers.facebook.com" target="_blank" rel="noopener" style={{ color: 'var(--accent-primary-hover)' }}>Meta Developer Dashboard</a>'a gidin</li>
                                    <li>Messenger ürününü ekleyin</li>
                                    <li>Facebook sayfanızı bağlayın</li>
                                    <li>Page Access Token oluşturun</li>
                                    <li>Webhooks → Callback URL'ye yukarıdaki URL'yi yapıştırın</li>
                                    <li>Verify Token'ı girin</li>
                                    <li>"messages" webhook field'ını subscribe edin</li>
                                </ol>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ========= AI PROMPTS TAB ========= */}
            {tab === 'ai' && (<>
                {/* Platform bazlı AI Toggle */}
                <div className="glass-card" style={{ padding: '16px 20px', marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                        <Bot size={18} style={{ color: 'var(--accent-primary)' }} />
                        <h3 style={{ fontSize: 15, fontWeight: 600 }}>Platform Bazlı AI Yanıtları</h3>
                    </div>
                    {!platformAI.feature_ai ? (
                        <p style={{ fontSize: 12, color: '#f87171', padding: '10px 0' }}>
                            Yapay zeka modülü sistem yöneticisi tarafından kapatılmış. Aktif etmek için yönetici ile iletişime geçin.
                        </p>
                    ) : (
                        <>
                            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 14 }}>
                                Her platform için AI otomatik yanıtını ayrı ayrı açıp kapatabilirsiniz. Kapatılan platformdan gelen mesajlara AI yanıt vermez.
                            </p>
                            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                                {[
                                    { key: 'ai_instagram', label: 'Instagram', color: '#E1306C' },
                                    { key: 'ai_whatsapp', label: 'WhatsApp', color: '#25D366' },
                                    { key: 'ai_messenger', label: 'Messenger', color: '#0084FF' },
                                ].map(p => (
                                    <div key={p.key} style={{
                                        flex: '1 1 140px', padding: '12px 16px', borderRadius: 'var(--radius-md)',
                                        border: '1px solid var(--border-color)', background: 'var(--bg-secondary)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12
                                    }}>
                                        <span style={{ fontSize: 13, fontWeight: 500, color: p.color }}>{p.label}</span>
                                        <label className="toggle-switch">
                                            <input type="checkbox" checked={!!platformAI[p.key]}
                                                onChange={async (e) => {
                                                    const val = e.target.checked ? 1 : 0;
                                                    setPlatformAI(prev => ({ ...prev, [p.key]: val }));
                                                    try {
                                                        await aiAPI.updatePlatformSettings({ [p.key]: val });
                                                        setTestResult({ success: true, message: `${p.label} AI yanıtı ${val ? 'açıldı' : 'kapatıldı'}` });
                                                    } catch (err) {
                                                        setPlatformAI(prev => ({ ...prev, [p.key]: val ? 0 : 1 }));
                                                        setTestResult({ success: false, message: err.response?.data?.error || 'Ayar güncellenemedi' });
                                                    }
                                                }} />
                                            <span className="toggle-slider"></span>
                                        </label>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </div>

                <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <Bot size={18} style={{ color: 'var(--accent-primary)' }} />
                            <h3 style={{ fontSize: 15, fontWeight: 600 }}>AI Promptları</h3>
                        </div>
                        <button className="btn btn-sm btn-primary" onClick={() => setShowNew(true)}>
                            <Plus size={14} /> Yeni Prompt
                        </button>
                    </div>

                    {showNew && (
                        <div style={{ padding: 20, borderBottom: '1px solid var(--border-color)', background: 'rgba(99,102,241,0.04)' }}>
                            <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Yeni Prompt Oluştur</h4>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                <input className="input" placeholder="Prompt Adı" value={newPrompt.name} onChange={e => setNewPrompt({ ...newPrompt, name: e.target.value })} />
                                <textarea className="input" placeholder="System Prompt (AI'ya verilen talimatlar)" value={newPrompt.system_prompt} onChange={e => setNewPrompt({ ...newPrompt, system_prompt: e.target.value })} rows={4} />
                                <textarea className="input" placeholder="Ek Talimatlar (opsiyonel)" value={newPrompt.instructions} onChange={e => setNewPrompt({ ...newPrompt, instructions: e.target.value })} rows={3} />
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <button className="btn btn-primary btn-sm" onClick={createPrompt} disabled={saving}>
                                        {saving ? <Loader size={14} className="spinning" /> : <><Save size={14} /> Kaydet</>}
                                    </button>
                                    <button className="btn btn-ghost btn-sm" onClick={() => setShowNew(false)}>İptal</button>
                                </div>
                            </div>
                        </div>
                    )}

                    {prompts.map(p => (
                        <div key={p.id} style={{ padding: 20, borderBottom: '1px solid var(--border-color)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                                <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <span style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</span>
                                        {p.is_active ? (
                                            <span className="badge" style={{ background: 'var(--success-bg)', color: 'var(--success)', fontSize: 10, border: '1px solid rgba(16,185,129,0.3)' }}>Aktif</span>
                                        ) : (
                                            <span className="badge" style={{ background: 'var(--unqualified-bg)', color: 'var(--unqualified)', fontSize: 10 }}>Pasif</span>
                                        )}
                                    </div>
                                    <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                                        v{p.version} • {p.creator_name || 'Sistem'} • {new Date(p.created_at).toLocaleDateString('tr-TR')}
                                    </span>
                                </div>
                                <div style={{ display: 'flex', gap: 6 }}>
                                    <button className="btn btn-sm btn-ghost" onClick={() => setEditingPrompt(editingPrompt === p.id ? null : p.id)}>
                                        {editingPrompt === p.id ? <EyeOff size={14} /> : <Eye size={14} />}
                                    </button>
                                    <button className="btn btn-sm btn-ghost" onClick={() => savePrompt(p.id, { is_active: !p.is_active })}>
                                        {p.is_active ? 'Deaktif' : 'Aktif'}
                                    </button>
                                    <button className="btn btn-sm btn-ghost" onClick={() => deletePrompt(p.id)} style={{ color: 'var(--error)' }}>
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </div>

                            {editingPrompt === p.id && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    <div>
                                        <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>System Prompt</label>
                                        <textarea className="input" defaultValue={p.system_prompt} id={`sp-${p.id}`} rows={4} />
                                    </div>
                                    <div>
                                        <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>Talimatlar</label>
                                        <textarea className="input" defaultValue={p.instructions} id={`ins-${p.id}`} rows={3} />
                                    </div>
                                    <button className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => {
                                        const sp = document.getElementById(`sp-${p.id}`).value;
                                        const ins = document.getElementById(`ins-${p.id}`).value;
                                        savePrompt(p.id, { system_prompt: sp, instructions: ins });
                                    }}>
                                        <Save size={14} /> Güncelle
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}

                    {prompts.length === 0 && (
                        <div className="empty-state" style={{ padding: 40 }}>
                            <AlertCircle />
                            <p>Henüz prompt yok</p>
                        </div>
                    )}
                </div>
            </>)}

            {/* ========= LEAD AYARLARI TAB ========= */}
            {tab === 'leads' && (
                <div className="glass-card" style={{ padding: '20px 24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                        <Target size={18} style={{ color: '#06b6d4' }} />
                        <h3 style={{ fontSize: 15, fontWeight: 600 }}>Lead Otomasyon Ayarları</h3>
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 18 }}>
                        Lead modülünü aktif/pasif yapın ve otomasyon ayarlarını düzenleyin.
                    </p>

                    {/* Lead özelliği aktif/pasif toggle */}
                    <div style={{
                        padding: '14px 18px', borderRadius: 'var(--radius-md)',
                        border: `1px solid ${leadSettings.feature_lead ? 'rgba(6,182,212,0.3)' : 'var(--border-color)'}`,
                        background: leadSettings.feature_lead ? 'rgba(6,182,212,0.06)' : 'var(--bg-secondary)',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                        marginBottom: 16
                    }}>
                        <div>
                            <span style={{ fontSize: 13, fontWeight: 600, color: leadSettings.feature_lead ? '#06b6d4' : 'var(--text-secondary)' }}>
                                🎯 Lead Yönetimi {leadSettings.feature_lead ? '(Aktif)' : '(Pasif)'}
                            </span>
                            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                                Lead modülü, sidebar menüsü ve tüm lead işlevleri
                            </div>
                        </div>
                        <label className="toggle-switch">
                            <input type="checkbox" checked={!!leadSettings.feature_lead}
                                disabled={user?.role !== 'admin' && user?.role !== 'super_admin'}
                                onChange={async (e) => {
                                    const val = e.target.checked ? 1 : 0;
                                    setLeadSettings(prev => ({ ...prev, feature_lead: val }));
                                    try {
                                        await leadsAPI.updateSettings({ feature_lead: val });
                                        setTestResult({ success: true, message: `Lead yönetimi ${val ? 'aktif edildi' : 'pasif edildi'}` });
                                    } catch (err) {
                                        setTestResult({ success: false, message: 'Kaydedilemedi' });
                                    }
                                }} />
                            <span className="toggle-slider"></span>
                        </label>
                    </div>

                    {/* feature_lead açıkken otomasyon ayarları */}
                    {!!leadSettings.feature_lead && (<>
                    {/* Otomatik mesaj toggle */}
                    <div style={{
                        padding: '14px 18px', borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-color)', background: 'var(--bg-secondary)',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                        marginBottom: 20
                    }}>
                        <div>
                            <span style={{ fontSize: 13, fontWeight: 500, color: '#06b6d4' }}>📲 Otomatik WhatsApp Mesajı</span>
                            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                                Yeni lead geldiğinde otomatik olarak WhatsApp mesajı gönderilir
                            </div>
                        </div>
                        <label className="toggle-switch">
                            <input type="checkbox" checked={!!leadSettings.lead_auto_message}
                                disabled={user?.role !== 'admin' && user?.role !== 'super_admin'}
                                onChange={async (e) => {
                                    const val = e.target.checked ? 1 : 0;
                                    setLeadSettings(prev => ({ ...prev, lead_auto_message: val }));
                                    try {
                                        await leadsAPI.updateSettings({ lead_auto_message: val });
                                        setTestResult({ success: true, message: `Otomatik mesaj ${val ? 'açıldı' : 'kapatıldı'}` });
                                    } catch (err) {
                                        setTestResult({ success: false, message: 'Kaydedilemedi' });
                                    }
                                }} />
                            <span className="toggle-slider"></span>
                        </label>
                    </div>

                    {/* Mesaj şablonu ve gecikme — auto_message açıkken göster */}
                    {!!leadSettings.lead_auto_message && (
                        <div style={{ padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', background: 'var(--bg-tertiary)' }}>
                            <div style={{ marginBottom: 16 }}>
                                <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 6 }}>Mesaj Şablonu</label>
                                <textarea className="form-input" rows={4}
                                    placeholder="Merhaba {isim}, bizimle iletişime geçtiğiniz için teşekkür ederiz!"
                                    value={leadSettings.lead_message_template}
                                    disabled={user?.role !== 'admin' && user?.role !== 'super_admin'}
                                    onChange={(e) => setLeadSettings(prev => ({ ...prev, lead_message_template: e.target.value }))}
                                    style={{ resize: 'vertical', width: '100%' }}
                                />
                                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                                    Kullanılabilir değişkenler: <code style={{ background: 'var(--bg-secondary)', padding: '1px 4px', borderRadius: 3 }}>{'{isim}'}</code> — Lead'in adı
                                </p>
                            </div>

                            <div style={{ marginBottom: 16 }}>
                                <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 6 }}>Gecikme Süresi (saniye)</label>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <input className="form-input" type="number" min={0} max={3600}
                                        value={leadSettings.lead_message_delay}
                                        disabled={user?.role !== 'admin' && user?.role !== 'super_admin'}
                                        onChange={(e) => setLeadSettings(prev => ({ ...prev, lead_message_delay: parseInt(e.target.value) || 0 }))}
                                        style={{ width: 120 }}
                                    />
                                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                        {leadSettings.lead_message_delay === 0 ? 'Hemen gönder' :
                                            leadSettings.lead_message_delay >= 60 ? `${Math.floor(leadSettings.lead_message_delay / 60)} dk ${leadSettings.lead_message_delay % 60}s sonra` :
                                                `${leadSettings.lead_message_delay} saniye sonra`}
                                    </span>
                                </div>
                            </div>

                            <button className="btn btn-sm btn-primary"
                                disabled={(user?.role !== 'admin' && user?.role !== 'super_admin') || saving}
                                onClick={async () => {
                                    setSaving(true);
                                    try {
                                        await leadsAPI.updateSettings({
                                            lead_message_template: leadSettings.lead_message_template,
                                            lead_message_delay: leadSettings.lead_message_delay
                                        });
                                        setTestResult({ success: true, message: 'Lead otomasyon ayarları kaydedildi' });
                                    } catch (err) {
                                        setTestResult({ success: false, message: 'Kaydetme hatası' });
                                    } finally { setSaving(false); }
                                }}
                            >
                                <Save size={14} /> Kaydet
                            </button>
                        </div>
                    )}

                    </>)}

                    {/* Leadgen Webhook URL bilgisi — her zaman göster */}
                    <div style={{ marginTop: 20, padding: '14px 16px', borderRadius: 'var(--radius-md)', background: 'rgba(6,182,212,0.06)', border: '1px solid rgba(6,182,212,0.2)' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--text-primary)' }}>Meta Lead Ads Webhook</div>
                        <input className="input" readOnly
                            value={`${serverUrl}/api/webhooks/leadgen`}
                            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', cursor: 'text', marginBottom: 6 }}
                            onClick={e => { e.target.select(); navigator.clipboard?.writeText(e.target.value); }} />
                        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            Bu URL'yi Meta Developer Dashboard → Webhooks → Page → leadgen alanına yapıştırın.
                            Entegrasyonlar sekmesinde kayıtlı Page ID ile eşleşen leadler otomatik olarak sisteme düşer.
                        </p>
                    </div>
                </div>
            )}

            {/* ========= BİLDİRİMLER TAB ========= */}
            {tab === 'notifications' && (
                <div className="glass-card" style={{ padding: '20px 24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                        <Bell size={18} style={{ color: 'var(--accent-primary)' }} />
                        <h3 style={{ fontSize: 15, fontWeight: 600 }}>Randevu Bildirimleri</h3>
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 18 }}>
                        Randevu oluşturulduğunda müşteriye otomatik onay mesajı gönderilir. Hatırlatma mesajı da randevudan önce gönderilir.
                    </p>

                    {/* WhatsApp / SMS Toggle */}
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
                        {[
                            { key: 'appointment_whatsapp_notify', label: 'WhatsApp Bildirimi', color: '#25D366', icon: '📱' },
                            { key: 'appointment_sms_notify', label: 'SMS Bildirimi', color: '#FF6B35', icon: '📩' },
                        ].map(p => (
                            <div key={p.key} style={{
                                flex: '1 1 200px', padding: '14px 18px', borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--border-color)', background: 'var(--bg-secondary)',
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12
                            }}>
                                <div>
                                    <span style={{ fontSize: 13, fontWeight: 500, color: p.color }}>{p.icon} {p.label}</span>
                                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                                        {p.key === 'appointment_whatsapp_notify' ? 'Aktif WhatsApp entegrasyonu gerekli' : 'NetGSM API bilgileri gerekli'}
                                    </div>
                                </div>
                                <label className="toggle-switch">
                                    <input type="checkbox" checked={!!notifySettings[p.key]}
                                        disabled={user?.role !== 'admin' && user?.role !== 'super_admin'}
                                        onChange={async (e) => {
                                            const val = e.target.checked ? 1 : 0;
                                            setNotifySettings(prev => ({ ...prev, [p.key]: val }));
                                            try {
                                                await appointmentsAPI.updateNotificationSettings({ [p.key]: val });
                                                setTestResult({ success: true, message: `${p.label} ${val ? 'açıldı' : 'kapatıldı'}` });
                                            } catch (err) {
                                                // Toggle açık kalsın, sadece uyarı göster
                                                setTestResult({ success: false, message: 'Sunucuya kaydedilemedi, tekrar deneyin' });
                                            }
                                        }} />
                                    <span className="toggle-slider"></span>
                                </label>
                            </div>
                        ))}
                    </div>

                    {/* Hatırlatma süresi */}
                    <div style={{ marginBottom: 20 }}>
                        <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 6 }}>Hatırlatma Süresi</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <select className="form-input" style={{ width: 180 }}
                                value={notifySettings.appointment_reminder_minutes}
                                disabled={user?.role !== 'admin' && user?.role !== 'super_admin'}
                                onChange={async (e) => {
                                    const val = parseInt(e.target.value);
                                    setNotifySettings(prev => ({ ...prev, appointment_reminder_minutes: val }));
                                    try {
                                        await appointmentsAPI.updateNotificationSettings({ appointment_reminder_minutes: val });
                                        setTestResult({ success: true, message: 'Hatırlatma süresi güncellendi' });
                                    } catch (err) {
                                        setTestResult({ success: false, message: 'Güncellenemedi' });
                                    }
                                }}
                            >
                                <option value={30}>30 dakika önce</option>
                                <option value={60}>1 saat önce</option>
                                <option value={120}>2 saat önce</option>
                                <option value={180}>3 saat önce</option>
                                <option value={1440}>1 gün önce</option>
                            </select>
                            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Randevudan bu kadar önce hatırlatma gönderilir</span>
                        </div>
                    </div>

                    {/* SMS Ayarları (NetGSM) */}
                    {!!notifySettings.appointment_sms_notify && (
                        <div style={{ padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', background: 'var(--bg-tertiary)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                                <MessageSquare size={16} style={{ color: '#FF6B35' }} />
                                <h4 style={{ fontSize: 14, fontWeight: 600 }}>NetGSM SMS Ayarları</h4>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                                <div>
                                    <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Kullanıcı Kodu</label>
                                    <input className="form-input" placeholder="NetGSM kullanıcı kodu"
                                        value={notifySettings.sms_usercode}
                                        disabled={user?.role !== 'admin' && user?.role !== 'super_admin'}
                                        onChange={(e) => setNotifySettings(prev => ({ ...prev, sms_usercode: e.target.value }))} />
                                </div>
                                <div>
                                    <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Şifre</label>
                                    <input className="form-input" type="password" placeholder="NetGSM şifre"
                                        value={notifySettings.sms_password}
                                        disabled={user?.role !== 'admin' && user?.role !== 'super_admin'}
                                        onChange={(e) => setNotifySettings(prev => ({ ...prev, sms_password: e.target.value }))} />
                                </div>
                                <div>
                                    <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Mesaj Başlığı</label>
                                    <input className="form-input" placeholder="SMS gönderici adı"
                                        value={notifySettings.sms_msgheader}
                                        disabled={user?.role !== 'admin' && user?.role !== 'super_admin'}
                                        onChange={(e) => setNotifySettings(prev => ({ ...prev, sms_msgheader: e.target.value }))} />
                                </div>
                            </div>
                            <button className="btn btn-sm btn-primary" style={{ marginTop: 14 }}
                                disabled={user?.role !== 'admin' || saving}
                                onClick={async () => {
                                    setSaving(true);
                                    try {
                                        await appointmentsAPI.updateNotificationSettings({
                                            sms_usercode: notifySettings.sms_usercode,
                                            sms_password: notifySettings.sms_password,
                                            sms_msgheader: notifySettings.sms_msgheader
                                        });
                                        setTestResult({ success: true, message: 'SMS ayarları kaydedildi' });
                                    } catch (err) {
                                        setTestResult({ success: false, message: 'Kaydetme hatası' });
                                    } finally { setSaving(false); }
                                }}
                            >
                                <Save size={14} /> Kaydet
                            </button>
                        </div>
                    )}
                </div>
            )}

            <style>{`.spinning { animation: spin 1s linear infinite; }`}</style>
        </div>
    );
}
