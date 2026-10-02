// ============================================================
// TELEGRAM NOTIFICATION BRIDGE
// Mini App/API -> Telegram Bot Server -> Telegram User
// ============================================================


// ============================================================
// HARD-CODED CONFIGURATION
// ============================================================

// Telegram Bot server notification endpoint
const BOT_NOTIFICATION_URL =
    'https://ahtgbot.vercel.app/internal/notify';

// Must match the secret configured in your Bot server
const BOT_INTERNAL_SECRET =
    'SOCIALX_NOTIFY_2026_X7p9K2m4Q8';


// ============================================================
// SEND USER NOTIFICATION
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

        // --------------------------------------------------------
        // Telegram ID is required
        // --------------------------------------------------------

        if (!telegramId) {
            console.log(
                '[Telegram Notification] Telegram ID missing.'
            );

            return false;
        }


        // --------------------------------------------------------
        // Use hard-coded configuration
        // --------------------------------------------------------

        const notificationUrl =
            BOT_NOTIFICATION_URL;

        const internalSecret =
            BOT_INTERNAL_SECRET;


        if (!notificationUrl || !internalSecret) {
            console.error(
                '[Telegram Notification] Configuration missing.'
            );

            return false;
        }


        // --------------------------------------------------------
        // Send notification to Bot server
        // --------------------------------------------------------

        const response = await fetch(
            notificationUrl,
            {
                method: 'POST',

                headers: {
                    'Content-Type': 'application/json',

                    'X-Internal-Secret':
                        internalSecret
                },

                body: JSON.stringify({

                    telegram_id:
                        String(telegramId),

                    event:
                        String(event || ''),

                    title:
                        String(title || ''),

                    message:
                        String(message || ''),

                    amount:
                        amount === null ||
                        amount === undefined ||
                        amount === ''
                            ? null
                            : Number(amount),

                    extra:
                        extra &&
                        typeof extra === 'object'
                            ? extra
                            : {}

                })
            }
        );


        // --------------------------------------------------------
        // Bot server returned an error
        // --------------------------------------------------------

        if (!response.ok) {

            let errorBody = '';

            try {
                errorBody =
                    await response.text();
            } catch (_) {
                errorBody = '';
            }

            console.error(
                '[Telegram Notification] Bot server returned:',
                response.status,
                errorBody
            );

            return false;
        }


        // --------------------------------------------------------
        // Notification sent successfully
        // --------------------------------------------------------

        return true;


    } catch (error) {

        // --------------------------------------------------------
        // IMPORTANT:
        // Telegram notification failure must NEVER break
        // the original API transaction.
        // --------------------------------------------------------

        console.error(
            '[Telegram Notification] Error:',
            error.message
        );

        return false;
    }
}


// ============================================================
// EXPORT
// ============================================================

module.exports = {
    sendUserNotification
};
