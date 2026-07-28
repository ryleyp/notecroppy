import { assertExistingDirectory, isPathInside } from "@/lib/fileSafety";

function allowedRoots() {
  if (!globalThis.__notetakerAllowedRoots) {
    globalThis.__notetakerAllowedRoots = new Set();
  }
  return globalThis.__notetakerAllowedRoots;
}

export function allowDirectory(dirPath, label = "Directory") {
  const resolved = assertExistingDirectory(dirPath, label);
  allowedRoots().add(resolved);
  return resolved;
}

export function allowConfiguredPaths({ vaultPath, transcriptsPath }) {
  const allowed = {};
  const warnings = [];

  if (vaultPath) allowed.vaultPath = allowDirectory(vaultPath, "Vault path");
  if (transcriptsPath) {
    try {
      allowed.transcriptsPath = allowDirectory(transcriptsPath, "Transcripts archive path");
    } catch (error) {
      warnings.push(error.message);
    }
  }

  return { allowed, warnings };
}

export function assertAllowedRoot(rootPath, label = "Directory") {
  const resolved = assertExistingDirectory(rootPath, label);
  const allowed = [...allowedRoots()].some((allowedRoot) => isPathInside(allowedRoot, resolved));

  if (!allowed) {
    const error = new Error(`${label} has not been approved for this local session`);
    error.status = 403;
    throw error;
  }

  return resolved;
}

export function listAllowedRoots() {
  return [...allowedRoots()];
}
