import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';

export interface TestingSubject {
  id: string;
  name: string;
  description?: string;
  testing_questions_count: number;
}

export interface CandidateQuestionOption {
  id: string;
  answer_text: string;
}

export interface CandidateQuestion {
  id: string;
  name: string;
  question_text: string;
  qtype: string;
  category_id: string;
  options: CandidateQuestionOption[];
}

export interface TestStartResponse {
  session_id: string;
  subject_id: string;
  total_questions: number;
  time_limit_minutes?: number | null;
  questions: CandidateQuestion[];
}

export interface CandidateAnswerSubmission {
  question_id: string;
  selected_option_id: string | null;
}

export interface QuestionResultBreakdown {
  question_id: string;
  selected_option_id: string | null;
  is_correct: boolean;
  correct_option_id: string | null;
  correct_answer_text?: string;
  feedback?: string;
}

export interface TestSubmitResponse {
  session_id: string;
  score: number;
  total_questions: number;
  percentage: number;
  breakdown: QuestionResultBreakdown[];
}

export type ReadinessStatus = 'needs_data' | 'ready' | 'flagged' | 'borderline';

export interface ReadinessEvaluation {
  status: ReadinessStatus;
  label: string;
  badgeClass: string;
  icon: string;
  summary: string;
}

export interface TestRoomPublicInfo {
  room_code: string;
  title: string;
  subject_name: string;
  requires_passcode: boolean;
  audience: 'student' | 'teacher' | 'any';
  question_count: number;
  time_limit_minutes: number | null;
  status: 'open' | 'closed' | 'expired';
}

export interface TestRoomAdminItem {
  id: string;
  room_code: string;
  title: string;
  subject_id: string;
  subject_name: string;
  has_passcode: boolean;
  audience: 'student' | 'teacher' | 'any';
  question_limit: number | null;
  time_limit_minutes: number | null;
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
  attempts: number;
  avg_percentage: number | null;
}

export interface CreateTestRoomDto {
  title: string;
  subject_id: string;
  passcode?: string;
  audience?: 'student' | 'teacher' | 'any';
  question_limit?: number | null;
  time_limit_minutes?: number | null;
  expires_at?: string | null;
}

export interface RoomParticipantResult {
  session_id: string;
  participant_name: string;
  participant_role: string;
  score: number;
  total_questions: number;
  percentage: number;
  started_at: string;
  submitted_at: string;
}

@Injectable({
  providedIn: 'root'
})
export class PreTestService {
  private supabaseService = inject(SupabaseService);

  /**
   * Fetches active subjects that have at least one question in status = 'testing'
   */
  async getActiveSubjects(): Promise<TestingSubject[]> {
    try {
      const { data, error } = await this.supabaseService.db.rpc('get_active_testing_subjects');
      if (error) throw error;
      return (data as TestingSubject[]) || [];
    } catch (err) {
      console.warn('RPC get_active_testing_subjects fallback to direct query:', err);
      const { data: questions, error: qErr } = await this.supabaseService.db
        .from('questions')
        .select('category_id, question_categories(id, name, description)')
        .eq('status', 'testing')
        .is('deleted_at', null);

      if (qErr || !questions) return [];

      const map = new Map<string, TestingSubject>();
      for (const q of questions as any[]) {
        const cat = q.question_categories;
        if (!cat || !cat.id) continue;
        const existing = map.get(cat.id);
        if (existing) {
          existing.testing_questions_count++;
        } else {
          map.set(cat.id, {
            id: cat.id,
            name: cat.name,
            description: cat.description,
            testing_questions_count: 1
          });
        }
      }
      return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    }
  }

  /**
   * Starts an anonymous exam session for a given subject (direct practice)
   */
  async startExam(subjectId: string, ipAddress = 'anonymous-web'): Promise<TestStartResponse> {
    const { data, error } = await this.supabaseService.db.rpc('start_candidate_test', {
      p_subject_id: subjectId,
      p_ip_address: ipAddress
    });

    if (error) throw error;
    return data as TestStartResponse;
  }

  /**
   * Submits exam answers atomically
   */
  async submitExam(sessionId: string, answers: CandidateAnswerSubmission[]): Promise<TestSubmitResponse> {
    const { data, error } = await this.supabaseService.db.rpc('submit_candidate_test', {
      p_session_id: sessionId,
      p_answers: answers
    });

    if (error) throw error;
    return data as TestSubmitResponse;
  }

  /**
   * Recalculates psychometric item analysis (Difficulty Index and Discrimination Index)
   */
  async recalculateMetrics(questionId?: string): Promise<void> {
    const { error } = await this.supabaseService.db.rpc('recalculate_item_analysis', {
      p_question_id: questionId || null
    });
    if (error) throw error;
  }

  // ---------------------------------------------------------------------------
  // Room / Passcode / Shareable URL Methods
  // ---------------------------------------------------------------------------

  /**
   * Public: fetch public info about a room by its code (no login required)
   */
  async getRoomPublicInfo(roomCode: string): Promise<TestRoomPublicInfo | null> {
    const code = roomCode.trim().toUpperCase();
    try {
      const { data, error } = await this.supabaseService.db.rpc('get_test_room_public', {
        p_room_code: code
      });
      if (error) throw error;
      return (data as TestRoomPublicInfo) || null;
    } catch (err) {
      console.warn('RPC get_test_room_public error:', err);
      return null;
    }
  }

  /**
   * Public: start a test inside a room with optional passcode, participant name and role
   */
  async startRoomTest(
    roomCode: string,
    passcode: string | null,
    participantName: string,
    participantRole: 'student' | 'teacher'
  ): Promise<{ ok: boolean; error?: string; session?: TestStartResponse }> {
    const { data, error } = await this.supabaseService.db.rpc('start_room_test', {
      p_room_code: roomCode.trim().toUpperCase(),
      p_passcode: passcode && passcode.trim() ? passcode.trim() : null,
      p_participant_name: participantName.trim(),
      p_participant_role: participantRole
    });

    if (error) {
      return { ok: false, error: error.message || 'Failed to start exam.' };
    }

    if (!data || !data.ok) {
      return { ok: false, error: data?.error || 'Invalid room code or passcode.' };
    }

    return {
      ok: true,
      session: {
        session_id: data.session_id,
        subject_id: data.subject_id,
        total_questions: data.total_questions,
        time_limit_minutes: data.time_limit_minutes,
        questions: data.questions
      }
    };
  }

  /**
   * Admin: List all created test rooms
   */
  async listRooms(): Promise<TestRoomAdminItem[]> {
    const { data, error } = await this.supabaseService.db.rpc('list_test_rooms');
    if (error) throw error;
    return (data as TestRoomAdminItem[]) || [];
  }

  /**
   * Admin: Create a new room
   */
  async createRoom(dto: CreateTestRoomDto): Promise<{ id: string; room_code: string }> {
    const { data, error } = await this.supabaseService.db.rpc('create_test_room', {
      p_title: dto.title.trim(),
      p_subject_id: dto.subject_id,
      p_passcode: dto.passcode && dto.passcode.trim() ? dto.passcode.trim() : null,
      p_audience: dto.audience || 'any',
      p_question_limit: dto.question_limit || null,
      p_time_limit_minutes: dto.time_limit_minutes || null,
      p_expires_at: dto.expires_at || null
    });

    if (error) throw error;
    return data as { id: string; room_code: string };
  }

  /**
   * Admin: Toggle room active state
   */
  async setRoomActive(roomId: string, active: boolean): Promise<void> {
    const { error } = await this.supabaseService.db.rpc('set_test_room_active', {
      p_room_id: roomId,
      p_active: active
    });
    if (error) throw error;
  }

  /**
   * Admin: Delete room
   */
  async deleteRoom(roomId: string): Promise<void> {
    const { error } = await this.supabaseService.db.rpc('delete_test_room', {
      p_room_id: roomId
    });
    if (error) throw error;
  }

  /**
   * Admin: Update passcode
   */
  async setRoomPasscode(roomId: string, passcode: string | null): Promise<void> {
    const { error } = await this.supabaseService.db.rpc('set_test_room_passcode', {
      p_room_id: roomId,
      p_passcode: passcode && passcode.trim() ? passcode.trim() : null
    });
    if (error) throw error;
  }

  /**
   * Admin: Get participant results for a specific room
   */
  async getRoomResults(roomId: string): Promise<RoomParticipantResult[]> {
    const { data, error } = await this.supabaseService.db.rpc('get_test_room_results', {
      p_room_id: roomId
    });
    if (error) throw error;
    return (data as RoomParticipantResult[]) || [];
  }

  /**
   * Evaluates production readiness according to psychometric rules:
   * - Needs Data: attempts < 20
   * - Ready for Production: attempts >= 20 AND 0.30 <= p <= 0.85 AND D >= 0.25
   * - Flagged / Review Needed: attempts >= 20 AND (p < 0.25 OR D <= 0.05)
   * - Borderline: attempts >= 20 (other intermediate scores)
   */
  evaluateReadiness(attempts: number, p: number | null, d: number | null): ReadinessEvaluation {
    if (attempts < 20) {
      return {
        status: 'needs_data',
        label: 'Needs Data',
        badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
        icon: 'hourglass_empty',
        summary: `${attempts}/20 attempts recorded. Requires at least 20 attempts for psychometric validity.`
      };
    }

    const pVal = p ?? 0;
    const dVal = d ?? 0;

    if (pVal >= 0.30 && pVal <= 0.85 && dVal >= 0.25) {
      return {
        status: 'ready',
        label: 'Ready for Production',
        badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        icon: 'verified',
        summary: `Optimal difficulty (p=${pVal.toFixed(2)}) & strong discrimination (D=${dVal.toFixed(2)}). Ready for release.`
      };
    }

    if (pVal < 0.25 || dVal <= 0.05) {
      const reasons: string[] = [];
      if (pVal < 0.25) reasons.push(`extremely hard (p=${pVal.toFixed(2)} < 0.25)`);
      if (dVal < 0) reasons.push(`negative discrimination (D=${dVal.toFixed(2)}) - possible miskeyed answer`);
      else if (dVal <= 0.05) reasons.push(`poor discrimination (D=${dVal.toFixed(2)} ≤ 0.05)`);

      return {
        status: 'flagged',
        label: 'Flagged / Review Needed',
        badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
        icon: 'warning',
        summary: `Item flagged due to: ${reasons.join(', ')}.`
      };
    }

    return {
      status: 'borderline',
      label: 'Review Needed',
      badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
      icon: 'info',
      summary: `Attempts sufficient (${attempts}), but metrics require administrative review (p=${pVal.toFixed(2)}, D=${dVal.toFixed(2)}).`
    };
  }

  /**
   * Helper to format difficulty index color
   */
  getDifficultyClass(p: number | null): string {
    if (p === null) return 'text-slate-400 bg-slate-50 border-slate-200';
    if (p >= 0.30 && p <= 0.85) return 'text-emerald-700 bg-emerald-50 border-emerald-200 font-bold';
    if ((p >= 0.25 && p < 0.30) || (p > 0.85 && p <= 0.90)) return 'text-amber-700 bg-amber-50 border-amber-200 font-bold';
    return 'text-rose-700 bg-rose-50 border-rose-200 font-bold';
  }

  /**
   * Helper to format discrimination index color
   */
  getDiscriminationClass(d: number | null): string {
    if (d === null) return 'text-slate-400 bg-slate-50 border-slate-200';
    if (d < 0) return 'text-rose-700 bg-rose-100 border-rose-300 font-black animate-pulse';
    if (d <= 0.05) return 'text-rose-700 bg-rose-50 border-rose-200 font-bold';
    if (d >= 0.25) return 'text-emerald-700 bg-emerald-50 border-emerald-200 font-bold';
    return 'text-amber-700 bg-amber-50 border-amber-200 font-bold';
  }
}
