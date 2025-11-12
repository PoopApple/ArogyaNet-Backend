const mongoose = require('mongoose');
require("dotenv").config()

const MONGO_URL = process.env.MONGODB_URI;
const DB_NAME = process.env.AUTH_DB_NAME || 'authdb';

// Connect to MongoDB and explicitly set the database name to `authdb` by default.
mongoose.connect(MONGO_URL, { dbName: DB_NAME })
.then(() => console.log(`MongoDB connected (db=${DB_NAME})`))
.catch(err => console.error('MongoDB connection error:', err));
