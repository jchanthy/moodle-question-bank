-- =====================================================================
-- FIX: Allow Teachers and Admins to UPDATE questions and answers
-- =====================================================================
--
-- PROBLEM:
-- 1. The 'answers' table has NO update policy for teachers/admins,
--    causing all choice updates to silently fail with 0 rows affected.
-- 2. The 'questions' table only permits updates where created_by = auth.uid(),
--    preventing teachers from updating questions assigned to them or
--    submitted by assistants for review.
--
-- HOW TO APPLY:
-- 1. Open Supabase Dashboard -> SQL Editor
-- 2. Paste this script and click "Run"
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. FIX ANSWERS TABLE UPDATE POLICY
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "teachers_and_admins_can_update_answers" ON answers;
DROP POLICY IF EXISTS "teachers_can_update_answers" ON answers;
DROP POLICY IF EXISTS "Enable update for answers" ON answers;

CREATE POLICY "teachers_and_admins_can_update_answers"
ON answers
FOR UPDATE
TO authenticated
USING (
  -- Can update answer if user is admin, teacher, or created the parent question
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'teacher')
  )
  OR EXISTS (
    SELECT 1 FROM questions q
    WHERE q.id = answers.question_id AND q.created_by = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'teacher')
  )
  OR EXISTS (
    SELECT 1 FROM questions q
    WHERE q.id = answers.question_id AND q.created_by = auth.uid()
  )
);

-- Also ensure INSERT and DELETE policies on answers are solid
DROP POLICY IF EXISTS "teachers_and_admins_can_insert_answers" ON answers;
CREATE POLICY "teachers_and_admins_can_insert_answers"
ON answers
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'teacher', 'assistant_teacher')
  )
  OR EXISTS (
    SELECT 1 FROM questions q
    WHERE q.id = answers.question_id AND q.created_by = auth.uid()
  )
);

DROP POLICY IF EXISTS "teachers_and_admins_can_delete_answers" ON answers;
CREATE POLICY "teachers_and_admins_can_delete_answers"
ON answers
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'teacher', 'assistant_teacher')
  )
  OR EXISTS (
    SELECT 1 FROM questions q
    WHERE q.id = answers.question_id AND q.created_by = auth.uid()
  )
);


-- ---------------------------------------------------------------------
-- 2. FIX QUESTIONS TABLE UPDATE POLICY
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "teachers_can_update_own_questions" ON questions;
DROP POLICY IF EXISTS "teachers_and_admins_can_update_questions" ON questions;

CREATE POLICY "teachers_and_admins_can_update_questions"
ON questions
FOR UPDATE
TO authenticated
USING (
  -- User owns the question, OR user has teacher/admin role
  created_by = auth.uid()
  OR EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'teacher')
  )
)
WITH CHECK (
  created_by = auth.uid()
  OR EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'teacher')
  )
);
