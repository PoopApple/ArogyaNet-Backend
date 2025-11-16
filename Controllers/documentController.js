const Document = require('../Models/Document');
const Appointment = require('../Models/Appointment');
const { generateS3Key, getPresignedUploadUrl, getPresignedDownloadUrl, deleteFromS3, BUCKET_NAME } = require('../Utils/s3');
const logger = require('../Utils/logger');

const formatDocument = (doc) => {
  // Handle populated patientId (object) vs plain ObjectId
  const patient = doc.patientId;
  const patientData = patient && typeof patient === 'object' && patient._id 
    ? { id: patient._id.toString(), name: patient.name || 'Unknown', email: patient.email }
    : { id: patient?.toString() || doc.patientId?.toString(), name: null, email: null };

  return {
    id: doc._id,
    originalName: doc.originalName,
    mimeType: doc.mimeType,
    size: doc.size,
    s3Key: doc.s3Key,
    patientId: patientData.id,
    patientName: patientData.name,
    patientEmail: patientData.email,
    createdAt: doc.createdAt,
  };
};

/**
 * Generate presigned upload URL for client to upload directly to S3
 * POST /api/documents/upload-url
 */
const getUploadUrl = async (req, res) => {
  try {
    const { originalName, mimeType, size } = req.body;

    // Only patients can upload files
    if (req.user?.role !== 'patient') {
      // eslint-disable-next-line no-console
      console.warn('[Upload] blocked-non-patient-upload', {
        userId: req.user?.id,
        role: req.user?.role,
        path: req.originalUrl || req.url,
      });
      return res.status(403).json({ message: 'Only patients can upload files' });
    }

    if (!originalName || !mimeType || !size) {
      return res.status(400).json({ message: 'Missing required fields: originalName, mimeType, size' });
    }

    // Validate file size (10MB limit)
    if (size > 10 * 1024 * 1024) {
      // eslint-disable-next-line no-console
      console.warn('[Upload] file-too-large', { userId: req.user?.id, size });
      return res.status(400).json({ message: 'File size exceeds 10MB limit' });
    }

    // Validate MIME type
    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/jpg',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    if (!allowedTypes.includes(mimeType)) {
      return res.status(400).json({ message: 'Unsupported file type' });
    }

    // Enforce max documents per patient (10)
    const currentCount = await Document.countDocuments({ patientId: req.user.id });
    if (currentCount >= 10) {
      // eslint-disable-next-line no-console
      console.warn('[Upload] patient-doc-limit-reached', { userId: req.user?.id, currentCount });
      return res.status(400).json({ message: 'Maximum document limit reached (10) for this patient' });
    }

    // Generate S3 key
    const s3Key = generateS3Key(req.user.id, originalName);

    // Log upload URL request intent
    logger.info('Upload URL requested', logger.withReq(req, {
      event: 'file-upload',
      phase: 'request-upload-url',
      originalName,
      mimeType,
      size,
      s3Key,
    }));
    // Additional console logging for quick debugging
    // eslint-disable-next-line no-console
    console.log('[Upload] request-upload-url', {
      userId: req.user?.id,
      originalName,
      mimeType,
      size,
      s3Key,
      path: req.originalUrl || req.url,
      method: req.method,
    });

    // Generate presigned upload URL
    const uploadUrl = await getPresignedUploadUrl(s3Key, mimeType);

    logger.info('Upload URL generated', logger.withReq(req, {
      event: 'file-upload',
      phase: 'upload-url-generated',
      s3Key,
      contentType: mimeType,
      expiresIn: 300,
    }));
    // eslint-disable-next-line no-console
    console.log('[Upload] upload-url-generated', {
      userId: req.user?.id,
      s3Key,
      contentType: mimeType,
      expiresIn: 300,
    });

    return res.json({
      uploadUrl,
      s3Key,
      expiresIn: 300, // 5 minutes
    });
  } catch (err) {
    logger.error('Failed to generate upload URL', logger.withReq(req, {
      event: 'file-upload',
      phase: 'request-upload-url',
      err,
    }));
    // eslint-disable-next-line no-console
    console.error('[Upload] error request-upload-url', {
      message: err?.message,
      stack: err?.stack,
    });
    return res.status(500).json({ message: 'Failed to generate upload URL' });
  }
};

/**
 * Confirm file upload and save metadata to MongoDB
 * POST /api/documents/confirm
 */
const confirmUpload = async (req, res) => {
  try {
    const { s3Key, originalName, mimeType, size } = req.body;

    // Only patients can confirm uploads
    if (req.user?.role !== 'patient') {
      // eslint-disable-next-line no-console
      console.warn('[Upload] blocked-non-patient-confirm', {
        userId: req.user?.id,
        role: req.user?.role,
        path: req.originalUrl || req.url,
      });
      return res.status(403).json({ message: 'Only patients can upload files' });
    }

    if (!s3Key || !originalName || !mimeType || !size) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    // Validate file size at confirmation as well (defense in depth) — 10MB limit
    if (size > 10 * 1024 * 1024) {
      // eslint-disable-next-line no-console
      console.warn('[Upload] file-too-large-confirm', { userId: req.user?.id, size });
      return res.status(400).json({ message: 'File size exceeds 10MB limit' });
    }

    // Enforce max documents per patient (10) at confirmation to avoid race condition
    const currentCount = await Document.countDocuments({ patientId: req.user.id });
    if (currentCount >= 10) {
      // eslint-disable-next-line no-console
      console.warn('[Upload] patient-doc-limit-reached-confirm', { userId: req.user?.id, currentCount });
      return res.status(400).json({ message: 'Maximum document limit reached (10) for this patient' });
    }

    // Log confirmation intent
    logger.info('Upload confirmation received', logger.withReq(req, {
      event: 'file-upload',
      phase: 'confirm-upload',
      s3Key,
      originalName,
      mimeType,
      size,
    }));
    // eslint-disable-next-line no-console
    console.log('[Upload] confirm-upload', {
      userId: req.user?.id,
      s3Key,
      originalName,
      mimeType,
      size,
    });

    // Create document record
    const document = await Document.create({
      patientId: req.user.id,
      originalName,
      mimeType,
      size,
      s3Key,
      s3Bucket: BUCKET_NAME,
    });

    logger.info('Upload confirmed and metadata saved', logger.withReq(req, {
      event: 'file-upload',
      phase: 'confirm-upload-success',
      s3Key,
      documentId: document._id.toString(),
      bucket: BUCKET_NAME,
    }));
    // eslint-disable-next-line no-console
    console.log('[Upload] confirm-upload-success', {
      userId: req.user?.id,
      s3Key,
      documentId: document._id?.toString(),
      bucket: BUCKET_NAME,
    });

    return res.status(201).json(formatDocument(document));
  } catch (err) {
    logger.error('Failed to confirm upload', logger.withReq(req, {
      event: 'file-upload',
      phase: 'confirm-upload',
      err,
    }));
    // eslint-disable-next-line no-console
    console.error('[Upload] error confirm-upload', {
      message: err?.message,
      stack: err?.stack,
    });
    return res.status(500).json({ message: 'Failed to confirm upload' });
  }
};

/**
 * List documents with proper access control
 * GET /api/documents
 */
const listDocuments = async (req, res) => {
  try {
    let query;

    if (req.user.role === 'admin') {
      // Admin sees all documents
      query = {};
    } else if (req.user.role === 'doctor') {
      // Doctor sees documents of their patients (patients they have appointments with)
      const appointments = await Appointment.find({ doctorId: req.user.id }).distinct('patientId');
      query = { 
        $or: [
          { patientId: { $in: appointments } },
          { doctorId: req.user.id }
        ]
      };
    } else {
      // Patient sees only their own documents
      query = { patientId: req.user.id };
    }

    const documents = await Document.find(query)
      .populate('patientId', 'name email')
      .populate('doctorId', 'name email')
      .sort({ createdAt: -1 })
      .limit(200);

    return res.json(documents.map(formatDocument));
  } catch (err) {
    console.error('[documentController] listDocuments error:', err);
    return res.status(500).json({ message: 'Failed to list documents' });
  }
};

/**
 * Get presigned download URL with permission check
 * GET /api/documents/:id/download
 */
const getDownloadUrl = async (req, res) => {
  try {
    const { id } = req.params;
    const document = await Document.findById(id);

    if (!document) {
      return res.status(404).json({ message: 'Document not found' });
    }

    // Permission check
    const canAccess = await checkDocumentAccess(req.user, document);
    if (!canAccess) {
      // eslint-disable-next-line no-console
      console.warn('[Download] access-denied', { userId: req.user?.id, role: req.user?.role, documentId: id });
      return res.status(403).json({ message: 'Access denied' });
    }

    // eslint-disable-next-line no-console
    console.log('[Download] request', {
      userId: req.user?.id,
      role: req.user?.role,
      documentId: id,
      s3Key: document.s3Key,
      path: req.originalUrl || req.url,
    });

    // Generate presigned download URL
    const downloadUrl = await getPresignedDownloadUrl(document.s3Key);

    // eslint-disable-next-line no-console
    console.log('[Download] url-generated', { userId: req.user?.id, documentId: id });

    return res.json({
      downloadUrl,
      originalName: document.originalName,
      expiresIn: 3600, // 1 hour
    });
  } catch (err) {
    console.error('[Download] error getDownloadUrl', { message: err?.message, stack: err?.stack });
    return res.status(500).json({ message: 'Failed to generate download URL' });
  }
};

/**
 * Delete document (patient can delete own files only)
 * DELETE /api/documents/:id
 */
const deleteDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const document = await Document.findById(id);

    if (!document) {
      return res.status(404).json({ message: 'Document not found' });
    }

    // Only patient who uploaded can delete (or admin)
    if (req.user.role !== 'admin' && document.patientId.toString() !== req.user.id) {
      // eslint-disable-next-line no-console
      console.warn('[Delete] access-denied', { userId: req.user?.id, role: req.user?.role, documentId: id });
      return res.status(403).json({ message: 'Only the patient who uploaded this file can delete it' });
    }

    // eslint-disable-next-line no-console
    console.log('[Delete] request', { userId: req.user?.id, documentId: id, s3Key: document.s3Key });

    // Delete from S3
    await deleteFromS3(document.s3Key);

    // Delete from MongoDB
    await Document.findByIdAndDelete(id);

    // eslint-disable-next-line no-console
    console.log('[Delete] success', { userId: req.user?.id, documentId: id });

    return res.json({ message: 'Document deleted successfully' });
  } catch (err) {
    console.error('[Delete] error deleteDocument', { message: err?.message, stack: err?.stack });
    return res.status(500).json({ message: 'Failed to delete document' });
  }
};

/**
 * Check if user has access to a document
 * @param {Object} user - Authenticated user
 * @param {Object} document - Document object
 * @returns {Promise<boolean>}
 */
const checkDocumentAccess = async (user, document) => {
  // Admin has access to all
  if (user.role === 'admin') {
    return true;
  }

  // Patient has access to their own documents
  if (user.role === 'patient' && document.patientId.toString() === user.id) {
    return true;
  }

  // Doctor has access if they have an appointment with the patient
  if (user.role === 'doctor') {
    const hasAppointment = await Appointment.findOne({
      doctorId: user.id,
      patientId: document.patientId,
    });
    return !!hasAppointment;
  }

  return false;
};

module.exports = {
  getUploadUrl,
  confirmUpload,
  listDocuments,
  getDownloadUrl,
  deleteDocument,
};

