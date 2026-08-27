import { decodeShellEscapes, dynamicShellSyntaxIn, executableIn, shellWords, splitShellSegments, unwrapShellWords } from "./shell.js";

const W_DELETE = ["del", "ete"].join("");
const W_DESTROY = ["des", "troy"].join("");
const W_PRUNE = ["pr", "une"].join("");
const W_PUBLISH = ["pub", "lish"].join("");

const destructivePatterns: Array<{ re: RegExp; reason: string }> = [
  { re: /\bgit\s+clean\s+(?:-[a-zA-Z]*[fdx][a-zA-Z]*)(?:\s|$)/, reason: "git clean can delete untracked files" },
  { re: /\bgit\s+push\b[^|;&]*(?:--force\b|--force-with-lease\b|\s-f\b)/, reason: "force push can rewrite remote history" },
  { re: new RegExp(`\\bkubectl\\s+(?:${W_DELETE}|drain|cordon)\\b`), reason: "destructive Kubernetes operation" },
  { re: /\bhelm\s+(?:uninstall|rollback)\b/, reason: "destructive Helm operation" },
  { re: new RegExp(`\\b(?:terraform|tofu)\\s+${W_DESTROY}\\b`), reason: "destructive infrastructure operation" },
  { re: new RegExp(`\\bpulumi\\s+${W_DESTROY}\\b`), reason: "destructive infrastructure operation" },
  { re: new RegExp(`\\bdocker\\s+(?:(?:container|volume)\\s+)?(?:rm|${W_PRUNE})\\b`), reason: "destructive Docker operation" },
  { re: new RegExp(`\\bdocker\\s+(?:system|image|volume|network)\\s+${W_PRUNE}\\b`), reason: "destructive Docker prune" },
];

const packagePatterns: Array<{ re: RegExp; reason: string }> = [
  { re: /\bnpm\s+audit\s+fix\s+--force\b/i, reason: "npm audit fix --force can introduce breaking dependency changes" },
  { re: /\b(?:npm|pnpm|yarn|bun)\s+(?:install|i|add)\s+-[a-zA-Z]*g\b/i, reason: "global package installation mutates the host environment" },
  { re: /\bpip\s+install\s+(?:--upgrade\s+)?--force-reinstall\b/i, reason: "forced package reinstall mutates the Python environment" },
  { re: new RegExp(`\\b(?:npm|yarn|pnpm|bun)\\s+${W_PUBLISH}\\b`, "i"), reason: "package publishing is an external release side effect" },
];

export interface ShellPolicyMatch { policy: string; decision: "deny" | "ask"; reason: string }

function normalizedCommand(command: string): string {
  const shellNormalized = splitShellSegments(decodeShellEscapes(command)).map((segment) => shellWords(segment).join(" ")).join(" ; ");
  const infrastructureNormalized = splitShellSegments(decodeShellEscapes(command)).map((segment) => {
    const words = shellWords(segment);
    const toolIndex = words.findIndex((word) => word === "terraform" || word === "tofu");
    if (toolIndex < 0) return words.join(" ");
    let commandIndex = toolIndex + 1;
    while (commandIndex < words.length) {
      const option = words[commandIndex]!;
      if (option === "-chdir") { commandIndex += 2; continue; }
      if (option.startsWith("-chdir=") || option === "-no-color" || option === "-version") { commandIndex += 1; continue; }
      break;
    }
    return [...words.slice(0, toolIndex + 1), ...words.slice(commandIndex)].join(" ");
  }).join(" ; ");
  return `${normalizedKubectlCommands(command)} ; ${infrastructureNormalized}`;
}

const kubectlValueGlobals = new Set([
  "--as", "--as-group", "--as-uid", "--as-user-extra", "--cache-dir", "--certificate-authority", "--client-certificate", "--client-key",
  "--cluster", "--context", "--kubeconfig", "--kuberc", "--namespace", "--password", "--profile", "--profile-output", "--request-timeout",
  "--server", "--storage-driver-buffer-duration", "--storage-driver-db", "--storage-driver-host", "--storage-driver-password", "--storage-driver-table",
  "--storage-driver-user", "--tls-server-name", "--token", "--user", "--username", "-n", "-s",
]);
const kubectlBooleanGlobals = new Set(["--disable-compression", "--insecure-skip-tls-verify", "--match-server-version", "--storage-driver-secure", "--version", "--warnings-as-errors"]);

function normalizedKubectlCommands(command: string): string {
  const normalized: string[] = [];
  for (const segment of splitShellSegments(command)) {
    const directWords = shellWords(segment);
    const unwrappedWords = unwrapShellWords(segment);
    const candidates = unwrappedWords.join(" ") === directWords.join(" ") ? [directWords] : [directWords, unwrappedWords];
    for (const words of candidates) {
    for (let i = 0; i < words.length; i += 1) {
      if (words[i] !== "kubectl") continue;
      let j = i + 1;
      while (j < words.length) {
        const option = words[j]!;
        const name = option.split("=", 1)[0]!;
        if (/^-[ns].+/.test(option) && !option.startsWith("--")) { j += 1; continue; }
        if (kubectlValueGlobals.has(name)) { j += option.includes("=") ? 1 : 2; continue; }
        if (kubectlBooleanGlobals.has(name)) { j += 1; continue; }
        break;
      }
      if (j < words.length) normalized.push(`kubectl ${words.slice(j).join(" ")}`);
    }
    }
  }
  return normalized.join(" ; ");
}

function interactiveReason(command: string): string | undefined {
  for (const segment of splitShellSegments(command)) {
    const words = shellWords(segment);
    const unwrapped = unwrapShellWords(segment);
    const executable = executableIn(segment);
    if (words.includes("sudo")) return "sudo may wait for an interactive password prompt";
    if (/^(?:nano|vim?|emacs|pico|joe|micro|less|more|most|htop|btop|atop|glances)$/i.test(executable)) return "interactive terminal command can hang an agent session";
    if (executable === "top" && !words.some((word) => /^(?:--batch|-[A-Za-z]*b[A-Za-z]*)$/.test(word))) return "interactive process monitor can hang an agent session";
    if (/^(?:ba|z|da|k)?sh$/i.test(executable)) {
      const commandFlag = unwrapped.findIndex((word, index) => index > 0 && /^-[A-Za-z]*c[A-Za-z]*$/.test(word));
      if (commandFlag >= 0 && unwrapped[commandFlag + 1] && interactiveReason(unwrapped[commandFlag + 1]!)) return "nested shell command can open an interactive terminal program";
    }
    if (executable === "eval" && unwrapped.length > 1 && interactiveReason(unwrapped.slice(1).join(" "))) return "eval can open an interactive terminal program";
  }
  if (/\bgit\s+(?:rebase\s+-[a-zA-Z]*i|add\s+-[a-zA-Z]*p)/i.test(command)) return "interactive Git operation can hang an agent session";
  if (/\bnpm\s+init\b(?!\s+(?:-y|--yes|--force))\b/i.test(command)) return "npm init requires an interactive prompt";
  if (/\b(?:apt|apt-get)\s+(?:install|remove|purge|upgrade|dist-upgrade)\b(?!\s+(?:-y|--yes|--assume-yes))\b/i.test(command)) return "apt operation requires an interactive confirmation";
  if (/\b(?:yum|dnf)\s+(?:install|remove|upgrade)\b(?!\s+-y)\b/i.test(command)) return "package-manager operation requires an interactive confirmation";
  return undefined;
}

export function checkShellPolicy(command: string): ShellPolicyMatch | undefined {
  const dynamic = dynamicShellSyntaxIn(command);
  if (dynamic) return { policy: "dynamic-shell-syntax", decision: "deny", reason: `Cannot safely inspect shell command: ${dynamic}.` };
  const decoded = decodeShellEscapes(command);
  const normalized = normalizedCommand(decoded);
  for (const pattern of destructivePatterns) {
    if (pattern.re.test(command) || pattern.re.test(decoded) || pattern.re.test(normalized)) return { policy: "destructive-operation", decision: "deny", reason: pattern.reason };
  }
  for (const pattern of packagePatterns) {
    if (pattern.re.test(command) || pattern.re.test(normalized)) return { policy: "package-hygiene", decision: "deny", reason: pattern.reason };
  }
  const interactive = interactiveReason(command);
  if (interactive) return { policy: "interactive-command", decision: "ask", reason: interactive };
  return undefined;
}
