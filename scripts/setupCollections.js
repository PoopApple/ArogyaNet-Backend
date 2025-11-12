// Script to ensure collections and indexes exist for the backend (run once)
require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URL = process.env.MONGODB_URI;
const DB_NAME = process.env.AUTH_DB_NAME || 'authdb';

async function main() {
  await mongoose.connect(MONGO_URL, { dbName: DB_NAME });
  console.log(`Connected to MongoDB (db=${DB_NAME})`);

  // Require models so Mongoose registers them and creates indexes
  const User = require('../Models/User');
  const RefreshToken = require('../Models/RefreshToken');

  try {
    // Ensure collections exist
    const collections = await mongoose.connection.db.listCollections().toArray();
    const existing = collections.map(c => c.name);

    if (!existing.includes('users')) {
      await mongoose.connection.createCollection('users');
      console.log('Created collection: users');
    }
    if (!existing.includes('refreshtokens')) {
      await mongoose.connection.createCollection('refreshtokens');
      console.log('Created collection: refreshtokens');
    }

    // Ensure indexes (Model.init creates indexes defined in schema)
    await User.init();
    console.log('User indexes ensured');
    await RefreshToken.init();
    console.log('RefreshToken indexes ensured');

    console.log('Setup complete');
  } catch (err) {
    console.error('Setup error:', err);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
