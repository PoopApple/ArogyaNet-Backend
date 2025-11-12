const Joi = require('joi');
const bcrypt = require('bcrypt');
const { sha256 } = require('../Utils/hash');
const { generateAccessToken, generateRefreshToken } = require('../Utils/token');
const User = require('../Models/User');
const RefreshToken = require('../Models/RefreshToken');
const { sendVerificationEmail } = require('../Utils/mailer');

const REFRESH_EXPIRES_DAYS = parseInt(process.env.REFRESH_EXPIRES_DAYS || '7', 10);

// Helper: infer role from email domain when role is not provided
const detectRoleFromEmail = (email) => {
  if (!email || typeof email !== 'string') return 'patient';
  const e = email.toLowerCase();
  // simple patterns: addresses containing 'admin' or 'doctor'
  if (e.includes('@admin.') || e.endsWith('@admin') || e.includes('.admin@') || e.includes('@admin')) return 'admin';
  if (e.includes('@doctor.') || e.endsWith('@doctor') || e.includes('.doctor@') || e.includes('@doctor')) return 'doctor';
  return 'patient';
};
const register = async (req, res) => {
  console.log('[authController] register body:', req.body);
  // Allow normal emails (user@domain.tld) or shorthand internal addresses like user@doctor or user@admin
  const emailSchema = Joi.alternatives().try(
    Joi.string().email(),
    Joi.string().pattern(/^[A-Za-z0-9._%+-]+@(doctor|admin)$/i)
  ).required();

  const schema = Joi.object({ name: Joi.string().required(), email: emailSchema, password: Joi.string().min(6).required(), role: Joi.string().valid('patient','doctor','admin') });
  const { error, value } = schema.validate(req.body);
  if (error) {
    console.error('[authController] Validation error:', error.message);
    return res.status(400).json({ message: error.message });
  }

  // If frontend didn't provide a role, infer it from the email address
  if (!value.role) {
    try {
      value.role = detectRoleFromEmail(value.email);
      console.log('[authController] Role inferred from email:', value.email, '->', value.role);
    } catch (e) {
      value.role = 'patient';
    }
  }

  try {
    console.log('[authController] Checking for existing user with email:', value.email);
    const existing = await User.findOne({ email: value.email });
    if (existing) {
      console.log('[authController] User already exists with email:', value.email);
      return res.status(409).json({ message: 'Email already in use' });
    }

    console.log('[authController] Hashing password...');
    const passwordHash = await bcrypt.hash(value.password, 12);
    
    console.log('[authController] Creating user in database...');
    const user = await User.create({ 
      name: value.name, 
      email: value.email, 
      passwordHash, 
      role: value.role || 'patient',
      doctorApproved: value.role === 'doctor' ? false : true,
    });
    console.log('[authController] User created:', user._id);

    // send verification (stub)
    console.log('[authController] Sending verification email...');
    const verificationToken = generateRefreshToken(); // one-time token for verification link
    await sendVerificationEmail(user.email, verificationToken);

    // create refresh token for the session
    console.log('[authController] Creating refresh token...');
    const rawRefresh = generateRefreshToken();
    const refreshHash = sha256(rawRefresh);
    const refreshDoc = await RefreshToken.create({ 
      userId: user._id, 
      tokenHash: refreshHash, 
      expiresAt: new Date(Date.now() + REFRESH_EXPIRES_DAYS * 24 * 3600 * 1000) 
    });

    res.cookie('refreshToken', rawRefresh, { httpOnly: true, sameSite: 'lax' });
    console.log('[authController] Generating access token...');
    const accessToken = generateAccessToken(user);
    console.log('[authController] Register successful for:', user.email);
    return res.status(201).json({ accessToken, user: { id: user._id, name: user.name, email: user.email, role: user.role, doctorApproved: user.doctorApproved } });
  } catch (err) {
    console.error('[authController] Register error:', err);
    console.error('[authController] Error stack:', err.stack);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

const login = async (req, res) => {
  console.log('[authController] login body:', req.body);
  // Login accepts both normal email addresses and shorthand addresses like user@doctor or user@admin
  const loginEmailSchema = Joi.alternatives().try(
    Joi.string().email(),
    Joi.string().pattern(/^[A-Za-z0-9._%+-]+@(doctor|admin)$/i)
  ).required();

  const schema = Joi.object({ email: loginEmailSchema, password: Joi.string().required() });
  const { error, value } = schema.validate(req.body);
  if (error) {
    console.error('[authController] Validation error:', error.message);
    return res.status(400).json({ message: error.message });
  }

  try {
    console.log('[authController] Finding user with email:', value.email);
    const user = await User.findOne({ email: value.email });
    if (!user) {
      console.log('[authController] User not found with email:', value.email);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    console.log('[authController] Comparing passwords...');
    const ok = await bcrypt.compare(value.password, user.passwordHash);
    if (!ok) {
      console.log('[authController] Password mismatch for user:', value.email);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    console.log('[authController] Creating refresh token...');
    const rawRefresh = generateRefreshToken();
    const refreshHash = sha256(rawRefresh);
    await RefreshToken.create({ 
      userId: user._id, 
      tokenHash: refreshHash, 
      expiresAt: new Date(Date.now() + REFRESH_EXPIRES_DAYS * 24 * 3600 * 1000) 
    });

    res.cookie('refreshToken', rawRefresh, { httpOnly: true, sameSite: 'lax' });
    console.log('[authController] Generating access token...');
    const accessToken = generateAccessToken(user);
    console.log('[authController] Login successful for:', user.email);
    return res.json({ accessToken, user: { id: user._id, name: user.name, email: user.email, role: user.role, doctorApproved: user.doctorApproved } });
  } catch (err) {
    console.error('[authController] Login error:', err);
    console.error('[authController] Error stack:', err.stack);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

const refresh = async (req, res) => {
  // refresh token rotation: token stored in httpOnly cookie or body
  const token = req.cookies?.refreshToken || req.body?.refreshToken;
  if (!token) return res.status(401).json({ message: 'Missing refresh token' });

  try {
    const tokenHash = sha256(token);
    const doc = await RefreshToken.findOne({ tokenHash, revoked: false });
    if (!doc || doc.expiresAt < new Date()) return res.status(401).json({ message: 'Invalid or expired refresh token' });

    // rotate: remove old token and issue new one
    await RefreshToken.findByIdAndUpdate(doc._id, { revoked: true });

    const user = await require('../Models/User').findById(doc.userId);
    if (!user) return res.status(401).json({ message: 'Invalid token user' });

    const rawRefresh = generateRefreshToken();
    const refreshHash = sha256(rawRefresh);
    await RefreshToken.create({ userId: user._id, tokenHash: refreshHash, expiresAt: new Date(Date.now() + REFRESH_EXPIRES_DAYS * 24 * 3600 * 1000) });

    res.cookie('refreshToken', rawRefresh, { httpOnly: true, sameSite: 'lax' });
    const accessToken = generateAccessToken(user);
    return res.json({ accessToken });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
};

const logout = async (req, res) => {
  const token = req.cookies?.refreshToken || req.body?.refreshToken;
  if (token) {
    const tokenHash = sha256(token);
    await RefreshToken.findOneAndUpdate({ tokenHash }, { revoked: true });
  }
  res.clearCookie('refreshToken');
  return res.json({ ok: true });
};

const me = async (req, res) => {
  // authenticateAccessToken middleware sets req.user
  if (!req.user) return res.status(401).json({ message: 'Not authenticated' });
  try {
    const user = await User.findById(req.user.id).select('-passwordHash');
    if (!user) return res.status(404).json({ message: 'Not found' });
    return res.json({ user: { id: user._id, name: user.name, email: user.email, role: user.role, doctorApproved: user.doctorApproved } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
};

module.exports = { register, login, refresh, logout, me };
