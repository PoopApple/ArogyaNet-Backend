const express = require('express');
const router = express.Router();
const { authenticateAccessToken } = require('../Middlewares/auth');
const { requireRole } = require('../Middlewares/role');
const { getProfile, listUsers, listDoctors, updateProfile, updateUserRole, updateDoctorApproval } = require('../Controllers/userController');

router.get('/', authenticateAccessToken, requireRole(['admin']), listUsers);
router.get('/doctors', authenticateAccessToken, listDoctors);
router.put('/:id', authenticateAccessToken, updateProfile);
router.patch('/:id/role', authenticateAccessToken, requireRole(['admin']), updateUserRole);
router.patch('/:id/approval', authenticateAccessToken, requireRole(['admin']), updateDoctorApproval);
router.get('/:id', authenticateAccessToken, getProfile);

module.exports = router;