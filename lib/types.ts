export type FileSystemItem = {
  name: string;
  content: string;
  type: "file" | "executable";
  executable: boolean;
  sourceFile?: string;
};

export type TerminalEntry = {
  id: string;
  prompt: string;
  command: string;
  output: string[];
};

export type AppRole = "student" | "admin";

export type AppUser = {
  username: string;
  name: string;
  role: AppRole;
};

export type SubmissionRecord = {
  id: string;
  user_id: string | null;
  name: string;
  username: string;
  file_name: string;
  file_path: string;
  code: string;
  submitted_at: string;
};
