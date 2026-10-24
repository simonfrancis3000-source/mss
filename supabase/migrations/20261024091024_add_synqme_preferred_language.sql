ALTER TABLE public.synqme_profiles
ADD COLUMN IF NOT EXISTS preferred_language text NOT NULL DEFAULT 'en'
CHECK (preferred_language IN ('en', 'es', 'fr', 'it', 'pt', 'hi', 'ja', 'zh'));
