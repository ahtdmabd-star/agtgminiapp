async function addBalanceWithTransaction(connection, telegramId, amount, type, description) {
    // ১. একটি ইউনিক ট্রানজেকশন আইডি তৈরি (যেমন: TXN-1718829381928-ABC)
    const transactionId = `TXN-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

    // ২. ইউজারের মূল ব্যালেন্স বাড়িয়ে দেওয়া
    await connection.execute(
        'UPDATE users SET balance = balance + ? WHERE telegram_id = ?',
        [amount, telegramId]
    );

    // ৩. ট্রানজেকশন টেবিলে অটোমেটিক হিস্টরি বা রেকর্ড সেভ করা
    await connection.execute(
        'INSERT INTO transactions (transaction_id, telegram_id, amount, type, description, status) VALUES (?, ?, ?, ?, ?, ?)',
        [transactionId, telegramId, amount, type, description, 'success']
    );

    return transactionId;
}

module.exports = addBalanceWithTransaction;
