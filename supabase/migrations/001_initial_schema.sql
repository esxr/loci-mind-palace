-- Palace storage (concept graph + generated config)
CREATE TABLE palaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL DEFAULT 'Untitled Palace',
    concept_graph JSONB NOT NULL,        -- ConceptGraph JSON
    palace_config JSONB,                 -- PalaceConfig JSON (null while generating)
    theme_id TEXT NOT NULL,
    seed INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'generating',  -- generating | ready | error
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    generation_time_ms INTEGER
);

CREATE INDEX idx_palaces_status ON palaces(status);
CREATE INDEX idx_palaces_created ON palaces(created_at DESC);

-- Conversation history for NPC chats
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    palace_id UUID NOT NULL REFERENCES palaces(id) ON DELETE CASCADE,
    concept_id TEXT NOT NULL,
    messages JSONB NOT NULL DEFAULT '[]'::jsonb,  -- Array of {role, content} objects
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversations_palace ON conversations(palace_id);
CREATE UNIQUE INDEX idx_conversations_unique ON conversations(palace_id, concept_id);

-- Supabase Storage bucket for 3D model files
-- Created via Supabase dashboard or CLI:
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('artifacts', 'artifacts', true);

-- Public access policy (no auth required)
-- CREATE POLICY "Public artifact access"
-- ON storage.objects FOR SELECT
-- USING (bucket_id = 'artifacts');

-- CREATE POLICY "Service role artifact upload"
-- ON storage.objects FOR INSERT
-- WITH CHECK (bucket_id = 'artifacts');
