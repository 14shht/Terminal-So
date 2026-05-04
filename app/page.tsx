"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EditorModal } from "@/components/EditorModal";
import { HelpPanel } from "@/components/HelpPanel";
import { Terminal } from "@/components/Terminal";
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

const parsePrintfLines = (content: string): string[] => {
  const matches = [...content.matchAll(/printf\s*\(\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g)];
  return matches.map((match) => match[1].replace(/\\n/g, "").trim()).filter(Boolean);
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

export default function Home() {
  const router = useRouter();
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
      if (nextUser.role === "admin") {
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
  }, [router]);

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
      setToast(data.error || data.message || "Gagal mengirim ujian.");
      return;
    }

    setSubmitted(true);
    setShowNameModal(false);
    setStudentNameInput("");
    setToast("Jawaban berhasil disubmit");
  };

  const runCommand = () => {
    const command = terminalInput.trim();
    const promptAtCommand = currentPrompt;

    setTerminalInput("");
    requestTerminalFocus();

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

        const echoLines = parseEchoLines(file.content);
        pushEntry(
          command,
          echoLines.length > 0 ? echoLines : ["Script berhasil dijalankan."],
          promptAtCommand,
        );
        return;
      }

      if (file.type !== "executable") {
        pushEntry(command, [`bash: ./${name}: No such file or directory`], promptAtCommand);
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

  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-200 p-6 text-zinc-900">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-zinc-400 border-t-zinc-700" />
          <div className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-600 [animation-delay:-0.2s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-600 [animation-delay:-0.1s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-600" />
          </div>
          <p className="text-sm text-zinc-700">Memuat sesi...</p>
        </div>
      </main>
    );
  }

  if (authError) {
    return <main className="min-h-screen bg-zinc-200 p-6 text-red-600">{authError}</main>;
  }

  if (!user) {
    return null;
  }

  return (
    <main ref={rootRef} className="min-h-screen bg-zinc-200 px-3 py-5 text-zinc-900 md:px-6">
      <div className="mx-auto w-full max-w-6xl space-y-3">
        <div data-animate="home-shell" className="flex items-center justify-between gap-3 rounded-xl border border-zinc-300 bg-white p-3 shadow-sm">
          <h1 className="text-lg font-semibold text-zinc-900 md:text-xl">Ujian Praktikum Sistem Operasi</h1>
          {user.role === "admin" ? (
            <button
              type="button"
              onClick={() => setShowHelpPanel((prev) => !prev)}
              className="rounded-md bg-zinc-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-600"
            >
              {showHelpPanel ? "Sembunyikan Bantuan" : "Tampilkan Bantuan"}
            </button>
          ) : null}
        </div>

        {user.role === "admin" && showHelpPanel ? <HelpPanel /> : null}

        <div data-animate="home-shell">
          <Terminal
          entries={entries}
          inputValue={terminalInput}
          onInputChange={setTerminalInput}
          onSubmit={runCommand}
          focusSignal={focusSignal}
          prompt={currentPrompt}
          username={user.username}
          onSubmitExam={() => {
            if (!activeSubmissionFile) {
              setToast("Tidak ada file aktif untuk disubmit.");
              return;
            }
            setStudentNameInput("");
            setShowNameModal(true);
          }}
          onLogout={logout}
          submitted={submitted}
          />
        </div>
      </div>

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

      {toast ? (
        <div className="fixed bottom-4 right-4 rounded-md bg-zinc-800 px-4 py-2 text-sm text-zinc-100 shadow-lg">
          {toast}
        </div>
      ) : null}
    </main>
  );
}

