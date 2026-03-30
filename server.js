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
if (!MONGO_URI) {
    console.error("Error: MONGO_URI not found.");
    process.exit(1);
}

mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB Connected!'))
    .catch(err => console.error('MongoDB Error:', err));

// --- Helper Functions ---
function toEnglishDigits(str) {
    if (!str) return str;
    const map = {
        '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4',
        '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9'
    };
    return String(str).replace(/[০-৯]/g, d => map[d] || d);
}

function getYearSafe(dateVal) {
    if (!dateVal) return "";
    try {
        const d = new Date(dateVal);
        if (isNaN(d.getTime())) return "";
        return d.getFullYear().toString();
    } catch (e) { return ""; }
}

// --- Routes ---

// Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const validUser = process.env.ADMIN_USER || 'mehedi4894';
    const validPass = process.env.ADMIN_PASS || 'Mehedi@01747527352';
    if (username === validUser && password === validPass) {
        res.json({ success: true, user: { username, name: username } });
    } else {
        res.json({ success: false, message: 'Invalid!' });
    }
});

// Save Entry
app.post('/api/saveFormData', async (req, res) => {
    try {
        const fd = req.body;
        const cleanYear = toEnglishDigits(fd.hariYear);
        const cleanTkGiven = toEnglishDigits(fd.tkGiven);
        const totalTk = (parseFloat(fd.rate) / 33) * parseFloat(fd.land);
        
        await new LandData({
            name: fd.name, land: fd.land, rate: fd.rate,
            totalTk: totalTk.toFixed(2), tkGiven: cleanTkGiven || 0,
            hariYear: cleanYear || "", entryBy: fd.loggedInUser
        }).save();
        res.json({ success: true });
    } catch (e) { res.json({ success: false, message: e.toString() }); }
});

// Get Initial Data
app.post('/api/getInitData', async (req, res) => {
    try {
        const profiles = await Profile.find({}).sort({ name: 1 }).lean();
        const landStats = await LandData.aggregate([
            { $group: { _id: "$name", lands: { $addToSet: "$land" }, years: { $addToSet: "$hariYear" } } }
        ]);

        const allYears = new Set(), namesFromData = new Set(), landMap = {}, yearMap = {};
        landStats.forEach(g => {
            if (g._id) {
                namesFromData.add(g._id);
                landMap[g._id] = g.lands.sort((a,b)=>a-b);
                yearMap[g._id] = g.years.filter(y => y).sort((a, b) => b - a);
                g.years.forEach(y => { if(y) allYears.add(y); });
            }
        });
        res.json({ profiles, searchOptions: { names: Array.from(namesFromData).sort(), years: Array.from(allYears).sort((a,b)=>b-a), yearMap, landMap } });
    } catch (error) { res.json({ profiles: [], searchOptions: { names: [], years: [], yearMap: {}, landMap: {} } }); }
});

// Get Report Data
app.post('/api/getReportData', async (req, res) => {
    const sd = req.body;
    let query = {};
    const cleanSearchYear = toEnglishDigits(sd.year);

    if (sd.name !== "ALL") query.name = sd.name;
    if (sd.land !== "ALL") query.land = parseFloat(sd.land);
    if (cleanSearchYear !== "ALL") {
        query.hariYear = cleanSearchYear;
    }

    try {
        const records = await LandData.find(query).sort({ date: -1 }).lean();
        res.json({ success: true, records: records.map(r => ({
            date: new Date(r.date).toLocaleDateString('en-GB'),
            year: getYearSafe(r.date), name: r.name, land: r.land, rate: r.rate,
            total: r.totalTk?.toFixed(2), given: r.tkGiven?.toFixed(2),
            hariYear: r.hariYear || "", entryBy: r.entryBy
        }))});
    } catch (e) { res.json({ success: false, records: [] }); }
});

// Delete Records
app.post('/api/deleteRecords', async (req, res) => {
    const { name, year } = req.body;
    const cleanYear = toEnglishDigits(year);
    if (name === "ALL" || cleanYear === "ALL") return res.json({ success: false, message: "Select specific." });
    try {
        await LandData.deleteMany({ name, hariYear: cleanYear });
        res.json({ success: true, message: "Deleted" });
    } catch(e) { res.json({ success: false, message: e.toString() }); }
});

// --- PROFILE MANAGEMENT ---
app.post('/api/saveProfile', async (req, res) => {
    const d = req.body;
    try {
        const land = parseFloat(d.land);
        const rate = parseFloat(d.rate);
        if (!d.name || isNaN(land) || isNaN(rate)) return res.json({ success: false, message: "Invalid Data" });
        if (d.oldName) {
            await Profile.findOneAndUpdate(
                { name: d.oldName, land: parseFloat(d.oldLand), rate: parseFloat(d.oldRate) },
                { name: d.name, land, rate, hariBorsho: d.hariBorsho }
            );
        } else {
            const exists = await Profile.findOne({ name: d.name, land });
            if (exists) {
                await Profile.findByIdAndUpdate(exists._id, { rate, hariBorsho: d.hariBorsho });
            } else {
                await new Profile({ name: d.name, land, rate, hariBorsho: d.hariBorsho }).save();
            }
        }
        res.json({ success: true });
    } catch (e) { res.json({ success: false, message: e.toString() }); }
});

app.post('/api/deleteProfile', async (req, res) => {
    try {
        await Profile.findOneAndDelete({ name: req.body.name, land: parseFloat(req.body.land) });
        res.json({ success: true });
    } catch(e) { res.json({ success: false }); }
});

app.listen(PORT, () => console.log(`Server running on ${PORT}`));
