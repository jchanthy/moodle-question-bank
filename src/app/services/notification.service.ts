import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';

export interface Notification {
  id: string;
  user_id: string;
  type: 'submitted_for_review' | 'review_assigned' | 'question_approved' | 'question_rejected';
  title: string;
  message: string;
  metadata: any;
  is_read: boolean;
  created_at: string;
}

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private supabase = inject(SupabaseService);
  
  notifications = signal<Notification[]>([]);
  allNotificationsArchive = signal<Notification[]>([]);
  unreadCount = signal(0);

  /**
   * Create a notification for a specific user
   */
  async createNotification(userId: string, type: string, title: string, message: string, metadata: any = {}) {
    console.log(`[NotificationService] Creating notification for user: ${userId}, type: ${type}`);
    const { error } = await this.supabase.db
      .from('notifications')
      .insert({
        user_id: userId,
        type,
        title,
        message,
        metadata,
        is_read: false // Explicit default to avoid any NULL issues in DB
      });
    if (error) {
      console.error('[NotificationService] Error creating notification:', error);
    } else {
      console.log('[NotificationService] Notification created successfully');
    }
  }

  /**
   * Notify all administrators
   */
  async notifyAdmins(type: string, title: string, message: string, metadata: any = {}) {
    console.log(`[NotificationService] Notifying all admins, type: ${type}`);
    // 1. Fetch all admin user IDs
    const { data: admins, error: fetchError } = await this.supabase.db
      .from('user_roles')
      .select('user_id')
      .eq('role', 'admin');

    if (fetchError) {
      console.error('[NotificationService] Error fetching admins to notify:', fetchError);
      return;
    }

    if (admins && admins.length > 0) {
      const notifications = admins.map(admin => ({
        user_id: admin.user_id,
        type,
        title,
        message,
        metadata,
        is_read: false // Explicit default
      }));

      const { error } = await this.supabase.db
        .from('notifications')
        .insert(notifications);
      
      if (error) {
        console.error('[NotificationService] Error batch inserting admin notifications:', error);
      } else {
        console.log(`[NotificationService] Successfully notified ${admins.length} admins`);
      }
    }
  }

  async loadNotifications() {
    const user = this.supabase.currentUser();
    if (!user) {
      console.log('[NotificationService] No logged-in user. Skipping notification load.');
      return;
    }

    console.log(`[NotificationService] Loading latest 20 notifications for user: ${user.id}`);
    const { data, error } = await this.supabase.db
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('[NotificationService] Error loading notifications:', error);
      return;
    }

    if (data) {
      console.log(`[NotificationService] Loaded ${data.length} notifications. Unread count: ${data.filter(n => !n.is_read).length}`);
      this.notifications.set(data);
      this.unreadCount.set(data.filter(n => !n.is_read).length);
    }
  }

  async loadAllNotificationsArchive() {
    const user = this.supabase.currentUser();
    if (!user) return;

    console.log(`[NotificationService] Loading up to 200 archive notifications for user: ${user.id}`);
    const { data, error } = await this.supabase.db
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      console.error('[NotificationService] Error loading notifications archive:', error);
      return;
    }

    if (data) {
      console.log(`[NotificationService] Loaded ${data.length} archive notifications`);
      this.allNotificationsArchive.set(data);
    }
  }

  async markAsRead(id: string) {
    console.log(`[NotificationService] Marking notification ${id} as read...`);
    const { data, error } = await this.supabase.db
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id)
      .select(); // Ask for returned data to verify update was successful

    if (error) {
      console.error('[NotificationService] Error marking notification as read in DB:', error);
      return;
    }

    console.log('[NotificationService] DB response for update:', data);
    if (!data || data.length === 0) {
      console.warn('[NotificationService] DB update affected 0 rows! This is highly likely an RLS permission issue.');
    }

    // Always sync local state so UI is responsive, but notify if DB update failed
    this.notifications.update(prev => 
      prev.map(n => n.id === id ? { ...n, is_read: true } : n)
    );
    this.allNotificationsArchive.update(prev => 
      prev.map(n => n.id === id ? { ...n, is_read: true } : n)
    );
    this.unreadCount.update(c => Math.max(0, c - 1));
  }

  async markAllAsRead() {
    const user = this.supabase.currentUser();
    if (!user) return;

    console.log(`[NotificationService] Marking all unread notifications as read for user ${user.id}`);
    const { data, error } = await this.supabase.db
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', user.id)
      .eq('is_read', false)
      .select();

    if (error) {
      console.error('[NotificationService] Error marking all notifications as read in DB:', error);
      return;
    }

    console.log('[NotificationService] DB response for batch update:', data);

    this.notifications.update(prev => prev.map(n => ({ ...n, is_read: true })));
    this.allNotificationsArchive.update(prev => prev.map(n => ({ ...n, is_read: true })));
    this.unreadCount.set(0);
  }

  /**
   * Automatically mark a review notification as read when a review task is completed
   */
  async markReviewNotificationsAsRead(questionId: string, userId?: string) {
    console.log(`[NotificationService] Clearing review notifications for question ${questionId}, user ${userId || 'all'}`);
    let query = this.supabase.db
      .from('notifications')
      .update({ is_read: true })
      .eq('type', 'review_assigned')
      .eq('metadata->>question_id', questionId);

    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { error } = await query;
    if (error) {
      console.error('[NotificationService] Error auto-clearing review notifications:', error);
    } else {
      this.loadNotifications();
      this.loadAllNotificationsArchive();
    }
  }
}

