const express = require('express');
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const ejs = require('ejs');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config()
// Initialize Express App
const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB connection
const uri = process.env.MONGODB_URI;
mongoose.set('strictQuery', true); // Optional: Suppress deprecation warnings for strictQuery
mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => console.error('Failed to connect to MongoDB:', err));

const pdfSchema = new mongoose.Schema({
  pdfData: Buffer, // Store PDF as binary data
  createdAt: { type: Date, default: Date.now },
});

const PDFModel = mongoose.model('PDF', pdfSchema);

// Enable CORS
app.use(cors({
  origin: 'https://doc-ment-hmtt.vercel.app/', // Replace with your frontend origin
  methods: ['GET', 'POST'],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('generated'));

// Endpoint for handling PDF generation
app.post('/generate-pdf', async (req, res) => {
  try {
    console.log('Request received at /generate-pdf');

    // Extract form fields
    const inputData = req.body;
    console.log('Form Data:', inputData);

    // Validate required fields
    const requiredFields = [
      'executionDay', 'executionMonth', 'executionPlace', 'sellerName', 'sellerFatherName', 'sellerAddress', 'sellerAadhaar',
      'buyerName', 'buyerFatherName', 'buyerAddress', 'buyerAadhaar', 'deviceModel', 'serialNumber', 'deviceColor',
      'storageCapacity', 'salePriceInWords', 'salePriceInFigures', 'paymentMode', 'bankName', 'accountHolderName',
      'accountNumber', 'ifscCode', 'accessoriesList', 'documentsList'
    ];

    for (const field of requiredFields) {
      if (!inputData[field]) {
        console.error(`Missing required field: ${field}`);
        return res.status(400).json({ success: false, error: `Missing required field: ${field}` });
      }
    }

    // Render the EJS template with the input data
    const templatePath = path.join(__dirname, 'templates', 'sale_deed_template.ejs');
    const filledTemplate = await ejs.renderFile(templatePath, inputData);

    // Replace non-encodable characters
    const sanitizedTemplate = filledTemplate.replace(/\t/g, ' ');

    // Create a new PDF document
    const pdfDoc = await PDFDocument.create();

    // Embed a font
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // Page settings
    const pageWidth = 600;
    const pageHeight = 800;
    const margin = 50;
    const fontSize = 12;
    const lineHeight = fontSize * 1.5;

    let page = pdfDoc.addPage([pageWidth, pageHeight]);
    let yPosition = pageHeight - margin;
    

    // Add a logo image
    const logoPath = path.join(__dirname, 'assets', 'logo.png'); // Ensure you have a 'logo.png' in the 'assets' folder
    const logoBytes = fs.readFileSync(logoPath);
    const logoImage = await pdfDoc.embedPng(logoBytes); // Use embedJpg if the logo is a JPG
    const logoDims = logoImage.scale(0.3); // Scale the logo to fit

    // Draw the logo at the top of the page
    page.drawImage(logoImage, {
      x: 50, // Adjust X position
      y: yPosition - logoDims.height, // Adjust Y position
      width: logoDims.width,
      height: logoDims.height,
    });

    yPosition -= logoDims.height + 20; // Adjust position after drawing the logo
    // Helper function for line wrapping
    const wrapText = (text, maxWidth) => {
      const words = text.split(' ');
      const lines = [];
      let currentLine = words[0];

      for (let i = 1; i < words.length; i++) {
        const word = words[i];
        const width = font.widthOfTextAtSize(`${currentLine} ${word}`, fontSize);
        if (width < maxWidth) {
          currentLine += ` ${word}`;
        } else {
          lines.push(currentLine);
          currentLine = word;
        }
      }
      lines.push(currentLine);
      return lines;
    };

    // Process text content and wrap lines
    const lines = sanitizedTemplate.split('\n').filter(line => line.trim() !== '');
    for (const line of lines) {
      const wrappedLines = wrapText(line, pageWidth - 2 * margin);
      for (const wrappedLine of wrappedLines) {
        if (yPosition < margin + lineHeight) {
          // Add a new page if space is not sufficient
          page = pdfDoc.addPage([pageWidth, pageHeight]);
          yPosition = pageHeight - margin;
        }
        page.drawText(wrappedLine, { x: margin, y: yPosition, size: fontSize, font });
        yPosition -= lineHeight;
      }
    }

    // Save the PDF as bytes
    const pdfBytes = await pdfDoc.save();

    // Convert Uint8Array to Buffer and save to MongoDB
    const newPDF = new PDFModel({ pdfData: Buffer.from(pdfBytes) });
    const savedPDF = await newPDF.save();

    console.log('PDF saved to MongoDB with ID:', savedPDF._id);

    // Return the document ID as a response
    res.json({ success: true, documentId: savedPDF._id });
  } catch (error) {
    console.error('Error during PDF generation:', error.message);
    res.status(500).json({ success: false, error: 'Failed to generate PDF' });
  }
});

// GET endpoint to download a PDF by ID
app.get('/download-pdf/:id', async (req, res) => {
    try {
      const pdfId = req.params.id; // Get the document ID from the request URL
      console.log('Fetching PDF with ID:', pdfId);
  
      // Validate the MongoDB ID
      if (!mongoose.Types.ObjectId.isValid(pdfId)) {
        console.error('Invalid PDF ID');
        return res.status(400).json({ success: false, error: 'Invalid PDF ID' });
      }
  
      // Fetch the document from MongoDB
      const pdfDocument = await PDFModel.findById(pdfId);
  
      if (!pdfDocument) {
        console.error('PDF not found');
        return res.status(404).json({ success: false, error: 'PDF not found' });
      }
  
      // Set headers for file download
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="downloaded_pdf_${pdfId}.pdf"`);
  
      // Send the PDF data as the response
      res.send(pdfDocument.pdfData);
    } catch (error) {
      console.error('Error during PDF retrieval:', error.message);
      res.status(500).json({ success: false, error: 'Failed to retrieve PDF' });
    }
  });
  

// Start the server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});
