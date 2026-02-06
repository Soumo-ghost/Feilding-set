const express = require('express');
const cors = require('cors');
const { Sequelize, DataTypes } = require('sequelize');
const crypto = require('crypto');
const morgan = require('morgan'); 
const path = require('path');


const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(morgan('dev')); 


app.use(express.static(path.join(__dirname, 'public')));

const ENCRYPTION_KEY = '12345678901234567890123456789012'; 
const IV_LENGTH = 16;

function encrypt(text) {
    if (!text) return null;
    let iv = crypto.randomBytes(IV_LENGTH);
    let cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
    if (!text) return null;
    let textParts = text.split(':');
    let iv = Buffer.from(textParts.shift(), 'hex');
    let encryptedText = Buffer.from(textParts.join(':'), 'hex');
    let decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
}


const sequelize = new Sequelize({ dialect: 'sqlite', storage: './event_db.sqlite', logging: false });

const Attendee = sequelize.define('Attendee', {
    registration_id: { type: DataTypes.STRING, unique: true }, 
    name: DataTypes.STRING,
    dept: DataTypes.STRING,
    grad_year: DataTypes.INTEGER,
    phone: DataTypes.STRING,
    address: DataTypes.STRING,
    rfid_uid: { type: DataTypes.STRING, unique: true, allowNull: true },
    meal_credits: { type: DataTypes.INTEGER, defaultValue: 1 },
    is_inside: { type: DataTypes.BOOLEAN, defaultValue: false }
});

const Log = sequelize.define('Log', {
    location: DataTypes.STRING,
    action: DataTypes.STRING,
    details: DataTypes.STRING
});

sequelize.sync().then(() => {
    console.log("------------------------------------------------");
    console.log("✅ DATABASE CONNECTED");
    console.log(`🚀 SERVER RUNNING AT http://localhost:${PORT}`);
    console.log("------------------------------------------------");
});



app.post('/admin/add_student', async (req, res) => {
    try {
        const { registration_id, name, dept, grad_year, phone, address } = req.body;
        console.log(`[ADMIN] Adding student: ${name}...`); 
        
        await Attendee.create({
            registration_id, name, dept, grad_year,
            phone: encrypt(phone),
            address: encrypt(address)
        });
        
        console.log(`[SUCCESS] ${name} added.`);
        res.json({ status: "success", msg: `Added ${name}` });
    } catch (e) { 
        console.log(`[ERROR] ${e.message}`);
        res.status(400).json({ status: "error", msg: "ID likely exists" }); 
    }
});

app.post('/admin/issue_meal', async (req, res) => {
    const { rfid_uid } = req.body;
    console.log(`[MEAL] Scanning Tag: ${rfid_uid}...`);

    const student = await Attendee.findOne({ where: { rfid_uid } });

    if (!student) {
        return res.status(404).json({ status: "error", msg: "Unknown Tag" });
    }
    
    if (student.meal_credits > 0) {
        student.meal_credits -= 1;
        await student.save();
        console.log(`[SUCCESS] Meal given to ${student.name}.`);
        return res.json({ status: "success", msg: "Meal Issued", remaining: student.meal_credits });
    } else {
        console.log(`[DENIED] No credits.`);
        return res.json({ status: "denied", msg: "No Credits Left" });
    }
});

app.post('/staff/link_card', async (req, res) => {
    const { registration_id, rfid_uid } = req.body;
    console.log(`[STAFF] Linking Card...`);

    const student = await Attendee.findOne({ where: { registration_id } });
    
    if (!student) return res.status(404).json({ msg: "Student not found" });
    if (student.rfid_uid) return res.status(400).json({ msg: "Card already linked!" });

    student.rfid_uid = rfid_uid;
    student.is_inside = true; 
    await student.save();

    console.log(`[SUCCESS] Linked to ${student.name}`);
    res.json({ status: "success", msg: `Linked to ${student.name}` });
});

app.post('/staff/check_status', async (req, res) => {
    const { rfid_uid } = req.body;
    const student = await Attendee.findOne({ 
        where: { rfid_uid },
        attributes: ['name', 'dept', 'meal_credits', 'is_inside'] 
    });

    if (!student) return res.status(404).json({ status: "error", msg: "Unregistered Tag" });
    res.json({ status: "success", data: student });
});

app.listen(PORT, '0.0.0.0', () => {});