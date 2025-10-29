const customerNoteModel = require('../models/customerNoteModel');

/**
 * Récupère toutes les notes d'un client
 * GET /api/customers/:customerId/notes
 */
exports.getNotes = async (req, res) => {
  try {
    const { customerId } = req.params;
    const notes = await customerNoteModel.getByCustomerId(customerId);
    res.json({ success: true, data: notes });
  } catch (error) {
    console.error('Error getting customer notes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Crée une nouvelle note
 * POST /api/customers/:customerId/notes
 * Body: { note: string, created_by?: string }
 */
exports.createNote = async (req, res) => {
  try {
    const { customerId } = req.params;
    const { note, created_by } = req.body;

    if (!note || !note.trim()) {
      return res.status(400).json({ success: false, error: 'Note text is required' });
    }

    const newNote = await customerNoteModel.create(customerId, note, created_by);
    res.json({ success: true, data: newNote });
  } catch (error) {
    console.error('Error creating customer note:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Met à jour une note
 * PUT /api/customers/notes/:noteId
 * Body: { note: string }
 */
exports.updateNote = async (req, res) => {
  try {
    const { noteId } = req.params;
    const { note } = req.body;

    if (!note || !note.trim()) {
      return res.status(400).json({ success: false, error: 'Note text is required' });
    }

    const updatedNote = await customerNoteModel.update(noteId, note);

    if (!updatedNote) {
      return res.status(404).json({ success: false, error: 'Note not found' });
    }

    res.json({ success: true, data: updatedNote });
  } catch (error) {
    console.error('Error updating customer note:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Supprime une note
 * DELETE /api/customers/notes/:noteId
 */
exports.deleteNote = async (req, res) => {
  try {
    const { noteId } = req.params;
    const deletedNote = await customerNoteModel.delete(noteId);

    if (!deletedNote) {
      return res.status(404).json({ success: false, error: 'Note not found' });
    }

    res.json({ success: true, message: 'Note deleted successfully' });
  } catch (error) {
    console.error('Error deleting customer note:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
