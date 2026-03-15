import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
    LayoutDashboard, MessageSquare, Users, BarChart3, Settings,
    Radio, LogOut, Zap, CalendarDays
} from 'lucide-react';
import logo from '../assets/logo.png';
import './Sidebar.css';

export default function Sidebar() {
    const { user, logout } = useAuth();

    const links = [
        { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
        { to: '/conversations', icon: MessageSquare, label: 'Konuşmalar' },
        { to: '/customers', icon: Users, label: 'Müşteriler' },
        ...(user?.appointment_enabled || user?.role === 'super_admin'
            ? [{ to: '/appointments', icon: CalendarDays, label: 'Randevular' }]
            : []),
        { to: '/reports', icon: BarChart3, label: 'Raporlar' },
        { to: '/settings', icon: Settings, label: 'Ayarlar' },
        { to: '/simulator', icon: Radio, label: 'Simülatör' },
    ];

    if (user?.role === 'super_admin') {
        links.push({ to: '/super-admin', icon: Zap, label: 'Süper Admin' });
    }

    return (
        <aside className="sidebar">
            <div className="sidebar-header">
                <div className="sidebar-logo">
                    <div className="logo-icon">
                        <img src={logo} alt="Regista" style={{ width: 32, height: 32, borderRadius: '50%' }} />
                    </div>
                    <div className="logo-text">
                        <span className="logo-title">Regista <span className="logo-ai">AICRM</span></span>
                        <span className="logo-subtitle">Müşteri Platformu</span>
                    </div>
                </div>
            </div>

            <nav className="sidebar-nav">
                {links.map(({ to, icon: Icon, label, end }) => (
                    <NavLink
                        key={to}
                        to={to}
                        end={end}
                        className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                    >
                        <Icon size={19} />
                        <span>{label}</span>
                    </NavLink>
                ))}
            </nav>

            <div className="sidebar-footer">
                <div className="sidebar-user">
                    <div className="user-avatar" style={{ background: user?.avatar_color || '#6366f1' }}>
                        {user?.name?.charAt(0)?.toUpperCase() || 'U'}
                    </div>
                    <div className="user-info">
                        <span className="user-name">{user?.name}</span>
                        <span className="user-role">
                            {user?.role === 'super_admin' ? 'Süper Admin' :
                                user?.role === 'admin' ? 'Yönetici' :
                                    user?.role === 'manager' ? 'Müdür' : 'Temsilci'}
                        </span>
                    </div>
                    <button className="btn-ghost btn-icon" onClick={logout} title="Çıkış Yap">
                        <LogOut size={17} />
                    </button>
                </div>
            </div>
        </aside>
    );
}
