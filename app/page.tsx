"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { EditorModal } from "@/components/EditorModal";
import { HelpPanel } from "@/components/HelpPanel";
import { Terminal } from "@/components/Terminal";
import { AppLoadingScreen } from "@/components/AppLoadingScreen";
import { AppUser, FileSystemItem, TerminalEntry } from "@/lib/types";
import { gsap } from "gsap";

const HOME_DIR = "/home/student";
const DEFAULT_FOLDERS = [HOME_DIR];

const DEFAULT_FILES: FileSystemItem[] = [];

type PersistedState = {
  currentDir: string;
  folders: string[];
  files: FileSystemItem[];
  entries: TerminalEntry[];
  submitted: boolean;
  layoutMode?: "split" | "pdf" | "terminal";
  monitoredStudentId?: string;
  monitoredStudentUsername?: string;
};

type AdminTerminalLoadResponse = {
  run?: {
    run_id: string;
    submission_id: string;
    user_id: string;
    username: string;
    language: "c" | "bash";
    source_filename: string;
    source_path: string;
    workspace_path: string;
    code_hash: string;
    submission_updated_at: string;
    compile_command: string;
    run_command: string;
    preview_lines: string[];
  };
  terminalState?: PersistedState;
  error?: string;
};

type InteractiveRunState = {
  mode: "c" | "sh";
  prompts: string[];
  answers: string[];
  sourceCode: string;
  cMenuModel?: {
    menuLines: string[];
    choices: Record<string, { body: string; prompts: string[] }>;
    defaultOutput: string[];
    exitChoice: string | null;
    stage: "choice" | "case_inputs";
    selectedChoice?: string;
    caseAnswers?: string[];
  };
  shellVars?: string[];
  shellOutputTemplates?: string[];
};

type GlobalExamStatusResponse = {
  status: "NOT_STARTED" | "SCHEDULED" | "RUNNING" | "PAUSED" | "ENDED";
  startTime: string | null;
  endTime: string | null;
  serverTime: string;
  remainingSeconds: number;
  isTerminalEnabled: boolean;
  isPausedIndividual?: boolean;
  isSubmitted: boolean;
  submittedAt: string | null;
};

const createId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const normalizePath = (path: string): string => {
  const isAbsolute = path.startsWith("/");
  const stack: string[] = [];

  for (const segment of path.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      stack.pop();
      continue;
    }
    stack.push(segment);
  }

  if (isAbsolute) {
    return `/${stack.join("/")}` || "/";
  }

  return stack.join("/") || ".";
};

const isInsideHome = (path: string): boolean => {
  return path === HOME_DIR || path.startsWith(`${HOME_DIR}/`);
};

const getFileName = (path: string): string => {
  const normalized = normalizePath(path);
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
};

const getPromptPath = (currentDir: string): string => {
  if (currentDir === HOME_DIR) {
    return "~";
  }
  return `~${currentDir.slice(HOME_DIR.length)}`;
};

const parseEchoLines = (content: string): string[] => {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("echo "))
    .map((line) => line.replace(/^echo\s+/, "").trim().replace(/^['\"]|['\"]$/g, ""));
};

const extractShellEchoText = (line: string): { text: string; noNewLine: boolean } | null => {
  const trimmed = line.trim();
  const match = trimmed.match(/^echo\s+(-n\s+)?(.+)$/);
  if (!match) {
    return null;
  }
  const rawText = (match[2] ?? "").trim();
  const unquoted = rawText.replace(/^['"]|['"]$/g, "");
  return { text: unquoted, noNewLine: Boolean(match[1]) };
};

const parseShellInteractiveScript = (content: string): {
  initialOutput: string[];
  prompts: string[];
  inputVars: string[];
  tailOutputTemplates: string[];
} => {
  const lines = content.split("\n");
  const initialOutput: string[] = [];
  const prompts: string[] = [];
  const inputVars: string[] = [];
  const tailOutputTemplates: string[] = [];
  let seenRead = false;
  let pendingPrompt = "";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const echo = extractShellEchoText(line);
    if (echo) {
      if (echo.noNewLine) {
        pendingPrompt = echo.text;
      } else if (!seenRead) {
        initialOutput.push(echo.text);
      } else {
        tailOutputTemplates.push(echo.text);
      }
      continue;
    }

    const readMatch = line.match(/^read\s+([a-zA-Z_][a-zA-Z0-9_]*)$/);
    if (readMatch) {
      seenRead = true;
      inputVars.push(readMatch[1]);
      prompts.push(pendingPrompt || `Input ${inputVars.length}:`);
      pendingPrompt = "";
      continue;
    }

    if (seenRead) {
      tailOutputTemplates.push(line);
    }
  }

  return { initialOutput, prompts, inputVars, tailOutputTemplates };
};

const evaluateShellMath = (expr: string, env: Record<string, string>): string => {
  const replaced = expr.replace(/[a-zA-Z_][a-zA-Z0-9_]*/g, (name) => env[name] ?? "0");
  if (!/^[0-9+\-*/% ().]+$/.test(replaced)) {
    return "0";
  }
  try {
    const result = Function(`"use strict"; return (${replaced});`)();
    if (typeof result === "number" && Number.isFinite(result)) {
      return `${result}`;
    }
    return "0";
  } catch {
    return "0";
  }
};

const renderShellOutputWithInputs = (
  sourceCode: string,
  prompts: string[],
  inputVars: string[],
  answers: string[],
  tailOutputTemplates: string[],
): string[] => {
  const env: Record<string, string> = {};
  inputVars.forEach((key, index) => {
    env[key] = answers[index] ?? "";
  });

  const assignmentLines = sourceCode
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("="));

  for (const line of assignmentLines) {
    const mathMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)=\$\(\((.+)\)\)$/);
    if (mathMatch) {
      env[mathMatch[1]] = evaluateShellMath(mathMatch[2], env);
      continue;
    }

    const assignMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)=(.+)$/);
    if (assignMatch) {
      const rawValue = assignMatch[2].trim().replace(/^['"]|['"]$/g, "");
      env[assignMatch[1]] = rawValue.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, key: string) => env[key] ?? "");
    }
  }
  const effectiveCode = applyShellIfElseBranches(sourceCode, env);

  const isShellControlLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    if (/^(if|then|elif|else|fi|do|done|while|for|case|esac)\b/.test(trimmed)) return true;
    if (/^(read)\b/.test(trimmed)) return true;
    if (/^\[.*\]$/.test(trimmed)) return true;
    if (/^[a-zA-Z_][a-zA-Z0-9_]*=\$\(\(.+\)\)$/.test(trimmed)) return true;
    if (/^[a-zA-Z_][a-zA-Z0-9_]*=.+$/.test(trimmed) && !trimmed.startsWith("echo ")) return true;
    return false;
  };

  const templateSource = tailOutputTemplates.length > 0 ? tailOutputTemplates : effectiveCode.split("\n");
  return templateSource
    .map((line) => line.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, key: string) => env[key] ?? ""))
    .map((line) => line.replace(/^echo\s+/, "").trim())
    .filter((line) => !isShellControlLine(line))
    .filter((line) => line && !prompts.includes(line));
};

const parsePrintfLines = (content: string): string[] => {
  const matches = [...content.matchAll(/printf\s*\(\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g)];
  return matches.map((match) => match[1].replace(/\\n/g, "").trim()).filter(Boolean);
};

const splitCArgs = (argsRaw: string): string[] => {
  const args: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of argsRaw) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      const value = current.trim();
      if (value) args.push(value);
      current = "";
      continue;
    }
    current += ch;
  }
  const tail = current.trim();
  if (tail) args.push(tail);
  return args;
};

const toNumber = (value: string): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const evaluateCExpression = (expr: string, env: Record<string, number>): number => {
  const replaced = expr.replace(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g, (name) => `${env[name] ?? 0}`);
  if (!/^[0-9+\-*/%().\s<>=!&|]+$/.test(replaced)) return 0;
  try {
    const result = Function(`"use strict"; return (${replaced});`)();
    return typeof result === "number" && Number.isFinite(result) ? result : 0;
  } catch {
    return 0;
  }
};

const evaluateShellCondition = (rawCondition: string, env: Record<string, string>): boolean => {
  const normalized = rawCondition
    .replace(/^\[\[?\s*/, "")
    .replace(/\s*\]\]?$/, "")
    .trim()
    .replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, key: string) => env[key] ?? "");

  const cmpMatch = normalized.match(/^(.+?)\s+(-eq|-ne|-gt|-ge|-lt|-le|==|!=|=)\s+(.+)$/);
  if (!cmpMatch) {
    return normalized.length > 0 && normalized !== "0";
  }

  const leftRaw = cmpMatch[1].trim().replace(/^['"]|['"]$/g, "");
  const op = cmpMatch[2];
  const rightRaw = cmpMatch[3].trim().replace(/^['"]|['"]$/g, "");
  const leftNum = Number(leftRaw);
  const rightNum = Number(rightRaw);
  const bothNumeric = Number.isFinite(leftNum) && Number.isFinite(rightNum);

  if (op === "==" || op === "=") return leftRaw === rightRaw;
  if (op === "!=") return leftRaw !== rightRaw;
  if (!bothNumeric) return false;
  if (op === "-eq") return leftNum === rightNum;
  if (op === "-ne") return leftNum !== rightNum;
  if (op === "-gt") return leftNum > rightNum;
  if (op === "-ge") return leftNum >= rightNum;
  if (op === "-lt") return leftNum < rightNum;
  if (op === "-le") return leftNum <= rightNum;
  return false;
};

const applyShellIfElseBranches = (sourceCode: string, env: Record<string, string>): string => {
  let next = sourceCode;
  const ifElseRegex = /if\s+(?:\[\[?\s*([^\]\n]+)\s*\]\]?|(.+?))\s*;\s*then\s*([\s\S]*?)\s*else\s*([\s\S]*?)\s*fi/g;
  next = next.replace(ifElseRegex, (_m, condBracket: string, condInline: string, ifBody: string, elseBody: string) => {
    const cond = (condBracket || condInline || "").trim();
    return evaluateShellCondition(cond, env) ? ifBody : elseBody;
  });

  const ifOnlyRegex = /if\s+(?:\[\[?\s*([^\]\n]+)\s*\]\]?|(.+?))\s*;\s*then\s*([\s\S]*?)\s*fi/g;
  next = next.replace(ifOnlyRegex, (_m, condBracket: string, condInline: string, ifBody: string) => {
    const cond = (condBracket || condInline || "").trim();
    return evaluateShellCondition(cond, env) ? ifBody : "";
  });
  return next;
};

const evaluateCCondition = (condition: string, env: Record<string, number>): boolean => {
  return Boolean(evaluateCExpression(condition, env));
};

const applyIfElseBranches = (content: string, env: Record<string, number>): string => {
  let next = content;
  const ifElseRegex = /if\s*\(([^)]+)\)\s*\{([\s\S]*?)\}\s*else\s*\{([\s\S]*?)\}/g;
  next = next.replace(ifElseRegex, (_m, cond: string, ifBody: string, elseBody: string) =>
    evaluateCCondition(cond, env) ? ifBody : elseBody,
  );
  const ifOnlyRegex = /if\s*\(([^)]+)\)\s*\{([\s\S]*?)\}/g;
  next = next.replace(ifOnlyRegex, (_m, cond: string, ifBody: string) =>
    evaluateCCondition(cond, env) ? ifBody : "",
  );
  return next;
};

const extractInteractivePrompts = (content: string): string[] => {
  const lines = content.split("\n");
  const prompts: string[] = [];
  let lastPrintf = "";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const printfMatch = line.match(/printf\s*\(\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
    if (printfMatch) {
      lastPrintf = printfMatch[1].replace(/\\n/g, "\n").trim();
    }
    if (/scanf\s*\(/.test(line)) {
      prompts.push(lastPrintf || `Input ${prompts.length + 1}:`);
      lastPrintf = "";
    }
  }

  return prompts;
};

const extractPreScanfPrintfLines = (content: string): string[] => {
  const lines = content.split("\n");
  const prePromptLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/scanf\s*\(/.test(line)) {
      break;
    }
    const printfMatch = line.match(/printf\s*\(\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
    if (!printfMatch) {
      continue;
    }
    const text = printfMatch[1].replace(/\\n/g, "").trim();
    if (text) {
      prePromptLines.push(text);
    }
  }

  return prePromptLines;
};

const detectMenuExitChoice = (content: string): string | null => {
  const caseRegex = /case\s+(\d+)\s*:\s*([\s\S]*?)(?:break\s*;|return\s+\d+\s*;)/g;
  let match: RegExpExecArray | null = caseRegex.exec(content);
  while (match) {
    const choice = match[1];
    const body = match[2] ?? "";
    if (/exit|program\s+selesai/i.test(body)) {
      return choice;
    }
    match = caseRegex.exec(content);
  }
  return null;
};

const extractCasePrintfLines = (content: string, choice: string): string[] => {
  const caseRegex = new RegExp(
    `case\\s+${choice}\\s*:\\s*([\\s\\S]*?)(?:break\\s*;|return\\s+\\d+\\s*;)`,
    "i",
  );
  const caseMatch = content.match(caseRegex);
  if (!caseMatch) return [];
  const body = caseMatch[1] ?? "";
  const matches = [...body.matchAll(/printf\s*\(\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g)];
  return matches
    .map((m) => m[1].replace(/\\n/g, "").trim())
    .filter(Boolean);
};

const extractCaseBodies = (content: string): Record<string, string> => {
  const cases: Record<string, string> = {};
  const caseRegex = /case\s+(\d+)\s*:\s*([\s\S]*?)(?=case\s+\d+\s*:|default\s*:|}\s*while|\}\s*$)/g;
  let match: RegExpExecArray | null = caseRegex.exec(content);
  while (match) {
    cases[match[1]] = match[2] ?? "";
    match = caseRegex.exec(content);
  }
  return cases;
};

const extractDefaultCaseOutput = (content: string): string[] => {
  const defaultMatch = content.match(/default\s*:\s*([\s\S]*?)(?=case\s+\d+\s*:|}\s*while|\}\s*$)/i);
  if (!defaultMatch) return ["Pilihan tidak tersedia."];
  const output = parsePrintfLines(defaultMatch[1] ?? "");
  return output.length > 0 ? output : ["Pilihan tidak tersedia."];
};

const renderProgramOutputWithInputs = (content: string, answers: string[], prompts: string[]): string[] => {
  const promptSet = new Set(prompts);

  const scanfVars = [...content.matchAll(/scanf\s*\(\s*"[^"]+"\s*,\s*&([a-zA-Z_][a-zA-Z0-9_]*)\s*\)/g)].map(
    (m) => m[1],
  );
  const env: Record<string, number> = {};
  scanfVars.forEach((name, index) => {
    env[name] = toNumber(answers[index] ?? "0");
  });

  const effectiveContent = applyIfElseBranches(content, env);
  const printfRegex = /printf\s*\(\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*(?:,\s*([\s\S]*?))?\)\s*;/g;
  const out: string[] = [];
  let match: RegExpExecArray | null = printfRegex.exec(effectiveContent);

  while (match) {
    const format = match[1].replace(/\\n/g, "").trim();
    const argsRaw = (match[2] ?? "").trim();
    const args = argsRaw ? splitCArgs(argsRaw) : [];
    let argIndex = 0;
    const rendered = format.replace(/%[-+0-9.]*[a-zA-Z]/g, (token) => {
      const expr = args[argIndex] ?? "0";
      argIndex += 1;
      const value = evaluateCExpression(expr, env);
      const precisionMatch = token.match(/\.(\d+)/);
      const conversion = token[token.length - 1]?.toLowerCase() ?? "f";
      if (conversion === "d" || conversion === "i") {
        return `${Math.trunc(value)}`;
      }
      if (precisionMatch) {
        return value.toFixed(Number(precisionMatch[1]));
      }
      return `${value}`;
    });

    const line = rendered.trim();
    if (line && !promptSet.has(line)) {
      out.push(line);
    }
    match = printfRegex.exec(effectiveContent);
  }

  return out;
};

const buildInteractiveIntroLines = (sourceCode: string, prompt: string): string[] => {
  const prePromptLines = extractPreScanfPrintfLines(sourceCode);
  if (prePromptLines.length === 0) {
    return ["Program menunggu input...", prompt];
  }

  const lastLine = prePromptLines[prePromptLines.length - 1];
  if (lastLine.includes(prompt)) {
    return prePromptLines;
  }

  return [...prePromptLines, prompt];
};

const upsertFile = (files: FileSystemItem[], nextFile: FileSystemItem): FileSystemItem[] => {
  const idx = files.findIndex((item) => item.name === nextFile.name);
  if (idx === -1) {
    return [...files, nextFile];
  }

  const updated = [...files];
  updated[idx] = { ...updated[idx], ...nextFile };
  return updated;
};

const getStorageKey = (username: string) => `ubuntu-web-lab-state-${username}`;

const getInitialState = (username: string): PersistedState => {
  if (typeof window === "undefined") {
    return {
      currentDir: HOME_DIR,
      folders: DEFAULT_FOLDERS,
      files: DEFAULT_FILES,
      entries: [],
      submitted: false,
      layoutMode: "split",
    };
  }

  const raw = window.localStorage.getItem(getStorageKey(username));
  if (!raw) {
    return {
      currentDir: HOME_DIR,
      folders: DEFAULT_FOLDERS,
      files: DEFAULT_FILES,
      entries: [],
      submitted: false,
      layoutMode: "split",
    };
  }

  try {
    const parsed = JSON.parse(raw) as PersistedState;
    const currentDir = parsed.currentDir && isInsideHome(parsed.currentDir) ? parsed.currentDir : HOME_DIR;
    const folders = Array.isArray(parsed.folders)
      ? Array.from(
          new Set([HOME_DIR, ...parsed.folders.map((item) => normalizePath(item)).filter(isInsideHome)]),
        )
      : DEFAULT_FOLDERS;
    const files = Array.isArray(parsed.files)
      ? parsed.files
          .filter((item) => typeof item?.name === "string")
          .map((item) => ({ ...item, name: normalizePath(item.name) }))
          .filter((item) => isInsideHome(item.name))
      : DEFAULT_FILES;
    const entries = Array.isArray(parsed.entries)
      ? parsed.entries
          .filter(
            (item) =>
              typeof item?.id === "string" &&
              typeof item?.prompt === "string" &&
              typeof item?.command === "string" &&
              Array.isArray(item?.output),
          )
          .map((item) => ({
            id: item.id,
            prompt: item.prompt,
            command: item.command,
            output: item.output.filter((line) => typeof line === "string"),
          }))
      : [];

    const layoutMode =
      parsed.layoutMode === "split" || parsed.layoutMode === "pdf" || parsed.layoutMode === "terminal"
        ? parsed.layoutMode
        : "split";
    const monitoredStudentId =
      typeof parsed.monitoredStudentId === "string" && parsed.monitoredStudentId.trim()
        ? parsed.monitoredStudentId.trim()
        : "";
    const monitoredStudentUsername =
      typeof parsed.monitoredStudentUsername === "string" && parsed.monitoredStudentUsername.trim()
        ? parsed.monitoredStudentUsername.trim()
        : "";
    return {
      currentDir,
      folders,
      files,
      entries,
      submitted: Boolean(parsed.submitted),
      layoutMode,
      monitoredStudentId,
      monitoredStudentUsername,
    };
  } catch {
    window.localStorage.removeItem(getStorageKey(username));
    return {
      currentDir: HOME_DIR,
      folders: DEFAULT_FOLDERS,
      files: DEFAULT_FILES,
      entries: [],
      submitted: false,
      layoutMode: "split",
    };
  }
};

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rootRef = useRef<HTMLElement | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState<AppUser | null>(null);
  const [authError, setAuthError] = useState("");

  const [currentDir, setCurrentDir] = useState(HOME_DIR);
  const [folders, setFolders] = useState<string[]>(DEFAULT_FOLDERS);
  const [files, setFiles] = useState<FileSystemItem[]>(DEFAULT_FILES);
  const [entries, setEntries] = useState<TerminalEntry[]>([]);
  const [terminalInput, setTerminalInput] = useState("");
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [historyDraft, setHistoryDraft] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [activeFilePath, setActiveFilePath] = useState("");
  const [editorContent, setEditorContent] = useState("");
  const [showHelpPanel, setShowHelpPanel] = useState(false);
  const [focusSignal, setFocusSignal] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [toast, setToast] = useState("");

  const [showNameModal, setShowNameModal] = useState(false);
  const [studentNameInput, setStudentNameInput] = useState("");
  const [submissionTargetPath, setSubmissionTargetPath] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [studentNameError, setStudentNameError] = useState("");
  const [submissionFileError, setSubmissionFileError] = useState("");
  const [interactiveRun, setInteractiveRun] = useState<InteractiveRunState | null>(null);
  const [confirmAction, setConfirmAction] = useState<"submit" | "logout" | null>(null);
  const [layoutMode, setLayoutMode] = useState<"split" | "pdf" | "terminal">("split");
  const [showMobilePdfModal, setShowMobilePdfModal] = useState(false);
  const [pdfLoadingDesktop, setPdfLoadingDesktop] = useState(true);
  const [pdfLoadingMobile, setPdfLoadingMobile] = useState(true);
  const [pdfLoadError, setPdfLoadError] = useState(false);
  const [monitoredQuestionPdfUrl, setMonitoredQuestionPdfUrl] = useState<string | null>(null);
  const [, setMonitoringDebugInfo] = useState<string>("");
  const [storedMonitoredStudentId, setStoredMonitoredStudentId] = useState("");
  const [storedMonitoredStudentUsername, setStoredMonitoredStudentUsername] = useState("");
  const [remainingSeconds, setRemainingSeconds] = useState<number>(45 * 60);
  const [timeExpired, setTimeExpired] = useState(false);
  const [globalExamStatus, setGlobalExamStatus] = useState<
    "NOT_STARTED" | "SCHEDULED" | "RUNNING" | "PAUSED" | "ENDED"
  >("NOT_STARTED");
  const [examStartTime, setExamStartTime] = useState<string | null>(null);
  const [isTerminalEnabled, setIsTerminalEnabled] = useState(false);
  const [isIndividualPaused, setIsIndividualPaused] = useState(false);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const studentNameInputRef = useRef<HTMLInputElement | null>(null);

  const allowAdminTerminal = searchParams.get("admin_terminal") === "1";
  const adminReturnRaw = searchParams.get("admin_return");
  const adminStudentId = searchParams.get("admin_student_id");
  const adminStudentUsername = searchParams.get("admin_student_username");
  const adminSubmissionIdParam = searchParams.get("admin_submission_id");
  const adminRunId = searchParams.get("admin_run_id") ?? "";
  const adminReturnPath =
    adminReturnRaw && adminReturnRaw.startsWith("/admin/submissions/")
      ? adminReturnRaw
      : "/admin";
  const effectiveAdminStudentId = adminStudentId || storedMonitoredStudentId;
  const effectiveAdminStudentUsername = adminStudentUsername || storedMonitoredStudentUsername;
  const adminSubmissionId =
    adminSubmissionIdParam ||
    (adminReturnPath.startsWith("/admin/submissions/")
      ? adminReturnPath.replace("/admin/submissions/", "").split("?")[0]
      : "");

  useEffect(() => {
    const loadMe = async () => {
      const response = await fetch("/api/me", { cache: "no-store" });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }

      const data = await response.json();
      if (!response.ok) {
        setAuthError(data.message || "Gagal memuat sesi");
        setAuthLoading(false);
        return;
      }

      const nextUser = data.user as AppUser;
      if (nextUser.role === "admin" && !allowAdminTerminal) {
        router.replace("/admin");
        return;
      }

      setUser(nextUser);
      const initial = getInitialState(nextUser.username);
      setCurrentDir(initial.currentDir);
      setFolders(initial.folders);
      setFiles(initial.files);
      setEntries(initial.entries);
      setSubmitted(initial.submitted);
      setLayoutMode(initial.layoutMode ?? "split");
      setStoredMonitoredStudentId(initial.monitoredStudentId ?? "");
      setStoredMonitoredStudentUsername(initial.monitoredStudentUsername ?? "");
      setAuthLoading(false);
    };

    void loadMe();
  }, [allowAdminTerminal, router]);

  useEffect(() => {
    if (!user || user.role !== "student") {
      return;
    }

    const loadSession = async () => {
      const response = await fetch(`/api/exam-session/status?t=${Date.now()}`, {
        cache: "no-store",
        headers: { "cache-control": "no-store" },
      });
      const data = (await response.json().catch(() => null)) as GlobalExamStatusResponse | null;
      if (!response.ok || !data) {
        return;
      }

      setGlobalExamStatus(data.status);
      setExamStartTime(data.startTime ?? null);
      setIsTerminalEnabled(Boolean(data.isTerminalEnabled));
      setIsIndividualPaused(Boolean(data.isPausedIndividual));
      setRemainingSeconds(Math.max(0, Number(data.remainingSeconds || 0)));
      setTimeExpired(data.status === "ENDED");
      setSubmitted(Boolean(data.isSubmitted));
      setSubmittedAt(data.submittedAt ?? null);
    };

    void loadSession();
    const poll = setInterval(() => {
      void loadSession();
    }, 5000);
    return () => clearInterval(poll);
  }, [user]);

  useEffect(() => {
    if (!user || user.role !== "admin" || !allowAdminTerminal || !adminSubmissionId) {
      return;
    }

    const loadAdminTerminalState = async () => {
      const response = await fetch(`/api/admin/submissions/${adminSubmissionId}/load-terminal`, {
        method: "POST",
        cache: "no-store",
        headers: { "cache-control": "no-store" },
      });
      const data = (await response.json().catch(() => null)) as AdminTerminalLoadResponse | null;
      if (!response.ok || !data?.terminalState || !data?.run) {
        setToast(data?.error || "Gagal load terminal submission terbaru.");
        return;
      }

      setCurrentDir(data.terminalState.currentDir);
      setFolders(data.terminalState.folders);
      setFiles(data.terminalState.files);
      setEntries(data.terminalState.entries);
      setSubmitted(false);
      setInteractiveRun(null);
      setTerminalInput("");
      setStoredMonitoredStudentId(data.terminalState.monitoredStudentId ?? "");
      setStoredMonitoredStudentUsername(data.terminalState.monitoredStudentUsername ?? "");
      setLayoutMode("terminal");
      setMonitoringDebugInfo(
        `Loaded submission_id=${data.run.submission_id} run_id=${data.run.run_id} code_hash=${data.run.code_hash} query_run_id=${adminRunId || "-"}`,
      );
    };

    void loadAdminTerminalState();
  }, [user, allowAdminTerminal, adminSubmissionId, adminRunId]);

  useEffect(() => {
    if (!user || user.role !== "admin" || !allowAdminTerminal) {
      return;
    }

    const loadMonitoredQuestion = async () => {
      setPdfLoadError(false);
      setPdfLoadingDesktop(true);
      setPdfLoadingMobile(true);
      setMonitoringDebugInfo("Memulai resolve soal student...");

      if (effectiveAdminStudentId) {
        setMonitoringDebugInfo(`Lookup by student_id: ${effectiveAdminStudentId}`);
        const response = await fetch(`/api/admin/students/${effectiveAdminStudentId}/question-pdf?t=${Date.now()}`, {
          cache: "no-store",
        });
        const data = (await response.json().catch(() => null)) as
          | { user?: { questionPdfUrl?: string | null } }
          | null;
        setMonitoredQuestionPdfUrl(response.ok ? (data?.user?.questionPdfUrl ?? null) : null);
        setMonitoringDebugInfo(
          response.ok
            ? `Lookup by student_id berhasil. PDF: ${data?.user?.questionPdfUrl ? "ada" : "kosong"}`
            : "Lookup by student_id gagal.",
        );
        return;
      }

      if (effectiveAdminStudentUsername) {
        setMonitoringDebugInfo(`Lookup by username: ${effectiveAdminStudentUsername}`);
        const response = await fetch(`/api/admin/users?t=${Date.now()}`, { cache: "no-store" });
        const data = (await response.json().catch(() => null)) as
          | { users?: Array<{ username: string; role: "admin" | "student"; questionPdfUrl?: string | null }> }
          | null;
        if (!response.ok || !data?.users) {
          setMonitoredQuestionPdfUrl(null);
          setMonitoringDebugInfo("Lookup by username gagal saat memuat daftar user.");
          return;
        }
        const target = data.users.find(
          (row) => row.role === "student" && row.username === effectiveAdminStudentUsername,
        );
        setMonitoredQuestionPdfUrl(target?.questionPdfUrl ?? null);
        setMonitoringDebugInfo(
          target
            ? `Lookup by username berhasil. PDF: ${target.questionPdfUrl ? "ada" : "kosong"}`
            : "Student username tidak ditemukan di daftar user.",
        );
        return;
      }

      if (adminSubmissionId) {
        setMonitoringDebugInfo(`Fallback by submission_id: ${adminSubmissionId}`);
        const submissionRes = await fetch(`/api/submissions/${adminSubmissionId}?t=${Date.now()}`, {
          cache: "no-store",
        });
        const submissionData = (await submissionRes.json().catch(() => null)) as
          | { submission?: { user_id?: string | null; username?: string | null } }
          | null;
        if (submissionRes.ok && submissionData?.submission) {
          const fallbackStudentId = submissionData.submission.user_id ?? "";
          const fallbackUsername = submissionData.submission.username ?? "";
          setMonitoringDebugInfo(
            `Data submission terbaca. user_id: ${fallbackStudentId || "-"}, username: ${fallbackUsername || "-"}`,
          );

          if (fallbackStudentId) {
            const byIdRes = await fetch(
              `/api/admin/students/${fallbackStudentId}/question-pdf?t=${Date.now()}`,
              { cache: "no-store" },
            );
            const byIdData = (await byIdRes.json().catch(() => null)) as
              | { user?: { questionPdfUrl?: string | null } }
              | null;
            setMonitoredQuestionPdfUrl(byIdRes.ok ? (byIdData?.user?.questionPdfUrl ?? null) : null);
            setMonitoringDebugInfo(
              byIdRes.ok
                ? `Fallback by user_id berhasil. PDF: ${byIdData?.user?.questionPdfUrl ? "ada" : "kosong"}`
                : "Fallback by user_id gagal.",
            );
            return;
          }

          if (fallbackUsername) {
            const usersRes = await fetch(`/api/admin/users?t=${Date.now()}`, { cache: "no-store" });
            const usersData = (await usersRes.json().catch(() => null)) as
              | { users?: Array<{ username: string; role: "admin" | "student"; questionPdfUrl?: string | null }> }
              | null;
            if (usersRes.ok && usersData?.users) {
              const target = usersData.users.find(
                (row) => row.role === "student" && row.username === fallbackUsername,
              );
              setMonitoredQuestionPdfUrl(target?.questionPdfUrl ?? null);
              setMonitoringDebugInfo(
                target
                  ? `Fallback by username berhasil. PDF: ${target.questionPdfUrl ? "ada" : "kosong"}`
                  : "Fallback username tidak ditemukan di daftar user.",
              );
              return;
            }
          }
        }
      }

      setMonitoredQuestionPdfUrl(null);
      setMonitoringDebugInfo("Semua metode resolve gagal. Tidak ada target student valid atau PDF belum diassign.");
    };

    void loadMonitoredQuestion();
  }, [effectiveAdminStudentId, effectiveAdminStudentUsername, adminSubmissionId, allowAdminTerminal, user]);

  useEffect(() => {
    if (!user || user.role !== "student") {
      return;
    }
    const shouldTick = (globalExamStatus === "RUNNING" && !isIndividualPaused) || globalExamStatus === "SCHEDULED";
    if (submitted || timeExpired || !shouldTick) {
      return;
    }

    const tick = setInterval(() => {
      setRemainingSeconds((prev) => {
        const next = Math.max(0, prev - 1);
        if (next <= 0) {
          setTimeExpired(true);
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(tick);
  }, [user, submitted, timeExpired, globalExamStatus, isIndividualPaused]);

  useEffect(() => {
    if (!user || typeof window === "undefined") {
      return;
    }
    if (user.role === "admin" && allowAdminTerminal) {
      return;
    }

    const payload: PersistedState = { currentDir, folders, files, entries, submitted, layoutMode };
    window.localStorage.setItem(getStorageKey(user.username), JSON.stringify(payload));
  }, [currentDir, folders, files, entries, submitted, layoutMode, user, allowAdminTerminal]);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = setTimeout(() => setToast(""), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!showNameModal) {
      return;
    }

    const focusTimer = setTimeout(() => {
      studentNameInputRef.current?.focus();
    }, 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) {
        setShowNameModal(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [showNameModal, submitting]);

  useEffect(() => {
    if (authLoading || !rootRef.current) {
      return;
    }

    const ctx = gsap.context(() => {
      gsap.from("[data-animate='home-shell']", {
        y: 14,
        opacity: 0,
        duration: 0.45,
        ease: "power2.out",
        stagger: 0.08,
      });
    }, rootRef);

    return () => ctx.revert();
  }, [authLoading]);

  const resolvePath = (inputPath: string): string => {
    const trimmed = inputPath.trim();
    if (!trimmed) {
      return currentDir;
    }

    const candidate = trimmed.startsWith("/")
      ? normalizePath(trimmed)
      : normalizePath(`${currentDir}/${trimmed}`);

    if (!isInsideHome(candidate)) {
      return HOME_DIR;
    }

    return candidate;
  };

  const fileMap = useMemo(() => {
    const map = new Map<string, FileSystemItem>();
    files.forEach((file) => map.set(file.name, file));
    return map;
  }, [files]);

  const folderSet = useMemo(() => new Set(folders), [folders]);

  const currentPrompt = useMemo(() => {
    const username = user?.username ?? "student";
    return `${username}@ubuntu:${getPromptPath(currentDir)}$`;
  }, [currentDir, user]);

  const requestTerminalFocus = () => {
    setFocusSignal((prev) => prev + 1);
  };

  const pushEntry = (command: string, output: string[], prompt = currentPrompt) => {
    setEntries((prev) => [
      ...prev,
      {
        id: createId(),
        prompt,
        command,
        output,
      },
    ]);
  };

  const onTerminalInputChange = (value: string) => {
    setTerminalInput(value);
    if (historyIndex !== -1) {
      setHistoryIndex(-1);
    }
  };

  const navigateHistoryUp = () => {
    if (commandHistory.length === 0) return;
    if (historyIndex === -1) {
      setHistoryDraft(terminalInput);
      const nextIndex = commandHistory.length - 1;
      setHistoryIndex(nextIndex);
      setTerminalInput(commandHistory[nextIndex]);
      return;
    }
    const nextIndex = Math.max(0, historyIndex - 1);
    setHistoryIndex(nextIndex);
    setTerminalInput(commandHistory[nextIndex]);
  };

  const navigateHistoryDown = () => {
    if (commandHistory.length === 0 || historyIndex === -1) return;
    const nextIndex = historyIndex + 1;
    if (nextIndex >= commandHistory.length) {
      setHistoryIndex(-1);
      setTerminalInput(historyDraft);
      return;
    }
    setHistoryIndex(nextIndex);
    setTerminalInput(commandHistory[nextIndex]);
  };

  const openEditor = (path: string) => {
    const resolved = resolvePath(path);
    const existing = fileMap.get(resolved);

    setActiveFilePath(resolved);
    setEditorContent(existing?.content ?? "");
    setEditorOpen(true);
  };

  const saveEditorFile = () => {
    const fullPath = activeFilePath.trim();
    if (!fullPath) {
      return "";
    }

    setFiles((prev) =>
      upsertFile(prev, {
        name: fullPath,
        content: editorContent,
        type: prev.find((item) => item.name === fullPath)?.type ?? "file",
        executable: prev.find((item) => item.name === fullPath)?.executable ?? false,
        sourceFile: prev.find((item) => item.name === fullPath)?.sourceFile,
      }),
    );
    return fullPath;
  };

  const saveEditorOnly = () => {
    const savedPath = saveEditorFile();
    if (!savedPath) {
      return;
    }

    const message = `File ${getFileName(savedPath)} berhasil disimpan.`;
    pushEntry("save", [message]);
    setToast(message);
  };

  const saveAndCloseEditor = () => {
    const savedPath = saveEditorFile();
    if (!savedPath) {
      return;
    }

    const message = `File ${getFileName(savedPath)} berhasil disimpan.`;
    setEditorOpen(false);
    pushEntry("save", [message]);
    setToast(message);
    requestTerminalFocus();
  };

  const executeCompiledProgram = (executableFile: FileSystemItem): string[] => {
    const sourceName = executableFile.sourceFile;
    if (!sourceName) {
      return ["Program berhasil dijalankan, tetapi output belum dikenali simulator."];
    }

    const source = fileMap.get(sourceName);
    if (!source) {
      return [`bash: ./${getFileName(executableFile.name)}: Source ${sourceName} tidak ditemukan`];
    }

    const code = source.content;
    if (/segitiga|alas|tinggi/i.test(code)) {
      return ["Masukkan alas: 10", "Masukkan tinggi: 6", "Luas segitiga adalah 30.00"];
    }

    if (/%\s*2\s*==\s*0/.test(code)) {
      return ["Masukkan angka: 8", "Angka 8 adalah Genap"];
    }

    const printfLines = parsePrintfLines(code);
    if (printfLines.length > 0) {
      return printfLines;
    }

    return ["Program berhasil dijalankan, tetapi output belum dikenali simulator."];
  };

  const getDirectChildren = (dirPath: string): string[] => {
    const folderChildren = folders
      .filter((folder) => folder !== dirPath)
      .filter((folder) => folder.startsWith(`${dirPath}/`))
      .map((folder) => folder.slice(`${dirPath}/`.length))
      .filter((rest) => rest && !rest.includes("/"))
      .map((name) => `${name}/`);

    const fileChildren = files
      .filter((file) => file.name.startsWith(`${dirPath}/`))
      .map((file) => file.name.slice(`${dirPath}/`.length))
      .filter((rest) => rest && !rest.includes("/"));

    return Array.from(new Set([...folderChildren, ...fileChildren])).sort((a, b) =>
      a.localeCompare(b),
    );
  };

  const buildTreeLines = (rootPath: string): string[] => {
    const lines: string[] = ["."];
    let directoryCount = 0;
    let fileCount = 0;

    const walk = (dirPath: string, prefix: string) => {
      const folderChildren = folders
        .filter((folder) => folder !== dirPath)
        .filter((folder) => folder.startsWith(`${dirPath}/`))
        .map((folder) => folder.slice(`${dirPath}/`.length))
        .filter((rest) => rest && !rest.includes("/"))
        .sort((a, b) => a.localeCompare(b));

      const fileChildren = files
        .filter((file) => file.name.startsWith(`${dirPath}/`))
        .map((file) => file.name.slice(`${dirPath}/`.length))
        .filter((rest) => rest && !rest.includes("/"))
        .sort((a, b) => a.localeCompare(b));

      const treeEntries = [
        ...folderChildren.map((name) => ({ name, isFolder: true })),
        ...fileChildren.map((name) => ({ name, isFolder: false })),
      ];

      treeEntries.forEach((entry, index) => {
        const isLast = index === treeEntries.length - 1;
        const branch = isLast ? "└── " : "├── ";
        lines.push(`${prefix}${branch}${entry.isFolder ? `${entry.name}/` : entry.name}`);

        if (entry.isFolder) {
          directoryCount += 1;
          const nextPrefix = `${prefix}${isLast ? "    " : "│   "}`;
          walk(`${dirPath}/${entry.name}`, nextPrefix);
          return;
        }

        fileCount += 1;
      });
    };

    walk(rootPath, "");
    lines.push("");
    lines.push(`${directoryCount} director${directoryCount === 1 ? "y" : "ies"}, ${fileCount} file${fileCount === 1 ? "" : "s"}`);
    return lines;
  };

  const logout = async () => {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/login");
  };

  const submitExam = async (studentName: string) => {
    if (!user) {
      return;
    }
    if (timeExpired) {
      setToast("Waktu ujian habis. Submit dinonaktifkan.");
      setShowNameModal(false);
      return;
    }

    const targetPath = submissionTargetPath.trim();
    const targetFile = targetPath ? fileMap.get(targetPath) ?? null : null;
    if (!targetFile) {
      setToast("Pilih file yang akan disubmit.");
      return;
    }

    setSubmitting(true);
    const response = await fetch("/api/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: (user as AppUser & { id?: string })?.id || null,
        name: studentName,
        username: user?.username || "praktikan1",
        fileName: getFileName(targetFile.name),
        filePath: targetFile.name,
        code: targetFile.content,
      }),
    });
    setSubmitting(false);

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (typeof data?.error === "string" && data.error.toLowerCase().includes("waktu ujian habis")) {
        setTimeExpired(true);
      }
      setToast(data.error || data.message || "Gagal mengirim ujian.");
      return;
    }

    setSubmitted(true);
    setSubmittedAt(new Date().toISOString());
    setShowNameModal(false);
    setStudentNameInput("");
    setToast("Jawaban berhasil disubmit");
  };

  const runCommand = () => {
    const rawInput = terminalInput;
    const command = rawInput.trim();
    const promptAtCommand = currentPrompt;

    if (showExamActions && !isTerminalEnabled) {
      setTerminalInput("");
      pushEntry("(system)", ["Terminal dikunci. Ujian belum aktif."], promptAtCommand);
      requestTerminalFocus();
      return;
    }

    setTerminalInput("");
    requestTerminalFocus();

    if (interactiveRun) {
      if (!rawInput.trim()) {
        return;
      }

      const inputValue = rawInput.trim();
      pushEntry(inputValue, [], promptAtCommand);

      if (interactiveRun.mode === "c" && interactiveRun.cMenuModel) {
        const model = interactiveRun.cMenuModel;

        if (model.stage === "choice") {
          const selected = model.choices[inputValue];
          if (!selected) {
            pushEntry("(program output)", model.defaultOutput, promptAtCommand);
            pushEntry("(stdin)", model.menuLines, promptAtCommand);
            setInteractiveRun({
              ...interactiveRun,
              cMenuModel: { ...model, stage: "choice", selectedChoice: undefined, caseAnswers: [] },
              answers: [],
              prompts: [],
            });
            return;
          }

          const prompts = selected.prompts;
          if (model.exitChoice && inputValue === model.exitChoice) {
            const exitLines = extractCasePrintfLines(interactiveRun.sourceCode, model.exitChoice);
            pushEntry("(program output)", exitLines.length ? exitLines : ["Program selesai."], promptAtCommand);
            setInteractiveRun(null);
            return;
          }

          if (prompts.length === 0) {
            const caseOutput = renderProgramOutputWithInputs(selected.body, [], []);
            pushEntry("(program output)", caseOutput.length ? caseOutput : ["(tidak ada output)"], promptAtCommand);
            pushEntry("(stdin)", model.menuLines, promptAtCommand);
            setInteractiveRun({
              ...interactiveRun,
              cMenuModel: { ...model, stage: "choice", selectedChoice: undefined, caseAnswers: [] },
              answers: [],
              prompts: [],
            });
            return;
          }

          pushEntry("(stdin)", [prompts[0]], promptAtCommand);
          setInteractiveRun({
            ...interactiveRun,
            prompts,
            answers: [],
            cMenuModel: { ...model, stage: "case_inputs", selectedChoice: inputValue, caseAnswers: [] },
          });
          return;
        }

        const nextCaseAnswers = [...(model.caseAnswers ?? []), inputValue];
        if (nextCaseAnswers.length < interactiveRun.prompts.length) {
          pushEntry("(stdin)", [interactiveRun.prompts[nextCaseAnswers.length]], promptAtCommand);
          setInteractiveRun({
            ...interactiveRun,
            answers: nextCaseAnswers,
            cMenuModel: { ...model, caseAnswers: nextCaseAnswers },
          });
          return;
        }

        const selectedChoice = model.selectedChoice ?? "";
        const selected = model.choices[selectedChoice];
        const caseOutput = selected
          ? renderProgramOutputWithInputs(selected.body, nextCaseAnswers, selected.prompts)
          : ["Pilihan tidak tersedia."];
        pushEntry("(program output)", caseOutput.length ? caseOutput : ["(tidak ada output)"], promptAtCommand);
        pushEntry("(stdin)", model.menuLines, promptAtCommand);
        setInteractiveRun({
          ...interactiveRun,
          prompts: [],
          answers: [],
          cMenuModel: { ...model, stage: "choice", selectedChoice: undefined, caseAnswers: [] },
        });
        return;
      }

      const nextAnswers = [...interactiveRun.answers, inputValue];

      if (nextAnswers.length < interactiveRun.prompts.length) {
        pushEntry("(stdin)", [interactiveRun.prompts[nextAnswers.length]], promptAtCommand);
        setInteractiveRun({ ...interactiveRun, answers: nextAnswers });
        return;
      }

      const finalLines =
        interactiveRun.mode === "c"
          ? renderProgramOutputWithInputs(interactiveRun.sourceCode, nextAnswers, interactiveRun.prompts)
          : renderShellOutputWithInputs(
              interactiveRun.sourceCode,
              interactiveRun.prompts,
              interactiveRun.shellVars ?? [],
              nextAnswers,
              interactiveRun.shellOutputTemplates ?? [],
            );
      pushEntry("(program output)", finalLines.length > 0 ? finalLines : ["(tidak ada output)"], promptAtCommand);
      setInteractiveRun(null);
      return;
    }

    if (!command) {
      return;
    }

    setHistoryIndex(-1);
    setHistoryDraft("");
    setCommandHistory((prev) => {
      if (prev[prev.length - 1] === command) {
        return prev;
      }
      return [...prev, command];
    });

    if (command === "clear") {
      setEntries([]);
      requestTerminalFocus();
      return;
    }

    if (command === "help") {
      pushEntry(
        command,
        [
          "Daftar command:",
          "help, clear, mkdir, cd, cd .., pwd, ls, tree",
          "gedit nama_file, nano nama_file, cat nama_file, rm nama_file, rmdir nama_folder",
          "chmod +x nama_file, gcc nama_file.c -o nama_output, ./nama_output, ./script.sh",
        ],
        promptAtCommand,
      );
      return;
    }

    if (command === "pwd") {
      pushEntry(command, [currentDir], promptAtCommand);
      return;
    }

    if (command === "ls") {
      const children = getDirectChildren(currentDir);
      pushEntry(command, [children.join("  ") || "(kosong)"], promptAtCommand);
      return;
    }

    if (command === "tree") {
      pushEntry(command, buildTreeLines(currentDir), promptAtCommand);
      return;
    }

    if (command === "cd") {
      setCurrentDir(HOME_DIR);
      pushEntry(command, [], promptAtCommand);
      return;
    }

    if (command.startsWith("cd ")) {
      const rawPath = command.replace(/^cd\s+/, "").trim();
      const targetDir = resolvePath(rawPath);
      if (!folderSet.has(targetDir)) {
        pushEntry(command, [`bash: cd: ${rawPath}: No such file or directory`], promptAtCommand);
        return;
      }

      setCurrentDir(targetDir);
      pushEntry(command, [], promptAtCommand);
      return;
    }

    if (command.startsWith("mkdir ")) {
      const name = command.replace(/^mkdir\s+/, "").trim();
      if (!name) {
        pushEntry(command, ["mkdir: missing operand"], promptAtCommand);
        return;
      }

      const targetDir = resolvePath(name);
      if (folderSet.has(targetDir) || fileMap.has(targetDir)) {
        pushEntry(
          command,
          [`mkdir: cannot create directory '${name}': File exists`],
          promptAtCommand,
        );
        return;
      }

      setFolders((prev) => Array.from(new Set([...prev, targetDir])));
      pushEntry(command, [], promptAtCommand);
      return;
    }

    if (command.startsWith("cat ")) {
      const name = command.replace(/^cat\s+/, "").trim();
      const filePath = resolvePath(name);
      const file = fileMap.get(filePath);
      if (!file) {
        pushEntry(command, [`cat: ${name}: No such file or directory`], promptAtCommand);
        return;
      }

      pushEntry(command, [file.content], promptAtCommand);
      return;
    }

    if (command.startsWith("touch ")) {
      const name = command.replace(/^touch\s+/, "").trim();
      if (!name) {
        pushEntry(command, ["touch: missing file operand"], promptAtCommand);
        return;
      }

      const filePath = resolvePath(name);
      if (folderSet.has(filePath)) {
        pushEntry(command, [`touch: cannot touch '${name}': Is a directory`], promptAtCommand);
        return;
      }

      setFiles((prev) =>
        upsertFile(prev, { name: filePath, content: "", type: "file", executable: false }),
      );
      pushEntry(command, [], promptAtCommand);
      return;
    }

    if (command.startsWith("rm ")) {
      const name = command.replace(/^rm\s+/, "").trim();
      const targetPath = resolvePath(name);

      if (folderSet.has(targetPath)) {
        pushEntry(command, [`rm: cannot remove '${name}': Is a directory`], promptAtCommand);
        return;
      }

      if (!fileMap.has(targetPath)) {
        pushEntry(
          command,
          [`rm: cannot remove '${name}': No such file or directory`],
          promptAtCommand,
        );
        return;
      }

      setFiles((prev) => prev.filter((file) => file.name !== targetPath));
      pushEntry(command, [], promptAtCommand);
      return;
    }

    if (command.startsWith("rmdir ")) {
      const name = command.replace(/^rmdir\s+/, "").trim();
      const targetPath = resolvePath(name);

      if (!folderSet.has(targetPath)) {
        pushEntry(
          command,
          [`rmdir: failed to remove '${name}': No such file or directory`],
          promptAtCommand,
        );
        return;
      }

      const hasChildFolder = folders.some(
        (folder) => folder !== targetPath && folder.startsWith(`${targetPath}/`),
      );
      const hasChildFile = files.some((file) => file.name.startsWith(`${targetPath}/`));
      if (hasChildFolder || hasChildFile || targetPath === HOME_DIR) {
        pushEntry(
          command,
          [`rmdir: failed to remove '${name}': Directory not empty`],
          promptAtCommand,
        );
        return;
      }

      setFolders((prev) => prev.filter((folder) => folder !== targetPath));
      pushEntry(command, [], promptAtCommand);
      return;
    }

    if (command.startsWith("gedit ") || command.startsWith("nano ")) {
      const name = command.split(/\s+/)[1];
      if (!name) {
        pushEntry(command, ["Editor: nama file wajib diisi"], promptAtCommand);
        return;
      }

      const targetPath = resolvePath(name);
      if (folderSet.has(targetPath)) {
        pushEntry(
          command,
          [`${command.startsWith("gedit") ? "gedit" : "nano"}: ${name}: Is a directory`],
          promptAtCommand,
        );
        return;
      }

      openEditor(name);
      pushEntry(command, [`Membuka editor untuk ${name}`], promptAtCommand);
      return;
    }

    if (command.startsWith("chmod +x ")) {
      const name = command.replace(/^chmod\s+\+x\s+/, "").trim();
      const targetPath = resolvePath(name);
      const file = fileMap.get(targetPath);
      if (!file) {
        pushEntry(command, [`chmod: cannot access '${name}': No such file or directory`], promptAtCommand);
        return;
      }

      setFiles((prev) =>
        prev.map((item) => (item.name === targetPath ? { ...item, executable: true } : item)),
      );
      pushEntry(command, [], promptAtCommand);
      return;
    }

    if (command.startsWith("gcc ")) {
      const parts = command.split(/\s+/);
      if (parts.length >= 4 && parts[2] === "-o") {
        const sourceNameArg = parts[1];
        const outputNameArg = parts[3];

        const sourcePath = resolvePath(sourceNameArg);
        const outputPath = resolvePath(outputNameArg);
        const source = fileMap.get(sourcePath);

        if (!source) {
          pushEntry(
            command,
            [`gcc: error: ${sourceNameArg}: No such file or directory`],
            promptAtCommand,
          );
          return;
        }

        setFiles((prev) =>
          upsertFile(prev, {
            name: outputPath,
            content: "",
            type: "executable",
            executable: true,
            sourceFile: sourcePath,
          }),
        );
        pushEntry(command, [`Compile berhasil. File output: ${getFileName(outputPath)}`], promptAtCommand);
        return;
      }

      pushEntry(
        command,
        ["Format gcc belum didukung. Gunakan: gcc nama_file.c -o nama_output"],
        promptAtCommand,
      );
      return;
    }

    if (command.startsWith("./")) {
      const name = command.slice(2).trim();
      const filePath = resolvePath(name);
      const file = fileMap.get(filePath);

      if (!file) {
        pushEntry(command, [`bash: ./${name}: No such file or directory`], promptAtCommand);
        return;
      }

      if (name.endsWith(".sh") || (file.type === "file" && !file.sourceFile)) {
        if (!file.executable) {
          pushEntry(command, [`bash: ./${name}: Permission denied`], promptAtCommand);
          return;
        }

        const shellFlow = parseShellInteractiveScript(file.content);
        if (shellFlow.prompts.length > 0 && shellFlow.inputVars.length > 0) {
          pushEntry(
            command,
            [...shellFlow.initialOutput, shellFlow.prompts[0]].filter(Boolean),
            promptAtCommand,
          );
          setInteractiveRun({
            mode: "sh",
            prompts: shellFlow.prompts,
            answers: [],
            sourceCode: file.content,
            shellVars: shellFlow.inputVars,
            shellOutputTemplates: shellFlow.tailOutputTemplates,
          });
          return;
        }

        const echoLines = parseEchoLines(file.content);
        pushEntry(command, echoLines.length > 0 ? echoLines : ["Script berhasil dijalankan."], promptAtCommand);
        return;
      }

      if (file.type !== "executable") {
        pushEntry(command, [`bash: ./${name}: No such file or directory`], promptAtCommand);
        return;
      }

      const source = file.sourceFile ? fileMap.get(file.sourceFile) : null;
      const sourceCode = source?.content || "";
      const prompts = extractInteractivePrompts(sourceCode);
      if (prompts.length > 0 && /scanf\s*\(/.test(sourceCode)) {
        const caseBodies = extractCaseBodies(sourceCode);
        const exitChoice = detectMenuExitChoice(sourceCode);
        const menuLines = buildInteractiveIntroLines(sourceCode, prompts[0]);
        const choices = Object.fromEntries(
          Object.entries(caseBodies).map(([choice, body]) => [choice, { body, prompts: extractInteractivePrompts(body) }]),
        );
        const isMenuProgram = Object.keys(choices).length > 0 && /switch\s*\(\s*pilih\s*\)/i.test(sourceCode);

        pushEntry(command, menuLines, promptAtCommand);
        if (isMenuProgram) {
          setInteractiveRun({
            mode: "c",
            prompts: [],
            answers: [],
            sourceCode,
            cMenuModel: {
              menuLines,
              choices,
              defaultOutput: extractDefaultCaseOutput(sourceCode),
              exitChoice,
              stage: "choice",
              caseAnswers: [],
            },
          });
        } else {
          setInteractiveRun({ mode: "c", prompts, answers: [], sourceCode });
        }
        return;
      }

      pushEntry(command, executeCompiledProgram(file), promptAtCommand);
      return;
    }

    pushEntry(
      command,
      [`Command tidak dikenali: ${command}`, "Ketik `help` untuk bantuan."],
      promptAtCommand,
    );
  };

  const interruptProgram = () => {
    if (!interactiveRun) {
      return;
    }
    pushEntry("^C", ["Program dibatalkan."], currentPrompt);
    setInteractiveRun(null);
    setTerminalInput("");
    requestTerminalFocus();
  };

  const submissionCandidates = files.filter((item) => item.type === "file" && item.content.trim().length > 0);
  const activeSubmissionFile = activeFilePath ? fileMap.get(activeFilePath) ?? null : null;
  const selectedSubmissionFile = submissionTargetPath ? fileMap.get(submissionTargetPath) ?? null : null;
  const isSubmitLocked = submitted || timeExpired || !isTerminalEnabled;
  const isTerminalInputLocked = submitted || timeExpired || !isTerminalEnabled || isIndividualPaused;
  const timerHours = Math.floor(remainingSeconds / 3600)
    .toString()
    .padStart(2, "0");
  const timerMinutes = Math.floor((remainingSeconds % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const timerSeconds = (remainingSeconds % 60).toString().padStart(2, "0");
  const timerText =
    remainingSeconds >= 3600 ? `${timerHours}:${timerMinutes}:${timerSeconds}` : `${timerMinutes}:${timerSeconds}`;
  const timerBadgeClass = timeExpired
    ? "border-red-200 bg-red-50 text-red-700"
    : remainingSeconds <= 5 * 60
      ? "border-red-200 bg-red-50 text-red-700"
      : remainingSeconds <= 15 * 60
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-sky-200 bg-sky-50 text-sky-700";

  if (authLoading) {
    return <AppLoadingScreen title="Memuat Dashboard Praktikum" subtitle="Menyiapkan terminal dan sesi pengguna..." />;
  }

  if (authError) {
    return <main className="min-h-screen bg-zinc-200 p-6 text-red-600">{authError}</main>;
  }

  if (!user) {
    return null;
  }

  const showExamActions = !(user.role === "admin" && allowAdminTerminal);
  const isAdminMonitorMode = user.role === "admin" && allowAdminTerminal;
  const previewQuestionPdfUrl =
    user.role === "admin" && allowAdminTerminal
      ? (effectiveAdminStudentId || effectiveAdminStudentUsername ? monitoredQuestionPdfUrl : null)
      : (user.questionPdfUrl ?? null);
  const hasQuestionPdf = Boolean(previewQuestionPdfUrl);
  const showQuestionPanel = !showExamActions || layoutMode === "split" || layoutMode === "pdf";
  const showTerminalPanel = !showExamActions || layoutMode === "split" || layoutMode === "terminal";
  const previewPanelHeightClass =
    layoutMode === "split"
      ? "h-full min-h-0"
      : !showExamActions
        ? "h-[56vh] min-h-[320px] min-[900px]:h-[calc(100vh-280px)] min-[900px]:min-h-[420px]"
        : "h-full min-h-0";
  const examState: "active" | "scheduled" | "not_started" | "paused_global" | "paused_individual" | "submitted" | "expired" = submitted
    ? "submitted"
    : globalExamStatus === "ENDED" || timeExpired
      ? "expired"
      : globalExamStatus === "PAUSED"
        ? "paused_global"
        : isIndividualPaused
          ? "paused_individual"
        : globalExamStatus === "SCHEDULED"
          ? "scheduled"
          : globalExamStatus === "NOT_STARTED"
            ? "not_started"
            : "active";

  return (
    <main ref={rootRef} className="h-screen overflow-hidden bg-[linear-gradient(160deg,#ecebe7_0%,#f4f3f1_45%,#ebe9e5_100%)] px-3 py-4 text-zinc-900 md:px-6">
      <div className={`mx-auto flex h-full w-full max-w-[1600px] flex-col space-y-3 ${showExamActions ? "pb-24" : ""}`}>
        <div
          data-animate="home-shell"
          className="flex flex-col gap-3 rounded-2xl border border-zinc-200/90 bg-white/90 p-3 shadow-[0_14px_35px_-20px_rgba(0,0,0,0.45)] backdrop-blur transition xl:flex-row xl:items-center xl:justify-between"
        >
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-zinc-900 md:text-2xl">Ujian Praktikum Sistem Operasi</h1>
            <p className="mt-0.5 text-xs text-zinc-500 md:text-sm">Login sebagai {user.username} (praktikan)</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            {showExamActions ? (
              <span
                className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold tracking-[0.12em] md:text-sm ${
                  examState === "submitted"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : examState === "paused_global" || examState === "paused_individual" || examState === "scheduled" || examState === "not_started"
                      ? "border-amber-200 bg-amber-50 text-amber-700"
                      : timerBadgeClass
                }`}
                title="Status ujian"
              >
                {examState === "active"
                  ? `Sisa Waktu ${timerText}`
                  : examState === "scheduled"
                    ? `Mulai dalam ${timerText}`
                  : examState === "not_started"
                      ? "Belum Dimulai"
                  : examState === "paused_individual"
                    ? "Dijeda Personal"
                  : examState === "paused_global"
                    ? "Dijeda Admin"
                      : examState === "submitted"
                        ? "Sudah Disubmit"
                        : "Waktu Habis"}
              </span>
            ) : null}
            {user.role === "admin" && !allowAdminTerminal ? (
              <button
                type="button"
                onClick={() => setShowHelpPanel((prev) => !prev)}
                className="rounded-lg bg-zinc-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:-translate-y-0.5 hover:bg-zinc-600"
              >
                {showHelpPanel ? "Sembunyikan Bantuan" : "Tampilkan Bantuan"}
              </button>
            ) : null}
            {showExamActions ? (
              <button
                type="button"
                onClick={() => setConfirmAction("logout")}
                className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-white transition hover:-translate-y-0.5 hover:bg-zinc-700"
              >
                Logout
              </button>
            ) : null}
          </div>
        </div>

        {user.role === "admin" && showHelpPanel ? <HelpPanel /> : null}

        <div data-animate="home-shell" className="flex min-h-0 flex-1 flex-col space-y-3">
          {showExamActions ? (
            <div className="rounded-xl border border-zinc-200 bg-white/90 p-2 shadow-[0_10px_24px_-18px_rgba(0,0,0,0.35)]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-50 p-1 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setLayoutMode("split")}
                  className={`rounded-lg px-2.5 py-1 ${layoutMode === "split" ? "bg-zinc-800 text-white" : "text-zinc-600"}`}
                >
                  Split View
                </button>
                <button
                  type="button"
                  onClick={() => setLayoutMode("pdf")}
                  className={`rounded-lg px-2.5 py-1 ${layoutMode === "pdf" ? "bg-zinc-800 text-white" : "text-zinc-600"}`}
                >
                  Soal Only
                </button>
                <button
                  type="button"
                  onClick={() => setLayoutMode("terminal")}
                  className={`rounded-lg px-2.5 py-1 ${layoutMode === "terminal" ? "bg-zinc-800 text-white" : "text-zinc-600"}`}
                >
                  Terminal Only
                </button>
                </div>
                <div className="min-[900px]:hidden">
                {hasQuestionPdf ? (
                  <button
                    type="button"
                    onClick={() => setShowMobilePdfModal(true)}
                    className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500"
                  >
                    Lihat Soal
                  </button>
                ) : (
                  <p className="text-sm text-zinc-600">
                    {user.role === "admin" && allowAdminTerminal
                      ? "Soal belum diassign untuk praktikan ini."
                      : "Soal PDF belum tersedia. Silakan hubungi admin."}
                  </p>
                )}
                </div>
              </div>
            </div>
          ) : null}

          <div
            className={`min-h-0 flex-1 gap-3 transition-all duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
              layoutMode === "split" && showQuestionPanel && showTerminalPanel
                ? "grid grid-cols-1 min-[900px]:h-[calc(100vh-230px)] min-[900px]:grid-cols-2 items-stretch"
                : layoutMode === "pdf"
                  ? "flex h-full flex-col"
                  : "flex flex-col"
            }`}
          >
            {showQuestionPanel ? (
              <aside
                className={`h-full min-h-0 min-w-0 overflow-hidden rounded-2xl border border-zinc-200 bg-white/95 shadow-[0_16px_36px_-24px_rgba(0,0,0,0.5)] ${
                  layoutMode === "pdf" ? "mx-auto h-full w-full max-w-[1100px] flex-1" : ""
                } flex flex-col`}
              >
                <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-100 px-3 py-2.5">
                  <div>
                    <p className="text-sm font-semibold text-zinc-800">Preview Soal</p>
                    {!showExamActions && effectiveAdminStudentUsername ? (
                      <p className="text-xs text-zinc-500">Praktikan: {effectiveAdminStudentUsername}</p>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    <a
                      href={hasQuestionPdf ? previewQuestionPdfUrl ?? "#" : "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-disabled={!hasQuestionPdf}
                      className={`rounded-lg px-2 py-1 text-xs font-semibold transition ${
                        hasQuestionPdf
                          ? "bg-blue-100 text-blue-700 hover:bg-blue-200"
                          : "cursor-not-allowed bg-zinc-200 text-zinc-400"
                      }`}
                    >
                      Buka PDF
                    </a>
                  </div>
                </div>
                <div className={`relative min-h-0 flex-1 overflow-hidden bg-zinc-50 p-0 ${previewPanelHeightClass}`}>
                  {hasQuestionPdf ? (
                    <>
                      {pdfLoadingDesktop ? (
                        <div className="absolute inset-0 animate-pulse border border-zinc-200 bg-white" />
                      ) : null}
                      <iframe
                        title="Preview Soal Praktikum"
                        src={previewQuestionPdfUrl ?? ""}
                        key={previewQuestionPdfUrl ?? "no-pdf-desktop"}
                        onLoad={() => setPdfLoadingDesktop(false)}
                        onError={() => {
                          setPdfLoadError(true);
                          setPdfLoadingDesktop(false);
                        }}
                        className="block h-full min-h-0 w-full border border-zinc-300 bg-white opacity-100"
                        style={{ opacity: 1, filter: "none" }}
                      />
                    </>
                  ) : (
                    <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 bg-white/80 p-4 text-center">
                      <div className="h-10 w-8 rounded border-2 border-zinc-300 bg-zinc-100" />
                      <p className="text-sm font-semibold text-zinc-700">
                        {user.role === "admin" && allowAdminTerminal
                          ? "Soal belum diassign untuk praktikan ini."
                          : "Soal belum tersedia"}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {user.role === "admin" && allowAdminTerminal
                          ? "Silakan pilih atau ganti soal dari Admin Dashboard."
                          : "Soal PDF belum tersedia. Silakan hubungi admin."}
                      </p>
                    </div>
                  )}
                  {pdfLoadError && hasQuestionPdf ? (
                    <div className="absolute inset-2 flex items-center justify-center rounded-xl border border-red-200 bg-red-50/95 p-4 text-center">
                      <div>
                        <p className="text-sm font-semibold text-red-700">Gagal memuat soal.</p>
                        <p className="mt-1 text-xs text-red-600">Periksa file PDF atau assignment soal praktikan ini.</p>
                      </div>
                    </div>
                  ) : null}
                </div>
              </aside>
            ) : null}

            {showTerminalPanel ? (
              <div
              className={`h-full min-h-0 flex-1 transition-all duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
                showExamActions && !showQuestionPanel ? "mx-auto w-full max-w-[1400px]" : ""
              }`}
            >
              <Terminal
                entries={entries}
                inputValue={terminalInput}
                onInputChange={onTerminalInputChange}
                onSubmit={runCommand}
                onHistoryUp={navigateHistoryUp}
                onHistoryDown={navigateHistoryDown}
                onInterrupt={interruptProgram}
                focusSignal={focusSignal}
                prompt={currentPrompt}
                username={user.username}
                backButtonLabel={user.role === "admin" && allowAdminTerminal ? "Kembali" : undefined}
                onBack={
                  user.role === "admin" && allowAdminTerminal
                    ? () => router.push(adminReturnPath)
                    : undefined
                }
                stdinMode={Boolean(interactiveRun)}
                readOnly={showExamActions && isTerminalInputLocked}
                stateBanner={
                  isAdminMonitorMode
                    ? null
                    : examState === "submitted"
                    ? {
                        title: "Ujian sudah disubmit",
                        description: `Jawaban tidak dapat diubah lagi.\nMode: Read Only${submittedAt ? `\nWaktu submit: ${new Date(submittedAt).toLocaleString()}` : ""}`,
                        tone: "success",
                      }
                    : examState === "expired"
                      ? {
                          title: "Waktu ujian telah habis",
                          description: "Jawaban tidak dapat diubah dan mode terminal read-only aktif.",
                          tone: "danger",
                        }
                      : examState === "not_started"
                        ? {
                            title: "Ujian belum dimulai",
                            description: "Ujian belum dimulai. Terminal masih dikunci oleh admin.",
                            tone: "warning",
                          }
                      : examState === "scheduled"
                        ? {
                            title: "Ujian terjadwal",
                            description: `Ujian akan dimulai pada ${examStartTime ? new Date(examStartTime).toLocaleString() : "-"}.\nTerminal akan aktif otomatis saat ujian dimulai.`,
                            tone: "warning",
                          }
                      : examState === "paused_global"
                        ? {
                            title: "Ujian sedang dijeda oleh admin",
                            description: "Countdown berhenti sementara, input terminal dinonaktifkan.",
                            tone: "warning",
                          }
                        : examState === "paused_individual"
                          ? {
                              title: "Timer kamu dijeda oleh admin",
                              description: "Input terminal dinonaktifkan sementara untuk akun ini.",
                              tone: "warning",
                            }
                          : null
                }
              />
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {showExamActions ? (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-zinc-200 bg-white/95 shadow-[0_-8px_24px_-16px_rgba(0,0,0,0.4)] backdrop-blur">
          <div className="mx-auto flex w-full max-w-[1600px] flex-col items-start gap-2 px-3 py-3 md:flex-row md:items-center md:justify-between md:gap-3 md:px-6">
            {examState === "submitted" ? (
              <div className="inline-flex items-center rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 md:text-sm">
                <span>Ujian sudah disubmit. Jawaban tidak dapat diubah lagi.</span>
              </div>
            ) : (
              <p className="text-xs text-zinc-600 md:text-sm">
                {examState === "expired"
                  ? "Waktu ujian habis. Jawaban tidak dapat diubah lagi."
                  : examState === "not_started"
                    ? "Ujian belum dimulai. Terminal masih dikunci oleh admin."
                  : examState === "scheduled"
                    ? `Ujian akan dimulai pada ${examStartTime ? new Date(examStartTime).toLocaleString() : "-"}`
                  : examState === "paused_individual"
                    ? "Timer akun ini sedang dijeda oleh admin."
                  : examState === "paused_global"
                    ? "Ujian sedang dijeda oleh admin."
                      : "Pastikan jawaban sudah benar sebelum submit."}
              </p>
            )}
            {examState === "active" || examState === "paused_global" || examState === "paused_individual" || examState === "scheduled" || examState === "not_started" ? (
              <button
                type="button"
                onClick={() => setConfirmAction("submit")}
                disabled={isSubmitLocked || examState !== "active"}
                className="self-end rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-blue-500 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 md:self-auto"
              >
                Submit Ujian
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <EditorModal
        isOpen={editorOpen}
        filename={getFileName(activeFilePath) || "untitled"}
        value={editorContent}
        onChange={setEditorContent}
        onSave={saveEditorOnly}
        onSaveAndClose={saveAndCloseEditor}
        onClose={() => {
          setEditorOpen(false);
          requestTerminalFocus();
        }}
      />

      {showNameModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="submit-modal-title"
            className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-xl sm:p-6"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="submit-modal-title" className="text-xl font-semibold text-slate-900">
                  Submit Ujian
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Pastikan data yang kamu kirim sudah benar sebelum menyelesaikan ujian.
                </p>
              </div>
              <button
                type="button"
                onClick={() => !submitting && setShowNameModal(false)}
                disabled={submitting}
                className="rounded-lg px-2 py-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                aria-label="Tutup modal submit"
              >
                x
              </button>
            </div>

            <form
              className="mt-5 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                const finalName = studentNameInput.trim();
                let hasError = false;

                if (!finalName) {
                  setStudentNameError("Nama praktikan wajib diisi.");
                  hasError = true;
                } else {
                  setStudentNameError("");
                }

                if (!submissionTargetPath.trim()) {
                  setSubmissionFileError("File submit wajib dipilih.");
                  hasError = true;
                } else {
                  setSubmissionFileError("");
                }

                if (hasError) {
                  return;
                }
                void submitExam(finalName);
              }}
            >
              <div>
                <label htmlFor="student-name" className="mb-1.5 block text-sm font-medium text-slate-700">
                  Nama Praktikan
                </label>
                <input
                  ref={studentNameInputRef}
                  id="student-name"
                  value={studentNameInput}
                  onChange={(event) => {
                    setStudentNameInput(event.target.value);
                    if (studentNameError) setStudentNameError("");
                  }}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                  placeholder="Contoh: Faiq Bangkit Wicaksono"
                />
                {studentNameError ? (
                  <p className="mt-1 text-xs font-medium text-red-600">{studentNameError}</p>
                ) : null}
              </div>

              <div>
                <p className="mb-1.5 text-sm font-medium text-slate-700">File terpilih</p>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
                  <p className="break-all">{selectedSubmissionFile?.name ?? "Belum ada file dipilih."}</p>
                </div>
              </div>

              {submissionCandidates.length > 1 ? (
                <div>
                  <label htmlFor="submission-file" className="mb-1.5 block text-sm font-medium text-slate-700">
                    Pilih file submit
                  </label>
                  <select
                    id="submission-file"
                    value={submissionTargetPath}
                    onChange={(event) => {
                      setSubmissionTargetPath(event.target.value);
                      if (submissionFileError) setSubmissionFileError("");
                    }}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                  >
                    <option value="">Pilih file jawaban...</option>
                    {submissionCandidates.map((file) => (
                      <option key={file.name} value={file.name}>
                        {file.name}
                      </option>
                    ))}
                  </select>
                  {submissionFileError ? (
                    <p className="mt-1 text-xs font-medium text-red-600">{submissionFileError}</p>
                  ) : null}
                </div>
              ) : null}

              <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setShowNameModal(false)}
                  disabled={submitting}
                  className="rounded-xl border border-slate-200 bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-200 disabled:opacity-60"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting || !submissionTargetPath.trim()}
                  className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      Mengirim...
                    </span>
                  ) : (
                    "Submit Ujian"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {confirmAction ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-4 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.45)]">
            <h2 className="text-lg font-semibold text-zinc-900">
              {confirmAction === "logout" ? "Yakin ingin logout?" : "Submit Ujian?"}
            </h2>
            <p className="mt-2 text-sm text-zinc-600">
              {confirmAction === "logout"
                ? "Yakin ingin logout? Pastikan jawaban sudah tersimpan."
                : "Setelah ujian disubmit, jawaban tidak dapat diubah lagi."}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => {
                  const action = confirmAction;
                  setConfirmAction(null);

                  if (action === "logout") {
                    void logout();
                    return;
                  }

                  if (submissionCandidates.length === 0) {
                    setToast("Belum ada file jawaban untuk disubmit.");
                    return;
                  }
                  if (timeExpired) {
                    setToast("Waktu ujian habis. Submit dinonaktifkan.");
                    return;
                  }

                  setStudentNameInput("");
                  setSubmissionTargetPath(activeSubmissionFile?.name ?? submissionCandidates[0]?.name ?? "");
                  setStudentNameError("");
                  setSubmissionFileError("");
                  setShowNameModal(true);
                }}
                className={`rounded-md px-3 py-2 text-sm text-white ${
                  confirmAction === "logout"
                    ? "bg-red-600 hover:bg-red-500"
                    : "bg-blue-600 hover:bg-blue-500"
                }`}
              >
                {confirmAction === "logout" ? "Ya, Logout" : "Ya, Submit Ujian"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="fixed bottom-4 right-4 rounded-md border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-900 shadow-lg">
          {toast}
        </div>
      ) : null}

      {showMobilePdfModal && showExamActions ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 lg:hidden">
          <div className="flex h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-700 px-3 py-2.5">
              <h2 className="text-sm font-semibold text-zinc-100">Preview Soal</h2>
              <div className="flex gap-2">
                <a
                  href={hasQuestionPdf ? previewQuestionPdfUrl ?? "#" : "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-disabled={!hasQuestionPdf}
                  className={`rounded-lg px-2 py-1 text-xs font-semibold ${
                    hasQuestionPdf ? "bg-blue-100 text-blue-700" : "bg-zinc-300 text-zinc-500"
                  }`}
                >
                  Buka PDF
                </a>
                <button
                  type="button"
                  onClick={() => setShowMobilePdfModal(false)}
                  className="rounded-lg bg-zinc-700 px-2 py-1 text-xs font-semibold text-zinc-100"
                >
                  Tutup
                </button>
              </div>
            </div>
            <div className="relative flex-1 overflow-auto bg-zinc-50 p-2">
              {hasQuestionPdf ? (
                <>
                  {pdfLoadingMobile ? (
                    <div className="absolute inset-2 animate-pulse rounded-xl border border-zinc-200 bg-white" />
                  ) : null}
                  <iframe
                    title="Preview Soal Praktikum Mobile"
                    src={previewQuestionPdfUrl ?? ""}
                    key={previewQuestionPdfUrl ?? "no-pdf-mobile"}
                    onLoad={() => setPdfLoadingMobile(false)}
                    onError={() => {
                      setPdfLoadError(true);
                      setPdfLoadingMobile(false);
                    }}
                    className="h-full min-h-[78vh] w-full rounded-xl border border-zinc-300 bg-white opacity-100"
                    style={{ opacity: 1, filter: "none" }}
                  />
                </>
              ) : (
                <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 bg-white/80 p-4 text-center">
                  <div className="h-10 w-8 rounded border-2 border-zinc-300 bg-zinc-100" />
                  <p className="text-sm font-semibold text-zinc-700">
                    {user.role === "admin" && allowAdminTerminal
                      ? "Soal belum diassign untuk praktikan ini."
                      : "Soal belum tersedia"}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {user.role === "admin" && allowAdminTerminal
                      ? "Silakan pilih atau ganti soal dari Admin Dashboard."
                      : "Soal PDF belum tersedia. Silakan hubungi admin."}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <AppLoadingScreen
          title="Memuat Dashboard Praktikum"
          subtitle="Menyiapkan terminal dan sesi pengguna..."
        />
      }
    >
      <HomeContent />
    </Suspense>
  );
}

