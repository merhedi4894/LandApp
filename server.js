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
app.use(express.static('public'));

// --- MongoDB Connection ---
const MONGO_URI = process.env.MONGO_URI;

// ডাটাবেস কানেকশন (এখানে process.exit বাদ দেওয়া হয়েছে যাতে সার্ভার বন্ধ না হয়)
if (MONGO_URI) {
    mongoose.connect(MONGO_URI)
        .then(() => console.log('MongoDB Connected Successfully!'))
        .catch(err => console.error('MongoDB Connection Error:', err));
} else {
    console.warn("WARNING: MONGO_URI not found in environment variables. Database will not work.");
}

// --- Helper: Year Extraction ---
function getYearSafe(dateVal) {
    if (!dateVal) return "";
    try {
        const d = new Date(dateVal);
        if (isNaN(d.getTime())) return "";
        return d.getFullYear().toString();
    } catch (e) { return ""; }
}

// --- Routes ---

// 1. Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
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

// 3. Get Initial Data
app.get('/api/getInitData', async (req, res) => {
    try {
        const profiles = await Profile.find({}).lean();
        const landStats = await LandData.aggregate([
            {
                $group: {
                    _id: "$name",
                    lands: { $addToSet: "$land" },
                    years: { $addToSet: { $dateToString: { format: "%Y", date: "$date" } } }
                }
            }
        ]);

        const allYears = new Set();
        const namesFromData = new Set();
        const landMap = {};
        const yearMap = {};

        landStats.forEach(group => {
            const name = group._id;
            if (name) {
                namesFromData.add(name);
                if (!landMap[name]) landMap[name] = new Set();
                group.lands.forEach(l => landMap[name].add(l));
                if (!yearMap[name]) yearMap[name] = new Set();
                group.years.forEach(y => {
                     if(y) {
                         allYears.add(y);
                         yearMap[name].add(y);
                     }
                });
            }
        });

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
    let query = {};
    
    if (searchData.name && searchData.name !== "ALL") query.name = searchData.name;
    if (searchData.land && searchData.land !== "ALL") query.land = parseFloat(searchData.land);
    
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
        const result = await LandData.deleteMany({ name: data.name, date: { $gte: start, $lt: end } });
        res.json({ success: true, message: result.deletedCount + " records deleted." });
    } catch (e) {
        res.json({ success: false, message: e.toString() });
    }
});

// --- PROFILE MANAGEMENT ---
app.post('/api/saveProfile', async (req, res) => {
    const data = req.body;
    try {
        const landVal = parseFloat(data.land);
        const rateVal = parseFloat(data.rate);
        const oldLandVal = parseFloat(data.oldLand);
        const oldRateVal = parseFloat(data.oldRate);

        if (data.oldName && data.oldName !== "") {
            await Profile.findOneAndUpdate(
                { name: data.oldName, land: oldLandVal, rate: oldRateVal },
                { name: data.name, land: landVal, rate: rateVal, hariBorsho: data.hariBorsho }
            );
        } else {
            const existing = await Profile.findOne({ name: data.name, land: landVal });
            if (existing) {
                await Profile.findOneAndUpdate({ _id: existing._id }, { rate: rateVal, hariBorsho: data.hariBorsho });
            } else {
                const newProfile = new Profile({ name: data.name, land: landVal, rate: rateVal, hariBorsho: data.hariBorsho });
                await newProfile.save();
            }
        }
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, message: e.toString() });
    }
});

app.post('/api/deleteProfile', async (req, res) => {
    try {
        await Profile.findOneAndDelete({ name: req.body.name, land: parseFloat(req.body.land), rate: parseFloat(req.body.rate) });
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false });
    }
});

// Start Server (এটি সব শেষে থাকবে)
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
