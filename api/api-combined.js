const db = require("../db");

const BOT_TOKEN =
    process.env.BOT_TOKEN ||
    "8332234102:AAEn-gW1WCbt4_a7od8sCvysndE2u3nZtNc";

const CHANNEL = "@AHTG_OFFICIAL";
const GROUP = "@ahtgofic";

const BOT_USERNAME = "ahtg_bd_bot";


/* =========================
   JSON RESPONSE
========================= */

function json(res, status, data) {
    res.status(status);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, OPTIONS"
    );
    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type"
    );

    return res.json(data);
}


/* =========================
   TELEGRAM MEMBERSHIP CHECK
========================= */

async function checkMembership(chatId, telegramId) {

    try {

        const url =
            `https://api.telegram.org/bot${BOT_TOKEN}` +
            `/getChatMember?chat_id=${encodeURIComponent(chatId)}` +
            `&user_id=${encodeURIComponent(telegramId)}`;

        const response = await fetch(url);

        if (!response.ok) {
            return false;
        }

        const data = await response.json();

        if (!data.ok || !data.result) {
            return false;
        }

        const status = data.result.status;

        return [
            "creator",
            "administrator",
            "member"
        ].includes(status);

    } catch (error) {

        console.error(
            "Telegram membership error:",
            error
        );

        return false;
    }
}


/* =========================
   MAIN API
========================= */

module.exports = async (req, res) => {

    res.setHeader(
        "Access-Control-Allow-Origin",
        "*"
    );

    res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, OPTIONS"
    );

    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type"
    );


    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }


    if (req.method !== "GET") {

        return json(res, 405, {
            success: false,
            message: "Method Not Allowed"
        });

    }


    /*
     * Current system uses:
     *
     * /api/api-combined?route=check-verification&telegram_id=123
     */

    const route =
        String(req.query?.route || "")
            .trim();


    /* =====================================================
       CHECK LOGIN + TELEGRAM VERIFICATION
    ===================================================== */

    if (route === "check-verification") {

        const telegramId =
            String(req.query?.telegram_id || "").trim();


        if (!telegramId) {

            return json(res, 400, {
                success: false,
                message: "Telegram ID is required."
            });

        }


        let connection;


        try {

            connection = await db.getConnection();


            /* =========================
               FIND USER
            ========================= */

            const [rows] =
                await connection.execute(
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
                        status,
                        created_at,
                        updated_at,
                        telegram_status
                    FROM users
                    WHERE telegram_id = ?
                    LIMIT 1
                    `,
                    [telegramId]
                );


            /*
             * Account does not exist
             */

            if (rows.length === 0) {

                return json(res, 404, {
                    success: false,
                    message:
                        "User account not found in database."
                });

            }


            const user = rows[0];


            /* =========================
               BANNED USER
            ========================= */

            if (
                String(user.status).toLowerCase()
                === "banned"
            ) {

                await connection.execute(
                    `
                    UPDATE users
                    SET telegram_status = ?
                    WHERE telegram_id = ?
                    `,
                    [
                        "unverified",
                        telegramId
                    ]
                );


                return json(res, 200, {
                    success: true,
                    verified: false,
                    banned: true,
                    role: user.role,
                    message:
                        "Your account has been banned."
                });

            }


            /* =========================
               TELEGRAM MEMBERSHIP
            ========================= */

            const [
                channelMember,
                groupMember
            ] = await Promise.all([

                checkMembership(
                    CHANNEL,
                    telegramId
                ),

                checkMembership(
                    GROUP,
                    telegramId
                )

            ]);


            /*
             * Admin does not need normal
             * channel/group verification.
             */

            const isAdmin =
                String(user.role).toLowerCase()
                === "admin";


            const verified =
                isAdmin ||
                (
                    channelMember &&
                    groupMember
                );


            const telegramStatus =
                verified
                    ? "verified"
                    : "unverified";


            /* =========================
               UPDATE TELEGRAM STATUS
            ========================= */

            await connection.execute(
                `
                UPDATE users
                SET telegram_status = ?
                WHERE telegram_id = ?
                `,
                [
                    telegramStatus,
                    telegramId
                ]
            );


            /* =========================
               REFERRAL LINK
            ========================= */

            const referralLink =
                `https://t.me/${BOT_USERNAME}` +
                `?start=ref_${telegramId}`;


            /* =========================
               USER DATA
            ========================= */

            const userData = {

                id: user.id,

                telegram_id:
                    String(user.telegram_id),

                username:
                    user.username || "",

                first_name:
                    user.first_name || "",

                role:
                    user.role || "user",

                balance:
                    Number(user.balance || 0),

                referred_by:
                    user.referred_by || null,

                referrals:
                    Number(user.referrals || 0),

                status:
                    user.status || "active",

                telegram_status:
                    telegramStatus,

                created_at:
                    user.created_at,

                updated_at:
                    user.updated_at,

                referral_link:
                    referralLink

            };


            /* =========================
               FINAL RESPONSE
            ========================= */

            return json(res, 200, {

                success: true,

                verified: verified,

                role:
                    user.role || "user",

                channel_member:
                    channelMember,

                group_member:
                    groupMember,

                userData:
                    userData

            });


        } catch (error) {

            console.error(
                "Verification API error:",
                error
            );


            return json(res, 500, {

                success: false,

                message:
                    "Server error while checking verification.",

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

    }


    /* =====================================================
       UNKNOWN ROUTE
    ===================================================== */

    return json(res, 404, {

        success: false,

        message:
            "API route not found."

    });

};
