import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';

export const authGuard: CanActivateFn = async (route, state) => {
  const supabaseService = inject(SupabaseService);
  const router = inject(Router);

  const { data: { session } } = await supabaseService.auth.getSession();
  if (session) {
    // Security check: Block suspended users immediately
    let isSuspended = false;
    try {
      const { data: profData } = await supabaseService.db
        .from('profiles')
        .select('bio')
        .eq('id', session.user.id)
        .maybeSingle();
      if (profData?.bio === 'suspended') {
        isSuspended = true;
      }
    } catch (dbErr) {
      console.warn('authGuard: Failed to query profile from DB:', dbErr);
    }

    if (!isSuspended) {
      const registry = await supabaseService.getUserRegistry();
      const regUser = registry[session.user.id];
      if (regUser && regUser.approval_status === 'suspended') {
        isSuspended = true;
      }
    }

    if (isSuspended) {
      console.log('authGuard: User is suspended/revoked. Signing out and redirecting.');
      await supabaseService.auth.signOut();
      router.navigate(['/auth']);
      return false;
    }
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

  // Security check: Block suspended users immediately
  let isSuspended = false;
  try {
    const { data: profData } = await supabaseService.db
      .from('profiles')
      .select('bio')
      .eq('id', session.user.id)
      .maybeSingle();
    if (profData?.bio === 'suspended') {
      isSuspended = true;
    }
  } catch (dbErr) {
    console.warn('adminGuard: Failed to query profile from DB:', dbErr);
  }

  if (!isSuspended) {
    const registry = await supabaseService.getUserRegistry();
    const regUser = registry[session.user.id];
    if (regUser && regUser.approval_status === 'suspended') {
      isSuspended = true;
    }
  }

  if (isSuspended) {
    console.log('adminGuard: User is suspended/revoked. Signing out and redirecting.');
    await supabaseService.auth.signOut();
    router.navigate(['/auth']);
    return false;
  }

  const registry = await supabaseService.getUserRegistry();
  const regUser = registry[session.user.id];
  let role = regUser ? regUser.role : null;

  if (!role) {
    const { data: roleData } = await supabaseService.db
      .from('user_roles')
      .select('role')
      .eq('user_id', session.user.id)
      .maybeSingle();
    role = roleData?.role;
  }

  role = role || (session.user.email === 'admin@mail.com' ? 'admin' : 'teacher');

  if (role === 'admin' || role === 'super_admin') {
    return true;
  }

  console.log(`adminGuard: Restricted access (role is ${role}). Redirecting to /teacher`);
  router.navigate(['/teacher']);
  return false;
};

export const superAdminGuard: CanActivateFn = async (route, state) => {
  const supabaseService = inject(SupabaseService);
  const router = inject(Router);

  const { data: { session } } = await supabaseService.auth.getSession();
  if (!session) {
    console.log('superAdminGuard: No active session found. Redirecting to /auth');
    router.navigate(['/auth']);
    return false;
  }

  // Security check: Block suspended users immediately
  let isSuspended = false;
  try {
    const { data: profData } = await supabaseService.db
      .from('profiles')
      .select('bio')
      .eq('id', session.user.id)
      .maybeSingle();
    if (profData?.bio === 'suspended') {
      isSuspended = true;
    }
  } catch (dbErr) {
    console.warn('superAdminGuard: Failed to query profile from DB:', dbErr);
  }

  if (!isSuspended) {
    const registry = await supabaseService.getUserRegistry();
    const regUser = registry[session.user.id];
    if (regUser && regUser.approval_status === 'suspended') {
      isSuspended = true;
    }
  }

  if (isSuspended) {
    console.log('superAdminGuard: User is suspended/revoked. Signing out and redirecting.');
    await supabaseService.auth.signOut();
    router.navigate(['/auth']);
    return false;
  }

  const registry = await supabaseService.getUserRegistry();
  const regUser = registry[session.user.id];
  let role = regUser ? regUser.role : null;

  if (!role) {
    const { data: roleData } = await supabaseService.db
      .from('user_roles')
      .select('role')
      .eq('user_id', session.user.id)
      .maybeSingle();
    role = roleData?.role;
  }

  role = role || (session.user.email === 'superadmin@mail.com' ? 'super_admin' : (session.user.email === 'admin@mail.com' ? 'admin' : 'teacher'));

  if (role === 'super_admin') {
    return true;
  }

  console.log(`superAdminGuard: Restricted access (role is ${role}). Redirecting to /admin`);
  router.navigate(['/admin']);
  return false;
};

