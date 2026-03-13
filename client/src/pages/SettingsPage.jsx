import { useState, useEffect } from 'react';
import { aiAPI, integrationsAPI } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import {
    Settings, Bot, Save, Plus, Eye, EyeOff, AlertCircle,
    Instagram, MessageCircle, Link2, CheckCircle, X, Loader,
    Webhook, Globe, Key, Phone, Shield, Trash2
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

    // Integration form state
    const [igForm, setIgForm] = useState({ platform: 'instagram', provider: 'meta', api_key: '', api_secret: '', page_id: '', webhook_url: '', verify_token: '', dsn_url: '', unipile_account_id: '', is_active: false });
    const [waForm, setWaForm] = useState({ platform: 'whatsapp', provider: 'meta', api_key: '', api_secret: '', phone_number_id: '', webhook_url: '', verify_token: '', dsn_url: '', unipile_account_id: '', is_active: false });

    useEffect(() => { loadData(); }, []);

    const loadData = async () => {
        try {
            const [pRes, iRes] = await Promise.all([
                aiAPI.getPrompts(),
                integrationsAPI.list()
            ]);
            setPrompts(pRes.data.prompts || []);
            const ints = iRes.data.integrations || [];
            setIntegrations(ints);

            // Form'ları mevcut verilerle doldur
            const ig = ints.find(i => i.platform === 'instagram');
            if (ig) setIgForm(prev => ({ ...prev, ...ig, api_key: ig.api_key || '', api_secret: ig.api_secret || '', provider: ig.provider || 'meta', dsn_url: ig.dsn_url || '', unipile_account_id: ig.unipile_account_id || '' }));
            const wa = ints.find(i => i.platform === 'whatsapp');
            if (wa) setWaForm(prev => ({ ...prev, ...wa, api_key: wa.api_key || '', api_secret: wa.api_secret || '', provider: wa.provider || 'meta', dsn_url: wa.dsn_url || '', unipile_account_id: wa.unipile_account_id || '' }));

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

    const testConnection = async (platform) => {
        setSaving(true);
        try {
            const res = await integrationsAPI.test(platform);
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
                                {igForm.is_active && (
                                    <span className="badge" style={{ fontSize: 10, background: igForm.provider === 'meta' ? 'rgba(59,130,246,0.12)' : 'rgba(139,92,246,0.12)', color: igForm.provider === 'meta' ? '#3b82f6' : '#8b5cf6', border: `1px solid ${igForm.provider === 'meta' ? 'rgba(59,130,246,0.3)' : 'rgba(139,92,246,0.3)'}` }}>
                                        {igForm.provider === 'meta' ? 'Meta' : 'Unipile'}
                                    </span>
                                )}
                                <span style={{ fontSize: 12, color: igForm.is_active ? 'var(--success)' : 'var(--text-muted)' }}>{igForm.is_active ? 'Aktif' : 'Pasif'}</span>
                                <div className={`toggle ${igForm.is_active ? 'active' : ''}`}
                                    onClick={() => setIgForm(prev => ({ ...prev, is_active: !prev.is_active }))} />
                            </div>
                        </div>
                        <div style={{ padding: 20 }}>
                            {/* Provider Seçici */}
                            <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
                                {['meta', 'unipile'].map(p => (
                                    <button key={p}
                                        className={`btn btn-sm ${igForm.provider === p ? 'btn-primary' : 'btn-ghost'}`}
                                        onClick={() => setIgForm(prev => ({ ...prev, provider: p }))}
                                        style={{ textTransform: 'capitalize', minWidth: 90 }}>
                                        {p === 'meta' ? 'Meta (Resmi)' : 'Unipile'}
                                    </button>
                                ))}
                            </div>

                            {igForm.provider === 'meta' ? (
                                <>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                                        <div>
                                            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <Key size={12} /> Access Token
                                            </label>
                                            <input className="input" type="password" placeholder="Instagram Access Token" value={igForm.api_key}
                                                onChange={e => setIgForm(prev => ({ ...prev, api_key: e.target.value }))} />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <Shield size={12} /> App Secret
                                            </label>
                                            <input className="input" type="password" placeholder="App Secret" value={igForm.api_secret}
                                                onChange={e => setIgForm(prev => ({ ...prev, api_secret: e.target.value }))} />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <Globe size={12} /> Page ID
                                            </label>
                                            <input className="input" placeholder="Facebook Page ID" value={igForm.page_id}
                                                onChange={e => setIgForm(prev => ({ ...prev, page_id: e.target.value }))} />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <Shield size={12} /> Verify Token
                                            </label>
                                            <input className="input" placeholder="Webhook Verify Token" value={igForm.verify_token}
                                                onChange={e => setIgForm(prev => ({ ...prev, verify_token: e.target.value }))} />
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
                                            <input className="input" type="password" placeholder="Unipile API Key" value={igForm.api_key}
                                                onChange={e => setIgForm(prev => ({ ...prev, api_key: e.target.value }))} />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <Globe size={12} /> DSN URL
                                            </label>
                                            <input className="input" placeholder="https://api1.unipile.com:13433" value={igForm.dsn_url}
                                                onChange={e => setIgForm(prev => ({ ...prev, dsn_url: e.target.value }))} />
                                        </div>
                                    </div>
                                    {/* Unipile Account ID */}
                                    <div style={{ marginBottom: 14 }}>
                                        <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                            <Instagram size={18} /> Unipile Account ID
                                        </label>
                                        <input className="input" placeholder="Unipile Dashboard → Accounts → Account ID" value={igForm.unipile_account_id}
                                            onChange={e => setIgForm(prev => ({ ...prev, unipile_account_id: e.target.value }))} />
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
                                </>
                            )}

                            <div style={{ display: 'flex', gap: 8 }}>
                                <button className="btn btn-primary btn-sm" onClick={() => saveIntegration(igForm)} disabled={saving}>
                                    {saving ? <Loader size={14} className="spinning" /> : <Save size={14} />} Kaydet
                                </button>
                                <button className="btn btn-secondary btn-sm" onClick={() => testConnection('instagram')} disabled={saving}>
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
                                {waForm.is_active && (
                                    <span className="badge" style={{ fontSize: 10, background: waForm.provider === 'meta' ? 'rgba(59,130,246,0.12)' : 'rgba(139,92,246,0.12)', color: waForm.provider === 'meta' ? '#3b82f6' : '#8b5cf6', border: `1px solid ${waForm.provider === 'meta' ? 'rgba(59,130,246,0.3)' : 'rgba(139,92,246,0.3)'}` }}>
                                        {waForm.provider === 'meta' ? 'Meta' : 'Unipile'}
                                    </span>
                                )}
                                <span style={{ fontSize: 12, color: waForm.is_active ? 'var(--success)' : 'var(--text-muted)' }}>{waForm.is_active ? 'Aktif' : 'Pasif'}</span>
                                <div className={`toggle ${waForm.is_active ? 'active' : ''}`}
                                    onClick={() => setWaForm(prev => ({ ...prev, is_active: !prev.is_active }))} />
                            </div>
                        </div>
                        <div style={{ padding: 20 }}>
                            {/* Provider Seçici */}
                            <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
                                {['meta', 'unipile'].map(p => (
                                    <button key={p}
                                        className={`btn btn-sm ${waForm.provider === p ? 'btn-primary' : 'btn-ghost'}`}
                                        onClick={() => setWaForm(prev => ({ ...prev, provider: p }))}
                                        style={{ textTransform: 'capitalize', minWidth: 90 }}>
                                        {p === 'meta' ? 'Meta (Resmi)' : 'Unipile'}
                                    </button>
                                ))}
                            </div>

                            {waForm.provider === 'meta' ? (
                                <>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                                        <div>
                                            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <Key size={12} /> Access Token
                                            </label>
                                            <input className="input" type="password" placeholder="WhatsApp Access Token" value={waForm.api_key}
                                                onChange={e => setWaForm(prev => ({ ...prev, api_key: e.target.value }))} />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <Shield size={12} /> App Secret
                                            </label>
                                            <input className="input" type="password" placeholder="App Secret" value={waForm.api_secret}
                                                onChange={e => setWaForm(prev => ({ ...prev, api_secret: e.target.value }))} />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <Phone size={12} /> Phone Number ID
                                            </label>
                                            <input className="input" placeholder="WhatsApp Phone Number ID" value={waForm.phone_number_id}
                                                onChange={e => setWaForm(prev => ({ ...prev, phone_number_id: e.target.value }))} />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <Shield size={12} /> Verify Token
                                            </label>
                                            <input className="input" placeholder="Webhook Verify Token" value={waForm.verify_token}
                                                onChange={e => setWaForm(prev => ({ ...prev, verify_token: e.target.value }))} />
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
                                            <input className="input" type="password" placeholder="Unipile API Key" value={waForm.api_key}
                                                onChange={e => setWaForm(prev => ({ ...prev, api_key: e.target.value }))} />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <Globe size={12} /> DSN URL
                                            </label>
                                            <input className="input" placeholder="https://api1.unipile.com:13433" value={waForm.dsn_url}
                                                onChange={e => setWaForm(prev => ({ ...prev, dsn_url: e.target.value }))} />
                                        </div>
                                    </div>
                                    {/* Unipile Account ID */}
                                    <div style={{ marginBottom: 14 }}>
                                        <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                            <MessageCircle size={14} /> Unipile Account ID
                                        </label>
                                        <input className="input" placeholder="Unipile Dashboard → Accounts → Account ID" value={waForm.unipile_account_id}
                                            onChange={e => setWaForm(prev => ({ ...prev, unipile_account_id: e.target.value }))} />
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
                                </>
                            )}

                            <div style={{ display: 'flex', gap: 8 }}>
                                <button className="btn btn-primary btn-sm" onClick={() => saveIntegration(waForm)} disabled={saving}>
                                    {saving ? <Loader size={14} className="spinning" /> : <Save size={14} />} Kaydet
                                </button>
                                <button className="btn btn-secondary btn-sm" onClick={() => testConnection('whatsapp')} disabled={saving}>
                                    Bağlantıyı Test Et
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* How-to Guide */}
                    <div className="glass-card" style={{ padding: 20 }}>
                        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>📖 Nasıl Bağlanır?</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
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
                        </div>
                    </div>
                </div>
            )}

            {/* ========= AI PROMPTS TAB ========= */}
            {tab === 'ai' && (
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
            )}

            <style>{`.spinning { animation: spin 1s linear infinite; }`}</style>
        </div>
    );
}
