# Implementation Plan - Clear and Seed Database

This plan outlines the steps to purge all current test questions, answers, assignments, notifications, and categories, and populate the database with a clean, fully-functioning dataset that perfectly aligns with our dashboard workflows (Admin, Teacher, and Assistant Teacher).

## User Review Required

> [!IMPORTANT]
> The database reset will permanently delete all existing questions, answers, categories, assignments, and notifications in the database.
> The existing user auth accounts and profiles (`admin@mail.com`, `teacher@mail.com`, `teacher2@mail.com`, `user1@mail.com`) will **NOT** be deleted, as they are part of Supabase Auth, but all their created questions and relationships will be clean and fresh.

## Proposed Changes

We will create a Node.js script `scratch/reset_and_seed_db.js` using the Supabase JavaScript SDK. We will execute the script using Node.js after authenticating as `admin@mail.com` to ensure full permission to write and delete.

### [NEW] [reset_and_seed_db.js](file:///c:/Users/chant/OneDrive%20-%20Cambodia%20Academy%20of%20Digital%20Technology/@projects/@IDG/moodle-question-bank/scratch/reset_and_seed_db.js)

The script will follow this logical flow:
1. **Authenticate**: Log in as `admin@mail.com` using the password `admin123`.
2. **Clear Data**: Delete records in the correct order to satisfy foreign key constraints:
   - `notifications`
   - `assignments`
   - `answers`
   - `questions` (with child questions of version > 1 first, then version = 1 parent questions)
   - `question_categories`
3. **Seed Categories**:
   - Global categories: "General Mathematics", "Software Engineering"
   - User-specific categories
4. **Seed Question Families**:
   - **Assistant Teacher (teacher2@mail.com) Private Drafts**:
     - 1 MCQ Draft: "What is the capital of Cambodia?" (v1, draft)
     - 1 True/False Draft: "HTML stands for HyperText Markup Language." (v1, draft)
   - **Assistant Teacher Peer-Submissions (Pending Teacher Review)**:
     - 1 Numerical Question: "Solve for x: 2x + 5 = 15" (v1, pending_teacher_review, assigned to teacher@mail.com)
     - 1 Essay Question: "Explain the difference between SQL and NoSQL databases." (v1, pending_teacher_review, assigned to teacher@mail.com)
   - **Teacher (teacher@mail.com) Pending Admin Review**:
     - 1 MCQ Question: "Which of the following is a primary color?" (v1, pending_review)
     - 1 True/False Question: "JavaScript is a statically-typed language." (v1, pending_review)
   - **Approved / Active Questions**:
     - 1 Numerical Question: "What is 5 + 7?" (v1, approved)
     - 1 MCQ with Version History: "Define Polymorphism." (v1 approved, v2 approved, parent-child relation intact)
   - **Archived (Soft Deleted) Questions**:
     - 1 MCQ Question: "Outdated draft question." (v1, status='draft', soft-deleted `deleted_at = now`)
     - 1 True/False Question: "Outdated approved question." (v1, status='approved', soft-deleted `deleted_at = now`)
5. **Seed Assignments & Notifications**:
   - Assign appropriate review tasks.
   - Insert unread and read notifications for `teacher@mail.com` and `teacher2@mail.com` to test notification counters and colors immediately.

## Verification Plan

### Automated/Scripted Verification
- Run `node scratch/reset_and_seed_db.js` in the terminal.
- Verify that the console log outputs success for all deletion and insertion operations.
- Run `node scratch/verify_dashboard_queries.js` to ensure the dashboard queries match the seeded records.

### Manual Verification
- Log in to the Moodler Question Bank application as `teacher@mail.com`, `teacher2@mail.com`, and `admin@mail.com`.
- Confirm that each dashboard displays the perfect matching list of questions, assignments, and notifications with zero errors.
