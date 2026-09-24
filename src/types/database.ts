export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      appointment_assignees: {
        Row: {
          appointment_id: string
          assigned_at: string
          assigned_by: string | null
          user_id: string
        }
        Insert: {
          appointment_id: string
          assigned_at?: string
          assigned_by?: string | null
          user_id: string
        }
        Update: {
          appointment_id?: string
          assigned_at?: string
          assigned_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_assignees_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_assignees_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_assignees_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          address: string | null
          appointment_type: Database["public"]["Enums"]["appointment_type"]
          cancelled_reason: string | null
          client_id: string | null
          client_signoff_at: string | null
          client_signoff_name: string | null
          completed_at: string | null
          contact_name: string
          contact_phone: string | null
          created_at: string
          created_by: string | null
          id: string
          lead_id: string | null
          notes: string | null
          project_id: string | null
          scheduled_date: string
          status: Database["public"]["Enums"]["appointment_status"]
          ticket_id: string | null
          time_slot: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          appointment_type: Database["public"]["Enums"]["appointment_type"]
          cancelled_reason?: string | null
          client_id?: string | null
          client_signoff_at?: string | null
          client_signoff_name?: string | null
          completed_at?: string | null
          contact_name: string
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          lead_id?: string | null
          notes?: string | null
          project_id?: string | null
          scheduled_date: string
          status?: Database["public"]["Enums"]["appointment_status"]
          ticket_id?: string | null
          time_slot: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          appointment_type?: Database["public"]["Enums"]["appointment_type"]
          cancelled_reason?: string | null
          client_id?: string | null
          client_signoff_at?: string | null
          client_signoff_name?: string | null
          completed_at?: string | null
          contact_name?: string
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          lead_id?: string | null
          notes?: string | null
          project_id?: string | null
          scheduled_date?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          ticket_id?: string | null
          time_slot?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_ticket_fk"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string | null
          actor_role: Database["public"]["Enums"]["user_role"] | null
          at: string
          entity: string
          entity_id: string | null
          id: string
          metadata: Json
          severity: Database["public"]["Enums"]["audit_severity"]
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: Database["public"]["Enums"]["user_role"] | null
          at?: string
          entity: string
          entity_id?: string | null
          id?: string
          metadata?: Json
          severity?: Database["public"]["Enums"]["audit_severity"]
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: Database["public"]["Enums"]["user_role"] | null
          at?: string
          entity?: string
          entity_id?: string | null
          id?: string
          metadata?: Json
          severity?: Database["public"]["Enums"]["audit_severity"]
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      blog_posts: {
        Row: {
          author_id: string | null
          author_name: string | null
          body: string | null
          category: string | null
          cover_storage_path: string | null
          created_at: string
          excerpt: string | null
          id: string
          published: boolean
          published_at: string | null
          read_minutes: number | null
          slug: string
          title: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          author_name?: string | null
          body?: string | null
          category?: string | null
          cover_storage_path?: string | null
          created_at?: string
          excerpt?: string | null
          id?: string
          published?: boolean
          published_at?: string | null
          read_minutes?: number | null
          slug: string
          title: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          author_name?: string | null
          body?: string | null
          category?: string | null
          cover_storage_path?: string | null
          created_at?: string
          excerpt?: string | null
          id?: string
          published?: boolean
          published_at?: string | null
          read_minutes?: number | null
          slug?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "blog_posts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      commissions: {
        Row: {
          amount: number
          created_at: string
          id: string
          project_id: string
          rate_pct: number | null
          released_at: string | null
          released_by: string | null
          status: Database["public"]["Enums"]["approval_status"]
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          project_id: string
          rate_pct?: number | null
          released_at?: string | null
          released_by?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          project_id?: string
          rate_pct?: number | null
          released_at?: string | null
          released_by?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commissions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_released_by_fkey"
            columns: ["released_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          client_id: string | null
          client_signature_ip: unknown
          client_signature_name: string | null
          client_signed_at: string | null
          commissioning_pct: number
          company_signed_at: string | null
          company_signed_by: string | null
          contract_value: number
          created_at: string
          delivery_pct: number
          down_payment_pct: number
          financing_approved: boolean | null
          financing_partner: string | null
          financing_required: boolean
          id: string
          lead_id: string
          pdf_path: string | null
          quotation_id: string
          reference: string
          status: Database["public"]["Enums"]["contract_status"]
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          client_signature_ip?: unknown
          client_signature_name?: string | null
          client_signed_at?: string | null
          commissioning_pct?: number
          company_signed_at?: string | null
          company_signed_by?: string | null
          contract_value: number
          created_at?: string
          delivery_pct?: number
          down_payment_pct?: number
          financing_approved?: boolean | null
          financing_partner?: string | null
          financing_required?: boolean
          id?: string
          lead_id: string
          pdf_path?: string | null
          quotation_id: string
          reference?: string
          status?: Database["public"]["Enums"]["contract_status"]
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          client_signature_ip?: unknown
          client_signature_name?: string | null
          client_signed_at?: string | null
          commissioning_pct?: number
          company_signed_at?: string | null
          company_signed_by?: string | null
          contract_value?: number
          created_at?: string
          delivery_pct?: number
          down_payment_pct?: number
          financing_approved?: boolean | null
          financing_partner?: string | null
          financing_required?: boolean
          id?: string
          lead_id?: string
          pdf_path?: string | null
          quotation_id?: string
          reference?: string
          status?: Database["public"]["Enums"]["contract_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contracts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_company_signed_by_fkey"
            columns: ["company_signed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_participants: {
        Row: {
          conversation_id: string
          last_read_at: string | null
          user_id: string
        }
        Insert: {
          conversation_id: string
          last_read_at?: string | null
          user_id: string
        }
        Update: {
          conversation_id?: string
          last_read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_participants_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          last_message_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          last_message_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          last_message_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          client_id: string | null
          id: string
          is_client_visible: boolean
          kind: Database["public"]["Enums"]["document_kind"]
          lead_id: string | null
          mime_type: string | null
          name: string
          project_id: string | null
          size_kb: number | null
          storage_path: string
          ticket_id: string | null
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          client_id?: string | null
          id?: string
          is_client_visible?: boolean
          kind: Database["public"]["Enums"]["document_kind"]
          lead_id?: string | null
          mime_type?: string | null
          name: string
          project_id?: string | null
          size_kb?: number | null
          storage_path: string
          ticket_id?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          client_id?: string | null
          id?: string
          is_client_visible?: boolean
          kind?: Database["public"]["Enums"]["document_kind"]
          lead_id?: string | null
          mime_type?: string | null
          name?: string
          project_id?: string | null
          size_kb?: number | null
          storage_path?: string
          ticket_id?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      estimates: {
        Row: {
          appliances: Json
          battery_count: number
          contact_email: string | null
          created_at: string
          daily_wh: number
          estimated_cost: number | null
          id: string
          inverter_kw: number | null
          lead_id: string | null
          monthly_kwh: number
          monthly_savings: number | null
          panel_count: number | null
          payback_years: number | null
          pdf_path: string | null
          peak_load_w: number
          rate_per_kwh: number | null
          recommended_kw: number | null
          region_id: string
          roof_area_sqm: number | null
          stated_monthly_bill: number | null
          system_type: Database["public"]["Enums"]["system_type"] | null
          usage_pattern: string
        }
        Insert: {
          appliances?: Json
          battery_count?: number
          contact_email?: string | null
          created_at?: string
          daily_wh?: number
          estimated_cost?: number | null
          id?: string
          inverter_kw?: number | null
          lead_id?: string | null
          monthly_kwh?: number
          monthly_savings?: number | null
          panel_count?: number | null
          payback_years?: number | null
          pdf_path?: string | null
          peak_load_w?: number
          rate_per_kwh?: number | null
          recommended_kw?: number | null
          region_id?: string
          roof_area_sqm?: number | null
          stated_monthly_bill?: number | null
          system_type?: Database["public"]["Enums"]["system_type"] | null
          usage_pattern?: string
        }
        Update: {
          appliances?: Json
          battery_count?: number
          contact_email?: string | null
          created_at?: string
          daily_wh?: number
          estimated_cost?: number | null
          id?: string
          inverter_kw?: number | null
          lead_id?: string | null
          monthly_kwh?: number
          monthly_savings?: number | null
          panel_count?: number | null
          payback_years?: number | null
          pdf_path?: string | null
          peak_load_w?: number
          rate_per_kwh?: number | null
          recommended_kw?: number | null
          region_id?: string
          roof_area_sqm?: number | null
          stated_monthly_bill?: number | null
          system_type?: Database["public"]["Enums"]["system_type"] | null
          usage_pattern?: string
        }
        Relationships: [
          {
            foreignKeyName: "estimates_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      faqs: {
        Row: {
          answer: string
          category: string
          created_at: string
          id: string
          published: boolean
          question: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          answer: string
          category?: string
          created_at?: string
          id?: string
          published?: boolean
          question: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          answer?: string
          category?: string
          created_at?: string
          id?: string
          published?: boolean
          question?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      invoices: {
        Row: {
          amount: number
          amount_paid: number
          balance: number | null
          client_id: string | null
          created_at: string
          due_at: string | null
          id: string
          invoice_number: string
          is_manual: boolean
          issued_at: string | null
          notes: string | null
          paid_at: string | null
          pdf_path: string | null
          project_id: string
          stage: Database["public"]["Enums"]["payment_stage"]
          status: Database["public"]["Enums"]["invoice_status"]
          triggered_by_milestone:
            | Database["public"]["Enums"]["milestone_key"]
            | null
          updated_at: string
        }
        Insert: {
          amount: number
          amount_paid?: number
          balance?: number | null
          client_id?: string | null
          created_at?: string
          due_at?: string | null
          id?: string
          invoice_number?: string
          is_manual?: boolean
          issued_at?: string | null
          notes?: string | null
          paid_at?: string | null
          pdf_path?: string | null
          project_id: string
          stage: Database["public"]["Enums"]["payment_stage"]
          status?: Database["public"]["Enums"]["invoice_status"]
          triggered_by_milestone?:
            | Database["public"]["Enums"]["milestone_key"]
            | null
          updated_at?: string
        }
        Update: {
          amount?: number
          amount_paid?: number
          balance?: number | null
          client_id?: string | null
          created_at?: string
          due_at?: string | null
          id?: string
          invoice_number?: string
          is_manual?: boolean
          issued_at?: string | null
          notes?: string | null
          paid_at?: string | null
          pdf_path?: string | null
          project_id?: string
          stage?: Database["public"]["Enums"]["payment_stage"]
          status?: Database["public"]["Enums"]["invoice_status"]
          triggered_by_milestone?:
            | Database["public"]["Enums"]["milestone_key"]
            | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          address: string | null
          assigned_to: string | null
          budget_range: string | null
          converted_client_id: string | null
          created_at: string
          email: string
          estimated_kw: number | null
          id: string
          in_service_area: boolean | null
          is_decision_maker: boolean | null
          location: string | null
          lost_reason: string | null
          monthly_bill: number | null
          name: string
          owns_property: boolean | null
          phone: string | null
          qualification_notes: string | null
          qualified: boolean | null
          score: number
          source: Database["public"]["Enums"]["lead_source"]
          stage: Database["public"]["Enums"]["lead_stage"]
          timeline: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          assigned_to?: string | null
          budget_range?: string | null
          converted_client_id?: string | null
          created_at?: string
          email: string
          estimated_kw?: number | null
          id?: string
          in_service_area?: boolean | null
          is_decision_maker?: boolean | null
          location?: string | null
          lost_reason?: string | null
          monthly_bill?: number | null
          name: string
          owns_property?: boolean | null
          phone?: string | null
          qualification_notes?: string | null
          qualified?: boolean | null
          score?: number
          source?: Database["public"]["Enums"]["lead_source"]
          stage?: Database["public"]["Enums"]["lead_stage"]
          timeline?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          assigned_to?: string | null
          budget_range?: string | null
          converted_client_id?: string | null
          created_at?: string
          email?: string
          estimated_kw?: number | null
          id?: string
          in_service_area?: boolean | null
          is_decision_maker?: boolean | null
          location?: string | null
          lost_reason?: string | null
          monthly_bill?: number | null
          name?: string
          owns_property?: boolean | null
          phone?: string | null
          qualification_notes?: string | null
          qualified?: boolean | null
          score?: number
          source?: Database["public"]["Enums"]["lead_source"]
          stage?: Database["public"]["Enums"]["lead_stage"]
          timeline?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_converted_client_id_fkey"
            columns: ["converted_client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_schedules: {
        Row: {
          appointment_id: string | null
          completed_at: string | null
          created_at: string
          due_date: string
          id: string
          notified_at: string | null
          project_id: string
          report_document_id: string | null
          status: Database["public"]["Enums"]["approval_status"]
          updated_at: string
        }
        Insert: {
          appointment_id?: string | null
          completed_at?: string | null
          created_at?: string
          due_date: string
          id?: string
          notified_at?: string | null
          project_id: string
          report_document_id?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          updated_at?: string
        }
        Update: {
          appointment_id?: string | null
          completed_at?: string | null
          created_at?: string
          due_date?: string
          id?: string
          notified_at?: string | null
          project_id?: string
          report_document_id?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_report_document_fk"
            columns: ["report_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_schedules_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_schedules_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          author_id: string | null
          body: string
          conversation_id: string
          created_at: string
          id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          conversation_id: string
          created_at?: string
          id?: string
        }
        Update: {
          author_id?: string | null
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          appointment_email: boolean
          appointment_sms: boolean
          billing_email: boolean
          billing_sms: boolean
          marketing_email: boolean
          milestone_email: boolean
          milestone_sms: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          appointment_email?: boolean
          appointment_sms?: boolean
          billing_email?: boolean
          billing_sms?: boolean
          marketing_email?: boolean
          milestone_email?: boolean
          milestone_sms?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          appointment_email?: boolean
          appointment_sms?: boolean
          billing_email?: boolean
          billing_sms?: boolean
          marketing_email?: boolean
          milestone_email?: boolean
          milestone_sms?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          attempts: number
          body: string
          category: string
          channel: Database["public"]["Enums"]["notification_channel"]
          claimed_by: string | null
          created_at: string
          delivery_error: string | null
          delivery_status: Database["public"]["Enums"]["delivery_status"]
          entity: string | null
          entity_id: string | null
          id: string
          last_attempt_at: string | null
          provider_message_id: string | null
          read: boolean
          sent_at: string | null
          title: string
          to_email: string | null
          to_phone: string | null
          user_id: string | null
        }
        Insert: {
          attempts?: number
          body: string
          category?: string
          channel?: Database["public"]["Enums"]["notification_channel"]
          claimed_by?: string | null
          created_at?: string
          delivery_error?: string | null
          delivery_status?: Database["public"]["Enums"]["delivery_status"]
          entity?: string | null
          entity_id?: string | null
          id?: string
          last_attempt_at?: string | null
          provider_message_id?: string | null
          read?: boolean
          sent_at?: string | null
          title: string
          to_email?: string | null
          to_phone?: string | null
          user_id?: string | null
        }
        Update: {
          attempts?: number
          body?: string
          category?: string
          channel?: Database["public"]["Enums"]["notification_channel"]
          claimed_by?: string | null
          created_at?: string
          delivery_error?: string | null
          delivery_status?: Database["public"]["Enums"]["delivery_status"]
          entity?: string | null
          entity_id?: string | null
          id?: string
          last_attempt_at?: string | null
          provider_message_id?: string | null
          read?: boolean
          sent_at?: string | null
          title?: string
          to_email?: string | null
          to_phone?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      packages: {
        Row: {
          created_at: string
          featured: boolean
          id: string
          ideal_for: string | null
          inclusions: string[]
          is_active: boolean
          name: string
          price_from: number
          segment: Database["public"]["Enums"]["segment"]
          size_kw: number
          sort_order: number
          system_type: Database["public"]["Enums"]["system_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          featured?: boolean
          id?: string
          ideal_for?: string | null
          inclusions?: string[]
          is_active?: boolean
          name: string
          price_from: number
          segment?: Database["public"]["Enums"]["segment"]
          size_kw: number
          sort_order?: number
          system_type: Database["public"]["Enums"]["system_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          featured?: boolean
          id?: string
          ideal_for?: string | null
          inclusions?: string[]
          is_active?: boolean
          name?: string
          price_from?: number
          segment?: Database["public"]["Enums"]["segment"]
          size_kw?: number
          sort_order?: number
          system_type?: Database["public"]["Enums"]["system_type"]
          updated_at?: string
        }
        Relationships: []
      }
      payment_refunds: {
        Row: {
          amount: number
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          external_reference: string | null
          id: string
          payment_id: string
          reason: string
          recorded_at: string
          recorded_by: string | null
          status: Database["public"]["Enums"]["refund_status"]
        }
        Insert: {
          amount: number
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          external_reference?: string | null
          id?: string
          payment_id: string
          reason: string
          recorded_at?: string
          recorded_by?: string | null
          status?: Database["public"]["Enums"]["refund_status"]
        }
        Update: {
          amount?: number
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          external_reference?: string | null
          id?: string
          payment_id?: string
          reason?: string
          recorded_at?: string
          recorded_by?: string | null
          status?: Database["public"]["Enums"]["refund_status"]
        }
        Relationships: [
          {
            foreignKeyName: "payment_refunds_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_refunds_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_refunds_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          invoice_id: string
          note: string | null
          paid_at: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          recorded_by: string | null
          reference: string | null
          verified: boolean
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          invoice_id: string
          note?: string | null
          paid_at?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          recorded_by?: string | null
          reference?: string | null
          verified?: boolean
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          invoice_id?: string
          note?: string | null
          paid_at?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          recorded_by?: string | null
          reference?: string | null
          verified?: boolean
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_lines: {
        Row: {
          base_pay: number
          commission_pay: number
          created_at: string
          deductions: number
          gross_pay: number | null
          id: string
          net_pay: number | null
          notes: string | null
          overtime_hours: number
          overtime_pay: number
          payroll_run_id: string
          regular_hours: number
          user_id: string
        }
        Insert: {
          base_pay?: number
          commission_pay?: number
          created_at?: string
          deductions?: number
          gross_pay?: number | null
          id?: string
          net_pay?: number | null
          notes?: string | null
          overtime_hours?: number
          overtime_pay?: number
          payroll_run_id: string
          regular_hours?: number
          user_id: string
        }
        Update: {
          base_pay?: number
          commission_pay?: number
          created_at?: string
          deductions?: number
          gross_pay?: number | null
          id?: string
          net_pay?: number | null
          notes?: string | null
          overtime_hours?: number
          overtime_pay?: number
          payroll_run_id?: string
          regular_hours?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_lines_payroll_run_id_fkey"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_lines_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_runs: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          id: string
          period_end: string
          period_start: string
          status: Database["public"]["Enums"]["payroll_status"]
          total_gross: number
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          id?: string
          period_end: string
          period_start: string
          status?: Database["public"]["Enums"]["payroll_status"]
          total_gross?: number
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          id?: string
          period_end?: string
          period_start?: string
          status?: Database["public"]["Enums"]["payroll_status"]
          total_gross?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_runs_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      permits: {
        Row: {
          authority: string
          created_at: string
          decided_at: string | null
          document_id: string | null
          external_reference: string | null
          fee_amount: number | null
          findings: string | null
          id: string
          permit_type: Database["public"]["Enums"]["permit_type"]
          project_id: string
          recorded_at: string | null
          recorded_by: string | null
          status: Database["public"]["Enums"]["permit_status"]
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          authority: string
          created_at?: string
          decided_at?: string | null
          document_id?: string | null
          external_reference?: string | null
          fee_amount?: number | null
          findings?: string | null
          id?: string
          permit_type: Database["public"]["Enums"]["permit_type"]
          project_id: string
          recorded_at?: string | null
          recorded_by?: string | null
          status?: Database["public"]["Enums"]["permit_status"]
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          authority?: string
          created_at?: string
          decided_at?: string | null
          document_id?: string | null
          external_reference?: string | null
          fee_amount?: number | null
          findings?: string | null
          id?: string
          permit_type?: Database["public"]["Enums"]["permit_type"]
          project_id?: string
          recorded_at?: string | null
          recorded_by?: string | null
          status?: Database["public"]["Enums"]["permit_status"]
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "permits_document_fk"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "permits_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "permits_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolio_items: {
        Row: {
          client_consented: boolean
          cover_storage_path: string | null
          created_at: string
          gallery_paths: string[]
          id: string
          location: string | null
          project_id: string | null
          published: boolean
          segment: string | null
          sort_order: number
          summary: string | null
          system_size: string | null
          title: string
          updated_at: string
          year: number | null
        }
        Insert: {
          client_consented?: boolean
          cover_storage_path?: string | null
          created_at?: string
          gallery_paths?: string[]
          id?: string
          location?: string | null
          project_id?: string | null
          published?: boolean
          segment?: string | null
          sort_order?: number
          summary?: string | null
          system_size?: string | null
          title: string
          updated_at?: string
          year?: number | null
        }
        Update: {
          client_consented?: boolean
          cover_storage_path?: string | null
          created_at?: string
          gallery_paths?: string[]
          id?: string
          location?: string | null
          project_id?: string | null
          published?: boolean
          segment?: string | null
          sort_order?: number
          summary?: string | null
          system_size?: string | null
          title?: string
          updated_at?: string
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          address: string | null
          approval_status: Database["public"]["Enums"]["staff_approval"] | null
          approved_at: string | null
          approved_by: string | null
          avatar_initials: string | null
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          is_active: boolean
          phone: string | null
          rejection_reason: string | null
          requested_role: Database["public"]["Enums"]["user_role"] | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          address?: string | null
          approval_status?: Database["public"]["Enums"]["staff_approval"] | null
          approved_at?: string | null
          approved_by?: string | null
          avatar_initials?: string | null
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name: string
          id: string
          is_active?: boolean
          phone?: string | null
          rejection_reason?: string | null
          requested_role?: Database["public"]["Enums"]["user_role"] | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          address?: string | null
          approval_status?: Database["public"]["Enums"]["staff_approval"] | null
          approved_at?: string | null
          approved_by?: string | null
          avatar_initials?: string | null
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean
          phone?: string | null
          rejection_reason?: string | null
          requested_role?: Database["public"]["Enums"]["user_role"] | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      project_crew: {
        Row: {
          assigned_at: string
          crew_role: string
          project_id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          crew_role?: string
          project_id: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          crew_role?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_crew_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_crew_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      project_milestones: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          created_at: string
          id: string
          key: Database["public"]["Enums"]["milestone_key"]
          label: string
          note: string | null
          project_id: string
          sequence: number
          status: Database["public"]["Enums"]["milestone_status"]
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          key: Database["public"]["Enums"]["milestone_key"]
          label: string
          note?: string | null
          project_id: string
          sequence: number
          status?: Database["public"]["Enums"]["milestone_status"]
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          key?: Database["public"]["Enums"]["milestone_key"]
          label?: string
          note?: string | null
          project_id?: string
          sequence?: number
          status?: Database["public"]["Enums"]["milestone_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_milestones_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_milestones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          actual_turnover: string | null
          address: string
          amount_paid: number
          assigned_engineer: string | null
          client_id: string | null
          contract_id: string | null
          contract_value: number
          created_at: string
          id: string
          lead_id: string | null
          reference: string
          start_date: string | null
          status: Database["public"]["Enums"]["project_status"]
          system_kw: number
          system_type: Database["public"]["Enums"]["system_type"]
          target_turnover: string | null
          updated_at: string
          warranty_start_date: string | null
        }
        Insert: {
          actual_turnover?: string | null
          address: string
          amount_paid?: number
          assigned_engineer?: string | null
          client_id?: string | null
          contract_id?: string | null
          contract_value: number
          created_at?: string
          id?: string
          lead_id?: string | null
          reference: string
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          system_kw: number
          system_type: Database["public"]["Enums"]["system_type"]
          target_turnover?: string | null
          updated_at?: string
          warranty_start_date?: string | null
        }
        Update: {
          actual_turnover?: string | null
          address?: string
          amount_paid?: number
          assigned_engineer?: string | null
          client_id?: string | null
          contract_id?: string | null
          contract_value?: number
          created_at?: string
          id?: string
          lead_id?: string | null
          reference?: string
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          system_kw?: number
          system_type?: Database["public"]["Enums"]["system_type"]
          target_turnover?: string | null
          updated_at?: string
          warranty_start_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_assigned_engineer_fkey"
            columns: ["assigned_engineer"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_lines: {
        Row: {
          id: string
          line_total: number | null
          purchase_order_id: string
          quantity: number
          quantity_received: number
          stock_item_id: string
          unit_cost: number
        }
        Insert: {
          id?: string
          line_total?: number | null
          purchase_order_id: string
          quantity: number
          quantity_received?: number
          stock_item_id: string
          unit_cost: number
        }
        Update: {
          id?: string
          line_total?: number | null
          purchase_order_id?: string
          quantity?: number
          quantity_received?: number
          stock_item_id?: string
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_lines_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_lines_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          expected_at: string | null
          id: string
          matched_at: string | null
          matched_by: string | null
          notes: string | null
          po_number: string
          received_at: string | null
          recorded_by: string | null
          rejection_reason: string | null
          requested_by: string | null
          status: Database["public"]["Enums"]["po_status"]
          supplier_confirmed_at: string | null
          supplier_id: string
          supplier_invoice_ref: string | null
          supplier_reference: string | null
          total_amount: number
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          expected_at?: string | null
          id?: string
          matched_at?: string | null
          matched_by?: string | null
          notes?: string | null
          po_number?: string
          received_at?: string | null
          recorded_by?: string | null
          rejection_reason?: string | null
          requested_by?: string | null
          status?: Database["public"]["Enums"]["po_status"]
          supplier_confirmed_at?: string | null
          supplier_id: string
          supplier_invoice_ref?: string | null
          supplier_reference?: string | null
          total_amount?: number
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          expected_at?: string | null
          id?: string
          matched_at?: string | null
          matched_by?: string | null
          notes?: string | null
          po_number?: string
          received_at?: string | null
          recorded_by?: string | null
          rejection_reason?: string | null
          requested_by?: string | null
          status?: Database["public"]["Enums"]["po_status"]
          supplier_confirmed_at?: string | null
          supplier_id?: string
          supplier_invoice_ref?: string | null
          supplier_reference?: string | null
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_matched_by_fkey"
            columns: ["matched_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      quotation_lines: {
        Row: {
          description: string
          id: string
          line_total: number | null
          quantity: number
          quotation_id: string
          sort_order: number
          stock_item_id: string | null
          unit_price: number
        }
        Insert: {
          description: string
          id?: string
          line_total?: number | null
          quantity: number
          quotation_id: string
          sort_order?: number
          stock_item_id?: string | null
          unit_price: number
        }
        Update: {
          description?: string
          id?: string
          line_total?: number | null
          quantity?: number
          quotation_id?: string
          sort_order?: number
          stock_item_id?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "quotation_lines_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotation_lines_stock_item_fk"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      quotations: {
        Row: {
          battery_count: number
          created_at: string
          discount_approved_at: string | null
          discount_approved_by: string | null
          discount_pct: number
          estimate_id: string | null
          id: string
          labour_cost: number
          lead_id: string
          margin_pct: number
          material_cost: number
          package_id: string | null
          panel_count: number | null
          pdf_path: string | null
          prepared_by: string | null
          reference: string
          rejection_reason: string | null
          responded_at: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["quotation_status"]
          system_kw: number
          system_type: Database["public"]["Enums"]["system_type"]
          total_price: number
          updated_at: string
          valid_until: string | null
          version: number
        }
        Insert: {
          battery_count?: number
          created_at?: string
          discount_approved_at?: string | null
          discount_approved_by?: string | null
          discount_pct?: number
          estimate_id?: string | null
          id?: string
          labour_cost?: number
          lead_id: string
          margin_pct?: number
          material_cost?: number
          package_id?: string | null
          panel_count?: number | null
          pdf_path?: string | null
          prepared_by?: string | null
          reference?: string
          rejection_reason?: string | null
          responded_at?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["quotation_status"]
          system_kw: number
          system_type: Database["public"]["Enums"]["system_type"]
          total_price?: number
          updated_at?: string
          valid_until?: string | null
          version?: number
        }
        Update: {
          battery_count?: number
          created_at?: string
          discount_approved_at?: string | null
          discount_approved_by?: string | null
          discount_pct?: number
          estimate_id?: string | null
          id?: string
          labour_cost?: number
          lead_id?: string
          margin_pct?: number
          material_cost?: number
          package_id?: string | null
          panel_count?: number | null
          pdf_path?: string | null
          prepared_by?: string | null
          reference?: string
          rejection_reason?: string | null
          responded_at?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["quotation_status"]
          system_kw?: number
          system_type?: Database["public"]["Enums"]["system_type"]
          total_price?: number
          updated_at?: string
          valid_until?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "quotations_discount_approved_by_fkey"
            columns: ["discount_approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_prepared_by_fkey"
            columns: ["prepared_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          client_id: string | null
          created_at: string
          display_location: string | null
          display_name: string
          id: string
          moderated_at: string | null
          moderated_by: string | null
          project_id: string | null
          published: boolean
          quote: string
          rating: number
          referral_contact: string | null
          referral_name: string | null
          status: Database["public"]["Enums"]["approval_status"]
          system_summary: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          display_location?: string | null
          display_name?: string
          id?: string
          moderated_at?: string | null
          moderated_by?: string | null
          project_id?: string | null
          published?: boolean
          quote: string
          rating: number
          referral_contact?: string | null
          referral_name?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          system_summary?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string
          display_location?: string | null
          display_name?: string
          id?: string
          moderated_at?: string | null
          moderated_by?: string | null
          project_id?: string | null
          published?: boolean
          quote?: string
          rating?: number
          referral_contact?: string | null
          referral_name?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          system_summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reviews_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_moderated_by_fkey"
            columns: ["moderated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      rma_claims: {
        Row: {
          claim_reference: string
          created_at: string
          decision_at: string | null
          decision_notes: string | null
          external_reference: string | null
          fault_description: string
          filed_at: string | null
          id: string
          manufacturer: string
          recorded_at: string | null
          recorded_by: string | null
          replacement_asset_id: string | null
          serialised_asset_id: string
          status: Database["public"]["Enums"]["rma_status"]
          ticket_id: string | null
          updated_at: string
        }
        Insert: {
          claim_reference?: string
          created_at?: string
          decision_at?: string | null
          decision_notes?: string | null
          external_reference?: string | null
          fault_description: string
          filed_at?: string | null
          id?: string
          manufacturer: string
          recorded_at?: string | null
          recorded_by?: string | null
          replacement_asset_id?: string | null
          serialised_asset_id: string
          status?: Database["public"]["Enums"]["rma_status"]
          ticket_id?: string | null
          updated_at?: string
        }
        Update: {
          claim_reference?: string
          created_at?: string
          decision_at?: string | null
          decision_notes?: string | null
          external_reference?: string | null
          fault_description?: string
          filed_at?: string | null
          id?: string
          manufacturer?: string
          recorded_at?: string | null
          recorded_by?: string | null
          replacement_asset_id?: string | null
          serialised_asset_id?: string
          status?: Database["public"]["Enums"]["rma_status"]
          ticket_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rma_claims_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rma_claims_replacement_asset_id_fkey"
            columns: ["replacement_asset_id"]
            isOneToOne: false
            referencedRelation: "serialised_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rma_claims_serialised_asset_id_fkey"
            columns: ["serialised_asset_id"]
            isOneToOne: false
            referencedRelation: "serialised_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rma_claims_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      serialised_assets: {
        Row: {
          client_id: string | null
          created_at: string
          id: string
          installed_at: string | null
          product_name: string
          project_id: string | null
          scanned_by: string | null
          serial_number: string
          status: Database["public"]["Enums"]["asset_status"]
          stock_item_id: string | null
          updated_at: string
          warranty_expires_at: string | null
          warranty_years: number
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          id?: string
          installed_at?: string | null
          product_name: string
          project_id?: string | null
          scanned_by?: string | null
          serial_number: string
          status?: Database["public"]["Enums"]["asset_status"]
          stock_item_id?: string | null
          updated_at?: string
          warranty_expires_at?: string | null
          warranty_years?: number
        }
        Update: {
          client_id?: string | null
          created_at?: string
          id?: string
          installed_at?: string | null
          product_name?: string
          project_id?: string | null
          scanned_by?: string | null
          serial_number?: string
          status?: Database["public"]["Enums"]["asset_status"]
          stock_item_id?: string | null
          updated_at?: string
          warranty_expires_at?: string | null
          warranty_years?: number
        }
        Relationships: [
          {
            foreignKeyName: "serialised_assets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "serialised_assets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "serialised_assets_scanned_by_fkey"
            columns: ["scanned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "serialised_assets_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          category: string
          description: string | null
          editable_by: Database["public"]["Enums"]["user_role"][]
          is_public: boolean
          key: string
          label: string
          max_value: number | null
          min_value: number | null
          sort_order: number
          unit: string | null
          updated_at: string
          updated_by: string | null
          value: Json
          value_type: Database["public"]["Enums"]["setting_type"]
        }
        Insert: {
          category: string
          description?: string | null
          editable_by?: Database["public"]["Enums"]["user_role"][]
          is_public?: boolean
          key: string
          label: string
          max_value?: number | null
          min_value?: number | null
          sort_order?: number
          unit?: string | null
          updated_at?: string
          updated_by?: string | null
          value: Json
          value_type?: Database["public"]["Enums"]["setting_type"]
        }
        Update: {
          category?: string
          description?: string | null
          editable_by?: Database["public"]["Enums"]["user_role"][]
          is_public?: boolean
          key?: string
          label?: string
          max_value?: number | null
          min_value?: number | null
          sort_order?: number
          unit?: string | null
          updated_at?: string
          updated_by?: string | null
          value?: Json
          value_type?: Database["public"]["Enums"]["setting_type"]
        }
        Relationships: [
          {
            foreignKeyName: "settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      site_photos: {
        Row: {
          appointment_id: string | null
          caption: string | null
          id: string
          is_client_visible: boolean
          latitude: number | null
          longitude: number | null
          photo_category: string | null
          project_id: string | null
          storage_path: string
          taken_at: string
          uploaded_by: string | null
        }
        Insert: {
          appointment_id?: string | null
          caption?: string | null
          id?: string
          is_client_visible?: boolean
          latitude?: number | null
          longitude?: number | null
          photo_category?: string | null
          project_id?: string | null
          storage_path: string
          taken_at?: string
          uploaded_by?: string | null
        }
        Update: {
          appointment_id?: string | null
          caption?: string | null
          id?: string
          is_client_visible?: boolean
          latitude?: number | null
          longitude?: number | null
          photo_category?: string | null
          project_id?: string | null
          storage_path?: string
          taken_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "site_photos_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_photos_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_photos_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_items: {
        Row: {
          brand: string | null
          category: Database["public"]["Enums"]["stock_category"]
          created_at: string
          id: string
          is_serialised: boolean
          name: string
          on_hand: number
          reorder_point: number
          reserved: number
          sku: string
          supplier_id: string | null
          unit: string
          unit_cost: number
          updated_at: string
        }
        Insert: {
          brand?: string | null
          category: Database["public"]["Enums"]["stock_category"]
          created_at?: string
          id?: string
          is_serialised?: boolean
          name: string
          on_hand?: number
          reorder_point?: number
          reserved?: number
          sku: string
          supplier_id?: string | null
          unit?: string
          unit_cost?: number
          updated_at?: string
        }
        Update: {
          brand?: string | null
          category?: Database["public"]["Enums"]["stock_category"]
          created_at?: string
          id?: string
          is_serialised?: boolean
          name?: string
          on_hand?: number
          reorder_point?: number
          reserved?: number
          sku?: string
          supplier_id?: string | null
          unit?: string
          unit_cost?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_items_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          movement_type: Database["public"]["Enums"]["movement_type"]
          note: string | null
          project_id: string | null
          purchase_order_id: string | null
          quantity: number
          reference: string | null
          stock_item_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          movement_type: Database["public"]["Enums"]["movement_type"]
          note?: string | null
          project_id?: string | null
          purchase_order_id?: string | null
          quantity: number
          reference?: string | null
          stock_item_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          movement_type?: Database["public"]["Enums"]["movement_type"]
          note?: string | null
          project_id?: string | null
          purchase_order_id?: string | null
          quantity?: number
          reference?: string | null
          stock_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_po_fk"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_reservations: {
        Row: {
          created_at: string
          id: string
          project_id: string
          quantity: number
          quantity_held: number
          status: Database["public"]["Enums"]["reservation_status"]
          stock_item_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          quantity: number
          quantity_held?: number
          status?: Database["public"]["Enums"]["reservation_status"]
          stock_item_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          quantity?: number
          quantity_held?: number
          status?: Database["public"]["Enums"]["reservation_status"]
          stock_item_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_reservations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_reservations_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          contact_person: string | null
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          lead_time_days: number
          name: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          lead_time_days?: number
          name: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          lead_time_days?: number
          name?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ticket_messages: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          is_internal: boolean
          ticket_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          is_internal?: boolean
          ticket_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          is_internal?: boolean
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_messages_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      tickets: {
        Row: {
          assigned_to: string | null
          billable_approved: boolean | null
          billable_quote_amount: number | null
          category: Database["public"]["Enums"]["ticket_category"]
          client_id: string | null
          created_at: string
          description: string | null
          id: string
          priority: Database["public"]["Enums"]["ticket_priority"]
          project_id: string | null
          reference: string
          resolution: string | null
          resolved_at: string | null
          satisfaction_rating: number | null
          status: Database["public"]["Enums"]["ticket_status"]
          subject: string
          triaged_at: string | null
          triaged_by: string | null
          updated_at: string
          warranty_covered: boolean | null
        }
        Insert: {
          assigned_to?: string | null
          billable_approved?: boolean | null
          billable_quote_amount?: number | null
          category?: Database["public"]["Enums"]["ticket_category"]
          client_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["ticket_priority"]
          project_id?: string | null
          reference?: string
          resolution?: string | null
          resolved_at?: string | null
          satisfaction_rating?: number | null
          status?: Database["public"]["Enums"]["ticket_status"]
          subject: string
          triaged_at?: string | null
          triaged_by?: string | null
          updated_at?: string
          warranty_covered?: boolean | null
        }
        Update: {
          assigned_to?: string | null
          billable_approved?: boolean | null
          billable_quote_amount?: number | null
          category?: Database["public"]["Enums"]["ticket_category"]
          client_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["ticket_priority"]
          project_id?: string | null
          reference?: string
          resolution?: string | null
          resolved_at?: string | null
          satisfaction_rating?: number | null
          status?: Database["public"]["Enums"]["ticket_status"]
          subject?: string
          triaged_at?: string | null
          triaged_by?: string | null
          updated_at?: string
          warranty_covered?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "tickets_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_triaged_by_fkey"
            columns: ["triaged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      time_logs: {
        Row: {
          appointment_id: string | null
          clock_in: string
          clock_out: string | null
          created_at: string
          hours: number | null
          id: string
          latitude: number | null
          longitude: number | null
          note: string | null
          project_id: string | null
          user_id: string
        }
        Insert: {
          appointment_id?: string | null
          clock_in: string
          clock_out?: string | null
          created_at?: string
          hours?: number | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          note?: string | null
          project_id?: string | null
          user_id: string
        }
        Update: {
          appointment_id?: string | null
          clock_in?: string
          clock_out?: string | null
          created_at?: string
          hours?: number | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          note?: string | null
          project_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_logs_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      warranty_requests: {
        Row: {
          client_id: string
          expected_transfer_date: string | null
          id: string
          project_id: string
          proof_document_id: string | null
          request_type: Database["public"]["Enums"]["warranty_request_type"]
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["approval_status"]
          submitted_at: string
          transfer_to_email: string | null
          transfer_to_name: string | null
          transfer_to_phone: string | null
        }
        Insert: {
          client_id: string
          expected_transfer_date?: string | null
          id?: string
          project_id: string
          proof_document_id?: string | null
          request_type: Database["public"]["Enums"]["warranty_request_type"]
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          submitted_at?: string
          transfer_to_email?: string | null
          transfer_to_name?: string | null
          transfer_to_phone?: string | null
        }
        Update: {
          client_id?: string
          expected_transfer_date?: string | null
          id?: string
          project_id?: string
          proof_document_id?: string | null
          request_type?: Database["public"]["Enums"]["warranty_request_type"]
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          submitted_at?: string
          transfer_to_email?: string | null
          transfer_to_name?: string | null
          transfer_to_phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "warranty_proof_document_fk"
            columns: ["proof_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warranty_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warranty_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warranty_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      am_in_conversation: { Args: { p_conversation: string }; Returns: boolean }
      approve_staff: {
        Args: {
          p_approve: boolean
          p_reason?: string
          p_role?: string
          p_user_id: string
        }
        Returns: undefined
      }
      available_slots: { Args: { p_date: string }; Returns: Json }
      check_public_form_rate: { Args: { p_email: string }; Returns: undefined }
      claim_notifications: {
        Args: { p_limit?: number; p_worker: string }
        Returns: {
          attempts: number
          body: string
          category: string
          channel: Database["public"]["Enums"]["notification_channel"]
          claimed_by: string | null
          created_at: string
          delivery_error: string | null
          delivery_status: Database["public"]["Enums"]["delivery_status"]
          entity: string | null
          entity_id: string | null
          id: string
          last_attempt_at: string | null
          provider_message_id: string | null
          read: boolean
          sent_at: string | null
          title: string
          to_email: string | null
          to_phone: string | null
          user_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "notifications"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      console_search: {
        Args: { p_term: string }
        Returns: {
          id: string
          kind: string
          subtitle: string
          title: string
        }[]
      }
      consume_project_stock: {
        Args: {
          p_project_id: string
          p_quantity: number
          p_stock_item_id: string
        }
        Returns: undefined
      }
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      estimator_settings_readable: {
        Args: never
        Returns: {
          is_public: boolean
          key: string
        }[]
      }
      grant_admin: { Args: { p_email: string }; Returns: string }
      grant_staff_role: {
        Args: { p_email: string; p_role: string }
        Returns: string
      }
      has_role: {
        Args: { roles: Database["public"]["Enums"]["user_role"][] }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      is_assigned_to_appointment: {
        Args: { p_appointment_id: string }
        Returns: boolean
      }
      is_crew_on_project: { Args: { p_project_id: string }; Returns: boolean }
      is_internal: { Args: never; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      may_message: { Args: { p_other: string }; Returns: boolean }
      messageable_people: {
        Args: never
        Returns: {
          avatar_initials: string
          avatar_url: string
          full_name: string
          id: string
          role: Database["public"]["Enums"]["user_role"]
        }[]
      }
      open_conversation: {
        Args: { p_body: string; p_other: string }
        Returns: string
      }
      owns_project: { Args: { p_project_id: string }; Returns: boolean }
      project_contact: { Args: { p_project_id: string }; Returns: Json }
      project_gate_status: { Args: { p_project_id: string }; Returns: Json }
      project_ready_for_dispatch: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      record_client_upload: {
        Args: {
          p_kind: string
          p_mime_type?: string
          p_name: string
          p_project_id: string
          p_size_kb?: number
          p_storage_path: string
          p_ticket_id?: string
        }
        Returns: string
      }
      release_project_reservations: {
        Args: { p_project_id: string }
        Returns: undefined
      }
      request_booking: {
        Args: {
          p_address?: string
          p_appointment_type: string
          p_email: string
          p_name: string
          p_notes?: string
          p_phone: string
          p_scheduled_date: string
          p_time_slot: string
        }
        Returns: undefined
      }
      request_upgrade: {
        Args: { p_details?: string; p_monthly_bill?: number; p_reason: string }
        Returns: string
      }
      requeue_stalled_notifications: { Args: never; Returns: number }
      reserve_stock_for_project: {
        Args: { p_project_id: string; p_quotation_id: string }
        Returns: undefined
      }
      setting_num: {
        Args: { p_default: number; p_key: string }
        Returns: number
      }
      setting_text: {
        Args: { p_default: string; p_key: string }
        Returns: string
      }
      settle_notification: {
        Args: {
          p_error?: string
          p_id: string
          p_provider_message_id?: string
          p_status: Database["public"]["Enums"]["delivery_status"]
        }
        Returns: undefined
      }
      staff_display_names: { Args: { p_ids: string[] }; Returns: Json }
      staff_for_client: {
        Args: { p_client: string }
        Returns: {
          user_id: string
        }[]
      }
      submit_enquiry: {
        Args: {
          p_address?: string
          p_email: string
          p_message?: string
          p_monthly_bill?: number
          p_name: string
          p_phone?: string
        }
        Returns: undefined
      }
      submit_estimate: {
        Args: {
          p_address: string
          p_appliances: Json
          p_email: string
          p_estimate: Json
          p_name: string
          p_phone: string
        }
        Returns: undefined
      }
      ticket_thread: {
        Args: { p_ticket_id: string }
        Returns: {
          author_is_staff: boolean
          author_name: string
          body: string
          created_at: string
          id: string
          is_internal: boolean
        }[]
      }
      validate_public_contact: {
        Args: { p_email: string; p_name: string }
        Returns: undefined
      }
      write_audit: {
        Args: {
          p_action: string
          p_entity: string
          p_entity_id: string
          p_metadata?: Json
          p_severity?: Database["public"]["Enums"]["audit_severity"]
        }
        Returns: undefined
      }
    }
    Enums: {
      appointment_status:
        | "requested"
        | "confirmed"
        | "dispatched"
        | "in_progress"
        | "completed"
        | "cancelled"
      appointment_type:
        | "virtual_consultation"
        | "site_survey"
        | "installation"
        | "maintenance"
        | "repair"
      approval_status: "pending" | "approved" | "rejected"
      asset_status: "installed" | "replaced" | "removed" | "faulty"
      audit_severity: "info" | "warning" | "critical"
      contract_status:
        | "draft"
        | "awaiting_client"
        | "awaiting_company"
        | "executed"
        | "cancelled"
      delivery_status: "queued" | "sent" | "failed" | "skipped"
      document_kind:
        | "quotation"
        | "contract"
        | "invoice"
        | "receipt"
        | "warranty_certificate"
        | "turnover_certificate"
        | "inspection_report"
        | "permit"
        | "survey_report"
        | "as_built"
        | "proof_of_sale"
        | "other"
      invoice_status:
        | "draft"
        | "sent"
        | "partially_paid"
        | "paid"
        | "overdue"
        | "void"
      lead_source:
        | "estimator"
        | "quote_request"
        | "referral"
        | "walk_in"
        | "facebook"
      lead_stage:
        | "new"
        | "quoted"
        | "site_visit"
        | "contract"
        | "installed"
        | "lost"
      milestone_key:
        | "engineering_survey"
        | "permitting"
        | "structural_mounting"
        | "dc_wiring"
        | "ac_wiring"
        | "commissioning"
        | "turnover"
      milestone_status: "pending" | "in_progress" | "done" | "blocked"
      movement_type:
        | "receipt"
        | "issue"
        | "consumption"
        | "return"
        | "adjustment"
        | "write_off"
      notification_channel: "in_app" | "email" | "sms"
      payment_intent_status:
        | "awaiting_payment"
        | "processing"
        | "succeeded"
        | "failed"
        | "cancelled"
        | "expired"
      payment_method:
        | "bank_transfer"
        | "cash"
        | "cheque"
        | "gcash"
        | "maya"
        | "credit_card"
        | "financing"
        | "grabpay"
        | "qrph"
        | "online_banking"
      payment_stage: "down_payment" | "delivery" | "commissioning" | "retention"
      payroll_status: "draft" | "pending_approval" | "approved" | "paid"
      permit_status:
        | "preparing"
        | "submitted"
        | "under_review"
        | "approved"
        | "rejected"
      permit_type:
        | "lgu_building"
        | "electrical"
        | "utility_interconnection"
        | "net_metering"
        | "permission_to_operate"
      po_status:
        | "draft"
        | "pending_approval"
        | "approved"
        | "ordered"
        | "partially_received"
        | "received"
        | "cancelled"
      project_status:
        | "planning"
        | "in_progress"
        | "on_hold"
        | "completed"
        | "cancelled"
      quotation_status:
        | "draft"
        | "pending_approval"
        | "sent"
        | "accepted"
        | "rejected"
        | "expired"
      refund_status: "recorded" | "confirmed" | "cancelled"
      reservation_status:
        | "reserved"
        | "short"
        | "issued"
        | "consumed"
        | "released"
      rma_status:
        | "draft"
        | "filed"
        | "under_assessment"
        | "approved"
        | "rejected"
        | "replacement_received"
        | "closed"
      segment: "residential" | "commercial"
      setting_type: "number" | "percent" | "currency" | "text" | "boolean"
      staff_approval: "pending" | "approved" | "rejected"
      stock_category:
        | "panel"
        | "inverter"
        | "battery"
        | "racking"
        | "charge_controller"
        | "accessory"
      system_type: "on_grid" | "hybrid" | "off_grid"
      ticket_category:
        | "hardware_fault"
        | "performance"
        | "billing"
        | "maintenance"
        | "upgrade"
        | "other"
      ticket_priority: "low" | "normal" | "high" | "urgent"
      ticket_status:
        | "open"
        | "in_progress"
        | "awaiting_client"
        | "resolved"
        | "closed"
      user_role:
        | "client"
        | "sales"
        | "project_engineer"
        | "inventory_manager"
        | "accountant"
        | "technician"
        | "admin"
      warranty_request_type: "registration" | "transfer"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      appointment_status: [
        "requested",
        "confirmed",
        "dispatched",
        "in_progress",
        "completed",
        "cancelled",
      ],
      appointment_type: [
        "virtual_consultation",
        "site_survey",
        "installation",
        "maintenance",
        "repair",
      ],
      approval_status: ["pending", "approved", "rejected"],
      asset_status: ["installed", "replaced", "removed", "faulty"],
      audit_severity: ["info", "warning", "critical"],
      contract_status: [
        "draft",
        "awaiting_client",
        "awaiting_company",
        "executed",
        "cancelled",
      ],
      delivery_status: ["queued", "sent", "failed", "skipped"],
      document_kind: [
        "quotation",
        "contract",
        "invoice",
        "receipt",
        "warranty_certificate",
        "turnover_certificate",
        "inspection_report",
        "permit",
        "survey_report",
        "as_built",
        "proof_of_sale",
        "other",
      ],
      invoice_status: [
        "draft",
        "sent",
        "partially_paid",
        "paid",
        "overdue",
        "void",
      ],
      lead_source: [
        "estimator",
        "quote_request",
        "referral",
        "walk_in",
        "facebook",
      ],
      lead_stage: [
        "new",
        "quoted",
        "site_visit",
        "contract",
        "installed",
        "lost",
      ],
      milestone_key: [
        "engineering_survey",
        "permitting",
        "structural_mounting",
        "dc_wiring",
        "ac_wiring",
        "commissioning",
        "turnover",
      ],
      milestone_status: ["pending", "in_progress", "done", "blocked"],
      movement_type: [
        "receipt",
        "issue",
        "consumption",
        "return",
        "adjustment",
        "write_off",
      ],
      notification_channel: ["in_app", "email", "sms"],
      payment_intent_status: [
        "awaiting_payment",
        "processing",
        "succeeded",
        "failed",
        "cancelled",
        "expired",
      ],
      payment_method: [
        "bank_transfer",
        "cash",
        "cheque",
        "gcash",
        "maya",
        "credit_card",
        "financing",
        "grabpay",
        "qrph",
        "online_banking",
      ],
      payment_stage: ["down_payment", "delivery", "commissioning", "retention"],
      payroll_status: ["draft", "pending_approval", "approved", "paid"],
      permit_status: [
        "preparing",
        "submitted",
        "under_review",
        "approved",
        "rejected",
      ],
      permit_type: [
        "lgu_building",
        "electrical",
        "utility_interconnection",
        "net_metering",
        "permission_to_operate",
      ],
      po_status: [
        "draft",
        "pending_approval",
        "approved",
        "ordered",
        "partially_received",
        "received",
        "cancelled",
      ],
      project_status: [
        "planning",
        "in_progress",
        "on_hold",
        "completed",
        "cancelled",
      ],
      quotation_status: [
        "draft",
        "pending_approval",
        "sent",
        "accepted",
        "rejected",
        "expired",
      ],
      refund_status: ["recorded", "confirmed", "cancelled"],
      reservation_status: [
        "reserved",
        "short",
        "issued",
        "consumed",
        "released",
      ],
      rma_status: [
        "draft",
        "filed",
        "under_assessment",
        "approved",
        "rejected",
        "replacement_received",
        "closed",
      ],
      segment: ["residential", "commercial"],
      setting_type: ["number", "percent", "currency", "text", "boolean"],
      staff_approval: ["pending", "approved", "rejected"],
      stock_category: [
        "panel",
        "inverter",
        "battery",
        "racking",
        "charge_controller",
        "accessory",
      ],
      system_type: ["on_grid", "hybrid", "off_grid"],
      ticket_category: [
        "hardware_fault",
        "performance",
        "billing",
        "maintenance",
        "upgrade",
        "other",
      ],
      ticket_priority: ["low", "normal", "high", "urgent"],
      ticket_status: [
        "open",
        "in_progress",
        "awaiting_client",
        "resolved",
        "closed",
      ],
      user_role: [
        "client",
        "sales",
        "project_engineer",
        "inventory_manager",
        "accountant",
        "technician",
        "admin",
      ],
      warranty_request_type: ["registration", "transfer"],
    },
  },
} as const
