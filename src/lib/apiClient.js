"use client";

let sessionTokenPromise = null;

export async function getApiSessionToken() {
  if (!sessionTokenPromise) {
    sessionTokenPromise = fetch("/api/session")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || !data.token) throw new Error(data.error || "Could not start local session");
        return data.token;
      })
      .catch((error) => {
        sessionTokenPromise = null;
        throw error;
      });
  }

  return sessionTokenPromise;
}

export async function apiFetch(input, init = {}) {
  const token = await getApiSessionToken();
  const headers = new Headers(init.headers || {});
  headers.set("x-notetaker-session", token);

  return fetch(input, {
    ...init,
    headers,
  });
}

export async function approveLocalPaths(settings) {
  const res = await apiFetch("/api/paths", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      vaultPath: settings.vaultPath || "",
      transcriptsPath: settings.transcriptsPath || "",
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Could not approve local paths");
  return data;
}
