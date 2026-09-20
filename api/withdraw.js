const db = require("./db");

function json(res, status, data) {
    res.status(status);
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify(data));
}

async function getBody(req) {
    if (req.body && typeof req.body === "object") {
        return req.body;
    }

    return new Promise((resolve) => {
        let body = "";

        req.on("data", (chunk) => {
            body += chunk;
        });

        req.on("end", () => {
            try {
                resolve(JSON.parse(body || "{}"));
            } catch {
                resolve({});
            }
        });
    });
}

async function getUser(telegramId) {
    const [rows] = await db.execute(
        `SELECT
            id,
            telegram_id,
            username,
            first_name,
            role,
            balance,
            status
         FROM users
         WHERE telegram_id = ?
         LIMIT 1`,
        [String(telegramId)]
    );

    return rows[0] || null;
}

async function getSettings() {
    const [rows] = await db.execute(
        `SELECT
            id,
            min_withdraw_usd,
            usd_to_bdt_rate,
            withdraw_charge_percent
         FROM withdrawal_settings
         WHERE id = 1
         LIMIT 1`
    );

    if (rows.length) {
        return rows[0];
    }

    await db.execute(
        `INSERT INTO withdrawal_settings
        (
            id,
            min_withdraw_usd,
            usd_to_bdt_rate,
            withdraw_charge_percent
        )
        VALUES (1, 1.00, 100.00, 5.00)`
    );

    return {
        id: 1,
        min_withdraw_usd: 1,
        usd_to_bdt_rate: 100,
        withdraw_charge_percent: 5
    };
}

async function checkAdmin(telegramId) {
    if (!telegramId) {
        return null;
    }

    const user = await getUser(telegramId);

    if (!user) {
        return null;
    }

    if (user.role !== "admin") {
        return null;
    }

    if (user.status !== "active") {
        return null;
    }

    return user;
}

module.exports = async (req, res) => {

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type"
    );
    res.setHeader(
        "Access-Control-Allow-Methods",
        "GET,POST,OPTIONS"
    );

    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    let body = {};

    try {
        body = await getBody(req);

        const query = req.query || {};

        const action =
            body.action ||
            query.action ||
            "";

        /*
        =====================================================
        USER INFO
        =====================================================
        */

        if (action === "info") {

            const telegramId =
                body.telegram_id ||
                query.telegram_id;

            if (!telegramId) {
                return json(res, 400, {
                    success: false,
                    message: "Telegram ID is required."
                });
            }

            const user = await getUser(telegramId);

            if (!user) {
                return json(res, 404, {
                    success: false,
                    message: "User not found."
                });
            }

            const settings = await getSettings();

            return json(res, 200, {
                success: true,

                user: {
                    telegram_id: user.telegram_id,
                    username: user.username,
                    first_name: user.first_name
                },

                balance: Number(user.balance || 0),

                settings: {
                    min_withdraw_usd:
                        Number(settings.min_withdraw_usd),

                    usd_to_bdt_rate:
                        Number(settings.usd_to_bdt_rate),

                    withdraw_charge_percent:
                        Number(
                            settings.withdraw_charge_percent
                        )
                }
            });
        }


        /*
        =====================================================
        USER WITHDRAW HISTORY
        =====================================================
        */

        if (action === "history") {

            const telegramId =
                body.telegram_id ||
                query.telegram_id;

            if (!telegramId) {
                return json(res, 400, {
                    success: false,
                    message: "Telegram ID is required."
                });
            }

            const [rows] = await db.execute(
                `SELECT
                    id,
                    method,
                    account_number,
                    amount_usd,
                    usd_to_bdt_rate,
                    gross_bdt,
                    charge_percent,
                    charge_bdt,
                    net_bdt,
                    status,
                    admin_note,
                    created_at,
                    processed_at
                 FROM withdrawals
                 WHERE telegram_id = ?
                 ORDER BY id DESC`,
                [String(telegramId)]
            );

            return json(res, 200, {
                success: true,
                withdrawals: rows
            });
        }


        /*
        =====================================================
        USER SUBMIT WITHDRAWAL
        =====================================================
        */

        if (action === "submit") {

            const telegramId =
                body.telegram_id;

            const method =
                String(body.method || "").trim();

            const accountNumber =
                String(body.account_number || "").trim();

            const amount =
                Number(body.amount_usd);

            if (
                !telegramId ||
                !method ||
                !accountNumber ||
                !body.amount_usd
            ) {
                return json(res, 400, {
                    success: false,
                    message: "All fields are required."
                });
            }

            if (
                !Number.isFinite(amount) ||
                amount <= 0
            ) {
                return json(res, 400, {
                    success: false,
                    message: "Invalid withdrawal amount."
                });
            }

            const allowedMethods = [
                "bKash",
                "Nagad",
                "Rocket",
                "Upay",
                "USDT-BEP20",
                "USDT-TRC20"
            ];

            if (!allowedMethods.includes(method)) {
                return json(res, 400, {
                    success: false,
                    message: "Invalid withdrawal method."
                });
            }

            const user = await getUser(telegramId);

            if (!user) {
                return json(res, 404, {
                    success: false,
                    message: "User account not found."
                });
            }

            if (user.status !== "active") {
                return json(res, 403, {
                    success: false,
                    message: "Your account is not active."
                });
            }

            const settings = await getSettings();

            const minimum =
                Number(settings.min_withdraw_usd);

            const rate =
                Number(settings.usd_to_bdt_rate);

            const chargePercent =
                Number(settings.withdraw_charge_percent);

            if (amount < minimum) {
                return json(res, 400, {
                    success: false,
                    message:
                        `Minimum withdrawal is $${minimum.toFixed(2)}.`
                });
            }

            const gross =
                amount * rate;

            const charge =
                gross * chargePercent / 100;

            const net =
                gross - charge;


            /*
            ================================================
            TRANSACTION START
            ================================================
            */

            const connection =
                await db.getConnection();

            try {

                await connection.beginTransaction();


                /*
                Lock user balance.
                */

                const [lockedUsers] =
                    await connection.execute(
                        `SELECT balance
                         FROM users
                         WHERE telegram_id = ?
                         FOR UPDATE`,
                        [String(telegramId)]
                    );

                if (!lockedUsers.length) {
                    throw new Error(
                        "User account not found."
                    );
                }

                const balance =
                    Number(
                        lockedUsers[0].balance || 0
                    );

                if (amount > balance) {
                    throw new Error(
                        "Insufficient balance."
                    );
                }


                /*
                Deduct balance immediately.
                The amount will be refunded if admin rejects.
                */

                await connection.execute(
                    `UPDATE users
                     SET balance = balance - ?
                     WHERE telegram_id = ?`,
                    [
                        amount,
                        String(telegramId)
                    ]
                );


                /*
                Create withdrawal request.
                */

                const [result] =
                    await connection.execute(
                        `INSERT INTO withdrawals
                        (
                            telegram_id,
                            method,
                            account_number,
                            amount_usd,
                            usd_to_bdt_rate,
                            gross_bdt,
                            charge_percent,
                            charge_bdt,
                            net_bdt,
                            status
                        )
                        VALUES
                        (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
                        [
                            String(telegramId),
                            method,
                            accountNumber,
                            amount,
                            rate,
                            gross,
                            chargePercent,
                            charge,
                            net
                        ]
                    );


                await connection.commit();

                return json(res, 200, {
                    success: true,
                    message:
                        "Withdrawal request submitted successfully.",

                    withdrawal_id:
                        result.insertId,

                    amount_usd:
                        Number(amount.toFixed(2)),

                    gross_bdt:
                        Number(gross.toFixed(2)),

                    charge_bdt:
                        Number(charge.toFixed(2)),

                    net_bdt:
                        Number(net.toFixed(2))
                });

            } catch (error) {

                await connection.rollback();

                throw error;

            } finally {

                connection.release();
            }
        }


        /*
        =====================================================
        ADMIN LIST
        =====================================================
        */

        if (action === "admin-list") {

            const adminId =
                body.telegram_id ||
                query.telegram_id;

            const admin =
                await checkAdmin(adminId);

            if (!admin) {
                return json(res, 403, {
                    success: false,
                    message: "Unauthorized access."
                });
            }

            const [rows] =
                await db.execute(
                    `SELECT
                        id,
                        telegram_id,
                        method,
                        account_number,
                        amount_usd,
                        usd_to_bdt_rate,
                        gross_bdt,
                        charge_percent,
                        charge_bdt,
                        net_bdt,
                        status,
                        admin_note,
                        created_at,
                        processed_at
                     FROM withdrawals
                     WHERE status = 'pending'
                     ORDER BY id ASC`
                );

            return json(res, 200, {
                success: true,
                withdrawals: rows
            });
        }


        /*
        =====================================================
        ADMIN SETTINGS GET
        =====================================================
        */

        if (action === "admin-settings-get") {

            const adminId =
                body.telegram_id ||
                query.telegram_id;

            const admin =
                await checkAdmin(adminId);

            if (!admin) {
                return json(res, 403, {
                    success: false,
                    message: "Unauthorized access."
                });
            }

            const settings =
                await getSettings();

            return json(res, 200, {
                success: true,
                settings: {
                    min_withdraw_usd:
                        Number(settings.min_withdraw_usd),

                    usd_to_bdt_rate:
                        Number(settings.usd_to_bdt_rate),

                    withdraw_charge_percent:
                        Number(
                            settings.withdraw_charge_percent
                        )
                }
            });
        }


        /*
        =====================================================
        ADMIN SETTINGS UPDATE
        =====================================================
        */

        if (action === "admin-settings-update") {

            const adminId =
                body.telegram_id;

            const admin =
                await checkAdmin(adminId);

            if (!admin) {
                return json(res, 403, {
                    success: false,
                    message: "Unauthorized access."
                });
            }

            const minimum =
                Number(body.min_withdraw_usd);

            const rate =
                Number(body.usd_to_bdt_rate);

            const charge =
                Number(body.withdraw_charge_percent);

            if (
                !Number.isFinite(minimum) ||
                minimum <= 0
            ) {
                return json(res, 400, {
                    success: false,
                    message:
                        "Invalid minimum withdrawal."
                });
            }

            if (
                !Number.isFinite(rate) ||
                rate <= 0
            ) {
                return json(res, 400, {
                    success: false,
                    message:
                        "Invalid USD to BDT rate."
                });
            }

            if (
                !Number.isFinite(charge) ||
                charge < 0 ||
                charge > 100
            ) {
                return json(res, 400, {
                    success: false,
                    message:
                        "Invalid withdrawal charge."
                });
            }

            await db.execute(
                `UPDATE withdrawal_settings
                 SET
                    min_withdraw_usd = ?,
                    usd_to_bdt_rate = ?,
                    withdraw_charge_percent = ?
                 WHERE id = 1`,
                [
                    minimum,
                    rate,
                    charge
                ]
            );

            return json(res, 200, {
                success: true,
                message:
                    "Withdrawal settings updated successfully."
            });
        }


        /*
        =====================================================
        ADMIN APPROVE / REJECT
        =====================================================
        */

        if (action === "admin-process") {

            const adminId =
                body.telegram_id;

            const withdrawalId =
                Number(body.withdrawal_id);

            const processAction =
                String(
                    body.process_action || ""
                ).toLowerCase();

            const adminNote =
                String(
                    body.admin_note || ""
                ).trim();

            const admin =
                await checkAdmin(adminId);

            if (!admin) {
                return json(res, 403, {
                    success: false,
                    message: "Unauthorized access."
                });
            }

            if (
                !withdrawalId ||
                !["approve", "reject"]
                    .includes(processAction)
            ) {
                return json(res, 400, {
                    success: false,
                    message:
                        "Invalid withdrawal request."
                });
            }

            const connection =
                await db.getConnection();

            try {

                await connection.beginTransaction();


                /*
                Lock withdrawal row.
                */

                const [rows] =
                    await connection.execute(
                        `SELECT *
                         FROM withdrawals
                         WHERE id = ?
                         FOR UPDATE`,
                        [withdrawalId]
                    );

                if (!rows.length) {
                    throw new Error(
                        "Withdrawal request not found."
                    );
                }

                const withdrawal =
                    rows[0];


                /*
                Prevent duplicate processing.
                */

                if (
                    withdrawal.status !==
                    "pending"
                ) {
                    throw new Error(
                        "This withdrawal has already been processed."
                    );
                }


                /*
                APPROVE
                */

                if (
                    processAction ===
                    "approve"
                ) {

                    await connection.execute(
                        `UPDATE withdrawals
                         SET
                            status = 'approved',
                            admin_note = ?,
                            processed_at = NOW()
                         WHERE id = ?
                         AND status = 'pending'`,
                        [
                            adminNote || null,
                            withdrawalId
                        ]
                    );

                    await connection.commit();

                    return json(res, 200, {
                        success: true,
                        message:
                            "Withdrawal approved successfully."
                    });
                }


                /*
                REJECT
                */

                if (
                    processAction ===
                    "reject"
                ) {

                    /*
                    Refund the exact USD amount
                    previously deducted.
                    */

                    await connection.execute(
                        `UPDATE users
                         SET balance = balance + ?
                         WHERE telegram_id = ?`,
                        [
                            Number(
                                withdrawal.amount_usd
                            ),
                            String(
                                withdrawal.telegram_id
                            )
                        ]
                    );


                    await connection.execute(
                        `UPDATE withdrawals
                         SET
                            status = 'rejected',
                            admin_note = ?,
                            processed_at = NOW()
                         WHERE id = ?
                         AND status = 'pending'`,
                        [
                            adminNote || null,
                            withdrawalId
                        ]
                    );


                    await connection.commit();

                    return json(res, 200, {
                        success: true,
                        message:
                            "Withdrawal rejected and balance refunded."
                    });
                }

            } catch (error) {

                await connection.rollback();

                throw error;

            } finally {

                connection.release();
            }
        }


        /*
        =====================================================
        UNKNOWN ACTION
        =====================================================
        */

        return json(res, 400, {
            success: false,
            message: "Invalid action."
        });

    } catch (error) {

        console.error(
            "Withdrawal API Error:",
            error
        );

        return json(res, 500, {
            success: false,
            message:
                error.message ||
                "Internal server error."
        });
    }
};
