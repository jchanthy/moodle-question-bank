-- Migration: Question Pre-Testing & Quality Analysis Engine
-- 1. Update questions table: add testing status, attempts counters, psychometric metrics, last_tested_at
ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_status_check;

ALTER TABLE questions ADD CONSTRAINT questions_status_check 
  CHECK (status IN ('draft', 'testing', 'approved', 'rejected', 'pending_review', 'pending_teacher_review', 'teacher_approved', 'pending_admin_approval', 'published'));

ALTER TABLE questions 
  ADD COLUMN IF NOT EXISTS total_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS correct_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS difficulty_index DECIMAL(4,3) NULL,
  ADD COLUMN IF NOT EXISTS discrimination_index DECIMAL(4,3) NULL,
  ADD COLUMN IF NOT EXISTS last_tested_at TIMESTAMP WITH TIME ZONE NULL;

-- 2. Create test_sessions table
CREATE TABLE IF NOT EXISTS test_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID NOT NULL REFERENCES question_categories(id) ON DELETE CASCADE,
  ip_address TEXT,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  submitted_at TIMESTAMP WITH TIME ZONE NULL,
  score NUMERIC(5,2) DEFAULT 0,
  total_questions INT NOT NULL DEFAULT 0
);

-- 3. Create test_responses table
CREATE TABLE IF NOT EXISTS test_responses (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES test_sessions(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  selected_option_id UUID REFERENCES answers(id) ON DELETE SET NULL,
  is_correct BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_test_sessions_subject ON test_sessions(subject_id);
CREATE INDEX IF NOT EXISTS idx_test_responses_session ON test_responses(session_id);
CREATE INDEX IF NOT EXISTS idx_test_responses_question ON test_responses(question_id);
CREATE INDEX IF NOT EXISTS idx_questions_status ON questions(status);

-- 4. Enable RLS and Configure Anonymous / Public Access Policies
ALTER TABLE test_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public insert test_sessions" ON test_sessions;
DROP POLICY IF EXISTS "Allow public select test_sessions" ON test_sessions;
DROP POLICY IF EXISTS "Allow public update test_sessions" ON test_sessions;
DROP POLICY IF EXISTS "Allow public insert test_responses" ON test_responses;
DROP POLICY IF EXISTS "Allow public select test_responses" ON test_responses;
DROP POLICY IF EXISTS "Allow public select testing questions" ON questions;
DROP POLICY IF EXISTS "Allow public select testing answers" ON answers;
DROP POLICY IF EXISTS "Allow public select question_categories" ON question_categories;

CREATE POLICY "Allow public insert test_sessions" ON test_sessions
  FOR INSERT TO public WITH CHECK (true);

CREATE POLICY "Allow public select test_sessions" ON test_sessions
  FOR SELECT TO public USING (true);

CREATE POLICY "Allow public update test_sessions" ON test_sessions
  FOR UPDATE TO public USING (true) WITH CHECK (true);

CREATE POLICY "Allow public insert test_responses" ON test_responses
  FOR INSERT TO public WITH CHECK (true);

CREATE POLICY "Allow public select test_responses" ON test_responses
  FOR SELECT TO public USING (true);

CREATE POLICY "Allow public select question_categories" ON question_categories
  FOR SELECT TO public USING (true);

CREATE POLICY "Allow public select testing questions" ON questions
  FOR SELECT TO public USING (status = 'testing' AND deleted_at IS NULL);

CREATE POLICY "Allow public select testing answers" ON answers
  FOR SELECT TO public USING (
    EXISTS (
      SELECT 1 FROM questions q 
      WHERE q.id = answers.question_id 
      AND q.status = 'testing' 
      AND q.deleted_at IS NULL
    )
  );

-- 5. Stored Procedures: Item Analysis Calculation & Anonymous Test Runner
CREATE OR REPLACE FUNCTION recalculate_item_analysis(p_question_id UUID DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r_q RECORD;
  v_total_attempts INT;
  v_correct_attempts INT;
  v_p DECIMAL(4,3);
  v_d DECIMAL(4,3);
  v_n INT;
  v_k INT;
  v_top_correct INT;
  v_bot_correct INT;
  v_p_top NUMERIC;
  v_p_bot NUMERIC;
BEGIN
  FOR r_q IN 
    SELECT id, total_attempts, correct_attempts 
    FROM questions 
    WHERE (p_question_id IS NULL OR id = p_question_id)
      AND deleted_at IS NULL
  LOOP
    v_total_attempts := r_q.total_attempts;
    v_correct_attempts := r_q.correct_attempts;
    
    -- Difficulty Index p: correct_attempts / total_attempts
    IF v_total_attempts > 0 THEN
      v_p := ROUND((v_correct_attempts::numeric / v_total_attempts::numeric), 3);
    ELSE
      v_p := NULL;
    END IF;

    -- Discrimination Index D: p_top27% - p_bottom27%
    SELECT COUNT(*) INTO v_n
    FROM test_responses tr
    JOIN test_sessions ts ON tr.session_id = ts.id
    WHERE tr.question_id = r_q.id AND ts.submitted_at IS NOT NULL;

    IF v_n >= 4 THEN
      v_k := GREATEST(1, ROUND(v_n * 0.27)::INT);

      WITH ordered_responses AS (
        SELECT 
          tr.is_correct,
          ts.score,
          ROW_NUMBER() OVER (ORDER BY ts.score DESC, ts.submitted_at ASC) as rank_desc,
          ROW_NUMBER() OVER (ORDER BY ts.score ASC, ts.submitted_at ASC) as rank_asc
        FROM test_responses tr
        JOIN test_sessions ts ON tr.session_id = ts.id
        WHERE tr.question_id = r_q.id AND ts.submitted_at IS NOT NULL
      )
      SELECT 
        COALESCE(SUM(CASE WHEN rank_desc <= v_k AND is_correct THEN 1 ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN rank_asc <= v_k AND is_correct THEN 1 ELSE 0 END), 0)
      INTO v_top_correct, v_bot_correct
      FROM ordered_responses;

      v_p_top := v_top_correct::numeric / v_k::numeric;
      v_p_bot := v_bot_correct::numeric / v_k::numeric;
      v_d := ROUND((v_p_top - v_p_bot), 3);
    ELSE
      v_d := NULL;
    END IF;

    UPDATE questions
    SET 
      difficulty_index = v_p,
      discrimination_index = v_d
    WHERE id = r_q.id;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION get_active_testing_subjects()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_agg(sub) INTO v_result
  FROM (
    SELECT 
      qc.id,
      qc.name,
      qc.description,
      COUNT(q.id) AS testing_questions_count
    FROM question_categories qc
    JOIN questions q ON q.category_id = qc.id
    WHERE q.status = 'testing' AND q.deleted_at IS NULL
    GROUP BY qc.id, qc.name, qc.description
    HAVING COUNT(q.id) > 0
    ORDER BY qc.name ASC
  ) sub;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION start_candidate_test(
  p_subject_id UUID,
  p_ip_address TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session_id UUID;
  v_questions JSONB;
  v_count INT;
BEGIN
  SELECT count(*) INTO v_count
  FROM questions
  WHERE category_id = p_subject_id
    AND status = 'testing'
    AND deleted_at IS NULL;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'No questions currently available in the testing pool for this subject.';
  END IF;

  INSERT INTO test_sessions (subject_id, ip_address, started_at, total_questions)
  VALUES (p_subject_id, p_ip_address, now(), v_count)
  RETURNING id INTO v_session_id;

  SELECT jsonb_agg(q_row) INTO v_questions
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
            jsonb_build_object(
              'id', a.id,
              'answer_text', a.answer_text
            ) ORDER BY random()
          )
          FROM answers a
          WHERE a.question_id = q.id
        ),
        '[]'::jsonb
      ) AS options
    FROM questions q
    WHERE q.category_id = p_subject_id
      AND q.status = 'testing'
      AND q.deleted_at IS NULL
    ORDER BY random()
  ) q_row;

  RETURN jsonb_build_object(
    'session_id', v_session_id,
    'subject_id', p_subject_id,
    'total_questions', v_count,
    'questions', v_questions
  );
END;
$$;

CREATE OR REPLACE FUNCTION submit_candidate_test(
  p_session_id UUID,
  p_answers JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session RECORD;
  v_answer JSONB;
  v_question_id UUID;
  v_selected_option_id UUID;
  v_is_correct BOOLEAN;
  v_fraction NUMERIC;
  v_correct_count INT := 0;
  v_total_submitted INT := 0;
  v_results JSONB := '[]'::jsonb;
  v_score_pct NUMERIC(5,2);
  v_correct_option_id UUID;
  v_correct_answer_text TEXT;
  v_feedback TEXT;
BEGIN
  SELECT * INTO v_session
  FROM test_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Test session % not found.', p_session_id;
  END IF;

  IF v_session.submitted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Test session % has already been submitted.', p_session_id;
  END IF;

  FOR v_answer IN SELECT * FROM jsonb_array_elements(p_answers)
  LOOP
    v_question_id := (v_answer->>'question_id')::UUID;
    v_selected_option_id := CASE 
      WHEN v_answer->>'selected_option_id' IS NOT NULL AND v_answer->>'selected_option_id' <> '' 
      THEN (v_answer->>'selected_option_id')::UUID 
      ELSE NULL 
    END;

    v_is_correct := false;
    v_fraction := 0;
    v_feedback := NULL;
    
    IF v_selected_option_id IS NOT NULL THEN
      SELECT fraction, feedback INTO v_fraction, v_feedback
      FROM answers
      WHERE id = v_selected_option_id AND question_id = v_question_id;

      IF v_fraction IS NOT NULL AND v_fraction > 0 THEN
        v_is_correct := true;
      END IF;
    END IF;

    IF v_is_correct THEN
      v_correct_count := v_correct_count + 1;
    END IF;

    SELECT id, answer_text INTO v_correct_option_id, v_correct_answer_text
    FROM answers
    WHERE question_id = v_question_id AND fraction >= 100
    LIMIT 1;

    INSERT INTO test_responses (session_id, question_id, selected_option_id, is_correct, created_at)
    VALUES (p_session_id, v_question_id, v_selected_option_id, v_is_correct, now());

    UPDATE questions
    SET 
      total_attempts = total_attempts + 1,
      correct_attempts = correct_attempts + (CASE WHEN v_is_correct THEN 1 ELSE 0 END),
      last_tested_at = now()
    WHERE id = v_question_id;

    v_total_submitted := v_total_submitted + 1;

    v_results := v_results || jsonb_build_object(
      'question_id', v_question_id,
      'selected_option_id', v_selected_option_id,
      'is_correct', v_is_correct,
      'correct_option_id', v_correct_option_id,
      'correct_answer_text', v_correct_answer_text,
      'feedback', v_feedback
    );
  END LOOP;

  IF v_total_submitted > 0 THEN
    v_score_pct := ROUND((v_correct_count::numeric / v_total_submitted::numeric) * 100, 2);
  ELSE
    v_score_pct := 0;
  END IF;

  UPDATE test_sessions
  SET 
    submitted_at = now(),
    score = v_correct_count,
    total_questions = v_total_submitted
  WHERE id = p_session_id;

  PERFORM recalculate_item_analysis();

  RETURN jsonb_build_object(
    'session_id', p_session_id,
    'score', v_correct_count,
    'total_questions', v_total_submitted,
    'percentage', v_score_pct,
    'breakdown', v_results
  );
END;
$$;
