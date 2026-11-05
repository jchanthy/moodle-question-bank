-- =====================================================================
-- Migration: Pre-Test Rooms (shareable test URL + room code + passcode)
-- =====================================================================
-- Admins create a "room" that points to a subject (category) in the
-- Pre-Testing Pool. Students / teachers open  /test?room=CODE  without
-- logging in and (optionally) enter a passcode.
--
-- SECURITY NOTES
--  * Passcodes are stored ONLY as bcrypt hashes (pgcrypto crypt()).
--  * test_rooms is locked down by RLS; all public access goes through
--    SECURITY DEFINER RPCs that never return the hash.
--  * Wrong code / wrong passcode return the same generic error, and
--    failed passcode attempts are throttled per room.
--  * Participant names are PII, so the old "public select" policies on
--    test_sessions / test_responses are removed (RPCs are SECURITY
--    DEFINER and keep working).
--
-- HOW TO APPLY: Supabase Dashboard -> SQL Editor -> paste -> Run
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS test_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  subject_id UUID NOT NULL REFERENCES question_categories(id) ON DELETE CASCADE,
  passcode_hash TEXT NULL,
  audience TEXT NOT NULL DEFAULT 'any' CHECK (audience IN ('student', 'teacher', 'any')),
  question_limit INT NULL CHECK (question_limit IS NULL OR question_limit > 0),
  time_limit_minutes INT NULL CHECK (time_limit_minutes IS NULL OR time_limit_minutes > 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMP WITH TIME ZONE NULL,
  created_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS test_room_failures (
  id BIGSERIAL PRIMARY KEY,
  room_id UUID NOT NULL REFERENCES test_rooms(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_test_room_failures_room_time ON test_room_failures(room_id, created_at);

ALTER TABLE test_sessions
  ADD COLUMN IF NOT EXISTS room_id UUID NULL REFERENCES test_rooms(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS participant_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS participant_role TEXT NULL;
CREATE INDEX IF NOT EXISTS idx_test_sessions_room ON test_sessions(room_id);

-- ---------------------------------------------------------------------
-- 2. RLS: rooms are private (no direct table access from the client)
-- ---------------------------------------------------------------------
ALTER TABLE test_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_room_failures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public select test_sessions" ON test_sessions;
DROP POLICY IF EXISTS "Allow public update test_sessions" ON test_sessions;
DROP POLICY IF EXISTS "Allow public insert test_sessions" ON test_sessions;
DROP POLICY IF EXISTS "Allow public select test_responses" ON test_responses;
DROP POLICY IF EXISTS "Allow public insert test_responses" ON test_responses;

-- ---------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_test_room_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'super_admin')
  );
$$;

CREATE OR REPLACE FUNCTION generate_test_room_code()
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_code TEXT;
BEGIN
  LOOP
    -- Generate 6-digit numeric PIN (100000 to 999999)
    v_code := lpad(floor(100000 + random() * 900000)::text, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM test_rooms WHERE room_code = v_code);
  END LOOP;
  RETURN v_code;
END;
$$;

-- ---------------------------------------------------------------------
-- 4. Admin RPCs
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_test_room(
  p_title TEXT,
  p_subject_id UUID,
  p_passcode TEXT DEFAULT NULL,
  p_audience TEXT DEFAULT 'any',
  p_question_limit INT DEFAULT NULL,
  p_time_limit_minutes INT DEFAULT NULL,
  p_expires_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_code TEXT;
  v_id UUID;
  v_hash TEXT := NULL;
BEGIN
  IF NOT is_test_room_admin() THEN
    RAISE EXCEPTION 'Only administrators can create test rooms.';
  END IF;

  IF p_title IS NULL OR length(trim(p_title)) < 2 THEN
    RAISE EXCEPTION 'Room title is required.';
  END IF;

  IF p_audience NOT IN ('student', 'teacher', 'any') THEN
    RAISE EXCEPTION 'Invalid audience.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM question_categories WHERE id = p_subject_id) THEN
    RAISE EXCEPTION 'Subject not found.';
  END IF;

  IF p_passcode IS NOT NULL AND length(trim(p_passcode)) > 0 THEN
    IF length(trim(p_passcode)) < 4 THEN
      RAISE EXCEPTION 'Passcode must be at least 4 characters.';
    END IF;
    v_hash := crypt(trim(p_passcode), gen_salt('bf'));
  END IF;

  v_code := generate_test_room_code();

  INSERT INTO test_rooms (
    room_code, title, subject_id, passcode_hash, audience,
    question_limit, time_limit_minutes, expires_at, created_by
  )
  VALUES (
    v_code, trim(p_title), p_subject_id, v_hash, p_audience,
    p_question_limit, p_time_limit_minutes, p_expires_at, auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'room_code', v_code);
END;
$$;

CREATE OR REPLACE FUNCTION list_test_rooms()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT is_test_room_admin() THEN
    RAISE EXCEPTION 'Only administrators can view test rooms.';
  END IF;

  SELECT COALESCE(jsonb_agg(r_row ORDER BY (r_row->>'created_at') DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'id', r.id,
      'room_code', r.room_code,
      'title', r.title,
      'subject_id', r.subject_id,
      'subject_name', c.name,
      'has_passcode', r.passcode_hash IS NOT NULL,
      'audience', r.audience,
      'question_limit', r.question_limit,
      'time_limit_minutes', r.time_limit_minutes,
      'is_active', r.is_active,
      'expires_at', r.expires_at,
      'created_at', r.created_at,
      'attempts', (
        SELECT count(*) FROM test_sessions s
        WHERE s.room_id = r.id AND s.submitted_at IS NOT NULL
      ),
      'avg_percentage', (
        SELECT ROUND(AVG(s.score / NULLIF(s.total_questions, 0)) * 100, 1)
        FROM test_sessions s
        WHERE s.room_id = r.id AND s.submitted_at IS NOT NULL
      )
    ) AS r_row
    FROM test_rooms r
    LEFT JOIN question_categories c ON c.id = r.subject_id
  ) x;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION set_test_room_active(p_room_id UUID, p_active BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_test_room_admin() THEN
    RAISE EXCEPTION 'Only administrators can update test rooms.';
  END IF;
  UPDATE test_rooms SET is_active = p_active WHERE id = p_room_id;
END;
$$;

CREATE OR REPLACE FUNCTION set_test_room_passcode(p_room_id UUID, p_passcode TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash TEXT := NULL;
BEGIN
  IF NOT is_test_room_admin() THEN
    RAISE EXCEPTION 'Only administrators can update test rooms.';
  END IF;

  IF p_passcode IS NOT NULL AND length(trim(p_passcode)) > 0 THEN
    IF length(trim(p_passcode)) < 4 THEN
      RAISE EXCEPTION 'Passcode must be at least 4 characters.';
    END IF;
    v_hash := crypt(trim(p_passcode), gen_salt('bf'));
  END IF;

  UPDATE test_rooms SET passcode_hash = v_hash WHERE id = p_room_id;
  DELETE FROM test_room_failures WHERE room_id = p_room_id;
END;
$$;

CREATE OR REPLACE FUNCTION delete_test_room(p_room_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_test_room_admin() THEN
    RAISE EXCEPTION 'Only administrators can delete test rooms.';
  END IF;
  -- Sessions are kept for analysis (room_id becomes NULL via ON DELETE SET NULL)
  DELETE FROM test_rooms WHERE id = p_room_id;
END;
$$;

CREATE OR REPLACE FUNCTION get_test_room_results(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT is_test_room_admin() THEN
    RAISE EXCEPTION 'Only administrators can view room results.';
  END IF;

  SELECT COALESCE(jsonb_agg(s_row ORDER BY (s_row->>'submitted_at') DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'session_id', s.id,
      'participant_name', s.participant_name,
      'participant_role', s.participant_role,
      'score', s.score,
      'total_questions', s.total_questions,
      'percentage', ROUND(s.score / NULLIF(s.total_questions, 0) * 100, 1),
      'started_at', s.started_at,
      'submitted_at', s.submitted_at
    ) AS s_row
    FROM test_sessions s
    WHERE s.room_id = p_room_id AND s.submitted_at IS NOT NULL
  ) x;

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------
-- 5. Public RPCs (no login required)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_test_room_public(p_room_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room RECORD;
  v_available INT;
  v_status TEXT;
BEGIN
  SELECT r.*, c.name AS subject_name INTO v_room
  FROM test_rooms r
  LEFT JOIN question_categories c ON c.id = r.subject_id
  WHERE r.room_code = upper(trim(COALESCE(p_room_code, '')));

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF NOT v_room.is_active THEN
    v_status := 'closed';
  ELSIF v_room.expires_at IS NOT NULL AND v_room.expires_at < now() THEN
    v_status := 'expired';
  ELSE
    v_status := 'open';
  END IF;

  SELECT count(*) INTO v_available
  FROM questions
  WHERE category_id = v_room.subject_id
    AND status = 'testing'
    AND deleted_at IS NULL;

  RETURN jsonb_build_object(
    'room_code', v_room.room_code,
    'title', v_room.title,
    'subject_name', v_room.subject_name,
    'requires_passcode', v_room.passcode_hash IS NOT NULL,
    'audience', v_room.audience,
    'question_count', LEAST(v_available, COALESCE(v_room.question_limit, v_available)),
    'time_limit_minutes', v_room.time_limit_minutes,
    'status', v_status
  );
END;
$$;

-- Returns {ok:false, error:'...'} for expected failures (so failed-attempt
-- logging is not rolled back by an exception).
CREATE OR REPLACE FUNCTION start_room_test(
  p_room_code TEXT,
  p_passcode TEXT DEFAULT NULL,
  p_participant_name TEXT DEFAULT NULL,
  p_participant_role TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_room RECORD;
  v_name TEXT;
  v_role TEXT;
  v_session_id UUID;
  v_questions JSONB;
  v_count INT;
BEGIN
  SELECT * INTO v_room
  FROM test_rooms
  WHERE room_code = upper(trim(COALESCE(p_room_code, '')));

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid room code or passcode.');
  END IF;

  IF NOT v_room.is_active THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This test room is closed.');
  END IF;

  IF v_room.expires_at IS NOT NULL AND v_room.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This test room has expired.');
  END IF;

  -- Throttle brute-force passcode guessing (max 10 failures / 10 min / room)
  IF v_room.passcode_hash IS NOT NULL THEN
    IF (
      SELECT count(*) FROM test_room_failures
      WHERE room_id = v_room.id AND created_at > now() - interval '10 minutes'
    ) >= 10 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Too many incorrect attempts. Please wait a few minutes and try again.');
    END IF;

    IF p_passcode IS NULL OR crypt(trim(p_passcode), v_room.passcode_hash) <> v_room.passcode_hash THEN
      INSERT INTO test_room_failures (room_id) VALUES (v_room.id);
      DELETE FROM test_room_failures WHERE created_at < now() - interval '1 day';
      RETURN jsonb_build_object('ok', false, 'error', 'Invalid room code or passcode.');
    END IF;
  END IF;

  v_name := trim(COALESCE(p_participant_name, ''));
  IF length(v_name) < 2 OR length(v_name) > 80 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Please enter your name (2-80 characters).');
  END IF;

  IF v_room.audience = 'any' THEN
    v_role := CASE WHEN p_participant_role IN ('student', 'teacher') THEN p_participant_role ELSE NULL END;
    IF v_role IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Please choose whether you are a student or a teacher.');
    END IF;
  ELSE
    v_role := v_room.audience;
  END IF;

  SELECT jsonb_agg(q_row), count(*) INTO v_questions, v_count
  FROM (
    SELECT
      q.id,
      q.name,
      q.question_text,
      q.qtype,
      q.category_id,
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object('id', a.id, 'answer_text', a.answer_text)
            ORDER BY random()
          )
          FROM answers a
          WHERE a.question_id = q.id
        ),
        '[]'::jsonb
      ) AS options
    FROM questions q
    WHERE q.category_id = v_room.subject_id
      AND q.status = 'testing'
      AND q.deleted_at IS NULL
    ORDER BY random()
    LIMIT COALESCE(v_room.question_limit, 2147483647)
  ) q_row;

  IF v_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No questions are currently available for this room.');
  END IF;

  INSERT INTO test_sessions (
    subject_id, ip_address, started_at, total_questions,
    room_id, participant_name, participant_role
  )
  VALUES (
    v_room.subject_id, 'room-' || v_room.room_code, now(), v_count,
    v_room.id, v_name, v_role
  )
  RETURNING id INTO v_session_id;

  RETURN jsonb_build_object(
    'ok', true,
    'session_id', v_session_id,
    'subject_id', v_room.subject_id,
    'total_questions', v_count,
    'time_limit_minutes', v_room.time_limit_minutes,
    'questions', v_questions
  );
END;
$$;

-- ---------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION create_test_room(TEXT, UUID, TEXT, TEXT, INT, INT, TIMESTAMP WITH TIME ZONE) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION list_test_rooms() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION set_test_room_active(UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION set_test_room_passcode(UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION delete_test_room(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION get_test_room_results(UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION create_test_room(TEXT, UUID, TEXT, TEXT, INT, INT, TIMESTAMP WITH TIME ZONE) TO authenticated;
GRANT EXECUTE ON FUNCTION list_test_rooms() TO authenticated;
GRANT EXECUTE ON FUNCTION set_test_room_active(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION set_test_room_passcode(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_test_room(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_test_room_results(UUID) TO authenticated;

GRANT EXECUTE ON FUNCTION get_test_room_public(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION start_room_test(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
