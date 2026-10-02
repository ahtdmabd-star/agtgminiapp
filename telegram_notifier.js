// ============================================================
// TELEGRAM NOTIFICATION BRIDGE
// Mini App API -> Telegram Bot Server
// ============================================================

async function sendUserNotification({
    telegramId,
    event,
    title,
    message,
    amount = null,
    extra = {}
}) {
    try {
        if (!telegramId) {
            console.log(
                '[Telegram Notification] Telegram ID missing'
            );
            return false;
        }

        const notificationUrl =
            process.env.BOT_NOTIFICATION_URL;

        const internalSecret =
            process.env.BOT_INTERNAL_SECRET;

        if (!notificationUrl || !internalSecret) {
            console.error(
                '[Telegram Notification] Environment variables missing.'
            );
            return false;
        }

        const response = await fetch(
            notificationUrl,
            {
                method: 'POST',

                headers: {
                    'Content-Type': 'application/json',
                    'X-Internal-Secret': internalSecret
                },

                body: JSON.stringify({
                    telegram_id: String(telegramId),
                    event: String(event || ''),
                    title: String(title || ''),
                    message: String(message || ''),
                    amount:
                        amount === null
                            ? null
                            : Number(amount),
                    extra: extra || {}
                })
            }
        );

        if (!response.ok) {
            console.error(
                '[Telegram Notification] Bot server returned:',
                response.status
            );

            return false;
        }

        return true;

    } catch (error) {

        // Notification failure should NEVER
        // break the original API transaction.
        console.error(
            '[Telegram Notification] Error:',
            error.message
        );

        return false;
    }
}

module.exports = {
    sendUserNotification
};
