import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { resolveInsideDirectory } from "@/lib/fileSafety";
import { assertAllowedRoot } from "@/lib/pathAllowlist";
import { assertTrustedRequest } from "@/lib/requestSafety";

function getMondayOfWeek(dateStr) {
  // Week = Sunday–Saturday; file is named after that Monday
  const date = new Date((dateStr || new Date().toISOString().split("T")[0]) + "T12:00:00");
  const day = date.getDay(); // 0=Sun … 6=Sat
  const sunday = new Date(date);
  sunday.setDate(date.getDate() - day);
  const monday = new Date(sunday);
  monday.setDate(sunday.getDate() + 1);
  return monday.toISOString().split("T")[0];
}

function extractDateFromTitle(title) {
  const match = title && title.match(/(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Which action items belong to the note-taker. Role terms are generic, but the
// personal names have to come from configuration — hardcoding one user's name
// put personal data in a public repo and made the feature a no-op for everyone
// else. ownerNames is supplied per request from Settings.
export function isRelevantItem(line, ownerNames = []) {
  const names = ownerNames.map((n) => String(n || "").trim()).filter(Boolean);
  if (names.length) {
    const namePattern = new RegExp(`\\b(${names.map(escapeRegex).join("|")})\\b`, "i");
    if (namePattern.test(line)) return true;
  }
  return /\b(Customer Success|Customer Success Managers?|CSMs?)\b/i.test(line)
    || /\bCS\b/.test(line);
}

export function extractItems(notes, ownerNames = []) {
  const result = { actionItems: [], nextSteps: [] };

  const actionMatch = notes.match(/## Action Items\n([\s\S]*?)(?=\n## |\n---\n|$)/);
  if (actionMatch) {
    result.actionItems = actionMatch[1]
      .split("\n")
      .filter((l) => l.trim().startsWith("- ") && isRelevantItem(l, ownerNames));
  }

  const nextMatch = notes.match(/## Next Steps\n([\s\S]*?)(?=\n## |\n---\n|$)/);
  if (nextMatch) {
    result.nextSteps = nextMatch[1]
      .split("\n")
      .filter((l) => l.trim().startsWith("- ") && isRelevantItem(l, ownerNames));
  }

  return result;
}

function meetingBlock(items, meetingTitle) {
  return `**${meetingTitle}**\n${items.map((l) => l.trimEnd()).join("\n")}`;
}

function buildNewFile(monday, actionItems, nextSteps, meetingTitle) {
  const actionBlock = actionItems.length ? meetingBlock(actionItems, meetingTitle) : "";
  const nextBlock = nextSteps.length ? meetingBlock(nextSteps, meetingTitle) : "";

  return `# ${monday} - ToDos from Meetings\n\n## Action Items\n\n${actionBlock}\n\n## Next Steps\n\n${nextBlock}\n`.trimEnd() + "\n";
}

function blockDate(block) {
  const m = block.match(/\*\*(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "0000-00-00";
}

// Insert a new meeting block into a section's content, newest date first
function insertInOrder(sectionContent, newBlock, meetingTitle) {
  const newDate = (meetingTitle.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || "0000-00-00";
  const trimmed = sectionContent.trim();
  if (!trimmed) return newBlock;

  const blocks = trimmed.split(/\n\n(?=\*\*)/).filter((b) => b.trim());

  let insertAt = blocks.length;
  for (let i = 0; i < blocks.length; i++) {
    if (newDate >= blockDate(blocks[i])) {
      insertAt = i;
      break;
    }
  }

  blocks.splice(insertAt, 0, newBlock);
  return blocks.join("\n\n");
}

function parseSections(content) {
  const actionMatch = content.match(/## Action Items\n\n?([\s\S]*?)(?=\n## Next Steps|$)/);
  const nextMatch = content.match(/## Next Steps\n\n?([\s\S]*?)$/);
  return {
    actionContent: actionMatch ? actionMatch[1].trimEnd() : "",
    nextContent: nextMatch ? nextMatch[1].trimEnd() : "",
  };
}

function appendToFile(existing, actionItems, nextSteps, meetingTitle) {
  const monday = existing.match(/^# (.+)\n/)?.[1] ?? "";
  const { actionContent, nextContent } = parseSections(existing);

  const newActionContent = actionItems.length
    ? insertInOrder(actionContent, meetingBlock(actionItems, meetingTitle), meetingTitle)
    : actionContent;

  const newNextContent = nextSteps.length
    ? insertInOrder(nextContent, meetingBlock(nextSteps, meetingTitle), meetingTitle)
    : nextContent;

  return `# ${monday}\n\n## Action Items\n\n${newActionContent}\n\n## Next Steps\n\n${newNextContent}\n`;
}

export async function POST(request) {
  try {
    assertTrustedRequest(request);

    const { notes, vaultPath, meetingTitle, ownerNames = [] } = await request.json();
    if (!notes || !vaultPath) return NextResponse.json({ ok: true });

    const { actionItems, nextSteps } = extractItems(notes, ownerNames);
    if (actionItems.length === 0 && nextSteps.length === 0) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const resolvedVault = assertAllowedRoot(vaultPath, "Vault path");
    const todosDir = resolveInsideDirectory(resolvedVault, "Todos", "Todos folder");
    if (!fs.existsSync(todosDir)) fs.mkdirSync(todosDir, { recursive: true });

    const monday = getMondayOfWeek(extractDateFromTitle(meetingTitle));
    const filePath = path.join(todosDir, `${monday} - ToDos from Meetings.md`);

    const content = fs.existsSync(filePath)
      ? appendToFile(fs.readFileSync(filePath, "utf-8"), actionItems, nextSteps, meetingTitle)
      : buildNewFile(monday, actionItems, nextSteps, meetingTitle);

    fs.writeFileSync(filePath, content, "utf-8");

    const relativePath = path.relative(resolvedVault, filePath);
    const count = actionItems.length + nextSteps.length;
    return NextResponse.json({ ok: true, savedPath: relativePath, count });
  } catch (error) {
    console.error("Todos error:", error);
    return NextResponse.json({ ok: true });
  }
}
