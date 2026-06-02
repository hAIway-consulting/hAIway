// Declarative process model of the hAIway AI Foundation Platform.
//
// Lanes = functional categories (swimlanes). Each node carries a {col,row}
// grid position used by generate-bpmn.mjs for auto-layout. Flows express
// trigger / data-flow relationships ("which function triggers which process").
//
// Node types: start | end | timer | gateway | user | service | script | store
//   user    = action by a person (consultant / end user / platform admin)
//   service = code that runs (server action, edge function, worker, ext. service)
//   script  = DB-internal automation (pg_cron, trigger, RPC, pgmq queue)
//   store   = persisted data domain (table group)

export const model = {
  collaborationId: "Collaboration_haiway",
  processId: "Process_haiway",
  pool: { id: "Pool_haiway", name: "hAIway — AI Foundation Platform" },

  lanes: [
    // ---------------------------------------------------------------------
    {
      id: "Lane_user",
      name: "Benutzer & Berater",
      nodes: [
        { id: "start_login", type: "start", name: "Registrieren / Anmelden", col: 0, row: 0 },
        { id: "u_onboard", type: "user", name: "Onboarding ausfüllen", col: 2, row: 0 },
        { id: "u_admin", type: "user", name: "Plattform-Admin: Kunden, Features, Branding, KI-Settings", col: 0, row: 1 },
        { id: "u_upload", type: "user", name: "Quelle hochladen (Text / PDF / Audio)", col: 0, row: 2 },
        { id: "u_import", type: "user", name: "Batch-Import (CSV / Excel)", col: 1, row: 2 },
        { id: "u_connect", type: "user", name: "Connector verbinden (SharePoint / GDrive / Trello / Shopware)", col: 0, row: 3 },
        { id: "u_perm", type: "user", name: "Berechtigungen & Ordner verwalten", col: 1, row: 3 },
        { id: "u_phone_setup", type: "user", name: "Telefon-Assistent konfigurieren", col: 0, row: 4 },
        { id: "u_cal_connect", type: "user", name: "Google-Kalender verbinden", col: 1, row: 4 },
        { id: "u_chat", type: "start", name: "Frage im Chat stellen", col: 3, row: 0 },
        { id: "u_search", type: "user", name: "Volltext-/Semantik-Suche", col: 3, row: 1 },
        { id: "u_review", type: "user", name: "Antwort-Qualität bewerten (Admin)", col: 9, row: 0 },
      ],
    },
    // ---------------------------------------------------------------------
    {
      id: "Lane_web",
      name: "Web-App (Next.js · Server Actions & API)",
      nodes: [
        { id: "a_auth_callback", type: "service", name: "auth/callback · exchangeCodeForSession", col: 1, row: 0 },
        { id: "a_admin", type: "service", name: "createOrganization / toggleFeature / inviteMember", col: 1, row: 1 },
        { id: "a_create_source", type: "service", name: "createTextSource / createPdfSource / createRecordingSource", col: 1, row: 2 },
        { id: "a_batch_import", type: "service", name: "batchImportSources", col: 1, row: 3 },
        { id: "a_connect", type: "service", name: "connectSharepoint / connectGdrive / connectTrello", col: 1, row: 4 },
        { id: "a_perm", type: "service", name: "createPermissionGroup / SourceFolder / grantFolderAccess", col: 1, row: 5 },
        { id: "a_phone_cfg", type: "service", name: "createOrUpdateAssistant / toggleAssistantStatus", col: 1, row: 6 },
        { id: "a_cal_exchange", type: "service", name: "getGoogleOAuthUrl / exchangeGoogleCode / saveCalendarSettings", col: 1, row: 7 },
        { id: "a_branding", type: "service", name: "saveBranding / saveAiSettings", col: 2, row: 1 },
        { id: "a_store_chunks", type: "service", name: "storeChunks · splitIntoChunks + embedBatch", col: 2, row: 2 },
        { id: "a_replay", type: "service", name: "replayJobFailureAction", col: 2, row: 3 },
        { id: "a_save_tokens", type: "service", name: "saveSharepointTokens / saveGdriveTokens / saveTrelloToken", col: 2, row: 4 },
        { id: "a_provision", type: "service", name: "provisionVapiAssistant / syncVapiConfig", col: 2, row: 6 },
        { id: "a_onboard", type: "service", name: "onboard_organization_v2 aufrufen", col: 3, row: 0 },
        { id: "a_send_message", type: "service", name: "sendMessage (RAG-Orchestrierung)", col: 3, row: 1 },
        { id: "a_trigger_sync", type: "service", name: "triggerInitialSync / retrySource / reconcileConnector", col: 3, row: 4 },
        { id: "a_query_prep", type: "service", name: "rewriteFollowUpQuery + expandQuery + resolveEntities", col: 4, row: 1 },
        { id: "a_retrieve", type: "service", name: "boostedHybridSearch / hybridSearch · RRF-Fusion", col: 5, row: 1 },
        { id: "a_search", type: "service", name: "hybridSearch (Suche)", col: 5, row: 2 },
        { id: "a_generate", type: "service", name: "generateAnswer (LLM-Antwort)", col: 7, row: 1 },
        { id: "a_review", type: "service", name: "submitReview / getQualityTotals / getPassiveSignals", col: 9, row: 1 },
      ],
    },
    // ---------------------------------------------------------------------
    {
      id: "Lane_connect",
      name: "Connectoren & Ingestion (Edge Functions)",
      nodes: [
        { id: "c_sharepoint", type: "service", name: "connector-sharepoint (initial / delta / reconcile)", col: 4, row: 0 },
        { id: "c_gdrive", type: "service", name: "connector-gdrive (initial / delta / reconcile)", col: 4, row: 1 },
        { id: "c_calsync", type: "service", name: "sync-google-calendar", col: 4, row: 2 },
        { id: "c_imap", type: "service", name: "worker-imap-poll (geplant · 501)", col: 4, row: 3 },
        { id: "c_synclock", type: "service", name: "try_acquire_sync_lock + start_integration_run", col: 5, row: 0 },
        { id: "c_fetch", type: "service", name: "Externe API abrufen (Graph / Drive)", col: 5, row: 1 },
        { id: "c_rawwrite", type: "service", name: "raw_events schreiben + finish_integration_run", col: 5, row: 2 },
        { id: "c_trello_wb", type: "service", name: "connector-trello (Karte schreiben)", col: 6, row: 0 },
        { id: "c_shopware", type: "service", name: "connector-shopware (Order / Customer lesen)", col: 6, row: 1 },
        { id: "c_writeback", type: "service", name: "connector-writeback (rename / delete)", col: 6, row: 2 },
      ],
    },
    // ---------------------------------------------------------------------
    {
      id: "Lane_pipeline",
      name: "RAG-Pipeline · Worker (Bronze → Silver → Gold)",
      nodes: [
        { id: "w_normalize", type: "service", name: "worker-normalize · raw_events → entities/sources", col: 6, row: 0 },
        { id: "w_embed", type: "service", name: "worker-embed · Chunking + Embeddings → content_chunks", col: 7, row: 0 },
        { id: "w_extract", type: "service", name: "worker-extract-entities · GPT-4o-mini → CRM", col: 8, row: 0 },
      ],
    },
    // ---------------------------------------------------------------------
    {
      id: "Lane_db",
      name: "Datenbank & Orchestrierung (Supabase · pg_cron · RPC · Trigger)",
      nodes: [
        { id: "trg_profile", type: "script", name: "Trigger handle_new_profile → profiles", col: 1, row: 0 },
        { id: "db_orgs", type: "store", name: "organizations (settings: branding, ai)", col: 2, row: 0 },
        { id: "db_jobfail", type: "store", name: "job_failures (Dead-Letter)", col: 2, row: 1 },
        { id: "db_calint", type: "store", name: "calendar_integrations", col: 2, row: 2 },
        { id: "rpc_onboard", type: "script", name: "RPC onboard_organization_v2 → org + members", col: 3, row: 0 },
        { id: "db_orgint", type: "store", name: "organization_integrations (Credentials)", col: 3, row: 1 },
        { id: "rpc_softdelete", type: "script", name: "RPC soft_delete / restore / purge_source", col: 3, row: 2 },
        { id: "cron_connectors", type: "timer", name: "Cron: connector delta-sync (15 min)", col: 4, row: 0 },
        { id: "cron_cal", type: "timer", name: "Cron: sync-google-calendar (15 min)", col: 4, row: 1 },
        { id: "cron_reconcile", type: "timer", name: "Cron: reconcile-connectors (täglich)", col: 4, row: 2 },
        { id: "cron_partition", type: "timer", name: "Cron: raw_events Partition-Rollover (täglich)", col: 4, row: 3 },
        { id: "rpc_hybrid", type: "script", name: "RPC hybrid_search_boosted / match_chunks (RLS)", col: 5, row: 1 },
        { id: "db_raw", type: "store", name: "raw_events (Bronze, partitioniert)", col: 5, row: 2 },
        { id: "db_runs", type: "store", name: "integration_runs (Observability / KPI)", col: 5, row: 3 },
        { id: "cron_norm", type: "timer", name: "Cron: worker-normalize (2 min)", col: 6, row: 0 },
        { id: "q_normalize", type: "script", name: "pgmq: normalize-Queue", col: 6, row: 1 },
        { id: "db_sources", type: "store", name: "sources (Silver) + Ordner / Berechtigungen", col: 6, row: 2 },
        { id: "cron_embed", type: "timer", name: "Cron: worker-embed (2 min)", col: 7, row: 0 },
        { id: "q_embed", type: "script", name: "pgmq: embed-Queue", col: 7, row: 1 },
        { id: "db_chunks", type: "store", name: "content_chunks + pgvector (Gold)", col: 7, row: 2 },
        { id: "cron_extract", type: "timer", name: "Cron: worker-extract-entities (2 min)", col: 8, row: 0 },
        { id: "q_extract", type: "script", name: "pgmq: extract-Queue", col: 8, row: 1 },
        { id: "db_entities", type: "store", name: "contacts / companies / projects + tags", col: 8, row: 2 },
        { id: "db_reviews", type: "store", name: "chat_message_reviews + admin-KPI-RPC", col: 9, row: 0 },
        { id: "trg_touch", type: "script", name: "Trigger touch_chat_conversation", col: 9, row: 1 },
        { id: "db_chat", type: "store", name: "chat_conversations / chat_messages", col: 9, row: 2 },
        { id: "db_phone", type: "store", name: "phone_assistants / phone_numbers", col: 10, row: 2 },
        { id: "db_calls", type: "store", name: "call_logs / activities", col: 11, row: 2 },
      ],
    },
    // ---------------------------------------------------------------------
    {
      id: "Lane_phone",
      name: "Telefon-Assistent (Vapi)",
      nodes: [
        { id: "p_provision", type: "service", name: "phone-assistant-provision (Assistent / Nummer)", col: 3, row: 0 },
        { id: "p_rag", type: "service", name: "phone-assistant-rag (Echtzeit-Retrieval im Anruf)", col: 10, row: 0 },
        { id: "p_complete", type: "service", name: "phone-assistant-call-complete (Transkript → Wissen)", col: 11, row: 0 },
      ],
    },
    // ---------------------------------------------------------------------
    {
      id: "Lane_ext",
      name: "Externe Dienste",
      nodes: [
        { id: "x_supabase_auth", type: "service", name: "Supabase Auth (Magic Link / OTP)", col: 1, row: 0 },
        { id: "x_msgraph", type: "service", name: "Microsoft OAuth / Graph API", col: 1, row: 1 },
        { id: "x_google", type: "service", name: "Google OAuth / Drive / Calendar API", col: 1, row: 2 },
        { id: "x_trello", type: "service", name: "Trello API", col: 1, row: 3 },
        { id: "x_shopware", type: "service", name: "Shopware Admin API", col: 6, row: 1 },
        { id: "x_openai", type: "service", name: "OpenAI (Embeddings · Whisper · GPT-4o-mini)", col: 7, row: 0 },
        { id: "x_anthropic", type: "service", name: "Anthropic (Claude Sonnet / Haiku)", col: 7, row: 1 },
        { id: "x_caller", type: "start", name: "Anrufer wählt Nummer", col: 9, row: 0 },
        { id: "x_vapi", type: "service", name: "Vapi (Voice · Telefonie)", col: 10, row: 1 },
        { id: "x_resend", type: "service", name: "Resend (E-Mail-Benachrichtigung)", col: 11, row: 1 },
      ],
    },
  ],

  // -----------------------------------------------------------------------
  flows: [
    // --- Auth & Onboarding -------------------------------------------------
    { source: "start_login", target: "x_supabase_auth", name: "OTP / Magic Link" },
    { source: "x_supabase_auth", target: "a_auth_callback" },
    { source: "a_auth_callback", target: "trg_profile", name: "neuer User" },
    { source: "a_auth_callback", target: "u_onboard" },
    { source: "u_onboard", target: "a_onboard" },
    { source: "a_onboard", target: "rpc_onboard" },
    { source: "rpc_onboard", target: "db_orgs" },

    // --- Platform admin ----------------------------------------------------
    { source: "u_admin", target: "a_admin" },
    { source: "a_admin", target: "db_orgs" },
    { source: "u_admin", target: "a_branding" },
    { source: "a_branding", target: "db_orgs" },
    { source: "u_admin", target: "a_replay" },
    { source: "a_replay", target: "db_jobfail" },

    // --- Manual source ingestion ------------------------------------------
    { source: "u_upload", target: "a_create_source" },
    { source: "a_create_source", target: "x_openai", name: "Audio: Whisper" },
    { source: "a_create_source", target: "a_store_chunks" },
    { source: "u_import", target: "a_batch_import" },
    { source: "a_batch_import", target: "a_store_chunks" },
    { source: "a_store_chunks", target: "x_openai", name: "Embeddings" },
    { source: "a_store_chunks", target: "db_sources" },
    { source: "a_store_chunks", target: "db_chunks" },

    // --- Connector OAuth & sync -------------------------------------------
    { source: "u_connect", target: "a_connect" },
    { source: "a_connect", target: "x_msgraph", name: "SharePoint OAuth" },
    { source: "a_connect", target: "x_google", name: "GDrive OAuth" },
    { source: "a_connect", target: "x_trello", name: "Trello Token" },
    { source: "x_msgraph", target: "a_save_tokens" },
    { source: "x_google", target: "a_save_tokens" },
    { source: "x_trello", target: "a_save_tokens" },
    { source: "a_save_tokens", target: "db_orgint" },
    { source: "a_save_tokens", target: "a_trigger_sync", name: "Initial-Sync" },
    { source: "a_trigger_sync", target: "c_sharepoint" },
    { source: "a_trigger_sync", target: "c_gdrive" },
    { source: "a_trigger_sync", target: "c_shopware" },
    { source: "a_trigger_sync", target: "c_trello_wb" },
    { source: "a_trigger_sync", target: "c_writeback" },
    { source: "a_trigger_sync", target: "q_normalize", name: "retrySource" },
    { source: "c_sharepoint", target: "c_synclock" },
    { source: "c_gdrive", target: "c_synclock" },
    { source: "c_synclock", target: "c_fetch" },
    { source: "c_fetch", target: "x_msgraph" },
    { source: "c_fetch", target: "x_google" },
    { source: "c_fetch", target: "c_rawwrite" },
    { source: "c_rawwrite", target: "db_raw" },
    { source: "c_rawwrite", target: "db_runs" },
    { source: "c_rawwrite", target: "q_normalize", name: "enqueue" },
    { source: "c_shopware", target: "x_shopware" },
    { source: "c_trello_wb", target: "x_trello" },
    { source: "c_writeback", target: "x_google" },
    { source: "c_writeback", target: "rpc_softdelete" },
    { source: "rpc_softdelete", target: "db_sources" },

    // --- Cron triggers -----------------------------------------------------
    { source: "cron_connectors", target: "c_sharepoint", name: "delta" },
    { source: "cron_connectors", target: "c_gdrive", name: "delta" },
    { source: "cron_reconcile", target: "c_gdrive", name: "reconcile" },
    { source: "cron_cal", target: "c_calsync" },
    { source: "cron_partition", target: "db_raw" },
    { source: "c_calsync", target: "x_google" },
    { source: "c_calsync", target: "db_raw" },
    { source: "c_calsync", target: "q_normalize", name: "enqueue" },

    // --- RAG pipeline (Bronze -> Silver -> Gold -> CRM) -------------------
    { source: "cron_norm", target: "w_normalize" },
    { source: "q_normalize", target: "w_normalize" },
    { source: "w_normalize", target: "db_sources", name: "upsert_connector_source" },
    { source: "w_normalize", target: "q_embed", name: "enqueue" },
    { source: "cron_embed", target: "w_embed" },
    { source: "q_embed", target: "w_embed" },
    { source: "w_embed", target: "x_openai", name: "Embeddings" },
    { source: "w_embed", target: "db_chunks" },
    { source: "w_embed", target: "q_extract", name: "enqueue" },
    { source: "cron_extract", target: "w_extract" },
    { source: "q_extract", target: "w_extract" },
    { source: "w_extract", target: "x_openai", name: "GPT-4o-mini" },
    { source: "w_extract", target: "db_entities" },

    // --- Chat RAG query ----------------------------------------------------
    { source: "u_chat", target: "a_send_message" },
    { source: "a_send_message", target: "db_chat", name: "User-Message" },
    { source: "a_send_message", target: "a_query_prep" },
    { source: "a_query_prep", target: "x_anthropic", name: "Haiku: rewrite/expand" },
    { source: "a_query_prep", target: "a_retrieve" },
    { source: "a_retrieve", target: "x_openai", name: "Query-Embedding" },
    { source: "a_retrieve", target: "rpc_hybrid" },
    { source: "rpc_hybrid", target: "db_chunks", name: "Vektor + FTS" },
    { source: "a_retrieve", target: "a_generate" },
    { source: "a_generate", target: "x_anthropic", name: "Claude Sonnet" },
    { source: "a_generate", target: "x_openai", name: "GPT-4o (Fallback)" },
    { source: "a_generate", target: "db_chat", name: "Assistant-Message" },
    { source: "db_chat", target: "trg_touch" },

    // --- Search ------------------------------------------------------------
    { source: "u_search", target: "a_search" },
    { source: "a_search", target: "rpc_hybrid" },

    // --- Retrieval quality review -----------------------------------------
    { source: "a_generate", target: "u_review", name: "Antwort" },
    { source: "u_review", target: "a_review" },
    { source: "a_review", target: "db_reviews" },

    // --- Permissions -------------------------------------------------------
    { source: "u_perm", target: "a_perm" },
    { source: "a_perm", target: "db_sources" },
    { source: "db_sources", target: "rpc_hybrid", name: "RLS-Filter" },

    // --- Phone assistant setup --------------------------------------------
    { source: "u_phone_setup", target: "a_phone_cfg" },
    { source: "a_phone_cfg", target: "db_phone" },
    { source: "a_phone_cfg", target: "a_provision" },
    { source: "a_provision", target: "p_provision" },
    { source: "p_provision", target: "x_vapi" },
    { source: "p_provision", target: "db_phone" },
    { source: "u_cal_connect", target: "a_cal_exchange" },
    { source: "a_cal_exchange", target: "x_google", name: "Calendar OAuth" },
    { source: "a_cal_exchange", target: "db_calint" },
    { source: "a_cal_exchange", target: "a_provision", name: "syncVapiConfig" },

    // --- Phone call runtime ------------------------------------------------
    { source: "x_caller", target: "x_vapi" },
    { source: "x_vapi", target: "p_rag", name: "assistant-request / tool-calls" },
    { source: "p_rag", target: "rpc_hybrid", name: "search_knowledge" },
    { source: "p_rag", target: "db_phone", name: "Org-Lookup" },
    { source: "p_rag", target: "x_google", name: "Slots / Termin" },
    { source: "x_vapi", target: "p_complete", name: "end-of-call-report" },
    { source: "p_complete", target: "db_sources", name: "Transkript-Source" },
    { source: "p_complete", target: "x_openai", name: "Embeddings" },
    { source: "p_complete", target: "db_chunks" },
    { source: "p_complete", target: "x_anthropic", name: "Action-Items" },
    { source: "p_complete", target: "db_entities", name: "match_caller_to_contact" },
    { source: "p_complete", target: "db_calls" },
    { source: "p_complete", target: "x_resend", name: "E-Mail" },
  ],
};
