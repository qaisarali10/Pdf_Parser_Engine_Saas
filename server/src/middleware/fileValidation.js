import { hasExcelExtension } from "../utils/excel.js";

export function validateFileUpload(req, res, next) {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded." });
  }

  if (!hasExcelExtension(req.file.originalname)) {
    return res.status(400).json({ message: "Only Excel files (.xlsx) are supported." });
  }

  const maxSize = process.env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024;
  if (req.file.size > maxSize) {
    return res.status(400).json({ 
      message: `File too large. Maximum size is ${maxSize / 1024 / 1024}MB.` 
    });
  }

  const buffer = req.file.buffer;
  
  if (buffer.length < 4) {
    return res.status(400).json({ message: "Invalid file format." });
  }

  const excelSignatures = [
    Buffer.from([0x50, 0x4B, 0x03, 0x04]),
    Buffer.from([0x50, 0x4B, 0x05, 0x06]),
    Buffer.from([0x50, 0x4B, 0x07, 0x08])
  ];

  const isValidExcel = excelSignatures.some(sig => 
    buffer.subarray(0, sig.length).equals(sig)
  );

  if (!isValidExcel) {
    return res.status(400).json({ message: "Invalid Excel file format." });
  }

  next();
}