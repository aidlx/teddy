export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '12';
  };
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string | null;
          display_name: string | null;
          avatar_url: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          email?: string | null;
          display_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
        };
        Update: {
          email?: string | null;
          display_name?: string | null;
          avatar_url?: string | null;
        };
        Relationships: [];
      };
      files: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          mime_type: string;
          size: number;
          storage_path: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          name: string;
          mime_type: string;
          size: number;
          storage_path: string;
          created_at?: string;
        };
        Update: {
          name?: string;
          mime_type?: string;
          size?: number;
          storage_path?: string;
        };
        Relationships: [];
      };
      courses: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          code: string | null;
          color: string | null;
          schedule_text: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          name: string;
          code?: string | null;
          color?: string | null;
          schedule_text?: string | null;
          created_at?: string;
        };
        Update: {
          name?: string;
          code?: string | null;
          color?: string | null;
          schedule_text?: string | null;
        };
        Relationships: [];
      };
      tasks: {
        Row: {
          id: string;
          owner_id: string;
          course_id: string | null;
          title: string;
          description: string | null;
          due_at: string | null;
          completed_at: string | null;
          raw_capture: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          course_id?: string | null;
          title: string;
          description?: string | null;
          due_at?: string | null;
          completed_at?: string | null;
          raw_capture?: string | null;
          created_at?: string;
        };
        Update: {
          course_id?: string | null;
          title?: string;
          description?: string | null;
          due_at?: string | null;
          completed_at?: string | null;
          raw_capture?: string | null;
        };
        Relationships: [];
      };
      notes: {
        Row: {
          id: string;
          owner_id: string;
          course_id: string | null;
          title: string | null;
          content: string;
          raw_capture: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          course_id?: string | null;
          title?: string | null;
          content: string;
          raw_capture?: string | null;
          created_at?: string;
        };
        Update: {
          course_id?: string | null;
          title?: string | null;
          content?: string;
          raw_capture?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
