import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Mail, Lock, ArrowRight } from 'lucide-react';
import logo from '../assets/logo.png';

export default function LoginPage() {
    const { login } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            await login(email, password);
        } catch (err) {
            setError(err.response?.data?.error || 'Giriş yapılamadı');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-page">
            <div className="login-bg">
                <div className="login-orb login-orb-1" />
                <div className="login-orb login-orb-2" />
                <div className="login-orb login-orb-3" />
            </div>

            <div className="login-container">
                <div className="login-card glass-card">
                    <div className="login-header">
                        <div className="login-logo">
                            <img src={logo} alt="Regista" style={{ width: 56, height: 56, borderRadius: '50%' }} />
                        </div>
                        <h1>Regista <span className="text-accent">AICRM</span></h1>
                        <p>Müşteri Hizmetleri Platformu</p>
                    </div>

                    <form onSubmit={handleSubmit} className="login-form">
                        {error && <div className="login-error">{error}</div>}

                        <div className="form-group">
                            <label>Email</label>
                            <div className="input-wrapper">
                                <Mail size={16} className="input-icon" />
                                <input
                                    type="email"
                                    className="input"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="email@ornek.com"
                                    required
                                    style={{ paddingLeft: '40px' }}
                                />
                            </div>
                        </div>

                        <div className="form-group">
                            <label>Şifre</label>
                            <div className="input-wrapper">
                                <Lock size={16} className="input-icon" />
                                <input
                                    type="password"
                                    className="input"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                    required
                                    style={{ paddingLeft: '40px' }}
                                />
                            </div>
                        </div>

                        <button type="submit" className="btn btn-primary btn-lg login-btn" disabled={loading}>
                            {loading ? <div className="loading-spinner" style={{ width: 20, height: 20, borderWidth: 2 }} /> : (
                                <>Giriş Yap <ArrowRight size={18} /></>
                            )}
                        </button>
                    </form>

                </div>
            </div>

            <style>{`
        .login-page {
          height: 100vh;
          width: 100vw;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--bg-primary);
          position: relative;
          overflow: hidden;
        }

        .login-bg {
          position: absolute;
          inset: 0;
          overflow: hidden;
        }

        .login-orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(120px);
          opacity: 0.15;
        }

        .login-orb-1 {
          width: 500px;
          height: 500px;
          background: #6366f1;
          top: -200px;
          right: -100px;
          animation: float 8s ease-in-out infinite;
        }

        .login-orb-2 {
          width: 400px;
          height: 400px;
          background: #a855f7;
          bottom: -150px;
          left: -100px;
          animation: float 10s ease-in-out infinite reverse;
        }

        .login-orb-3 {
          width: 300px;
          height: 300px;
          background: #06b6d4;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          animation: float 6s ease-in-out infinite;
        }

        .login-container {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 420px;
          padding: 20px;
        }

        .login-card {
          padding: 40px 36px;
        }

        .login-header {
          text-align: center;
          margin-bottom: 32px;
        }

        .login-logo {
          width: 56px;
          height: 56px;
          background: var(--accent-gradient);
          border-radius: var(--radius-lg);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          margin: 0 auto 16px;
          box-shadow: 0 4px 24px var(--accent-primary-glow);
        }

        .login-header h1 {
          font-size: 28px;
          font-weight: 800;
          letter-spacing: -1px;
        }

        .text-accent {
          background: var(--accent-gradient);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .login-header p {
          color: var(--text-secondary);
          font-size: 14px;
          margin-top: 4px;
        }

        .login-form {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .form-group label {
          display: block;
          font-size: 13px;
          font-weight: 500;
          color: var(--text-secondary);
          margin-bottom: 6px;
        }

        .input-wrapper {
          position: relative;
        }

        .input-icon {
          position: absolute;
          left: 14px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--text-muted);
        }

        .login-btn {
          width: 100%;
          margin-top: 8px;
        }

        .login-error {
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.3);
          color: #f87171;
          padding: 10px 14px;
          border-radius: var(--radius-md);
          font-size: 13px;
        }

        .login-demo {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          margin-top: 24px;
          padding-top: 20px;
          border-top: 1px solid var(--border-color);
          font-size: 12px;
          color: var(--text-tertiary);
        }
      `}</style>
        </div>
    );
}
