const express = require('express');
const router = express.Router();
const crypto = require('crypto');

// নোট: আপনার নতুন AdTask Schema/Model ইম্পোর্ট করুন
// const AdTaskUser = require('../models/AdTaskUser'); 
// const AdSettings = require('../models/AdSettings');

const ADSGRAM_SECRET = process.env.ADSGRAM_SECRET || "YOUR_ADSGRAM_SECRET_KEY";

/**
 * ১. Adsgram Webhook (অ্যাড কমপ্লিট হলে অটো কল হবে)
 * Adsgram URL: https://agtgminiapp.onrender.com/api/ads/reward-callback?userid=[userid]
 */
router.get('/reward-callback', async (req, res) => {
    try {
        const { userid, hash, ...params } = req.query;

        if (!userid) return res.status(400).send("User ID missing");

        // --- Signature Security Verification ---
        if (hash) {
            const checkString = Object.keys(params)
                .sort()
                .map(key => `${key}=${params[key]}`)
                .join('\n');
            
            const secretKey = crypto.createHash('sha256').update(ADSGRAM_SECRET).digest();
            const hmac = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex');

            if (hmac !== hash) {
                return res.status(403).send("Unauthorized Request");
            }
        }

        // --- কয়েন ও ২৪ ঘন্টার হিসাব আপডেট (নতুন টেবিলে) ---
        const rewardCoins = 100; // ডিফল্ট রিওয়ার্ড বা ডায়নামিক সেটিংস থেকে
        const now = new Date();

        /*
        let adUserData = await AdTaskUser.findOne({ userId: userid });
        if (!adUserData) {
            adUserData = new AdTaskUser({ userId: userid });
        }

        // ২৪ ঘন্টার হিসাব চেক ও রিসেট লজিক
        const lastTime = new Date(adUserData.last_ad_time || 0);
        const hoursPassed = (now - lastTime) / (1000 * 60 * 60);

        if (hoursPassed >= 24) {
            adUserData.daily_completed_tasks = 1; // ২৪ ঘন্টা পার হলে নতুন করে ১ থেকে শুরু
        } else {
            adUserData.daily_completed_tasks += 1;
        }

        adUserData.coins += rewardCoins;
        adUserData.completed_tasks += 1;
        adUserData.last_ad_time = now;

        await adUserData.save();
        */

        console.log(`User ${userid} completed ad successfully!`);
        return res.status(200).send("OK");

    } catch (error) {
        console.error("Callback Error:", error);
        return res.status(500).send("Server Error");
    }
});

/**
 * ২. অ্যাড অসম্পূর্ণ রাখলে (Incomplete Task Track API)
 */
router.post('/track-incomplete', async (req, res) => {
    try {
        const { userId } = req.body;
        /*
        let adUserData = await AdTaskUser.findOne({ userId });
        if (!adUserData) adUserData = new AdTaskUser({ userId });

        adUserData.incomplete_tasks += 1;
        await adUserData.save();
        */
        return res.json({ success: true, message: "Incomplete task tracked" });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * ৩. ইউজার প্যানেলের স্ট্যাটাস ডেটা পাওয়ার API
 */
router.get('/user-stats/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        /*
        const adUserData = await AdTaskUser.findOne({ userId }) || {
            coins: 0,
            completed_tasks: 0,
            incomplete_tasks: 0,
            daily_completed_tasks: 0
        };
        */
        
        // কাল্পনিক টেস্ট ডেটা:
        const adUserData = {
            coins: 450,
            completed_tasks: 9,
            incomplete_tasks: 2,
            daily_completed_tasks: 5
        };

        return res.json({ success: true, data: adUserData });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
      
