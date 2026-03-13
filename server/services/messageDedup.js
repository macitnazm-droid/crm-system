// Webhook ve Poller arasında paylaşılan mesaj deduplication
const processedMessageIds = new Set();

function isDuplicate(msgId) {
    if (!msgId) return false;
    if (processedMessageIds.has(msgId)) return true;
    processedMessageIds.add(msgId);
    // Set çok büyümesin
    if (processedMessageIds.size > 2000) {
        const arr = [...processedMessageIds];
        arr.slice(0, 500).forEach(id => processedMessageIds.delete(id));
    }
    return false;
}

module.exports = { isDuplicate, processedMessageIds };
