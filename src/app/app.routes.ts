import { Routes } from '@angular/router';
import { authGuard, adminGuard, superAdminGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: 'dictionary', loadComponent: () => import('./dictionary-viewer/dictionary-viewer').then(m => m.DictionaryViewerComponent) },
  { path: 'test', loadComponent: () => import('./test-runner/test-runner').then(m => m.TestRunnerComponent) },
  { path: 'auth', loadComponent: () => import('./auth/auth').then(m => m.AuthComponent) },
  { 
    path: 'teacher', 
    canActivate: [authGuard],
    loadComponent: () => import('./teacher-dashboard/teacher-dashboard').then(m => m.TeacherDashboardComponent) 
  },
  { 
    path: 'teacher/new-question', 
    canActivate: [authGuard],
    loadComponent: () => import('./question-form/question-form').then(m => m.QuestionFormComponent) 
  },
  { 
    path: 'teacher/edit-question/:id', 
    canActivate: [authGuard],
    loadComponent: () => import('./question-form/question-form').then(m => m.QuestionFormComponent) 
  },
  { 
    path: 'teacher/profile', 
    canActivate: [authGuard],
    loadComponent: () => import('./teacher-profile/teacher-profile').then(m => m.TeacherProfileComponent) 
  },
  { 
    path: 'admin', 
    canActivate: [adminGuard],
    loadComponent: () => import('./admin-dashboard/admin-dashboard').then(m => m.AdminDashboardComponent) 
  },
  { 
    path: 'super-admin', 
    canActivate: [superAdminGuard],
    loadComponent: () => import('./super-admin-dashboard/super-admin-dashboard').then(m => m.SuperAdminDashboardComponent) 
  },
  { path: '', redirectTo: 'teacher', pathMatch: 'full' },
  { path: '**', redirectTo: 'teacher' }
];
