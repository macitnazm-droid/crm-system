import { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
    const [socket, setSocket] = useState(null);
    const { isAuthenticated, user } = useAuth();

    useEffect(() => {
        if (isAuthenticated && user) {
            const socketUrl = import.meta.env.VITE_API_URL || (process.env.NODE_ENV === 'production' ? window.location.origin : 'http://localhost:3001');
            const s = io(socketUrl, {
                transports: ['websocket', 'polling']
            });

            s.on('connect', () => {
                console.log('📡 Socket bağlandı');
                if (user.company_id) {
                    s.emit('join:company', user.company_id);
                }
            });

            setSocket(s);

            return () => {
                s.disconnect();
            };
        }
    }, [isAuthenticated, user]);

    return (
        <SocketContext.Provider value={socket}>
            {children}
        </SocketContext.Provider>
    );
}

export const useSocket = () => useContext(SocketContext);
