import { Component, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../services/supabase.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './auth.html',
  styleUrl: './auth.css'
})
export class AuthComponent {
  email = '';
  password = '';
  isSignUp = signal(false);
  loading = signal(false);
  errorMessage = signal('');
  successMessage = signal('');

  constructor(private supabaseService: SupabaseService, private router: Router) {}

  async ngOnInit() {
    // If already logged in, redirect to dashboard
    const user = this.supabaseService.currentUser();
    if (user) {
      this.redirectByRole(user.id);
    }
  }

  private async redirectByRole(userId: string) {
    const { data } = await this.supabaseService.db
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .single();
    
    if (data?.role === 'admin') {
      this.router.navigate(['/admin']);
    } else {
      this.router.navigate(['/teacher']);
    }
  }

  toggleMode() {
    this.isSignUp.set(!this.isSignUp());
    this.errorMessage.set('');
    this.successMessage.set('');
  }

  async onSubmit() {
    this.loading.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');

    try {
      if (this.isSignUp()) {
        const { error } = await this.supabaseService.auth.signUp({
          email: this.email,
          password: this.password,
        });
        if (error) throw error;
        this.successMessage.set('Check your email for the confirmation link!');
      } else {
        const { data, error } = await this.supabaseService.auth.signInWithPassword({
          email: this.email,
          password: this.password,
        });
        if (error) throw error;

        // Fetch role manually for immediate navigation after login
        const { data: roleData } = await this.supabaseService.db
          .from('user_roles')
          .select('role')
          .eq('user_id', data.user.id)
          .single();

        const role = roleData?.role || 'teacher'; // Fallback to teacher
        if (role === 'admin') {
          this.router.navigate(['/admin']);
        } else {
          this.router.navigate(['/teacher']);
        }
      }
    } catch (error: any) {
      this.errorMessage.set(error.message);
    } finally {
      this.loading.set(false);
    }
  }
}
