import type { NextFunction, Request, Response } from "express";
import multer from "multer";

const imageMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 4, fields: 12, fieldSize: 8192 },
  fileFilter: (_req, file, callback) => {
    if (!imageMimeTypes.has(file.mimetype)) {
      callback(new Error("Unsupported image file."));
      return;
    }
    callback(null, true);
  },
});

export const uploadComplaintPhotos = (req: Request, res: Response, next: NextFunction): void => {
  upload.array("photos", 4)(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400)
        .json({ error: "Choose up to 4 photos, each no larger than 5 MB." });
      return;
    }
    if (error) {
      res.status(400).json({ error: "Only supported image files can be attached." });
      return;
    }
    next();
  });
};
