// Minimal mailer stub - replace with real email provider in production
const nodemailer = require('nodemailer');

async function sendVerificationEmail(to, token) {
  // For quick demo purposes we just log the verification link.
  // Frontend URL should be set in production (e.g., https://your-domain.com or S3 website endpoint)
  const frontendUrl = process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:8080';
  const verificationUrl = `${frontendUrl}/verify?token=${token}`;
  console.log(`[mailer] verification link for ${to}: ${verificationUrl}`);
  return true;
}

module.exports = { sendVerificationEmail };
