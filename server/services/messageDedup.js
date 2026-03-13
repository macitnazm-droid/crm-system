// Webhook ve Poller arasında paylaşılan mesaj deduplication
const processedMessageIds = new Set();

// AI'ın gönderdiği mesajların content hash'leri (geri dönen mesajları filtrelemek için)
const sentMessageHashes = new Set();

function isDuplicate(msgId) {
    if (!msgId) return false;
    if (processedMessageIds.has(msgId)) return true;
    processedMessageIds.add(msgId);
    if (processedMessageIds.size > 2000) {
        const arr = [...processedMessageIds];
        arr.slice(0, 500).forEach(id => processedMessageIds.delete(id));
    }
    return false;
}

function markAsSent(content) {
    if (!content) return;
    const hash = content.trim().substring(0, 100);
    sentMessageHashes.add(hash);
    // 5 dakika sonra temizle
    setTimeout(() => sentMessageHashes.delete(hash), 5 * 60 * 1000);
}

function wasSentByUs(content) {
    if (!content) return false;
    const hash = content.trim().substring(0, 100);
    return sentMessageHashes.has(hash);
}

module.exports = { isDuplicate, processedMessageIds, markAsSent, wasSentByUs };
