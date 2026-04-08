-- Enable RLS (if not already)
ALTER TABLE palaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read palaces (no auth in this app)
CREATE POLICY "Allow public read access to palaces"
  ON palaces FOR SELECT
  TO anon
  USING (true);

-- Allow anyone to insert palaces (edge functions use service role, but just in case)
CREATE POLICY "Allow public insert to palaces"
  ON palaces FOR INSERT
  TO anon
  WITH CHECK (true);

-- Allow anyone to update palaces
CREATE POLICY "Allow public update to palaces"
  ON palaces FOR UPDATE
  TO anon
  USING (true);

-- Allow anyone to read/write conversations
CREATE POLICY "Allow public read conversations"
  ON conversations FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow public insert conversations"
  ON conversations FOR INSERT
  TO anon
  WITH CHECK (true);
