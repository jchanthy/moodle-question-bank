import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { environment } from '../../environments/environment';

export interface Notification {
  id: string;
  user_id: string;
  type: 'submitted_for_review' | 'submitted_for_teacher_review' | 'review_assigned' | 'question_approved' | 'question_rejected' | 'teacher_approved' | 'teacher_rejected';
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
    if (['question_approved', 'question_rejected', 'teacher_approved', 'teacher_rejected'].includes(type)) {
      this.sendTelegramAlert(title, message, type, metadata);
    }

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
    }
  }

  /**
   * Notify all administrators
   */
  async notifyAdmins(type: string, title: string, message: string, metadata: any = {}) {
    this.sendTelegramAlert(title, message, type, metadata);

    // 1. Fetch all admin user IDs from registry
    let admins: any[] = [];
    try {
      const registry = await this.supabase.getUserRegistry();
      admins = Object.keys(registry)
        .filter(id => registry[id].role === 'admin' && registry[id].approval_status === 'approved')
        .map(id => ({ user_id: id }));
    } catch (err) {
      console.error('[NotificationService] Registry fetch for admins failed:', err);
    }

    if (admins.length === 0) {
      // DB table fallback
      let { data: dbAdmins } = await this.supabase.db
        .from('user_roles')
        .select('user_id')
        .eq('role', 'admin');
      
      if (dbAdmins && dbAdmins.length > 0) {
        admins = dbAdmins;
      }
    }

    // Fallback if empty
    if (admins.length === 0) {
      const { data: profiles, error: profileError } = await this.supabase.db
        .from('profiles')
        .select('id')
        .eq('email', 'admin@mail.com');
      
      if (!profileError && profiles) {
        admins = profiles.map(p => ({ user_id: p.id }));
      }
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
      }
    }
  }

  /**
   * Notify all teachers
   */
  async notifyTeachers(type: string, title: string, message: string, metadata: any = {}) {
    this.sendTelegramAlert(title, message, type, metadata);

    let teachers: { user_id: string }[] = [];

    try {
      // If notifying for teacher review, filter teachers by subject/category specialization
      if (type === 'submitted_for_teacher_review' && metadata?.question_id) {
        // 1. Fetch the question's category_id
        const { data: q } = await this.supabase.db
          .from('questions')
          .select('category_id')
          .eq('id', metadata.question_id)
          .maybeSingle();

        if (q && q.category_id) {
          // 2. Climb up to find root category ID
          let currentCatId = q.category_id;
          let rootCatId = currentCatId;
          
          while (currentCatId) {
            const { data: cat } = await this.supabase.db
              .from('question_categories')
              .select('id, parent_id')
              .eq('id', currentCatId)
              .maybeSingle();
            
            if (cat) {
              rootCatId = cat.id;
              currentCatId = cat.parent_id;
            } else {
              break;
            }
          }

          // 3. Find teachers whose specialization contains rootCatId
          const registry = await this.supabase.getUserRegistry();
          const specTeacherIds: string[] = [];
          
          for (const userId of Object.keys(registry)) {
            const regUser = registry[userId];
            if (regUser.role === 'teacher' && regUser.approval_status === 'approved' && regUser.specialization?.includes(rootCatId)) {
              specTeacherIds.push(userId);
            }
          }

          if (specTeacherIds.length > 0) {
            teachers = specTeacherIds.map(id => ({ user_id: id }));
          } else {
            // DB fallback
            const { data: specTeachers } = await this.supabase.db
              .from('profiles')
              .select('id')
              .contains('specialization', [rootCatId]);

            if (specTeachers && specTeachers.length > 0) {
              const teacherIds = specTeachers.map(t => t.id);
              const { data: filteredRoles } = await this.supabase.db
                .from('user_roles')
                .select('user_id')
                .eq('role', 'teacher')
                .in('user_id', teacherIds);

              if (filteredRoles && filteredRoles.length > 0) {
                teachers = filteredRoles.map(t => ({ user_id: t.user_id }));
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('[NotificationService] Error filtering teachers by subject:', err);
    }

    // Fallback: If no specialized teachers found or not a teacher review submission, notify all teachers
    if (teachers.length === 0) {
      try {
        const registry = await this.supabase.getUserRegistry();
        const allTeacherIds = Object.keys(registry)
          .filter(id => registry[id].role === 'teacher' && registry[id].approval_status === 'approved');
        
        if (allTeacherIds.length > 0) {
          teachers = allTeacherIds.map(id => ({ user_id: id }));
        }
      } catch (err) {
        console.error('[NotificationService] Registry fetch for teachers failed:', err);
      }

      if (teachers.length === 0) {
        const { data: allTeachers, error: fetchError } = await this.supabase.db
          .from('user_roles')
          .select('user_id')
          .eq('role', 'teacher');

        if (!fetchError && allTeachers && allTeachers.length > 0) {
          teachers = allTeachers.map(t => ({ user_id: t.user_id }));
        }
      }
    }

    // Fallback if still empty
    if (teachers.length === 0) {
      const { data: profiles, error: profileError } = await this.supabase.db
        .from('profiles')
        .select('id')
        .or('email.eq.teacher@mail.com,email.eq.user1@mail.com');
      
      if (!profileError && profiles) {
        teachers = profiles.map(p => ({ user_id: p.id }));
      }
    }

    if (teachers && teachers.length > 0) {
      const notifications = teachers.map(teacher => ({
        user_id: teacher.user_id,
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
        console.error('[NotificationService] Error batch inserting teacher notifications:', error);
      }
    }
  }

  /**
   * Send a formatted alert message to the shared Telegram group/channel
   */
  async sendTelegramAlert(title: string, message: string, type: string, metadata: any = {}) {
    // Skip alerts in local development environment
    const hostname = window.location.hostname;
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === 'lvh.me' || hostname.startsWith('192.168.') || hostname.startsWith('10.');
    if (isLocalhost) {
      console.log('[NotificationService] Telegram alert skipped (running on local development)');
      return;
    }

    const token = environment.telegramBotToken;
    const chatId = environment.telegramChatId;
    if (!token || !chatId) {
      return;
    }

    // Map type to user-friendly emoji status
    let statusEmoji = '🔔';
    if (type.includes('approved') || type.includes('ready')) {
      statusEmoji = '✅';
    } else if (type.includes('rejected')) {
      statusEmoji = '❌';
    } else if (type.includes('submitted')) {
      statusEmoji = '📝';
    }

    // Construct a dynamic system URL
    const baseUrl = window.location.origin;
    let actionUrl = `${baseUrl}/auth`;

    if (metadata?.test_url) {
      actionUrl = metadata.test_url;
    } else if (type === 'submitted_for_review') {
      actionUrl = `${baseUrl}/admin`;
    } else if (type === 'submitted_for_teacher_review') {
      actionUrl = `${baseUrl}/teacher`;
    } else if (metadata?.question_id) {
      actionUrl = `${baseUrl}/teacher/edit-question/${metadata.question_id}`;
    } else if (type.includes('approved') || type.includes('rejected')) {
      actionUrl = `${baseUrl}/teacher`;
    }

    const htmlMessage = `${statusEmoji} <b>Moodle Question Bank Alert</b>\n\n` +
      `<b>Action:</b> ${title}\n` +
      `<b>Detail:</b> ${message}\n\n` +
      `🔗 <b>Link:</b> <a href="${actionUrl}">${actionUrl}</a>`;

    try {
      console.log(`[NotificationService] Attempting to send Telegram alert to chat: ${chatId}`);
      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: htmlMessage,
          parse_mode: 'HTML'
        })
      });
      if (!res.ok) {
        const errorData = await res.json();
        console.error('[NotificationService] Telegram API error response:', errorData);
      } else {
        console.log('[NotificationService] Telegram alert sent successfully!');
      }
    } catch (err) {
      console.error('[NotificationService] Failed to send Telegram notification:', err);
    }
  }

  async loadNotifications() {
    const user = this.supabase.currentUser();
    if (!user) {
      return;
    }

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
      this.notifications.set(data);
      this.unreadCount.set(data.filter(n => !n.is_read).length);
    }
  }

  async loadAllNotificationsArchive() {
    const user = this.supabase.currentUser();
    if (!user) return;

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
      this.allNotificationsArchive.set(data);
    }
  }

  async markAsRead(id: string) {
    const { data, error } = await this.supabase.db
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id)
      .select(); // Ask for returned data to verify update was successful

    if (error) {
      console.error('[NotificationService] Error marking notification as read in DB:', error);
      return;
    }

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

    const { error } = await this.supabase.db
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', user.id)
      .eq('is_read', false);

    if (error) {
      console.error('[NotificationService] Error marking all notifications as read in DB:', error);
      return;
    }

    this.notifications.update(prev => prev.map(n => ({ ...n, is_read: true })));
    this.allNotificationsArchive.update(prev => prev.map(n => ({ ...n, is_read: true })));
    this.unreadCount.set(0);
  }

  /**
   * Automatically mark a review notification as read when a review task is completed
   */
  async markReviewNotificationsAsRead(questionId: string, userId?: string) {
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

  /**
   * Delete or retract active review notifications when a question is withdrawn or returned to draft
   */
  async retractReviewNotifications(questionId: string) {
    const { error } = await this.supabase.db
      .from('notifications')
      .delete()
      .in('type', ['submitted_for_review', 'submitted_for_teacher_review', 'review_assigned'])
      .eq('metadata->>question_id', questionId);

    if (error) {
      console.error('[NotificationService] Error retracting notifications:', error);
    } else {
      this.loadNotifications();
      this.loadAllNotificationsArchive();
    }
  }
}

