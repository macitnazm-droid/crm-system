import { useState, useEffect, useRef } from 'react';
import { conversationsAPI, messagesAPI, aiAPI, customersAPI } from '../lib/api';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import {
    Send, Bot, BotOff, User, Clock, Instagram, MessageCircle,
    Sparkles, Search, Filter, ChevronDown, Phone, Image, X, Pencil, Check
} from 'lucide-react';

export default function ConversationsPage() {
    const { user } = useAuth();
    const socket = useSocket();
    const [conversations, setConversations] = useState([]);
    const [selected, setSelected] = useState(null);
    const [messages, setMessages] = useState([]);
    const [convDetail, setConvDetail] = useState(null);
    const [newMessage, setNewMessage] = useState('');
    const [sending, setSending] = useState(false);
    const [aiLoading, setAiLoading] = useState(false);
    const [selectedFile, setSelectedFile] = useState(null);
    const [filePreview, setFilePreview] = useState(null);
    const fileInputRef = useRef(null);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState('all');
    const [editingName, setEditingName] = useState(false);
    const [editName, setEditName] = useState('');
    const messagesEndRef = useRef(null);
    const selectedRef = useRef(null);

    useEffect(() => { loadConversations(); }, [filter]);

    useEffect(() => {
        if (!socket) return;
        const handleNewMessage = (data) => {
            if (data.conversation_id === selected) {
                setMessages(prev => {
                    if (prev.some(m => m.id === data.message.id)) return prev;
                    return [...prev, data.message];
                });
                conversationsAPI.markRead(data.conversation_id).catch(() => {});
            }
            loadConversations();
        };
        const handleConvUpdate = () => loadConversations();

        socket.on('message:new', handleNewMessage);
        socket.on('conversation:updated', handleConvUpdate);
        socket.on('conversation:ai_toggled', handleConvUpdate);
        socket.on('customer:categorized', handleConvUpdate);
        socket.on('customer:updated', handleConvUpdate);

        return () => {
            socket.off('message:new', handleNewMessage);
            socket.off('conversation:updated', handleConvUpdate);
            socket.off('conversation:ai_toggled', handleConvUpdate);
            socket.off('customer:categorized', handleConvUpdate);
            socket.off('customer:updated', handleConvUpdate);
        };
    }, [socket, selected]);

    useEffect(() => { scrollToBottom(); }, [messages]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    const loadConversations = async () => {
        try {
            const res = await conversationsAPI.list({ status: filter !== 'all' ? filter : undefined });
            const convs = (res.data.conversations || []).map(c =>
                c.id === selectedRef.current ? { ...c, unread_count: 0 } : c
            );
            setConversations(convs);
        } catch (err) { console.error(err); }
    };

    const selectConversation = async (id) => {
        setSelected(id);
        selectedRef.current = id;
        setConversations(prev => prev.map(c => c.id === id ? { ...c, unread_count: 0 } : c));
        try {
            const res = await conversationsAPI.get(id);
            setConvDetail(res.data.conversation);
            setMessages(res.data.messages || []);
            conversationsAPI.markRead(id).catch(() => {});
        } catch (err) { console.error(err); }
    };

    const sendMessage = async () => {
        if ((!newMessage.trim() && !selectedFile) || !selected || sending) return;
        setSending(true);
        try {
            let mediaUrl = null;
            let mediaType = null;
            if (selectedFile) {
                const uploadRes = await messagesAPI.upload(selectedFile);
                mediaUrl = uploadRes.data.url;
                mediaType = uploadRes.data.media_type;
            }
            await messagesAPI.send(selected, newMessage.trim() || null, mediaUrl, mediaType);
            setNewMessage('');
            setSelectedFile(null);
            setFilePreview(null);
        } catch (err) { console.error(err); }
        finally { setSending(false); }
    };

    const handleFileSelect = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setSelectedFile(file);
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (ev) => setFilePreview(ev.target.result);
            reader.readAsDataURL(file);
        } else {
            setFilePreview(null);
        }
    };

    const clearFile = () => {
        setSelectedFile(null);
        setFilePreview(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const toggleAI = async () => {
        if (!convDetail) return;
        try {
            const res = await conversationsAPI.toggleAI(selected, !convDetail.ai_enabled);
            setConvDetail(res.data.conversation);
            loadConversations();
        } catch (err) { console.error(err); }
    };

    const generateAIResponse = async () => {
        if (!selected || aiLoading) return;
        setAiLoading(true);
        try {
            await aiAPI.generateResponse(selected);
        } catch (err) { console.error(err); }
        finally { setAiLoading(false); }
    };

    const saveCustomerName = async () => {
        if (!editName.trim() || !convDetail?.customer_id) return;
        try {
            await customersAPI.updateName(convDetail.customer_id, editName.trim());
            setConvDetail(prev => ({ ...prev, customer_name: editName.trim() }));
            setConversations(prev => prev.map(c =>
                c.id === selected ? { ...c, customer_name: editName.trim() } : c
            ));
            setEditingName(false);
        } catch (err) { console.error(err); }
    };

    const getCatClass = (c) => ({ hot: 'badge-hot', warm: 'badge-warm', cold: 'badge-cold', unqualified: 'badge-unqualified' }[c] || '');
    const getCatLabel = (c) => ({ hot: '🔥 Hot', warm: '☀️ Warm', cold: '❄️ Cold', unqualified: 'Belirsiz' }[c] || c);

    const timeAgo = (d) => {
        const diff = Math.floor((Date.now() - new Date(d)) / 1000);
        if (diff < 60) return `${diff}s`;
        if (diff < 3600) return `${Math.floor(diff / 60)}dk`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}sa`;
        return `${Math.floor(diff / 86400)}g`;
    };

    const formatTime = (d) => new Date(d).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

    const filtered = conversations.filter(c =>
        !search || c.customer_name?.toLowerCase().includes(search.toLowerCase()) ||
        c.last_message_preview?.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div style={{ display: 'flex', height: 'calc(100vh - 48px)', gap: 0, margin: '-24px -28px', animation: 'fadeIn 0.3s ease-out' }}>
            {/* Left: Conversation List */}
            <div style={{ width: 360, borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', background: 'var(--bg-secondary)' }}>
                {/* Search & Filter */}
                <div style={{ padding: 16, borderBottom: '1px solid var(--border-color)' }}>
                    <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Konuşmalar</h2>
                    <div style={{ position: 'relative', marginBottom: 10 }}>
                        <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                        <input className="input" placeholder="Ara..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 36, fontSize: 13 }} />
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                        {['all', 'open', 'paused', 'closed'].map(f => (
                            <button key={f} className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilter(f)} style={{ fontSize: 12 }}>
                                {f === 'all' ? 'Tümü' : f === 'open' ? 'Açık' : f === 'paused' ? 'Bekleyen' : 'Kapalı'}
                            </button>
                        ))}
                    </div>
                </div>

                {/* List */}
                <div style={{ flex: 1, overflowY: 'auto' }}>
                    {filtered.map(conv => (
                        <div
                            key={conv.id}
                            onClick={() => selectConversation(conv.id)}
                            style={{
                                padding: '14px 16px', cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'center',
                                borderBottom: '1px solid var(--border-color)', transition: 'background var(--transition-fast)',
                                background: selected === conv.id ? 'var(--bg-active)' : 'transparent',
                            }}
                            onMouseEnter={e => { if (selected !== conv.id) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                            onMouseLeave={e => { if (selected !== conv.id) e.currentTarget.style.background = 'transparent'; }}
                        >
                            <div style={{
                                width: 42, height: 42, borderRadius: 'var(--radius-md)', flexShrink: 0,
                                background: selected === conv.id ? 'var(--accent-gradient)' : 'var(--bg-tertiary)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                color: selected === conv.id ? 'white' : 'var(--text-secondary)',
                                fontWeight: 700, fontSize: 15
                            }}>
                                {conv.customer_name?.charAt(0)?.toUpperCase() || '?'}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                                    <span style={{ fontWeight: 600, fontSize: 13 }}>{conv.customer_name}</span>
                                    {conv.customer_source === 'instagram' && <Instagram size={13} style={{ color: '#E1306C', flexShrink: 0 }} />}
                                    {conv.customer_source === 'whatsapp' && <Phone size={13} style={{ color: '#25D366', flexShrink: 0 }} />}
                                    {conv.customer_source === 'messenger' && <MessageCircle size={13} style={{ color: '#006AFF', flexShrink: 0 }} />}
                                    <span className={`badge ${getCatClass(conv.customer_category)}`} style={{ fontSize: 9, padding: '1px 6px' }}>
                                        {conv.customer_category?.toUpperCase()}
                                    </span>
                                </div>
                                <p style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {conv.last_message_preview}
                                </p>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{timeAgo(conv.updated_at)}</span>
                                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                    {conv.ai_enabled ? <Bot size={12} style={{ color: 'var(--accent-primary)' }} /> : <BotOff size={12} style={{ color: 'var(--text-muted)' }} />}
                                    {conv.unread_count > 0 && (
                                        <span style={{ background: 'var(--accent-primary)', color: 'white', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 'var(--radius-full)', minWidth: 18, textAlign: 'center' }}>
                                            {conv.unread_count}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Right: Chat */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
                {!selected ? (
                    <div className="empty-state" style={{ flex: 1 }}>
                        <MessageCircle size={48} />
                        <h3 style={{ marginTop: 12, color: 'var(--text-secondary)' }}>Bir konuşma seçin</h3>
                        <p style={{ fontSize: 13, marginTop: 4 }}>Sol taraftan bir konuşma seçerek mesajları görüntüleyin.</p>
                    </div>
                ) : (
                    <>
                        {/* Chat Header */}
                        <div style={{
                            padding: '12px 20px', borderBottom: '1px solid var(--border-color)',
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            background: 'var(--bg-secondary)'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <div style={{
                                    width: 38, height: 38, borderRadius: 'var(--radius-md)',
                                    background: 'var(--accent-gradient)', display: 'flex', alignItems: 'center',
                                    justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 14
                                }}>
                                    {convDetail?.customer_name?.charAt(0)?.toUpperCase() || '?'}
                                </div>
                                <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        {editingName ? (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <input
                                                    className="input"
                                                    value={editName}
                                                    onChange={e => setEditName(e.target.value)}
                                                    onKeyDown={e => { if (e.key === 'Enter') saveCustomerName(); if (e.key === 'Escape') setEditingName(false); }}
                                                    autoFocus
                                                    style={{ fontSize: 14, padding: '4px 8px', width: 180, height: 30 }}
                                                />
                                                <button onClick={saveCustomerName} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-primary)', padding: 2 }} title="Kaydet">
                                                    <Check size={16} />
                                                </button>
                                                <button onClick={() => setEditingName(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }} title="Vazgeç">
                                                    <X size={16} />
                                                </button>
                                            </div>
                                        ) : (
                                            <>
                                                <span style={{ fontWeight: 600, fontSize: 15 }}>{convDetail?.customer_name}</span>
                                                <button onClick={() => { setEditName(convDetail?.customer_name || ''); setEditingName(true); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }} title="İsmi düzenle">
                                                    <Pencil size={13} />
                                                </button>
                                            </>
                                        )}
                                        <span className={`badge ${getCatClass(convDetail?.customer_category)}`}>
                                            {getCatLabel(convDetail?.customer_category)}
                                        </span>
                                        {convDetail?.customer_source === 'instagram' && <span className="badge badge-instagram" style={{ fontSize: 10 }}>Instagram</span>}
                                        {convDetail?.customer_source === 'whatsapp' && <span className="badge badge-whatsapp" style={{ fontSize: 10 }}>WhatsApp</span>}
                                        {convDetail?.customer_source === 'messenger' && <span className="badge" style={{ fontSize: 10, background: 'rgba(0,106,255,0.12)', color: '#006AFF', border: '1px solid rgba(0,106,255,0.3)' }}>Messenger</span>}
                                    </div>
                                    <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                                        Skor: {convDetail?.customer_lead_score || 0} • {convDetail?.customer_phone || convDetail?.customer_email || ''}
                                    </span>
                                </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <button className="btn btn-sm btn-secondary" onClick={generateAIResponse} disabled={aiLoading} style={{ fontSize: 12 }}>
                                    {aiLoading ? <div className="loading-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> : <><Sparkles size={14} /> AI Yanıt</>}
                                </button>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', fontSize: 12 }}>
                                    <Bot size={14} style={{ color: convDetail?.ai_enabled ? 'var(--accent-primary)' : 'var(--text-muted)' }} />
                                    <span style={{ color: 'var(--text-secondary)' }}>{convDetail?.ai_enabled ? 'AI Aktif' : 'AI Kapalı'}</span>
                                    <div className={`toggle ${convDetail?.ai_enabled ? 'active' : ''}`} onClick={toggleAI} style={{ width: 40, height: 22 }}>
                                        <style>{`.toggle::after { width: 16px !important; height: 16px !important; } .toggle.active::after { transform: translateX(18px) !important; }`}</style>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Messages */}
                        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {messages.map((msg, i) => (
                                <div key={msg.id || i} style={{
                                    display: 'flex', justifyContent: msg.direction === 'inbound' ? 'flex-start' : 'flex-end',
                                    animation: `fadeIn 0.2s ease-out ${Math.min(i * 30, 300)}ms both`
                                }}>
                                    <div style={{
                                        maxWidth: '70%', padding: '10px 16px', borderRadius: 16,
                                        background: msg.direction === 'inbound' ? 'var(--bg-tertiary)'
                                            : msg.is_ai_generated ? 'linear-gradient(135deg, rgba(139,92,246,0.2), rgba(99,102,241,0.15))'
                                                : 'var(--accent-gradient)',
                                        border: msg.direction === 'inbound' ? '1px solid var(--border-color)'
                                            : msg.is_ai_generated ? '1px solid rgba(139,92,246,0.3)' : 'none',
                                        borderBottomLeftRadius: msg.direction === 'inbound' ? 4 : 16,
                                        borderBottomRightRadius: msg.direction === 'outbound' ? 4 : 16,
                                    }}>
                                        {msg.direction === 'outbound' && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4, fontSize: 10, opacity: 0.7 }}>
                                                {msg.is_ai_generated ? <><Bot size={10} /> AI ({msg.ai_model})</> : <><User size={10} /> {msg.sender_name || user?.name}</>}
                                            </div>
                                        )}
                                        {msg.media_url && ['image', 'sticker'].includes(msg.media_type) && (
                                            <img
                                                src={msg.media_url}
                                                alt="Görsel"
                                                style={{ maxWidth: '100%', maxHeight: 300, borderRadius: 8, marginBottom: 4, cursor: 'pointer' }}
                                                onClick={() => window.open(msg.media_url, '_blank')}
                                                onError={(e) => {
                                                    e.target.style.display = 'none';
                                                    const fallback = e.target.nextElementSibling;
                                                    if (fallback && fallback.classList.contains('media-fallback')) fallback.style.display = 'flex';
                                                }}
                                            />
                                        )}
                                        {msg.media_url && ['image', 'sticker'].includes(msg.media_type) && (
                                            <div className="media-fallback" style={{
                                                display: 'none', alignItems: 'center', gap: 6,
                                                padding: '8px 12px', background: 'rgba(139,92,246,0.1)',
                                                borderRadius: 8, marginBottom: 4, fontSize: 13, color: '#8b5cf6'
                                            }}>
                                                📷 Görsel (süresi dolmuş)
                                            </div>
                                        )}
                                        {msg.media_url && msg.media_type === 'video' && (
                                            <video src={msg.media_url} controls style={{ maxWidth: '100%', maxHeight: 300, borderRadius: 8, marginBottom: 4 }} />
                                        )}
                                        {msg.media_url && msg.media_type === 'audio' && (
                                            <audio src={msg.media_url} controls style={{ maxWidth: '100%', marginBottom: 4 }} />
                                        )}
                                        {msg.media_url && !['image', 'video', 'audio', 'sticker'].includes(msg.media_type) && (
                                            <a href={msg.media_url} target="_blank" rel="noopener noreferrer" style={{ color: '#8b5cf6', fontSize: 13 }}>📎 Dosyayı aç</a>
                                        )}
                                        {msg.content && !(msg.media_url && ['📷 Görsel', '🎥 Video', '🎵 Ses', '📎 Dosya'].includes(msg.content)) && (
                                            <p style={{ fontSize: 14, lineHeight: 1.5, wordBreak: 'break-word' }}>{msg.content}</p>
                                        )}
                                        <span style={{ fontSize: 10, opacity: 0.5, marginTop: 4, display: 'block', textAlign: msg.direction === 'inbound' ? 'left' : 'right' }}>
                                            {formatTime(msg.created_at)}
                                        </span>
                                    </div>
                                </div>
                            ))}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Input */}
                        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}>
                            {selectedFile && (
                                <div style={{ marginBottom: 8, padding: 8, background: 'var(--bg-primary)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                                    {filePreview ? (
                                        <img src={filePreview} alt="Önizleme" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 6 }} />
                                    ) : (
                                        <div style={{ width: 60, height: 60, background: 'var(--bg-secondary)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>
                                            📎 {selectedFile.name.substring(0, 10)}
                                        </div>
                                    )}
                                    <span style={{ flex: 1, fontSize: 12, opacity: 0.7 }}>{selectedFile.name}</span>
                                    <button onClick={clearFile} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4 }}>
                                        <X size={16} />
                                    </button>
                                </div>
                            )}
                            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    onChange={handleFileSelect}
                                    accept="image/*,video/*,audio/*,.pdf,.doc,.docx"
                                    style={{ display: 'none' }}
                                />
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    style={{ height: 42, width: 42, padding: 0, background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 8, cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                    title="Görsel/dosya ekle"
                                >
                                    <Image size={18} />
                                </button>
                                <textarea
                                    className="input"
                                    placeholder="Mesajınızı yazın..."
                                    value={newMessage}
                                    onChange={e => setNewMessage(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                                    rows={1}
                                    style={{ minHeight: 42, maxHeight: 120, resize: 'none', flex: 1 }}
                                />
                                <button className="btn btn-primary" onClick={sendMessage} disabled={sending || (!newMessage.trim() && !selectedFile)} style={{ height: 42, width: 42, padding: 0 }}>
                                    {sending ? <div className="loading-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> : <Send size={18} />}
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
