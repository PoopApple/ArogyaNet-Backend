const express = require('express');
const router = express.Router();
const { authenticateAccessToken } = require('../Middlewares/auth');
const { requireRole } = require('../Middlewares/role');
const { createPrescription, listPrescriptions } = require('../Controllers/prescriptionController');

router.get('/', authenticateAccessToken, listPrescriptions);
router.post('/', authenticateAccessToken, requireRole(['doctor', 'admin']), createPrescription);

module.exports = router;

