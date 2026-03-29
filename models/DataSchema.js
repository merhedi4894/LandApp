const mongoose = require('mongoose');

// প্রোফাইল স্কিমা (Settings এর জন্য)
const profileSchema = new mongoose.Schema({
    name: String,
    land: Number,
    rate: Number,
    hariBorsho: String
});

// ল্যান্ড ডাটা স্কিমা (খরচের হিসাবের জন্য)
const landSchema = new mongoose.Schema({
    date: { type: Date, default: Date.now },
    name: String,
    land: Number,
    rate: Number,
    totalTk: Number,
    tkGiven: Number,
    hariYear: String,
    entryBy: String
});

// সার্চের সুবিধার জন্য ইন্ডেক্স তৈরি
landSchema.index({ name: 1, date: 1 });

const Profile = mongoose.model('Profile', profileSchema);
const LandData = mongoose.model('LandData', landSchema);

module.exports = { Profile, LandData };
