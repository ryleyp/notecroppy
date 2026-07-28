import fs from "fs";
import path from "path";

export class FileSafetyError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "FileSafetyError";
    this.status = status;
  }
}

export function isPathInside(basePath, targetPath) {
  const relative = path.relative(
    path.resolve(basePath),
    path.resolve(targetPath)
  );
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

export function assertExistingDirectory(dirPath, label = "Directory") {
  if (!dirPath) throw new FileSafetyError(`${label} path is required`, 400);

  const resolved = path.resolve(dirPath);
  if (!fs.existsSync(resolved)) {
    throw new FileSafetyError(`${label} does not exist`, 404);
  }
  if (!fs.statSync(resolved).isDirectory()) {
    throw new FileSafetyError(`${label} is not a directory`, 400);
  }

  return resolved;
}

export function resolveInsideDirectory(basePath, childPath = "", label = "Target path") {
  const base = path.resolve(basePath);
  const target = path.resolve(base, childPath || ".");

  if (!isPathInside(base, target)) {
    throw new FileSafetyError(`${label} is outside the allowed folder`, 403);
  }

  return target;
}

export function assertExistingChildDirectory(basePath, childPath = "", label = "Target folder") {
  const target = resolveInsideDirectory(basePath, childPath, label);
  if (!fs.existsSync(target)) {
    throw new FileSafetyError(`${label} does not exist`, 404);
  }
  if (!fs.statSync(target).isDirectory()) {
    throw new FileSafetyError(`${label} is not a directory`, 400);
  }
  return target;
}

export function sanitizeFilename(name, fallback = "Untitled") {
  const safe = String(name || fallback)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);

  return safe || fallback;
}

export function uniqueFilePath(filePath) {
  let finalPath = filePath;
  let counter = 1;
  const ext = path.extname(filePath);
  const base = filePath.slice(0, filePath.length - ext.length);

  while (fs.existsSync(finalPath)) {
    finalPath = `${base} (${counter})${ext}`;
    counter++;
  }

  return finalPath;
}
