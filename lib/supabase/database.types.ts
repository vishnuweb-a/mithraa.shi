export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      approval_decisions: {
        Row: {
          acting_role: Database["public"]["Enums"]["project_role"]
          created_at: string
          decision: Database["public"]["Enums"]["gate_decision"]
          department: string | null
          id: number
          note: string | null
          project_id: string
          signer_id: string
          stage_id: string
        }
        Insert: {
          acting_role: Database["public"]["Enums"]["project_role"]
          created_at?: string
          decision: Database["public"]["Enums"]["gate_decision"]
          department?: string | null
          id?: never
          note?: string | null
          project_id: string
          signer_id?: string
          stage_id: string
        }
        Update: {
          acting_role?: Database["public"]["Enums"]["project_role"]
          created_at?: string
          decision?: Database["public"]["Enums"]["gate_decision"]
          department?: string | null
          id?: never
          note?: string | null
          project_id?: string
          signer_id?: string
          stage_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_decisions_project_id_stage_id_fkey"
            columns: ["project_id", "stage_id"]
            isOneToOne: false
            referencedRelation: "project_stages"
            referencedColumns: ["project_id", "stage_id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor_id: string | null
          actor_kind: Database["public"]["Enums"]["actor_kind"]
          created_at: string
          detail: Json
          id: number
          project_id: string
          target_id: string | null
          target_table: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_kind: Database["public"]["Enums"]["actor_kind"]
          created_at?: string
          detail?: Json
          id?: never
          project_id: string
          target_id?: string | null
          target_table?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_kind?: Database["public"]["Enums"]["actor_kind"]
          created_at?: string
          detail?: Json
          id?: never
          project_id?: string
          target_id?: string | null
          target_table?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      brain_records: {
        Row: {
          agent_key: string | null
          body: Json
          created_at: string
          created_by: string | null
          id: string
          kind: string
          origin: Database["public"]["Enums"]["actor_kind"]
          project_id: string
          stage_id: string | null
          title: string
        }
        Insert: {
          agent_key?: string | null
          body?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          origin?: Database["public"]["Enums"]["actor_kind"]
          project_id: string
          stage_id?: string | null
          title: string
        }
        Update: {
          agent_key?: string | null
          body?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          origin?: Database["public"]["Enums"]["actor_kind"]
          project_id?: string
          stage_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "brain_records_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brain_records_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "stages"
            referencedColumns: ["id"]
          },
        ]
      }
      gate_checklist_items: {
        Row: {
          done: boolean
          done_at: string | null
          done_by: string | null
          id: string
          label: string
          position: number
          project_id: string
          stage_id: string
        }
        Insert: {
          done?: boolean
          done_at?: string | null
          done_by?: string | null
          id?: string
          label: string
          position: number
          project_id: string
          stage_id: string
        }
        Update: {
          done?: boolean
          done_at?: string | null
          done_by?: string | null
          id?: string
          label?: string
          position?: number
          project_id?: string
          stage_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gate_checklist_items_project_id_stage_id_fkey"
            columns: ["project_id", "stage_id"]
            isOneToOne: false
            referencedRelation: "project_stages"
            referencedColumns: ["project_id", "stage_id"]
          },
        ]
      }
      gate_requirements: {
        Row: {
          created_at: string
          id: string
          project_id: string
          roles: Database["public"]["Enums"]["project_role"][]
          signers_required: number | null
          stage_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          roles: Database["public"]["Enums"]["project_role"][]
          signers_required?: number | null
          stage_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          roles?: Database["public"]["Enums"]["project_role"][]
          signers_required?: number | null
          stage_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gate_requirements_project_id_stage_id_fkey"
            columns: ["project_id", "stage_id"]
            isOneToOne: false
            referencedRelation: "project_stages"
            referencedColumns: ["project_id", "stage_id"]
          },
        ]
      }
      producer_attestations: {
        Row: {
          created_at: string
          id: number
          project_id: string
          signer_id: string
          stage_id: string
          statement: string
        }
        Insert: {
          created_at?: string
          id?: never
          project_id: string
          signer_id?: string
          stage_id: string
          statement?: string
        }
        Update: {
          created_at?: string
          id?: never
          project_id?: string
          signer_id?: string
          stage_id?: string
          statement?: string
        }
        Relationships: [
          {
            foreignKeyName: "producer_attestations_project_id_stage_id_fkey"
            columns: ["project_id", "stage_id"]
            isOneToOne: true
            referencedRelation: "project_stages"
            referencedColumns: ["project_id", "stage_id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      project_members: {
        Row: {
          added_by: string | null
          created_at: string
          department: string | null
          id: string
          project_id: string
          role: Database["public"]["Enums"]["project_role"]
          user_id: string
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          department?: string | null
          id?: string
          project_id: string
          role: Database["public"]["Enums"]["project_role"]
          user_id: string
        }
        Update: {
          added_by?: string | null
          created_at?: string
          department?: string | null
          id?: string
          project_id?: string
          role?: Database["public"]["Enums"]["project_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_stages: {
        Row: {
          activated_at: string | null
          passed_at: string | null
          project_id: string
          stage_id: string
          status: Database["public"]["Enums"]["stage_status"]
        }
        Insert: {
          activated_at?: string | null
          passed_at?: string | null
          project_id: string
          stage_id: string
          status?: Database["public"]["Enums"]["stage_status"]
        }
        Update: {
          activated_at?: string | null
          passed_at?: string | null
          project_id?: string
          stage_id?: string
          status?: Database["public"]["Enums"]["stage_status"]
        }
        Relationships: [
          {
            foreignKeyName: "project_stages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_stages_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "stages"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          code: string | null
          created_at: string
          created_by: string
          distribution_mode: Database["public"]["Enums"]["operating_mode"]
          financing_mode: Database["public"]["Enums"]["operating_mode"]
          id: string
          logline: string | null
          title: string
          updated_at: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          created_by: string
          distribution_mode?: Database["public"]["Enums"]["operating_mode"]
          financing_mode?: Database["public"]["Enums"]["operating_mode"]
          id?: string
          logline?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          code?: string | null
          created_at?: string
          created_by?: string
          distribution_mode?: Database["public"]["Enums"]["operating_mode"]
          financing_mode?: Database["public"]["Enums"]["operating_mode"]
          id?: string
          logline?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      stages: {
        Row: {
          gate_name: string
          id: string
          name: string
          position: number
        }
        Insert: {
          gate_name: string
          id: string
          name: string
          position: number
        }
        Update: {
          gate_name?: string
          id?: string
          name?: string
          position?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_project: {
        Args: { p_code?: string; p_logline?: string; p_title: string }
        Returns: string
      }
      set_project_mode: {
        Args: {
          p_mode: Database["public"]["Enums"]["operating_mode"]
          p_project: string
          p_setting: string
        }
        Returns: undefined
      }
    }
    Enums: {
      actor_kind: "human" | "agent" | "system"
      gate_decision: "approve" | "reject"
      operating_mode: "external" | "self"
      project_role:
        | "producer"
        | "director"
        | "writer"
        | "investor"
        | "pm"
        | "hod"
        | "crew"
        | "client"
      stage_status: "locked" | "active" | "passed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      actor_kind: ["human", "agent", "system"],
      gate_decision: ["approve", "reject"],
      operating_mode: ["external", "self"],
      project_role: [
        "producer",
        "director",
        "writer",
        "investor",
        "pm",
        "hod",
        "crew",
        "client",
      ],
      stage_status: ["locked", "active", "passed"],
    },
  },
} as const

