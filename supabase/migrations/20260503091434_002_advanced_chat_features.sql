/*
  # Advanced Chat Features - Schema Update

  1. New Tables
    - `admin_messages`
      - `id` (uuid, primary key)
      - `original_message_id` (uuid, references messages.id) - link to user-side message
      - `chat_id` (uuid, references chats)
      - `sender_id` (uuid, references profiles)
      - `content` (text, nullable)
      - `message_type` (text) - 'text', 'image', 'video', 'audio'
      - `media_url` (text, nullable)
      - `created_at` (timestamptz)
      - `admin_seen_at` (timestamptz, nullable) - when admin first viewed this message
      - `delete_after` (timestamptz, nullable) - admin_seen_at + 24h, used for auto-delete
      - `is_deleted_by_user` (boolean, default false) - true if user deleted from messages table

  2. Modified Tables
    - `messages`
      - Add `is_deleted` (boolean, default false) - soft delete for user side
      - Add `deleted_at` (timestamptz, nullable)

    - `profiles`
      - Add `push_token` (text, nullable) - for future FCM/push notifications
      - Add `notifications_enabled` (boolean, default true)

  3. Security
    - Enable RLS on admin_messages
    - Only admins can read/write admin_messages
    - Users cannot access admin_messages at all

  4. Triggers
    - On INSERT into messages: auto-insert into admin_messages (dual-write)
    - On UPDATE messages.is_deleted: sync is_deleted_by_user to admin_messages

  5. Indexes
    - admin_messages by delete_after for efficient cleanup queries
    - admin_messages by chat_id for admin browsing
*/

-- ============================================
-- ADD COLUMNS TO MESSAGES TABLE
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'messages' AND column_name = 'is_deleted'
  ) THEN
    ALTER TABLE messages ADD COLUMN is_deleted boolean DEFAULT false;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'messages' AND column_name = 'deleted_at'
  ) THEN
    ALTER TABLE messages ADD COLUMN deleted_at timestamptz;
  END IF;
END $$;

-- ============================================
-- ADD NOTIFICATION COLUMNS TO PROFILES
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'push_token'
  ) THEN
    ALTER TABLE profiles ADD COLUMN push_token text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'notifications_enabled'
  ) THEN
    ALTER TABLE profiles ADD COLUMN notifications_enabled boolean DEFAULT true;
  END IF;
END $$;

-- ============================================
-- ADMIN_MESSAGES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS admin_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content text,
  message_type text NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'video', 'audio')),
  media_url text,
  created_at timestamptz DEFAULT now(),
  admin_seen_at timestamptz,
  delete_after timestamptz,
  is_deleted_by_user boolean DEFAULT false
);

ALTER TABLE admin_messages ENABLE ROW LEVEL SECURITY;

-- Only admins can read admin_messages
CREATE POLICY "Admins can read admin_messages"
  ON admin_messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Only system (via trigger/function) and admins can insert
CREATE POLICY "Admins can insert admin_messages"
  ON admin_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Only admins can update admin_messages (for marking seen)
CREATE POLICY "Admins can update admin_messages"
  ON admin_messages FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Only admins can delete admin_messages (for cleanup)
CREATE POLICY "Admins can delete admin_messages"
  ON admin_messages FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE INDEX idx_admin_messages_delete_after ON admin_messages(delete_after) WHERE delete_after IS NOT NULL;
CREATE INDEX idx_admin_messages_chat_id ON admin_messages(chat_id, created_at);
CREATE INDEX idx_admin_messages_original_id ON admin_messages(original_message_id);

-- ============================================
-- TRIGGER: Dual-write - copy every message to admin_messages
-- ============================================
CREATE OR REPLACE FUNCTION dual_write_to_admin_messages()
RETURNS trigger AS $$
BEGIN
  INSERT INTO admin_messages (original_message_id, chat_id, sender_id, content, message_type, media_url, created_at)
  VALUES (NEW.id, NEW.chat_id, NEW.sender_id, NEW.content, NEW.message_type, NEW.media_url, NEW.created_at);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS dual_write_message ON messages;
CREATE TRIGGER dual_write_message
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION dual_write_to_admin_messages();

-- ============================================
-- TRIGGER: Sync user deletion to admin_messages
-- ============================================
CREATE OR REPLACE FUNCTION sync_user_delete_to_admin()
RETURNS trigger AS $$
BEGIN
  IF NEW.is_deleted = true AND (OLD.is_deleted = false OR OLD.is_deleted IS NULL) THEN
    UPDATE admin_messages
    SET is_deleted_by_user = true
    WHERE original_message_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS sync_message_delete ON messages;
CREATE TRIGGER sync_message_delete
  AFTER UPDATE ON messages
  FOR EACH ROW
  WHEN (NEW.is_deleted = true AND (OLD.is_deleted = false OR OLD.is_deleted IS NULL))
  EXECUTE FUNCTION sync_user_delete_to_admin();

-- ============================================
-- FUNCTION: Mark admin as seen + set delete_after = seen + 24h
-- ============================================
CREATE OR REPLACE FUNCTION mark_admin_messages_seen(p_chat_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE admin_messages
  SET
    admin_seen_at = now(),
    delete_after = now() + interval '24 hours'
  WHERE chat_id = p_chat_id
    AND admin_seen_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- FUNCTION: Cleanup expired admin_messages (called by edge function)
-- ============================================
CREATE OR REPLACE FUNCTION cleanup_expired_admin_messages()
RETURNS integer AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM admin_messages
  WHERE delete_after IS NOT NULL AND delete_after < now();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
