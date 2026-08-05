// Twenty CRM API client (self-hosted instance).
//
// Auth model (verified against Twenty v2.27.0):
//   - Reads (workspaceMembers via REST, invitations, roles) work with a
//     role-scoped API key.
//   - Member mutations (sendInvitations, updateWorkspaceMemberRole,
//     deleteUserFromWorkspace) are guarded by UserAuthGuard — an API key is
//     NOT enough. They require a user-context access token obtained through
//     the headless service-login flow: signIn -> workspace loginToken ->
//     getAuthTokensFromLoginToken.
//   - All engine operations live on the /metadata GraphQL endpoint, records
//     live on /rest/* and /graphql.
//
// When the service login is not configured, mutation helpers throw
// TwentyAuthError(kind: "invite_forbidden") so callers can degrade to the
// manual_required flow instead of failing hard.

export interface TwentyConfig {
  baseUrl: string;
  apiKey: string;
  serviceEmail?: string;
  servicePassword?: string;
}

export interface TwentyRole {
  id: string;
  label: string;
  memberIds: string[];
}

export interface TwentyWorkspaceMember {
  id: string;
  userEmail: string;
  name?: { firstName?: string; lastName?: string };
}

export interface TwentyInvitation {
  id: string;
  email: string;
  expiresAt: string;
}

export class TwentyAuthError extends Error {
  kind: "invite_forbidden" | "auth_failed";
  constructor(kind: "invite_forbidden" | "auth_failed", message: string) {
    super(message);
    this.kind = kind;
  }
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

async function gqlMetadata<T>(
  cfg: TwentyConfig,
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${normalizeBaseUrl(cfg.baseUrl)}/metadata`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json().catch(() => null);
  const firstError = body?.errors?.[0]?.message as string | undefined;
  if (firstError) throw new Error(firstError);
  if (!res.ok) throw new Error(`twenty /metadata HTTP ${res.status}`);
  return body.data as T;
}

/** Health probe against the Twenty server. */
export async function ping(cfg: TwentyConfig): Promise<void> {
  const res = await fetch(`${normalizeBaseUrl(cfg.baseUrl)}/healthz`);
  if (!res.ok) throw new Error(`twenty /healthz HTTP ${res.status}`);
}

/**
 * Headless service login: user-context access token for member mutations.
 * signIn returns per-workspace login tokens; the first workspace is used
 * (the sync targets single-workspace self-hosted instances).
 */
export async function getServiceAccessToken(cfg: TwentyConfig): Promise<string> {
  if (!cfg.serviceEmail || !cfg.servicePassword) {
    throw new TwentyAuthError(
      "invite_forbidden",
      "no service login configured — member mutations unavailable with api key only",
    );
  }
  const signIn = await gqlMetadata<{
    signIn: {
      availableWorkspaces: {
        availableWorkspacesForSignIn: Array<{ id: string; loginToken: string | null }>;
      };
    };
  }>(
    cfg,
    "", // public mutation — no token needed; empty bearer is ignored
    `mutation ($email: String!, $password: String!) {
       signIn(email: $email, password: $password) {
         availableWorkspaces { availableWorkspacesForSignIn { id loginToken } }
       } }`,
    { email: cfg.serviceEmail, password: cfg.servicePassword },
  ).catch((err) => {
    throw new TwentyAuthError("auth_failed", `service login failed: ${err.message}`);
  });

  const loginToken = signIn.signIn.availableWorkspaces.availableWorkspacesForSignIn.find(
    (w) => w.loginToken,
  )?.loginToken;
  if (!loginToken) {
    throw new TwentyAuthError("auth_failed", "service login: no workspace login token returned");
  }

  const tokens = await gqlMetadata<{
    getAuthTokensFromLoginToken: {
      tokens: { accessOrWorkspaceAgnosticToken: { token: string } };
    };
  }>(
    cfg,
    "",
    `mutation ($lt: String!, $o: String!) {
       getAuthTokensFromLoginToken(loginToken: $lt, origin: $o) {
         tokens { accessOrWorkspaceAgnosticToken { token } } } }`,
    { lt: loginToken, o: normalizeBaseUrl(cfg.baseUrl) },
  ).catch((err) => {
    throw new TwentyAuthError("auth_failed", `login token exchange failed: ${err.message}`);
  });

  return tokens.getAuthTokensFromLoginToken.tokens.accessOrWorkspaceAgnosticToken.token;
}

/** Roles incl. their member assignment (for drift detection). API key works. */
export async function listRoles(cfg: TwentyConfig): Promise<TwentyRole[]> {
  const data = await gqlMetadata<{
    getRoles: Array<{
      id: string;
      label: string;
      workspaceMembers: Array<{ id: string }>;
    }>;
  }>(cfg, cfg.apiKey, `query { getRoles { id label workspaceMembers { id } } }`);
  return data.getRoles.map((r) => ({
    id: r.id,
    label: r.label,
    memberIds: r.workspaceMembers.map((m) => m.id),
  }));
}

/** All workspace members via the REST core API (API key works). */
export async function listWorkspaceMembers(cfg: TwentyConfig): Promise<TwentyWorkspaceMember[]> {
  const members: TwentyWorkspaceMember[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const url = new URL(`${normalizeBaseUrl(cfg.baseUrl)}/rest/workspaceMembers`);
    url.searchParams.set("limit", "60");
    if (cursor) url.searchParams.set("starting_after", cursor);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${cfg.apiKey}` } });
    if (!res.ok) throw new Error(`twenty /rest/workspaceMembers HTTP ${res.status}`);
    const body = await res.json();
    const batch = (body?.data?.workspaceMembers ?? []) as TwentyWorkspaceMember[];
    members.push(...batch);
    cursor = body?.pageInfo?.endCursor ?? null;
    if (!body?.pageInfo?.hasNextPage || batch.length === 0) break;
  }
  return members;
}

/** Pending invitations (API key works). */
export async function listInvitations(cfg: TwentyConfig): Promise<TwentyInvitation[]> {
  const data = await gqlMetadata<{ findWorkspaceInvitations: TwentyInvitation[] }>(
    cfg,
    cfg.apiKey,
    `query { findWorkspaceInvitations { id email expiresAt } }`,
  );
  return data.findWorkspaceInvitations;
}

/** Invite an email with a role. Requires service login (UserAuthGuard). */
export async function sendInvitation(
  cfg: TwentyConfig,
  email: string,
  roleId: string,
): Promise<void> {
  const token = await getServiceAccessToken(cfg);
  const data = await gqlMetadata<{
    sendInvitations: { success: boolean; errors: string[] };
  }>(
    cfg,
    token,
    `mutation ($emails: [String!]!, $roleId: UUID) {
       sendInvitations(emails: $emails, roleId: $roleId) { success errors } }`,
    { emails: [email], roleId },
  );
  if (!data.sendInvitations.success) {
    throw new Error(`sendInvitations failed: ${data.sendInvitations.errors.join("; ")}`);
  }
}

/** Assign a role to a workspace member. Requires service login. */
export async function updateMemberRole(
  cfg: TwentyConfig,
  workspaceMemberId: string,
  roleId: string,
): Promise<void> {
  const token = await getServiceAccessToken(cfg);
  await gqlMetadata(
    cfg,
    token,
    `mutation ($m: UUID!, $r: UUID!) {
       updateWorkspaceMemberRole(workspaceMemberId: $m, roleId: $r) { id } }`,
    { m: workspaceMemberId, r: roleId },
  );
}

/** Remove a member from the workspace. Requires service login. */
export async function removeMember(
  cfg: TwentyConfig,
  workspaceMemberId: string,
): Promise<void> {
  const token = await getServiceAccessToken(cfg);
  await gqlMetadata(
    cfg,
    token,
    `mutation ($id: String!) { deleteUserFromWorkspace(workspaceMemberIdToDelete: $id) { id } }`,
    { id: workspaceMemberId },
  );
}

/** Withdraw a pending invitation (API key is sufficient — no UserAuthGuard). */
export async function deleteInvitation(cfg: TwentyConfig, appTokenId: string): Promise<void> {
  await gqlMetadata(
    cfg,
    cfg.apiKey,
    `mutation ($id: String!) { deleteWorkspaceInvitation(appTokenId: $id) }`,
    { id: appTokenId },
  );
}
