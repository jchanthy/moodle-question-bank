import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';

export const authGuard: CanActivateFn = async (route, state) => {
  const supabaseService = inject(SupabaseService);
  const router = inject(Router);

  const { data: { session } } = await supabaseService.auth.getSession();
  if (session) {
    return true;
  }

  console.log('authGuard: No active session found. Redirecting to /auth');
  router.navigate(['/auth']);
  return false;
};

export const adminGuard: CanActivateFn = async (route, state) => {
  const supabaseService = inject(SupabaseService);
  const router = inject(Router);

  const { data: { session } } = await supabaseService.auth.getSession();
  if (!session) {
    console.log('adminGuard: No active session found. Redirecting to /auth');
    router.navigate(['/auth']);
    return false;
  }

  // Fetch role
  const { data: roleData } = await supabaseService.db
    .from('user_roles')
    .select('role')
    .eq('user_id', session.user.id)
    .maybeSingle();

  const role = roleData?.role || (session.user.email === 'admin@mail.com' ? 'admin' : 'teacher');

  if (role === 'admin') {
    return true;
  }

  console.log(`adminGuard: Restricted access (role is ${roleData?.role}). Redirecting to /teacher`);
  router.navigate(['/teacher']);
  return false;
};
