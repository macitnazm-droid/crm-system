function setupSocket(io, db) {
    io.on('connection', (socket) => {
        console.log(`📡 Socket bağlandı: ${socket.id}`);

        // Şirket odasına katıl
        socket.on('join:company', (companyId) => {
            if (companyId) {
                const roomName = `company:${companyId}`;
                socket.join(roomName);
                console.log(`🏢 Socket ${socket.id} şirkete katıldı: ${roomName}`);
            }
        });

        socket.on('join:conversation', (conversationId) => {
            socket.join(`conversation:${conversationId}`);
        });

        socket.on('leave:conversation', (conversationId) => {
            socket.leave(`conversation:${conversationId}`);
        });

        // Agent yazıyor bildirimi
        socket.on('typing:start', (data) => {
            socket.to(`conversation:${data.conversation_id}`).emit('typing:start', {
                user_id: data.user_id,
                user_name: data.user_name,
                conversation_id: data.conversation_id
            });
        });

        socket.on('typing:stop', (data) => {
            socket.to(`conversation:${data.conversation_id}`).emit('typing:stop', {
                conversation_id: data.conversation_id
            });
        });

        socket.on('disconnect', () => {
            console.log(`📡 Socket ayrıldı: ${socket.id}`);
        });
    });
}

module.exports = { setupSocket };
