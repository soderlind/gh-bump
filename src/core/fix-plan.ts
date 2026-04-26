/**
 * FixPlan contract between prompts, model output, and repository mutations.
 */

import { z } from "zod";
import type { FixPlan } from "./types.js";

const fileChangeSchema = z.object({
  path: z.string().min(1),
  content: z.unknown(),
});

const fixPlanSchema = z.object({
  files: z.array(fileChangeSchema),
  prTitle: z.string().optional(),
  prBody: z.string().optional(),
  commitMessage: z.string().optional(),
  reason: z.string().optional(),
});

export type FixPlanParseResult =
  | { ok: true; plan: FixPlan }
  | { ok: false; reason?: string; error?: string; raw: string };

function extractJson(text: string): string {
  const jsonMatch = text.match(/```(?:json)?\s*\n([\s\S]*)\n```\s*$/);
  if (jsonMatch) {
    return jsonMatch[1];
  }

  if (text.startsWith("```")) {
    return text.replace(/^```(?:json)?\s*\n/, "").replace(/\n```\s*$/, "");
  }

  return text;
}

function normalizeFileContent(content: unknown): string | null {
  if (typeof content === "string") {
    return content;
  }

  if (content && typeof content === "object") {
    return `${JSON.stringify(content, null, 2)}\n`;
  }

  return null;
}

function repairExtraRootBraceBeforeCommitMessage(text: string): string | null {
  const repairedWithComma = text.replace(
    /(,\s*)}\s*,\s*("commitMessage"\s*:)/,
    "$1$2"
  );
  if (repairedWithComma !== text) {
    return repairedWithComma;
  }

  const repairedMissingComma = text.replace(
    /([^\s])\s*}\s*,\s*("commitMessage"\s*:)/,
    "$1,\n  $2"
  );

  return repairedMissingComma === text ? null : repairedMissingComma;
}

function extractJsonStringField(text: string, field: string): string | undefined {
  const match = text.match(new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`));
  return match ? match[1].replace(/\\n/g, "\n").replace(/\\"/g, '"') : undefined;
}

function parseMalformedSingleFileFixPlan(text: string): FixPlanParseResult | null {
  const path = extractJsonStringField(text, "path");
  if (!path) {
    return null;
  }

  const contentMarker = text.match(/"content"\s*:\s*"/);
  if (!contentMarker || contentMarker.index === undefined) {
    return null;
  }

  const contentStart = contentMarker.index + contentMarker[0].length;
  const contentTail = text.slice(contentStart);
  const contentEndMatch = contentTail.match(/"\s*}\s*\]\s*,\s*"prTitle"\s*:/);
  if (!contentEndMatch || contentEndMatch.index === undefined) {
    return null;
  }

  const content = contentTail.slice(0, contentEndMatch.index);
  const metadata = contentTail.slice(contentEndMatch.index);
  const prTitle = extractJsonStringField(metadata, "prTitle");
  const prBody = extractJsonStringField(metadata, "prBody");
  const commitMessage = extractJsonStringField(metadata, "commitMessage");

  return {
    ok: true,
    plan: {
      files: [{ path, content }],
      prTitle: prTitle || "fix(deps): security dependency update",
      prBody: prBody || "Automated security fix by gh-bump.",
      commitMessage: commitMessage || "fix(deps): security dependency update",
    },
  };
}

export function parseFixPlan(text: string): FixPlanParseResult {
  const jsonStr = extractJson(text);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr.trim());
  } catch (err) {
    const repairedJson = repairExtraRootBraceBeforeCommitMessage(jsonStr.trim());
    if (repairedJson) {
      try {
        parsed = JSON.parse(repairedJson);
      } catch {
        // Fall through to the single-file content repair below.
      }
    }

    if (parsed === undefined) {
      const repaired = parseMalformedSingleFileFixPlan(jsonStr);
      if (repaired) {
        return repaired;
      }

      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        raw: text,
      };
    }
  }

  const result = fixPlanSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      error: result.error.issues.map((issue) => issue.message).join("; "),
      raw: text,
    };
  }

  const files = result.data.files.map((file) => ({
    path: file.path,
    content: normalizeFileContent(file.content),
  }));

  const invalidContent = files.find((file) => file.content === null);
  if (invalidContent) {
    return {
      ok: false,
      error: `File content for ${invalidContent.path} must be a string or object.`,
      raw: text,
    };
  }

  if (files.length === 0) {
    return {
      ok: false,
      reason: result.data.reason,
      raw: text,
    };
  }

  return {
    ok: true,
    plan: {
      files: files.map((file) => ({
        path: file.path,
        content: file.content ?? "",
      })),
      prTitle: result.data.prTitle || "fix(deps): security dependency update",
      prBody: result.data.prBody || "Automated security fix by gh-bump.",
      commitMessage:
        result.data.commitMessage || "fix(deps): security dependency update",
    },
  };
}
