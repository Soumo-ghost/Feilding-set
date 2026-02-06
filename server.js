const express = require('express');
const bodyParser = require('express');
const cors = require('cors');
const { Sequelize, DataTypes } = require('sequelize');

// --- 1. CONFIGURATION ---
const app = express();
const PORT = 3000;

// Middleware
app.use(cors()); // Allow requests from anywhere (Hardware/Frontend)
app.use(express.json()); // Parse incoming JSON requests

// Database Setup (SQLite file named 'event_db.sqlite')
const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: './event_db.sqlite',
    logging: false // Set to true if you want to see SQL queries in console
});

// --- 2. DATABASE MODELS ---

// The Student Model
const Attendee = sequelize.define('Attendee', {
    registration_id: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true // Roll Number / Ticket ID
    },
    name: DataTypes.STRING,
    dept: DataTypes.STRING,
    grad_year: DataTypes.INTEGER,
    rfid_uid: {
        type: DataTypes.STRING,
        unique: true,
        allowNull: true // Initially null, assigned at entrance
    },
    meal_credits: {
        type: DataTypes.INTEGER,
        defaultValue: 1
    },
    is_inside: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    }
});

// The Logs Model (For history/debugging)
const Log = sequelize.define('Log', {
    location: DataTypes.STRING, // e.g., "ENTRANCE", "CAFETERIA"
    action: DataTypes.STRING,   // "CHECK_IN", "DENIED", etc.
    description: DataTypes.STRING
});

// Relationships (One Student has Many Logs)
Attendee.hasMany(Log);
Log.belongsTo(Attendee);

// Initialize DB
sequelize.sync().then(() => {
    console.log("Database & Tables created!");
});


// --- 3. API ENDPOINTS ---

/**
 * SETUP: Add a student (or list of students) before the event.
 * No RFID assigned yet.
 */
app.post('/setup/add_student', async (req, res) => {
    try {
        const { registration_id, name, dept, grad_year } = req.body;
        const student = await Attendee.create({
            registration_id, name, dept, grad_year
        });
        res.json({ status: "success", msg: `Added ${name}` });
    } catch (error) {
        res.status(400).json({ status: "error", msg: "Student ID likely exists already" });
    }
});

/**
 * ENTRANCE DESK: Issue the card.
 * Links a blank RFID tag to an existing student registration.
 */
app.post('/gate/issue_card', async (req, res) => {
    const { registration_id, rfid_uid } = req.body;

    try {
        // 1. Find the student by Roll No
        const student = await Attendee.findOne({ where: { registration_id } });
        if (!student) {
            return res.status(404).json({ status: "error", msg: "Student not found in list" });
        }

        // 2. Check if this Tag is already used
        const tagCheck = await Attendee.findOne({ where: { rfid_uid } });
        if (tagCheck) {
            return res.status(400).json({ status: "error", msg: "This Tag is already assigned!" });
        }

        // 3. Assign Tag & Mark Entered
        student.rfid_uid = rfid_uid;
        student.is_inside = true; 
        await student.save();

        // 4. Log it
        await Log.create({ 
            AttendeeId: student.id, 
            location: "DESK", 
            action: "ISSUED", 
            description: `Assigned to ${student.name}` 
        });

        res.json({ 
            status: "success", 
            student: student.name, 
            credits: student.meal_credits 
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

/**
 * UNIVERSAL SCANNER: The main logic for Gates and Food.
 * Hardware sends: { "rfid_uid": "...", "location": "CAFETERIA" }
 */
app.post('/scan', async (req, res) => {
    const { rfid_uid, location } = req.body;

    try {
        const student = await Attendee.findOne({ where: { rfid_uid } });

        // CASE 0: Unknown Tag
        if (!student) {
            return res.json({ status: "denied", reason: "UNKNOWN_TAG", beep: "long_error" });
        }

        // CASE 1: ENTRANCE SCAN (If they leave and come back)
        if (location === "ENTRANCE") {
            if (student.is_inside) {
                return res.json({ status: "denied", reason: "ALREADY_INSIDE", name: student.name });
            }
            student.is_inside = true;
            await student.save();
            await Log.create({ AttendeeId: student.id, location, action: "ENTERED" });
            return res.json({ status: "allowed", name: student.name, beep: "success" });
        }

        // CASE 2: CAFETERIA / MEAL
        else if (location === "CAFETERIA") {
            if (student.meal_credits > 0) {
                student.meal_credits -= 1;
                await student.save();
                await Log.create({ AttendeeId: student.id, location, action: "MEAL_REDEEMED" });
                return res.json({ 
                    status: "allowed", 
                    msg: "Meal Approved", 
                    credits_remaining: student.meal_credits, 
                    beep: "success" 
                });
            } else {
                await Log.create({ AttendeeId: student.id, location, action: "MEAL_DENIED" });
                return res.json({ status: "denied", reason: "NO_CREDITS", beep: "long_error" });
            }
        }

        // CASE 3: EXIT
        else if (location === "EXIT") {
            student.is_inside = false;
            await student.save();
            await Log.create({ AttendeeId: student.id, location, action: "EXITED" });
            return res.json({ status: "allowed", msg: "Goodbye", beep: "success" });
        }

        else {
            return res.json({ status: "error", msg: "Invalid Location ID" });
        }

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "System Error" });
    }
});

// --- 4. START SERVER ---
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    console.log(`Test checking in a user at: http://localhost:${PORT}/gate/issue_card`);
});