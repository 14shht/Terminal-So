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
};

type InteractiveRunState = {
  mode: "c" | "sh";
  prompts: string[];
  answers: string[];
  sourceCode: string;
  shellVars?: string[];
  shellOutputTemplates?: string[];
};

type ExamSessionResponse = {
  session: {
    startedAt: string;
    durationMinutes: number;
    expiresAt: string;
    remainingSeconds: number;
    isPaused: boolean;
    isPausedIndividual: boolean;
    now: string;
    status: "active" | "submitted" | "timeout";
  };
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

  return tailOutputTemplates
    .map((line) => line.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, key: string) => env[key] ?? ""))
    .map((line) => line.replace(/^echo\s+/, "").trim())
    .filter((line) => line && !prompts.includes(line));
};

const parsePrintfLines = (content: string): string[] => {
  const matches = [...content.matchAll(/printf\s*\(\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g)];
  return matches.map((match) => match[1].replace(/\\n/g, "").trim()).filter(Boolean);
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

const renderProgramOutputWithInputs = (content: string, answers: string[], prompts: string[]): string[] => {
  const lines = parsePrintfLines(content);
  const promptSet = new Set(prompts);
  let answerIndex = 0;

  return lines
    .map((line) =>
      line.replace(/%[-+0-9.]*[a-zA-Z]/g, () => {
        const answer = answers[answerIndex] ?? "";
        answerIndex += 1;
        return answer;
      }),
    )
    .map((line) => line.trim())
    .filter((line) => line && !promptSet.has(line));
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

    return { currentDir, folders, files, entries, submitted: Boolean(parsed.submitted) };
  } catch {
    window.localStorage.removeItem(getStorageKey(username));
    return {
      currentDir: HOME_DIR,
      folders: DEFAULT_FOLDERS,
      files: DEFAULT_FILES,
      entries: [],
      submitted: false,
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
  const [editorOpen, setEditorOpen] = useState(false);
  const [activeFilePath, setActiveFilePath] = useState("");
  const [editorContent, setEditorContent] = useState("");
  const [showHelpPanel, setShowHelpPanel] = useState(false);
  const [focusSignal, setFocusSignal] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [toast, setToast] = useState("");

  const [showNameModal, setShowNameModal] = useState(false);
  const [studentNameInput, setStudentNameInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [interactiveRun, setInteractiveRun] = useState<InteractiveRunState | null>(null);
  const [confirmAction, setConfirmAction] = useState<"submit" | "logout" | null>(null);
  const [showPdfPreview, setShowPdfPreview] = useState(true);
  const [showMobilePdfModal, setShowMobilePdfModal] = useState(false);
  const [pdfLoadingDesktop, setPdfLoadingDesktop] = useState(true);
  const [pdfLoadingMobile, setPdfLoadingMobile] = useState(true);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(90 * 60);
  const [timeExpired, setTimeExpired] = useState(false);
  const [isExamPaused, setIsExamPaused] = useState(false);
  const [isIndividualPaused, setIsIndividualPaused] = useState(false);

  const allowAdminTerminal = searchParams.get("admin_terminal") === "1";
  const adminReturnRaw = searchParams.get("admin_return");
  const adminReturnPath =
    adminReturnRaw && adminReturnRaw.startsWith("/admin/submissions/")
      ? adminReturnRaw
      : "/admin";

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
      setAuthLoading(false);
    };

    void loadMe();
  }, [allowAdminTerminal, router]);

  useEffect(() => {
    if (!user || user.role !== "student") {
      return;
    }

    const loadSession = async () => {
      const response = await fetch(`/api/exam/session?t=${Date.now()}`, {
        cache: "no-store",
        headers: { "cache-control": "no-store" },
      });
      const data = (await response.json().catch(() => null)) as ExamSessionResponse | null;
      if (!response.ok || !data?.session) {
        return;
      }

      setRemainingSeconds(Math.max(0, Number(data.session.remainingSeconds || 0)));
      setIsExamPaused(Boolean(data.session.isPaused));
      setIsIndividualPaused(Boolean(data.session.isPaused) ? false : Boolean(data.session.isPausedIndividual));
      setTimeExpired(data.session.status === "timeout" || data.session.remainingSeconds <= 0);
      if (data.session.status === "submitted") {
        setSubmitted(true);
      }
    };

    void loadSession();
    const poll = setInterval(() => {
      void loadSession();
    }, 1000);
    return () => clearInterval(poll);
  }, [user]);

  useEffect(() => {
    if (!user || typeof window === "undefined") {
      return;
    }

    const payload: PersistedState = { currentDir, folders, files, entries, submitted };
    window.localStorage.setItem(getStorageKey(user.username), JSON.stringify(payload));
  }, [currentDir, folders, files, entries, submitted, user]);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = setTimeout(() => setToast(""), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

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

    const targetPath = activeFilePath.trim();
    if (!targetPath) {
      setToast("Tidak ada file aktif untuk disubmit.");
      return;
    }
    const targetFile = fileMap.get(targetPath);
    if (!targetFile) {
      setToast("Tidak ada file aktif untuk disubmit.");
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
    setShowNameModal(false);
    setStudentNameInput("");
    setToast("Jawaban berhasil disubmit");
  };

  const runCommand = () => {
    const rawInput = terminalInput;
    const command = rawInput.trim();
    const promptAtCommand = currentPrompt;

    setTerminalInput("");
    requestTerminalFocus();

    if (interactiveRun) {
      if (!rawInput.trim()) {
        return;
      }

      const nextAnswers = [...interactiveRun.answers, rawInput.trim()];
      pushEntry(rawInput.trim(), [], promptAtCommand);

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
        pushEntry(command, [`Program menunggu input...`, prompts[0]], promptAtCommand);
        setInteractiveRun({ mode: "c", prompts, answers: [], sourceCode });
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

  const activeSubmissionFile = activeFilePath ? fileMap.get(activeFilePath) ?? null : null;
  const isSubmitLocked = submitted || timeExpired;
  const timerHours = Math.floor(remainingSeconds / 3600)
    .toString()
    .padStart(2, "0");
  const timerMinutes = Math.floor((remainingSeconds % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const timerSeconds = (remainingSeconds % 60).toString().padStart(2, "0");
  const timerText = `${timerHours}:${timerMinutes}:${timerSeconds}`;
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
  const hasQuestionPdf = Boolean(user.questionPdfUrl);

  return (
    <main ref={rootRef} className="h-screen overflow-hidden bg-[linear-gradient(160deg,#ecebe7_0%,#f4f3f1_45%,#ebe9e5_100%)] px-3 py-4 text-zinc-900 md:px-6">
      <div className={`mx-auto flex h-full w-full max-w-[1600px] flex-col space-y-3 ${showExamActions ? "pb-24" : ""}`}>
        <div
          data-animate="home-shell"
          className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-200/90 bg-white/90 p-3 shadow-[0_14px_35px_-20px_rgba(0,0,0,0.45)] backdrop-blur transition"
        >
          <h1 className="text-lg font-semibold tracking-tight text-zinc-900 md:text-2xl">Ujian Praktikum Sistem Operasi</h1>
          <div className="flex items-center gap-2">
            {showExamActions ? (
              <span
                className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold tracking-[0.12em] md:text-sm ${
                  submitted
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : timerBadgeClass
                }`}
                title={submitted ? "Status ujian" : "Sisa waktu ujian"}
              >
                {submitted ? "Sudah Disubmit" : timeExpired ? "00:00:00" : timerText}
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
            {showExamActions && !showPdfPreview && hasQuestionPdf ? (
              <button
                type="button"
                onClick={() => setShowPdfPreview(true)}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:-translate-y-0.5 hover:bg-indigo-500"
              >
                Lihat Soal
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
            <div className="lg:hidden">
              {hasQuestionPdf ? (
                <button
                  type="button"
                  onClick={() => setShowMobilePdfModal(true)}
                  className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500"
                >
                  Lihat Soal
                </button>
              ) : (
                <p className="text-sm text-zinc-600">Soal PDF belum tersedia. Silakan hubungi admin.</p>
              )}
            </div>
          ) : null}

          <div className="flex min-h-0 flex-1 gap-3 transition-all duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)]">
            {showExamActions ? (
              <aside
                className={`hidden min-h-0 overflow-hidden rounded-2xl border border-zinc-200 bg-white/95 shadow-[0_16px_36px_-24px_rgba(0,0,0,0.5)] transition-[width,opacity,transform] duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)] lg:flex lg:flex-col ${
                  showPdfPreview
                    ? "w-[40%] translate-x-0 opacity-100"
                    : "pointer-events-none w-0 -translate-x-6 opacity-0"
                }`}
              >
                <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-100 px-3 py-2.5">
                  <p className="text-sm font-semibold text-zinc-800">Preview Soal</p>
                  <div className="flex gap-2">
                    <a
                      href={hasQuestionPdf ? user.questionPdfUrl ?? "#" : "#"}
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
                    <button
                      type="button"
                      onClick={() => setShowPdfPreview(false)}
                      className="rounded-lg bg-zinc-700 px-2 py-1 text-xs font-semibold text-white transition hover:bg-zinc-600"
                    >
                      Sembunyikan
                    </button>
                  </div>
                </div>
                <div className="relative h-full min-h-0 overflow-auto bg-zinc-50 p-2">
                  {hasQuestionPdf ? (
                    <>
                      {pdfLoadingDesktop ? (
                        <div className="absolute inset-2 animate-pulse rounded-xl border border-zinc-200 bg-white" />
                      ) : null}
                      <iframe
                        title="Preview Soal Praktikum"
                        src={user.questionPdfUrl ?? ""}
                        key={user.questionPdfUrl ?? "no-pdf-desktop"}
                        onLoad={() => setPdfLoadingDesktop(false)}
                        className="h-full min-h-[74vh] w-full rounded-xl border border-zinc-300 bg-white opacity-100"
                        style={{ opacity: 1, filter: "none" }}
                      />
                    </>
                  ) : (
                    <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 bg-white/80 p-4 text-center">
                      <div className="h-10 w-8 rounded border-2 border-zinc-300 bg-zinc-100" />
                      <p className="text-sm font-semibold text-zinc-700">Soal belum tersedia</p>
                      <p className="text-xs text-zinc-500">Soal PDF belum tersedia. Silakan hubungi admin.</p>
                    </div>
                  )}
                </div>
              </aside>
            ) : null}

            <div
              className={`min-h-0 flex-1 transition-all duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
                showExamActions && !showPdfPreview ? "mx-auto w-full max-w-[1180px]" : ""
              }`}
            >
              <Terminal
                entries={entries}
                inputValue={terminalInput}
                onInputChange={setTerminalInput}
                onSubmit={runCommand}
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
                readOnly={showExamActions && isSubmitLocked}
              />
            </div>
          </div>
        </div>
      </div>

      {showExamActions ? (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-zinc-200 bg-white/95 shadow-[0_-8px_24px_-16px_rgba(0,0,0,0.4)] backdrop-blur">
          <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-3 px-3 py-3 md:px-6">
            <p className="text-xs text-zinc-600 md:text-sm">
              {submitted
                ? "Ujian sudah disubmit. Jawaban tidak dapat diubah lagi."
                : timeExpired
                  ? "Waktu ujian habis. Jawaban tidak dapat diubah lagi."
                  : "Pastikan semua jawaban sudah selesai sebelum submit."}
            </p>
            {showExamActions && isExamPaused && !submitted ? (
              <p className="text-xs text-amber-700 md:text-sm">Ujian sedang dijeda oleh admin.</p>
            ) : null}
            {showExamActions && !isExamPaused && isIndividualPaused && !submitted ? (
              <p className="text-xs text-amber-700 md:text-sm">Timer kamu dijeda oleh admin.</p>
            ) : null}
            <button
              type="button"
              onClick={() => setConfirmAction("submit")}
              disabled={isSubmitLocked}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-blue-500 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitted ? "Sudah Disubmit" : timeExpired ? "Waktu Habis" : "Submit Ujian"}
            </button>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xl rounded-xl border border-zinc-700 bg-zinc-900 p-4">
            <h2 className="text-lg font-semibold">Isi Nama Praktikan</h2>
            <p className="mt-2 text-sm text-zinc-400">
              Masukkan nama kamu sebelum submit ujian.
            </p>
            <div className="mt-3">
              <label htmlFor="student-name" className="mb-1 block text-sm text-zinc-300">
                Nama Praktikan
              </label>
              <input
                id="student-name"
                value={studentNameInput}
                onChange={(event) => setStudentNameInput(event.target.value)}
                className="w-full rounded border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none"
                placeholder="Contoh: Faiq Bangkit Wicaksono"
              />
            </div>
            <div className="mt-3 rounded border border-zinc-700 bg-zinc-950 p-3 text-sm">
              <p className="mb-1 text-zinc-400">File yang akan disubmit:</p>
              <p className="break-all text-zinc-100">
                {activeSubmissionFile?.name ?? "Tidak ada file aktif untuk disubmit."}
              </p>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNameModal(false)}
                className="rounded-md bg-zinc-700 px-3 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const finalName = studentNameInput.trim();
                  if (!finalName) {
                    alert("Nama wajib diisi.");
                    return;
                  }
                  void submitExam(finalName);
                }}
                disabled={submitting || !activeSubmissionFile}
                className="rounded-md bg-blue-600 px-3 py-2 text-sm disabled:opacity-60"
              >
                {submitting ? "Mengirim..." : "Submit"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmAction ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-4">
            <h2 className="text-lg font-semibold text-zinc-100">
              {confirmAction === "logout" ? "Yakin ingin logout?" : "Submit Ujian?"}
            </h2>
            <p className="mt-2 text-sm text-zinc-300">
              {confirmAction === "logout"
                ? "Yakin ingin logout? Pastikan jawaban sudah tersimpan."
                : "Setelah ujian disubmit, jawaban tidak dapat diubah lagi."}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className="rounded-md bg-zinc-700 px-3 py-2 text-sm text-zinc-100"
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

                  if (!activeSubmissionFile) {
                    setToast("Tidak ada file aktif untuk disubmit.");
                    return;
                  }
                  if (timeExpired) {
                    setToast("Waktu ujian habis. Submit dinonaktifkan.");
                    return;
                  }

                  setStudentNameInput("");
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
        <div className="fixed bottom-4 right-4 rounded-md bg-zinc-800 px-4 py-2 text-sm text-zinc-100 shadow-lg">
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
                  href={hasQuestionPdf ? user.questionPdfUrl ?? "#" : "#"}
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
                    src={user.questionPdfUrl ?? ""}
                    key={user.questionPdfUrl ?? "no-pdf-mobile"}
                    onLoad={() => setPdfLoadingMobile(false)}
                    className="h-full min-h-[78vh] w-full rounded-xl border border-zinc-300 bg-white opacity-100"
                    style={{ opacity: 1, filter: "none" }}
                  />
                </>
              ) : (
                <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 bg-white/80 p-4 text-center">
                  <div className="h-10 w-8 rounded border-2 border-zinc-300 bg-zinc-100" />
                  <p className="text-sm font-semibold text-zinc-700">Soal belum tersedia</p>
                  <p className="text-xs text-zinc-500">Soal PDF belum tersedia. Silakan hubungi admin.</p>
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

