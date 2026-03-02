import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';

export default function Layout() {
    return (
        <div style={{ display: 'flex', height: '100vh', width: '100vw' }}>
            <Sidebar />
            <main style={{
                flex: 1,
                marginLeft: 'var(--sidebar-width)',
                height: '100vh',
                overflow: 'auto',
                padding: '24px 28px'
            }}>
                <Outlet />
            </main>
        </div>
    );
}
