import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: 'auth', loadComponent: () => import('./auth/auth').then(m => m.AuthComponent) },
  { path: 'teacher', loadComponent: () => import('./teacher-dashboard/teacher-dashboard').then(m => m.TeacherDashboardComponent) },
  { path: 'teacher/new-question', loadComponent: () => import('./question-form/question-form').then(m => m.QuestionFormComponent) },
  { path: 'teacher/edit-question/:id', loadComponent: () => import('./question-form/question-form').then(m => m.QuestionFormComponent) },
  { path: 'teacher/profile', loadComponent: () => import('./teacher-profile/teacher-profile').then(m => m.TeacherProfileComponent) },
  { path: 'teacher/guide', loadComponent: () => import('./question-guide/question-guide').then(m => m.QuestionGuideComponent) },
  { path: 'admin', loadComponent: () => import('./admin-dashboard/admin-dashboard').then(m => m.AdminDashboardComponent) },
  { path: '', redirectTo: 'auth', pathMatch: 'full' }
];
