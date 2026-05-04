const COMMANDS = [
  "help",
  "mkdir nama_folder",
  "cd nama_folder",
  "cd ..",
  "cd",
  "ls",
  "tree",
  "pwd",
  "clear",
  "cat nama_file",
  "touch nama_file",
  "rm nama_file",
  "rmdir nama_folder",
  "chmod +x nama_file",
  "gedit nama_file",
  "nano nama_file",
  "gcc nama_file.c -o nama_output",
  "./nama_output",
  "./latihan.sh",
];

export function HelpPanel() {
  return (
    <section className="rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-lg">
      <h2 className="mb-3 text-lg font-semibold text-zinc-100">Command Bantuan</h2>
      <ul className="space-y-1 font-mono text-sm text-zinc-300">
        {COMMANDS.map((command) => (
          <li key={command}>{command}</li>
        ))}
      </ul>
    </section>
  );
}
