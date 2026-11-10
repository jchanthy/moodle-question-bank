-- =====================================================================
-- FIX: Row-Level Security (RLS) Violation on 'assignments' Table
-- =====================================================================
--
-- PROBLEM:
-- When an Admin assigns a teacher to review a question, the application throws:
--   "Error: new row violates row-level security policy for table 'assignments'"
--
-- CAUSE:
-- The 'assignments' table in Supabase has Row Level Security (RLS) enabled,
-- but lacks a permissive INSERT policy for authenticated users (admins/teachers),
-- or has a restrictive/outdated WITH CHECK expression.
--
-- HOW TO APPLY:
-- 1. Open your Supabase Dashboard (https://supabase.com/dashboard)
-- 2. Select your project: xtcvzevqbfvczhuwdisz
-- 3. Click "SQL Editor" in the left navigation sidebar
-- 4. Click "New query", paste this entire script, and click "Run" (or Ctrl+Enter)
-- =====================================================================

-- Ensure RLS is active
ALTER TABLE IF EXISTS assignments ENABLE ROW LEVEL SECURITY;

-- 1. Drop old/conflicting policies if they exist
DROP POLICY IF EXISTS "Allow authenticated select on assignments" ON assignments;
DROP POLICY IF EXISTS "assignments_select_policy" ON assignments;
DROP POLICY IF EXISTS "Teachers and admins can view assignments" ON assignments;
DROP POLICY IF EXISTS "Allow users to read assignments" ON assignments;
DROP POLICY IF EXISTS "allow_authenticated_select_assignments" ON assignments;

DROP POLICY IF EXISTS "Allow authenticated insert on assignments" ON assignments;
DROP POLICY IF EXISTS "assignments_insert_policy" ON assignments;
DROP POLICY IF EXISTS "Admins can insert assignments" ON assignments;
DROP POLICY IF EXISTS "Allow admins and teachers to insert assignments" ON assignments;
DROP POLICY IF EXISTS "teachers_and_admins_can_insert_assignments" ON assignments;
DROP POLICY IF EXISTS "allow_authenticated_insert_assignments" ON assignments;

DROP POLICY IF EXISTS "Allow authenticated update on assignments" ON assignments;
DROP POLICY IF EXISTS "assignments_update_policy" ON assignments;
DROP POLICY IF EXISTS "allow_authenticated_update_assignments" ON assignments;

DROP POLICY IF EXISTS "Allow authenticated delete on assignments" ON assignments;
DROP POLICY IF EXISTS "assignments_delete_policy" ON assignments;
DROP POLICY IF EXISTS "allow_authenticated_delete_assignments" ON assignments;

DROP POLICY IF EXISTS "assignments_all_policy" ON assignments;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON assignments;
DROP POLICY IF EXISTS "manage_assignments_policy" ON assignments;

-- 2. Create clean, complete policies for authenticated users

-- SELECT: Authenticated users (admins, teachers) can view assignments
CREATE POLICY "allow_authenticated_select_assignments"
ON assignments
FOR SELECT
TO authenticated
USING (true);

-- INSERT: Authenticated users (admins assigning reviewers) can insert new assignments
CREATE POLICY "allow_authenticated_insert_assignments"
ON assignments
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
);

-- UPDATE: Authenticated users (teachers completing reviews or admins updating status) can update assignments
CREATE POLICY "allow_authenticated_update_assignments"
ON assignments
FOR UPDATE
TO authenticated
USING (
  auth.uid() IS NOT NULL
)
WITH CHECK (
  auth.uid() IS NOT NULL
);

-- DELETE: Authenticated users (admins unassigning reviewers, or deleting question versions) can delete assignments
CREATE POLICY "allow_authenticated_delete_assignments"
ON assignments
FOR DELETE
TO authenticated
USING (
  auth.uid() IS NOT NULL
);

-- Verify policy status
SELECT tablename, policyname, cmd, qual, with_check 
FROM pg_policies 
WHERE tablename = 'assignments'
ORDER BY cmd, policyname;
