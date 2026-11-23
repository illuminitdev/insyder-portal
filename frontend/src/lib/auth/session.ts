import { api } from "../api/client";
import type { Capability } from "./capabilities";

export type User = {
  id: string;
  email: string;
  name: string;
  mustChangePassword: boolean;
  /** App owner: lands on /platform and belongs to no workspace */
  isPlatformAdmin?: boolean;
};

export async function changePassword(currentPassword: string, newPassword: string) {
  return api<{ ok: boolean }>("/v1/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

/** Edit your own name and email. Changing the email (your login) needs the current password. */
export async function updateProfile(body: { name?: string; email?: string; currentPassword?: string }) {
  return api<{ user: { id: string; name: string; email: string } }>("/v1/auth/profile", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export type WorkspaceMembership = {
  id: string;
  name: string;
  tenantId: string;
  currency: string;
  role: string;
  capabilities: Capability[];
};

export async function login(email: string, password: string) {
  return api<{ user: User }>("/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

/** "Create account" on the login page: files a request the platform admin approves or rejects. */
export async function requestAccess(body: { name: string; email: string; companyName: string; password: string }) {
  return api<{ ok: true }>("/v1/auth/access-requests", { method: "POST", body: JSON.stringify(body) });
}

export async function logout() {
  // A JSON body is required: the API rejects an empty body sent as application/json
  return api<{ ok: boolean }>("/v1/auth/logout", { method: "POST", body: "{}", keepalive: true });
}

export async function me() {
  return api<{ user: User }>("/v1/auth/me");
}

export async function listWorkspaces() {
  return api<{ workspaces: WorkspaceMembership[] }>("/v1/workspaces");
}
