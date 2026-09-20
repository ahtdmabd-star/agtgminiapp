const db = require("../include/db");

// --------------------------------------------------
// Helpers
// --------------------------------------------------

function send(res, status, data) {
    res.status(status).json(data);
}

function getTelegramId(req) {
    return (
        req.query?.telegram_id ||
        req.body?.telegram_id ||
        req.headers["x-telegram-id"] ||
        null
    );
}

async function getUser(connection, telegramId) {
    const [rows] = await connection.execute(
        `
        SELECT
            id,
            telegram_id,
            username,
            first_name,
            role,
            balance,
            referred_by,
            referrals,
            status
        FROM users
        WHERE telegram_id = ?
        LIMIT 1
        `,
        [String(telegramId)]
    );

    return rows[0] || null;
}

async function isAdmin(connection, telegramId) {
    const user = await getUser(connection, telegramId);

    return user && user.role === "admin";
}

async function getReferralSettings(connection) {
    const [rows] = await connection.execute(
        `
        SELECT
            id,
            percentage,
            description,
            updated_at
        FROM referral_settings
        WHERE id = 1
        LIMIT 1
        `
    );

    if (!rows.length) {
        return {
            id: 1,
            percentage: 5.00,
            description:
                "Invite friends and earn commission whenever they receive new balance."
        };
    }

    return rows[0];
}

// --------------------------------------------------
// API
// --------------------------------------------------

module.exports = async (req, res) => {
    let connection;

    try {
        connection = await db.getConnection();

        const action =
            req.query?.action ||
            req.body?.action ||
            "user-info";

        // ==================================================
        // USER REFERRAL INFORMATION
        // ==================================================

        if (action === "user-info") {
            const telegramId = getTelegramId(req);

            if (!telegramId) {
                return send(res, 400, {
                    success: false,
                    message: "Telegram ID is required."
                });
            }

            const user = await getUser(connection, telegramId);

            if (!user) {
                return send(res, 404, {
                    success: false,
                    message: "User not found."
                });
            }

            const settings = await getReferralSettings(connection);

            // Count actual referrals
            const [referralRows] = await connection.execute(
                `
                SELECT COUNT(*) AS total
                FROM users
                WHERE referred_by = ?
                `,
                [String(user.telegram_id)]
            );

            const totalReferrals = Number(
                referralRows[0]?.total || 0
            );

            // Find referrer information
            let referrer = null;

            if (user.referred_by) {
                const [referrerRows] = await connection.execute(
                    `
                    SELECT
                        telegram_id,
                        username,
                        first_name
                    FROM users
                    WHERE telegram_id = ?
                    LIMIT 1
                    `,
                    [String(user.referred_by)]
                );

                if (referrerRows.length) {
                    referrer = referrerRows[0];
                }
            }

            return send(res, 200, {
                success: true,

                user: {
                    telegram_id: user.telegram_id,
                    username: user.username,
                    first_name: user.first_name,
                    balance: Number(user.balance || 0),
                    referred_by: user.referred_by || null,
                    referrals: totalReferrals
                },

                referral: {
                    percentage: Number(settings.percentage || 0),
                    description: settings.description || "",
                    total_referrals: totalReferrals,
                    referred_by: user.referred_by || null,
                    referrer: referrer
                }
            });
        }

        // ==================================================
        // ADMIN - GET SETTINGS
        // ==================================================

        if (action === "admin-get") {
            const telegramId = getTelegramId(req);

            if (!telegramId) {
                return send(res, 400, {
                    success: false,
                    message: "Telegram ID is required."
                });
            }

            const admin = await isAdmin(connection, telegramId);

            if (!admin) {
                return send(res, 403, {
                    success: false,
                    message: "Admin access required."
                });
            }

            const settings = await getReferralSettings(connection);

            return send(res, 200, {
                success: true,
                settings: {
                    percentage: Number(settings.percentage || 0),
                    description: settings.description || "",
                    updated_at: settings.updated_at || null
                }
            });
        }

        // ==================================================
        // ADMIN - UPDATE SETTINGS
        // ==================================================

        if (action === "admin-update") {
            const telegramId = getTelegramId(req);

            if (!telegramId) {
                return send(res, 400, {
                    success: false,
                    message: "Telegram ID is required."
                });
            }

            const admin = await isAdmin(connection, telegramId);

            if (!admin) {
                return send(res, 403, {
                    success: false,
                    message: "Admin access required."
                });
            }

            const percentageValue =
                req.body?.percentage ??
                req.query?.percentage;

            const description =
                req.body?.description ??
                req.query?.description;

            const percentage = Number(percentageValue);

            if (
                !Number.isFinite(percentage) ||
                percentage < 0 ||
                percentage > 100
            ) {
                return send(res, 400, {
                    success: false,
                    message: "Percentage must be between 0 and 100."
                });
            }

            if (
                typeof description !== "string" ||
                description.trim().length === 0
            ) {
                return send(res, 400, {
                    success: false,
                    message: "Referral description is required."
                });
            }

            if (description.trim().length > 2000) {
                return send(res, 400, {
                    success: false,
                    message: "Referral description is too long."
                });
            }

            await connection.execute(
                `
                INSERT INTO referral_settings
                    (id, percentage, description)
                VALUES
                    (1, ?, ?)
                ON DUPLICATE KEY UPDATE
                    percentage = VALUES(percentage),
                    description = VALUES(description)
                `,
                [
                    percentage.toFixed(2),
                    description.trim()
                ]
            );

            const settings = await getReferralSettings(connection);

            return send(res, 200, {
                success: true,
                message: "Referral settings updated successfully.",
                settings: {
                    percentage: Number(settings.percentage || 0),
                    description: settings.description || "",
                    updated_at: settings.updated_at || null
                }
            });
        }

        // ==================================================
        // ADMIN - REFERRAL STATISTICS
        // ==================================================

        if (action === "admin-stats") {
            const telegramId = getTelegramId(req);

            if (!telegramId) {
                return send(res, 400, {
                    success: false,
                    message: "Telegram ID is required."
                });
            }

            const admin = await isAdmin(connection, telegramId);

            if (!admin) {
                return send(res, 403, {
                    success: false,
                    message: "Admin access required."
                });
            }

            const settings = await getReferralSettings(connection);

            const [totalReferralsRows] = await connection.execute(
                `
                SELECT COUNT(*) AS total
                FROM users
                WHERE referred_by IS NOT NULL
                  AND referred_by != ''
                `
            );

            const [totalCommissionRows] = await connection.execute(
                `
                SELECT
                    COALESCE(SUM(commission_amount), 0) AS total
                FROM referral_commissions
                `
            );

            const [commissionCountRows] = await connection.execute(
                `
                SELECT COUNT(*) AS total
                FROM referral_commissions
                `
            );

            return send(res, 200, {
                success: true,

                settings: {
                    percentage: Number(settings.percentage || 0),
                    description: settings.description || ""
                },

                statistics: {
                    total_referrals: Number(
                        totalReferralsRows[0]?.total || 0
                    ),

                    total_commissions: Number(
                        totalCommissionRows[0]?.total || 0
                    ),

                    commission_count: Number(
                        commissionCountRows[0]?.total || 0
                    )
                }
            });
        }

        // ==================================================
        // UNKNOWN ACTION
        // ==================================================

        return send(res, 400, {
            success: false,
            message: "Invalid referral API action."
        });

    } catch (error) {
        console.error("Referral API Error:", error);

        return send(res, 500, {
            success: false,
            message: "Internal server error.",
            error:
                process.env.NODE_ENV === "development"
                    ? error.message
                    : undefined
        });

    } finally {
        if (connection) {
            connection.release();
        }
    }
};
