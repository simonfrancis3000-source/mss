-- Cross-user shared knowledge must contain only reviewed, generalised lessons.
-- Raw conversation transcripts and user IDs are not stored in the shared library.
ALTER TABLE public.synqme_profiles
  ADD COLUMN IF NOT EXISTS share_anonymized_learning boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS share_learning_consent_at timestamptz;

CREATE TABLE IF NOT EXISTS public.synqme_shared_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL CHECK (category IN (
    'kitchen', 'bathroom', 'vacuuming', 'surface_cleaning', 'cleaning_supplies',
    'laundry', 'bedroom', 'living_room', 'pets', 'plants', 'food_and_meals',
    'guests', 'privacy_and_boundaries', 'scheduling', 'safety_and_access',
    'waste_and_recycling', 'general_household'
  )),
  prompt_pattern text NOT NULL CHECK (char_length(btrim(prompt_pattern)) BETWEEN 8 AND 240),
  answer_pattern text NOT NULL CHECK (char_length(btrim(answer_pattern)) BETWEEN 8 AND 700),
  general_principle text NOT NULL CHECK (char_length(btrim(general_principle)) BETWEEN 8 AND 500),
  context_tags text[] NOT NULL DEFAULT '{}',
  key_terms text[] NOT NULL DEFAULT '{}',
  applicability jsonb NOT NULL DEFAULT '{}'::jsonb,
  limitations text[] NOT NULL DEFAULT '{}',
  quality_score numeric(4,3) NOT NULL DEFAULT 0 CHECK (quality_score BETWEEN 0 AND 1),
  evidence_count integer NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
  source_type text NOT NULL DEFAULT 'community_derived'
    CHECK (source_type IN ('curated_seed', 'community_derived')),
  status text NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review', 'approved', 'rejected', 'retired')),
  fingerprint text NOT NULL UNIQUE,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS synqme_shared_knowledge_context_tags_gin
  ON public.synqme_shared_knowledge USING gin (context_tags);
CREATE INDEX IF NOT EXISTS synqme_shared_knowledge_key_terms_gin
  ON public.synqme_shared_knowledge USING gin (key_terms);
CREATE INDEX IF NOT EXISTS synqme_shared_knowledge_status_quality_idx
  ON public.synqme_shared_knowledge (status, quality_score DESC, evidence_count DESC);

ALTER TABLE public.synqme_shared_knowledge ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.synqme_shared_knowledge TO authenticated;

DROP POLICY IF EXISTS "Signed-in users can read approved shared knowledge" ON public.synqme_shared_knowledge;
CREATE POLICY "Signed-in users can read approved shared knowledge"
  ON public.synqme_shared_knowledge
  FOR SELECT TO authenticated
  USING (status = 'approved');

-- User-specific submissions are an isolated moderation queue, never a shared library.
CREATE TABLE IF NOT EXISTS public.synqme_knowledge_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN (
    'kitchen', 'bathroom', 'vacuuming', 'surface_cleaning', 'cleaning_supplies',
    'laundry', 'bedroom', 'living_room', 'pets', 'plants', 'food_and_meals',
    'guests', 'privacy_and_boundaries', 'scheduling', 'safety_and_access',
    'waste_and_recycling', 'general_household'
  )),
  prompt_pattern text NOT NULL CHECK (char_length(btrim(prompt_pattern)) BETWEEN 8 AND 240),
  answer_pattern text NOT NULL CHECK (char_length(btrim(answer_pattern)) BETWEEN 8 AND 700),
  general_principle text NOT NULL CHECK (char_length(btrim(general_principle)) BETWEEN 8 AND 500),
  context_tags text[] NOT NULL DEFAULT '{}',
  key_terms text[] NOT NULL DEFAULT '{}',
  applicability jsonb NOT NULL DEFAULT '{}'::jsonb,
  limitations text[] NOT NULL DEFAULT '{}',
  fingerprint text NOT NULL,
  redaction_version text NOT NULL DEFAULT 'v1',
  consent_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review', 'promoted', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS synqme_knowledge_candidates_status_created_idx
  ON public.synqme_knowledge_candidates (status, created_at DESC);
CREATE INDEX IF NOT EXISTS synqme_knowledge_candidates_context_tags_gin
  ON public.synqme_knowledge_candidates USING gin (context_tags);

ALTER TABLE public.synqme_knowledge_candidates ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.synqme_knowledge_candidates TO authenticated;

DROP POLICY IF EXISTS "Users can view their own knowledge candidates" ON public.synqme_knowledge_candidates;
CREATE POLICY "Users can view their own knowledge candidates"
  ON public.synqme_knowledge_candidates
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Consented users can insert pending knowledge candidates" ON public.synqme_knowledge_candidates;
CREATE POLICY "Consented users can insert pending knowledge candidates"
  ON public.synqme_knowledge_candidates
  FOR INSERT TO authenticated
  WITH CHECK (
    (select auth.uid()) = user_id
    AND status = 'pending_review'
    AND EXISTS (
      SELECT 1
      FROM public.synqme_profiles AS p
      WHERE p.user_id = (select auth.uid())
        AND p.share_anonymized_learning IS TRUE
        AND p.share_learning_consent_at = consent_at
    )
  );

DROP POLICY IF EXISTS "Users can delete their own knowledge candidates" ON public.synqme_knowledge_candidates;
CREATE POLICY "Users can delete their own knowledge candidates"
  ON public.synqme_knowledge_candidates
  FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id AND status = 'pending_review');

-- Curated starter knowledge: reviewed, generic principles that are not attributed to a user.
INSERT INTO public.synqme_shared_knowledge
  (category, prompt_pattern, answer_pattern, general_principle, context_tags, key_terms,
   applicability, limitations, quality_score, evidence_count, source_type, status, fingerprint)
VALUES
  (
    'privacy_and_boundaries',
    'What should happen when a household item has no clearly known storage place?',
    'Leave the item where it is and ask the user before moving or discarding it.',
    'Uncertainty about ownership or intended storage should reduce autonomy for actions that could misplace or discard personal belongings.',
    ARRAY['privacy_and_boundaries','safety_and_access'],
    ARRAY['unknown item','storage','move','discard','permission','belongings'],
    '{"rule":"ask_before_moving_or_discarding_unknown_items"}'::jsonb,
    ARRAY['Does not apply when the user has explicitly authorised a defined, reversible storage routine.'],
    0.98, 0, 'curated_seed', 'approved',
    'seed-unknown-items-v1'
  ),
  (
    'cleaning_supplies',
    'Can a household assistant choose any cleaning product that is available?',
    'Use a product the user has approved for the surface; ask if either the product or material compatibility is unknown.',
    'Do not infer that a general cleaning request authorises unapproved products or risky product-surface combinations.',
    ARRAY['cleaning_supplies','kitchen','bathroom','surface_cleaning','safety_and_access'],
    ARRAY['cleaner','detergent','surface','material','approved product','compatibility'],
    '{"rule":"match_approved_product_to_surface"}'::jsonb,
    ARRAY['Product instructions and the surface manufacturer’s care guidance take precedence.'],
    0.97, 0, 'curated_seed', 'approved',
    'seed-cleaning-products-v1'
  ),
  (
    'vacuuming',
    'What should be considered before vacuuming a room?',
    'Respect stated floor-care rules and avoid cables, small loose objects, and protected items; ask before moving objects if permission is unclear.',
    'Task completion should not override explicit object-protection rules or create avoidable trip, entanglement, or damage risks.',
    ARRAY['vacuuming','living_room','bedroom','safety_and_access','privacy_and_boundaries'],
    ARRAY['vacuum','hoover','floor','rug','cable','cord','loose object','protected item'],
    '{"rule":"check_floor_and_obstacles_before_vacuuming"}'::jsonb,
    ARRAY['Do not claim sensing or obstacle avoidance unless the target robot capability is verified.'],
    0.96, 0, 'curated_seed', 'approved',
    'seed-vacuum-obstacles-v1'
  ),
  (
    'scheduling',
    'How should the timing of a recurring household task be set?',
    'Ask for preferred frequency and timing, then check for context-specific exceptions such as meals, rest, guests, or a user-set quiet period.',
    'A routine should have a normal schedule and explicit exceptions rather than treating frequency as permission to interrupt any activity.',
    ARRAY['scheduling','kitchen','guests','privacy_and_boundaries'],
    ARRAY['schedule','frequency','morning','evening','quiet hours','guests','meals'],
    '{"rule":"normal_schedule_plus_exceptions"}'::jsonb,
    ARRAY['Do not assume calendar, presence, or environment sensing is available.'],
    0.95, 0, 'curated_seed', 'approved',
    'seed-recurring-schedule-v1'
  ),
  (
    'pets',
    'How should a household routine account for pets?',
    'Ask which pet-related areas, feeding items, rest spaces, and routines must be left undisturbed before proposing a task sequence.',
    'A household task may need to be adapted around animal access and protected items; do not assume a robot can safely interpret an animal’s behaviour.',
    ARRAY['pets','kitchen','living_room','safety_and_access'],
    ARRAY['pet','dog','cat','food bowl','water bowl','pet bed','feeding routine'],
    '{"rule":"identify_pet_related_boundaries_before_task_planning"}'::jsonb,
    ARRAY['This is a planning prompt, not veterinary guidance or proof of animal-safe robot capabilities.'],
    0.94, 0, 'curated_seed', 'approved',
    'seed-pet-boundaries-v1'
  )
ON CONFLICT (fingerprint) DO NOTHING;
