import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL ||
    (process.env.NODE_ENV === 'production'
        ? `${window.location.origin}/api`
        : 'http://localhost:3001/api');

const api = axios.create({
    baseURL: API_BASE,
    headers: { 'Content-Type': 'application/json' }
});

// Token interceptor
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('crm_token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// Auth check interceptor
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            localStorage.removeItem('crm_token');
            localStorage.removeItem('crm_user');
            window.location.href = '/login';
        }
        return Promise.reject(error);
    }
);

// Auth
export const authAPI = {
    login: (email, password) => api.post('/auth/login', { email, password }),
    register: (data) => api.post('/auth/register', data),
    me: () => api.get('/auth/me'),
};

// Conversations
export const conversationsAPI = {
    list: (params) => api.get('/conversations', { params }),
    get: (id) => api.get(`/conversations/${id}`),
    toggleAI: (id, enabled) => api.patch(`/conversations/${id}/ai`, { ai_enabled: enabled }),
    assign: (id, agentId) => api.patch(`/conversations/${id}/assign`, { agent_id: agentId }),
    updateStatus: (id, status) => api.patch(`/conversations/${id}/status`, { status }),
    markRead: (id) => api.patch(`/conversations/${id}/read`),
};

// Messages
export const messagesAPI = {
    list: (conversationId, limit) => api.get('/messages', { params: { conversation_id: conversationId, limit } }),
    send: (conversationId, content, mediaUrl, mediaType) => api.post('/messages/send', { conversation_id: conversationId, content, media_url: mediaUrl, media_type: mediaType }),
    upload: (file) => {
        const fd = new FormData();
        fd.append('file', file);
        return api.post('/messages/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    },
};

// Customers
export const customersAPI = {
    list: (params) => api.get('/customers', { params }),
    get: (id) => api.get(`/customers/${id}`),
    updateCategory: (id, category, leadScore) => api.patch(`/customers/${id}/category`, { category, lead_score: leadScore }),
    downloadSample: () => api.get('/customers/import/sample', { responseType: 'blob' }),
    import: (file) => {
        const fd = new FormData();
        fd.append('file', file);
        return api.post('/customers/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    },
};

// AI
export const aiAPI = {
    generateResponse: (conversationId) => api.post('/ai/generate-response', { conversation_id: conversationId }),
    getPrompts: () => api.get('/ai/prompts'),
    createPrompt: (data) => api.post('/ai/prompts', data),
    updatePrompt: (id, data) => api.patch(`/ai/prompts/${id}`, data),
    deletePrompt: (id) => api.delete(`/ai/prompts/${id}`),
    categorize: (customerId) => api.post('/ai/categorize', { customer_id: customerId }),
    getPlatformSettings: () => api.get('/ai/platform-settings'),
    updatePlatformSettings: (data) => api.patch('/ai/platform-settings', data),
};

// Reports
export const reportsAPI = {
    today: () => api.get('/reports/today'),
    categories: () => api.get('/reports/categories'),
    agents: () => api.get('/reports/agents'),
    messagesChart: () => api.get('/reports/messages-chart'),
    sources: () => api.get('/reports/sources'),
};

// Webhooks (simulate)
export const webhooksAPI = {
    simulate: (data) => api.post('/webhooks/simulate', data),
};

// Integrations
export const integrationsAPI = {
    list: () => api.get('/integrations'),
    save: (data) => api.post('/integrations', data),
    test: (platform, provider) => api.post('/integrations/test', { platform, provider }),
    unipileAccounts: () => api.get('/integrations/unipile-accounts'),
    unipileConnect: (providerType) => api.post('/integrations/unipile-connect', { provider_type: providerType }),
    unipileReconnect: (accountId) => api.post('/integrations/unipile-reconnect', { account_id: accountId }),
    // WhatsApp Web.js
    waWebConnect: () => api.post('/integrations/whatsapp-web/connect'),
    waWebQR: () => api.get('/integrations/whatsapp-web/qr'),
    waWebStatus: () => api.get('/integrations/whatsapp-web/status'),
    waWebDisconnect: () => api.post('/integrations/whatsapp-web/disconnect'),
};

// Appointments
export const appointmentsAPI = {
    list: (params) => api.get('/appointments', { params }),
    create: (data) => api.post('/appointments', data),
    update: (id, data) => api.patch(`/appointments/${id}`, data),
    updateStatus: (id, status) => api.patch(`/appointments/${id}/status`, { status }),
    delete: (id) => api.delete(`/appointments/${id}`),
    availableSlots: (params) => api.get('/appointments/available-slots', { params }),
    scan: () => api.post('/appointments/scan'),
    // Hizmetler
    getServices: () => api.get('/appointments/services'),
    createService: (data) => api.post('/appointments/services', data),
    updateService: (id, data) => api.patch(`/appointments/services/${id}`, data),
    deleteService: (id) => api.delete(`/appointments/services/${id}`),
    // Personel
    getStaff: () => api.get('/appointments/staff'),
    createStaff: (data) => api.post('/appointments/staff', data),
    updateStaff: (id, data) => api.patch(`/appointments/staff/${id}`, data),
    deleteStaff: (id) => api.delete(`/appointments/staff/${id}`),
    // Odalar
    getRooms: () => api.get('/appointments/rooms'),
    createRoom: (data) => api.post('/appointments/rooms', data),
    deleteRoom: (id) => api.delete(`/appointments/rooms/${id}`),
    // Çalışma Saatleri
    getWorkingHours: (params) => api.get('/appointments/working-hours', { params }),
    saveWorkingHours: (data) => api.post('/appointments/working-hours', data),
    // Bildirim Ayarları
    getNotificationSettings: () => api.get('/appointments/notification-settings'),
    updateNotificationSettings: (data) => api.patch('/appointments/notification-settings', data),
};

// Super Admin
export const superAdminAPI = {
    listCompanies: () => api.get('/superadmin/companies'),
    createCompany: (data) => api.post('/superadmin/companies', data),
    updateCompany: (id, data) => api.patch(`/superadmin/companies/${id}`, data),
    updateCompanyStatus: (id, isActive) => api.patch(`/superadmin/companies/${id}/status`, { is_active: isActive }),
    getStats: () => api.get('/superadmin/stats'),
    getCompanyUsers: (id) => api.get(`/superadmin/companies/${id}/users`),
    addCompanyUser: (id, data) => api.post(`/superadmin/companies/${id}/users`, data),
    removeCompanyUser: (id, userId) => api.delete(`/superadmin/companies/${id}/users/${userId}`),
    resetUserPassword: (companyId, userId, newPassword) => api.post(`/superadmin/companies/${companyId}/users/${userId}/reset-password`, { new_password: newPassword }),
    updateFeature: (companyId, feature, enabled) => api.patch(`/superadmin/companies/${companyId}/features`, { feature, enabled }),
};

export default api;
