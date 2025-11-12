const Document = require('../Models/Document');

const formatDocument = (doc, baseUrl = '') => ({
  id: doc._id,
  originalName: doc.originalName,
  mimeType: doc.mimeType,
  size: doc.size,
  url: `${baseUrl}/uploads/${doc.storagePath}`,
  createdAt: doc.createdAt,
});

const uploadDocument = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }

  try {
    const document = await Document.create({
      userId: req.user.id,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      storagePath: req.file.filename,
    });

    return res.status(201).json(formatDocument(document, process.env.BASE_URL || ''));
  } catch (err) {
    console.error('[documentController] upload error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

const listDocuments = async (req, res) => {
  const query = req.user.role === 'admin' ? {} : { userId: req.user.id };
  try {
    const documents = await Document.find(query)
      .sort({ createdAt: -1 })
      .limit(200);

    const baseUrl = process.env.BASE_URL || '';
    return res.json(documents.map((doc) => formatDocument(doc, baseUrl)));
  } catch (err) {
    console.error('[documentController] list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

module.exports = { uploadDocument, listDocuments };

