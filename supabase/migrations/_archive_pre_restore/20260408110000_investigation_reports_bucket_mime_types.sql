-- Ensure investigation-reports accepts common raster inputs (client converts webp/heic/heif to JPEG before OCR when needed).
UPDATE storage.buckets
SET allowed_mime_types = (
  SELECT ARRAY(
    SELECT DISTINCT unnest(
      COALESCE(allowed_mime_types, ARRAY[]::text[])
        || ARRAY[
          'image/jpeg',
          'image/jpg',
          'image/png',
          'image/bmp',
          'image/gif',
          'image/tiff',
          'image/webp',
          'image/heic',
          'image/heif',
          'application/pdf'
        ]::text[]
    )
  )
)
WHERE name = 'investigation-reports';
