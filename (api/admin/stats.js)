const pool = require('../api/db'); // আপনার ডাটাবেজ কানেকশন পাথ অনুযায়ী

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    const telegramId = req.query.telegram_id;

    if (!telegramId) {
        return res.status(400).json({ success: false, message: 'Unauthorized' });
    }

    try {
        // সিকিউরিটি চেক: রিকোয়েস্টকারী আসলেই এডমিন কি না
        const [adminRows] = await pool.execute('SELECT role FROM users WHERE telegram_id = ?', [telegramId]);
        if (adminRows.length === 0 || adminRows[0].role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }

        // মোট ইউজার সংখ্যা গণনা
        const [countRows] = await pool.execute('SELECT COUNT(*) as totalUsers FROM users');
        const totalUsers = countRows[0].totalUsers;

        // সমস্ত ইউজারের ব্যালেন্স যোগ করে মোট ব্যালেন্স হিসাব করা
        const [sumRows] = await pool.execute('SELECT SUM(balance) as totalBalance FROM users');
        const totalBalance = sumRows[0].totalBalance || 0;

        return res.status(200).json({
            success: true,
            totalUsers: totalUsers,
            totalBalance: totalBalance
        });

    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
