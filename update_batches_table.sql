-- Add timing and centre columns to batches table
ALTER TABLE batches ADD COLUMN timing VARCHAR(255) AFTER description;
ALTER TABLE batches ADD COLUMN centre VARCHAR(255) AFTER timing;
