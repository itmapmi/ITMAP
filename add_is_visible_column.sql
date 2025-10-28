-- SQL Script to Add isVisible Column to Markets Table
-- Run this in your production database console

-- Add the isVisible column with a default value of true
ALTER TABLE markets 
ADD COLUMN IF NOT EXISTS is_visible BOOLEAN NOT NULL DEFAULT true;

-- Verify the column was added
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'markets' AND column_name = 'is_visible';
