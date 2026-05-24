import { redirect } from "next/navigation";
import { requireOrgId } from "@/lib/db/org-context";
import { createServiceClient } from "@/lib/db/supabase-server";
import { saveBoardId, saveDefaultListId, clearBoardId } from "./actions";

export const dynamic = "force-dynamic";

interface TrelloCredentials {
  token?:           string;
  board_id?:        string;
  default_list_id?: string;
}

interface TrelloBoard { id: string; name: string; closed?: boolean }
interface TrelloList  { id: string; name: string; closed?: boolean }

async function trelloGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const apiKey = process.env.TRELLO_API_KEY;
  if (!apiKey) throw new Error("TRELLO_API_KEY not set on the platform");
  const url = new URL(`https://api.trello.com/1${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", apiKey);
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Trello ${path} -> ${res.status}: ${body.slice(0, 200)}`);
  }
  return await res.json() as T;
}

export default async function TrelloSetupPage() {
  const orgId = await requireOrgId();
  const db = createServiceClient();
  const { data } = await db
    .from("organization_integrations")
    .select("credentials, status")
    .eq("organization_id", orgId)
    .eq("provider_id", "trello")
    .maybeSingle<{ credentials: TrelloCredentials; status: string }>();

  if (!data?.credentials?.token) {
    redirect("/admin/integrationen?error=" + encodeURIComponent("Trello noch nicht verbunden. Klicke zuerst auf 'Trello verbinden'."));
  }
  if (data.credentials.board_id && data.credentials.default_list_id) {
    redirect("/admin/integrationen?connected=trello");
  }

  const token = data.credentials.token!;
  const boardId = data.credentials.board_id;

  let stage: "pick-board" | "pick-list";
  let boards: TrelloBoard[] = [];
  let lists:  TrelloList[]  = [];
  let fetchError: string | null = null;

  if (!boardId) {
    stage = "pick-board";
    try {
      boards = await trelloGet<TrelloBoard[]>("/members/me/boards", {
        token,
        fields: "id,name,closed",
        filter: "open",
      });
    } catch (err) {
      fetchError = err instanceof Error ? err.message : String(err);
    }
  } else {
    stage = "pick-list";
    try {
      lists = await trelloGet<TrelloList[]>(`/boards/${boardId}/lists`, {
        token,
        fields: "id,name,closed",
        filter: "open",
      });
    } catch (err) {
      fetchError = err instanceof Error ? err.message : String(err);
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <header className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>
          Integrationen · Trello
        </span>
        <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}>
          {stage === "pick-board" ? "Board auswählen" : "Standard-Liste auswählen"}
        </h1>
        <p className="text-[13px]" style={{ color: "var(--color-muted)" }}>
          {stage === "pick-board"
            ? "Wähle das Board, auf dem hAIway künftig Karten anlegt."
            : "Neue Karten landen standardmäßig in dieser Liste. Du kannst pro Aktion eine andere Liste angeben."}
        </p>
      </header>

      {fetchError && (
        <div className="rounded-xl p-4" style={{ background: "var(--color-danger-soft, var(--color-bg-elevated))", border: "1px solid var(--color-line)" }}>
          <p className="text-sm" style={{ color: "var(--color-danger)" }}>
            Fehler beim Laden: {fetchError}
          </p>
        </div>
      )}

      {stage === "pick-board" && boards.length > 0 && (
        <form action={saveBoardId} className="flex flex-col gap-4 rounded-xl p-5" style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}>
          <label className="flex flex-col gap-2">
            <span className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-placeholder)" }}>
              Board
            </span>
            <select
              name="board_id"
              required
              defaultValue=""
              className="min-h-[44px] rounded-lg px-3 text-sm"
              style={{ background: "var(--color-bg)", border: "1px solid var(--color-line)", color: "var(--color-text)" }}
            >
              <option value="" disabled>Bitte wählen…</option>
              {boards.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="self-start min-h-[44px] px-5 rounded-lg text-sm font-semibold"
            style={{ background: "var(--color-accent)", color: "var(--color-accent-text)" }}
          >
            Board übernehmen
          </button>
        </form>
      )}

      {stage === "pick-list" && lists.length > 0 && (
        <form action={saveDefaultListId} className="flex flex-col gap-4 rounded-xl p-5" style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}>
          <label className="flex flex-col gap-2">
            <span className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-placeholder)" }}>
              Standard-Liste
            </span>
            <select
              name="list_id"
              required
              defaultValue=""
              className="min-h-[44px] rounded-lg px-3 text-sm"
              style={{ background: "var(--color-bg)", border: "1px solid var(--color-line)", color: "var(--color-text)" }}
            >
              <option value="" disabled>Bitte wählen…</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="self-start min-h-[44px] px-5 rounded-lg text-sm font-semibold"
            style={{ background: "var(--color-accent)", color: "var(--color-accent-text)" }}
          >
            Setup abschließen
          </button>
        </form>
      )}

      {stage === "pick-list" && (
        <form action={clearBoardId}>
          <button
            type="submit"
            className="text-[12px]"
            style={{ color: "var(--color-muted)", textDecoration: "underline" }}
          >
            Anderes Board wählen
          </button>
        </form>
      )}

      {stage === "pick-board" && !fetchError && boards.length === 0 && (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          Keine Boards gefunden. Lege in Trello mindestens ein Board an und lade die Seite neu.
        </p>
      )}

      {stage === "pick-list" && !fetchError && lists.length === 0 && (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          Keine Listen auf diesem Board. Lege in Trello mindestens eine Liste an und lade die Seite neu.
        </p>
      )}
    </div>
  );
}
