require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const { Profile, LandData } = require('./models/DataSchema');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Frontend files

// --- MongoDB Connection ---
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
    console.error("Error: MONGO_URI not found in environment variables.");
    process.exit(1);
}

mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB Connected Successfully!'))
    .catch(err => console.error('MongoDB Connection Error:', err));

// --- Helper: Year Extraction ---
function getYearSafe(dateVal) {
    if (!dateVal) return "";
    try {
        const d = new Date(dateVal);
        if (isNaN(d.getTime())) return "";
        // Asia/Dhaka timezone offset adjustment approx +6 hours
        const offset = 6 * 60 * 60 * 1000; 
        const localDate = new Date(d.getTime() + offset);
        return localDate.getFullYear().toString();
    } catch (e) { return ""; }
}

// --- Routes ---

// 1. Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    // Render Environment Variables থেকে ইউজারনেম পাসওয়ার্ড চেক করা হচ্ছে
    // ডিফল্ট ভ্যালু দেওয়া আছে যদি Env সেট না করা থাকে
    const validUser = process.env.ADMIN_USER || 'mehedi4894';
    const validPass = process.env.ADMIN_PASS || 'Mehedi@01747527352';

    if (username === validUser && password === validPass) {
        res.json({ success: true, user: { username: username, name: username } });
    } else {
        res.json({ success: false, message: 'Invalid Credentials!' });
    }
});

// 2. Save Entry Data
app.post('/api/saveFormData', async (req, res) => {
    try {
        const formData = req.body;
        const totalTk = (parseFloat(formData.rate) / 33) * parseFloat(formData.land);
        
        const newEntry = new LandData({
            name: formData.name,
            land: formData.land,
            rate: formData.rate,
            totalTk: totalTk.toFixed(2),
            tkGiven: formData.tkGiven || 0,
            hariYear: formData.hariYear || "",
            entryBy: formData.loggedInUser
        });

        await newEntry.save();
        res.json({ success: true });
    } catch (e) {
        console.error("Save Error:", e);
        res.json({ success: false, message: e.toString() });
    }
});

// 3. Get Initial Data (Profiles & Search Options)
app.get('/api/getInitData', async (req, res) => {
    try {
        // ১. প্রোফাইল ডাটা নিয়ে আসা
        const profiles = await Profile.find({}).lean();

        // ২. ডাটাবেস থেকে ইউনিক নাম, জমি ও বছর বের করা (Aggregation)
        const landStats = await LandData.aggregate([
            {
                $group: {
                    _id: "$name",
                    lands: { $addToSet: "$land" },
                    years: { $addToSet: { $dateToString: { format: "%Y", date: "$date" } } },
                    docs: { $push: "$$ROOT" } 
                }
            }
        ]);

        const allYears = new Set();
        const namesFromData = new Set();
        const landMap = {};
        const yearMap = {};

        // প্রতিটি গ্রুপ থেকে ডাটা সাজানো
        landStats.forEach(group => {
            const name = group._id;
            if (name) {
                namesFromData.add(name);
                
                if (!landMap[name]) landMap[name] = new Set();
                group.lands.forEach(l => landMap[name].add(l));
                
                // বছর বের করা (HariYear ফিল্ড থেকেও নেওয়া যেতে পারে, এখানে Date থেকে নেওয়া হলো)
                if (!yearMap[name]) yearMap[name] = new Set();
                group.years.forEach(y => {
                     if(y) {
                         allYears.add(y);
                         yearMap[name].add(y);
                     }
                });
            }
        });

        // Set কে Array তে রূপান্তর এবং সর্ট করা
        const finalLandMap = {};
        for (let key in landMap) finalLandMap[key] = Array.from(landMap[key]).sort((a, b) => a - b);

        const finalYearMap = {};
        for (let key in yearMap) finalYearMap[key] = Array.from(yearMap[key]).sort((a,b) => b-a);

        res.json({
            profiles: profiles,
            searchOptions: {
                names: Array.from(namesFromData).sort(),
                years: Array.from(allYears).sort((a,b) => b-a),
                yearMap: finalYearMap,
                landMap: finalLandMap
            }
        });

    } catch (error) {
        console.error("Init Data Error:", error);
        res.json({ profiles: [], searchOptions: { names: [], years: [], yearMap: {}, landMap: {} } });
    }
});

// 4. Get Report Data
app.post('/api/getReportData', async (req, res) => {
    const searchData = req.body;
    
    // Query Builder
    let query = {};
    
    if (searchData.name && searchData.name !== "ALL") query.name = searchData.name;
    if (searchData.land && searchData.land !== "ALL") query.land = parseFloat(searchData.land);
    
    // Year Filtering
    if (searchData.year && searchData.year !== "ALL") {
        const year = parseInt(searchData.year);
        const start = new Date(`${year}-01-01T00:00:00.000Z`);
        const end = new Date(`${year + 1}-01-01T00:00:00.000Z`);
        query.date = { $gte: start, $lt: end };
    }

    try {
        const records = await LandData.find(query).sort({ date: -1 }).lean();
        
        const formattedRecords = records.map(row => ({
            date: new Date(row.date).toLocaleDateString('en-GB'),
            year: getYearSafe(row.date),
            name: row.name,
            land: row.land,
            rate: row.rate,
            total: row.totalTk ? row.totalTk.toFixed(2) : "0.00",
            given: row.tkGiven ? row.tkGiven.toFixed(2) : "0.00",
            hariYear: row.hariYear || "",
            entryBy: row.entryBy
        }));

        res.json({ success: true, records: formattedRecords });
    } catch (error) {
        res.json({ success: false, records: [] });
    }
});

// 5. Delete Records
app.post('/api/deleteRecords', async (req, res) => {
    const data = req.body;
    if (data.name === "ALL" || data.year === "ALL") {
        return res.json({ success: false, message: "Select specific name and year." });
    }

    try {
        const year = parseInt(data.year);
        const start = new Date(`${year}-01-01T00:00:00.000Z`);
        const end = new Date(`${year + 1}-01-01T00:00:00.000Z`);

        const result = await LandData.deleteMany({ 
            name: data.name, 
            date: { $gte: start, $lt: end } 
        });

        res.json({ success: true, message: result.deletedCount + " records deleted." });
    } catch (e) {
        res.json({ success: false, message: e.toString() });
    }
});

// --- PROFILE MANAGEMENT ---

app.post('/api/saveProfile', async (req, res) => {
    const data = req.body;
    try {
        // যদি পুরাতন নাম থাকে তবে আপডেট করা
        if (data.oldName) {
            await Profile.findOneAndUpdate(
                { name: data.oldName, land: data.oldLand, rate: data.oldRate },
                { name: data.name, land: data.land, rate: data.rate, hariBorsho: data.hariBorsho },
                { upsert: true }
            );
        } else {
            // নতুন প্রোফাইল তৈরি
            const newProfile = new Profile({
                name: data.name,
                land: data.land,
                rate: data.rate,
                hariBorsho: data.hariBorsho
            });
            await newProfile.save();
        }
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, message: e.toString() });
    }
});

app.post('/api/deleteProfile', async (req, res) => {
    try {
        await Profile.findOneAndDelete({ 
            name: req.body.name, 
            land: req.body.land, 
            rate: req.body.rate 
        });
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false });
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
