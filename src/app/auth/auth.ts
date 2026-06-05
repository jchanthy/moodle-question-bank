import { Component, signal, OnInit, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../services/supabase.service';
import { Router } from '@angular/router';

import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, InputTextModule, PasswordModule, IconFieldModule, InputIconModule],
  templateUrl: './auth.html',
  styleUrl: './auth.css'
})
export class AuthComponent implements OnInit {
  email = '';
  password = '';
  loading = signal(false);
  errorMessage = signal('');
  successMessage = signal('');

  // Setup Password Signals
  isPendingSetup = signal(false);
  pendingUserFullName = signal('');
  setupPassword = '';
  setupSuccess = signal(false);
  isResetMode = signal(false);
  isForgotPasswordMode = signal(false);

  constructor(private supabaseService: SupabaseService, private router: Router) {
    effect(() => {
      if (this.supabaseService.isRecoveryMode()) {
        this.isPendingSetup.set(true);
        this.isResetMode.set(true);
      }
    });
  }

  async ngOnInit() {
    // If in password recovery/reset mode, show the reset password overlay immediately
    if (this.supabaseService.isRecoveryMode() || window.location.hash.includes('type=recovery') || window.location.href.includes('type=recovery')) {
      this.isPendingSetup.set(true);
      this.isResetMode.set(true);
      return; // Do NOT check role or redirect!
    }

    // If already logged in normally, check role and state
    const session = this.supabaseService.currentUser();
    if (session) {
      await this.checkSessionState(session);
    }
  }

  private async checkSessionState(user: any) {
    // 1. Get status and full_name from profiles table (bio column holds: 'pending', 'approved', 'suspended')
    let approvalStatus: string | null = null;
    let fullName: string | null = null;
    try {
      const { data: profData } = await this.supabaseService.db
        .from('profiles')
        .select('bio, full_name')
        .eq('id', user.id)
        .maybeSingle();
      if (profData) {
        approvalStatus = profData.bio;
        fullName = profData.full_name;
      }
    } catch (dbErr) {
      console.warn('Failed to read status from profiles table:', dbErr);
    }

    // 2. Registry fallback
    const registry = await this.supabaseService.getUserRegistry();
    const regUser = registry[user.id];
    if (regUser) {
      if (!approvalStatus) approvalStatus = regUser.approval_status;
      if (!fullName) fullName = regUser.full_name;
    }

    if (approvalStatus === 'suspended') {
      this.errorMessage.set('Your account access has been revoked by the administrator.');
      await this.supabaseService.auth.signOut();
      return;
    }

    if (approvalStatus === 'pending') {
      // Show first-time setup overlay for pending users
      this.pendingUserFullName.set(fullName || regUser?.full_name || user.email.split('@')[0]);
      this.isPendingSetup.set(true);
    } else if (user) {
      this.redirectByRole(user.id);
    }
  }

  private async redirectByRole(userId: string) {
    const user = this.supabaseService.currentUser();
    if (user?.email === 'superadmin@mail.com') {
      this.router.navigate(['/super-admin']);
      return;
    }

    const registry = await this.supabaseService.getUserRegistry();
    const regUser = registry[userId];
    let role = regUser ? regUser.role : null;

    if (!role) {
      const { data } = await this.supabaseService.db
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .maybeSingle();
      role = data?.role;
    }
    
    role = role || (user?.email === 'superadmin@mail.com' ? 'super_admin' : (user?.email === 'admin@mail.com' ? 'admin' : 'teacher'));
    
    if (role === 'super_admin') {
      this.router.navigate(['/super-admin']);
    } else if (role === 'admin') {
      this.router.navigate(['/admin']);
    } else {
      this.router.navigate(['/teacher']);
    }
  }

  async onSaveSetupPassword() {
    if (!this.setupPassword || this.setupPassword.length < 6) {
      this.errorMessage.set('Password must be at least 6 characters.');
      return;
    }

    this.loading.set(true);
    this.errorMessage.set('');
    try {
      const { error } = await this.supabaseService.auth.updateUser({
        password: this.setupPassword
      });

      if (error) throw error;

      this.setupSuccess.set(true);
      
      const wasReset = this.isResetMode();
      this.supabaseService.isRecoveryMode.set(false);
      this.isResetMode.set(false);

      setTimeout(async () => {
        await this.supabaseService.auth.signOut();
        this.isPendingSetup.set(false);
        this.setupSuccess.set(false);
        this.setupPassword = '';
        if (wasReset) {
          this.successMessage.set('Password reset successfully! You can now sign in using your new password.');
        } else {
          this.successMessage.set('Password configured successfully! Access will be granted once the administrator approves your account.');
        }
      }, 3500);
    } catch (err: any) {
      this.errorMessage.set(err.message);
    } finally {
      this.loading.set(false);
    }
  }

  async onSendResetLink() {
    if (!this.email.trim()) {
      this.errorMessage.set('Please enter your email address.');
      return;
    }

    this.loading.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');
    try {
      const { error } = await this.supabaseService.auth.resetPasswordForEmail(this.email.trim(), {
        redirectTo: `${window.location.origin}/auth`
      });
      if (error) throw error;
      this.successMessage.set('A password reset link has been successfully sent to your email.');
      this.isForgotPasswordMode.set(false);
    } catch (err: any) {
      this.errorMessage.set(err.message);
    } finally {
      this.loading.set(false);
    }
  }

  async onSubmit() {
    this.loading.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');

    try {
      const { data, error } = await this.supabaseService.auth.signInWithPassword({
        email: this.email,
        password: this.password,
      });
      if (error) throw error;

      // 1. Get status from profiles table (bio column holds: 'pending', 'approved', 'suspended')
      let approvalStatus: string | null = null;
      try {
        const { data: profData } = await this.supabaseService.db
          .from('profiles')
          .select('bio')
          .eq('id', data.user.id)
          .maybeSingle();
        if (profData) {
          approvalStatus = profData.bio;
        }
      } catch (dbErr) {
        console.warn('Failed to read status from profiles table:', dbErr);
      }

      // 2. Registry fallback
      const registry = await this.supabaseService.getUserRegistry();
      const regUser = registry[data.user.id];
      if (regUser && !approvalStatus) {
        approvalStatus = regUser.approval_status;
      }

      if (approvalStatus === 'suspended') {
        this.errorMessage.set('Your account access has been revoked by the administrator.');
        await this.supabaseService.auth.signOut();
        return;
      }

      if (approvalStatus === 'pending') {
        this.errorMessage.set('Your account has been verified, but is pending administrator approval. Please wait for an admin to approve your access.');
        await this.supabaseService.auth.signOut();
        return;
      }

      // 3. Resolve role from DB table
      let role: string | null = null;
      if (this.email === 'superadmin@mail.com') {
        role = 'super_admin';
      } else {
        const { data: roleData } = await this.supabaseService.db
          .from('user_roles')
          .select('role')
          .eq('user_id', data.user.id)
          .maybeSingle();
        role = roleData?.role;
      }

      // 4. Registry fallback for role
      if (!role && regUser) {
        role = regUser.role;
      }

      // 5. Email-based defaults fallback
      if (!role) {
        if (this.email === 'superadmin@mail.com') {
          role = 'super_admin';
        } else if (this.email === 'admin@mail.com') {
          role = 'admin';
        } else if (this.email === 'teacher2@mail.com') {
          role = 'assistant_teacher';
        } else {
          role = 'teacher';
        }
      }
      console.log('Login successful. Detected role:', role);

      if (role === 'super_admin') {
        console.log('Redirecting to Super Admin Dashboard...');
        this.router.navigate(['/super-admin']);
      } else if (role === 'admin') {
        console.log('Redirecting to Admin Dashboard...');
        this.router.navigate(['/admin']);
      } else {
        console.log('Redirecting to Teacher Dashboard...');
        this.router.navigate(['/teacher']);
      }
    } catch (error: any) {
      this.errorMessage.set(error.message);
    } finally {
      this.loading.set(false);
    }
  }
}
