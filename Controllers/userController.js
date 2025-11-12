const User = require('../Models/User');

const sanitizeUser = (userDoc) => ({
  id: userDoc._id,
  name: userDoc.name,
  email: userDoc.email,
  role: userDoc.role,
  doctorApproved: userDoc.doctorApproved,
  phone: userDoc.phone,
  profile: userDoc.profile,
  createdAt: userDoc.createdAt,
});

const getProfile = async (req, res) => {
  const { id } = req.params;
  try {
    const user = await User.findById(id).select('-passwordHash');
    if (!user) return res.status(404).json({ message: 'Not found' });

    const isSelf = req.user && String(req.user.id) === String(id);
    const isAdmin = req.user && req.user.role === 'admin';
    const isDoctor = req.user && req.user.role === 'doctor';

    if (isSelf || isAdmin || isDoctor) {
      return res.json(sanitizeUser(user));
    }
    return res.status(403).json({ message: 'Forbidden' });
  } catch (err) {
    console.error('[userController] getProfile error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

const listUsers = async (_req, res) => {
  try {
    const users = await User.find().select('-passwordHash').limit(200);
    return res.json(users.map(sanitizeUser));
  } catch (err) {
    console.error('[userController] listUsers error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

const listDoctors = async (req, res) => {
  try {
    const query = { role: 'doctor' };
    if (!req.user || req.user.role !== 'admin') {
      query.doctorApproved = true;
    }

    const doctors = await User.find(query).select('-passwordHash').limit(200);
    return res.json(doctors.map(sanitizeUser));
  } catch (err) {
    console.error('[userController] listDoctors error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

const updateProfile = async (req, res) => {
  const { id } = req.params;

  const isSelf = req.user && String(req.user.id) === String(id);
  const isAdmin = req.user && req.user.role === 'admin';

  if (!isSelf && !isAdmin) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  const allowedFields = ['name', 'phone', 'profile'];
  const updates = {};

  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      updates[field] = req.body[field];
    }
  });

  try {
    const user = await User.findByIdAndUpdate(id, updates, { new: true, runValidators: true }).select('-passwordHash');
    if (!user) return res.status(404).json({ message: 'Not found' });
    return res.json(sanitizeUser(user));
  } catch (err) {
    console.error('[userController] updateProfile error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

const updateUserRole = async (req, res) => {
  if (!req.body.role || !['patient', 'doctor', 'admin'].includes(req.body.role)) {
    return res.status(400).json({ message: 'Invalid role' });
  }

  try {
    const updates = { role: req.body.role };
    if (req.body.role === 'doctor') {
      updates.doctorApproved = false;
    } else if (req.body.role !== 'doctor') {
      updates.doctorApproved = true;
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    ).select('-passwordHash');

    if (!user) return res.status(404).json({ message: 'Not found' });
    return res.json(sanitizeUser(user));
  } catch (err) {
    console.error('[userController] updateUserRole error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

const updateDoctorApproval = async (req, res) => {
  const { doctorApproved } = req.body;
  if (typeof doctorApproved !== 'boolean') {
    return res.status(400).json({ message: 'doctorApproved must be boolean' });
  }

  try {
    const user = await User.findById(req.params.id).select('-passwordHash');
    if (!user) return res.status(404).json({ message: 'Not found' });
    if (user.role !== 'doctor') {
      return res.status(400).json({ message: 'User is not a doctor' });
    }

    user.doctorApproved = doctorApproved;
    await user.save();

    return res.json(sanitizeUser(user));
  } catch (err) {
    console.error('[userController] updateDoctorApproval error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

module.exports = { getProfile, listUsers, listDoctors, updateProfile, updateUserRole, updateDoctorApproval };
