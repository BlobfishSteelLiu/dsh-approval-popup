// Lightweight Bash command parser used for semantic approval-risk checks.
// It is intentionally not a full POSIX parser: it tokenizes quoting, command
// separators, redirections and nested command substitutions, then classifies
// each simple command by argv rather than by prose keyword matching.

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish']);
const SHELL_WRAPPERS = new Set(['sudo', 'doas', 'command', 'builtin', 'exec', 'nohup', 'env', 'timeout', 'xargs']);

function basename(value) {
  return String(value).replace(/\\/g, '/').split('/').pop().toLowerCase();
}

function add(categories, reasons, category, reason) {
  if (!categories.includes(category)) categories.push(category);
  if (!reasons.includes(reason)) reasons.push(reason);
}

function tokenize(input) {
  const tokens = [];
  let word = '';
  let started = false;
  let quote = null;

  const flush = () => {
    if (started) tokens.push({ type: 'word', value: word });
    word = '';
    started = false;
  };

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quote !== null) {
      if (ch === quote) {
        quote = null;
        started = true;
        continue;
      }
      if (quote === '"' && ch === '\\' && i + 1 < input.length) {
        i += 1;
        word += input[i];
        started = true;
        continue;
      }
      word += ch;
      started = true;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      started = true;
      continue;
    }
    if (ch === '\\') {
      if (input[i + 1] === '\n') {
        i += 1;
        continue;
      }
      if (i + 1 < input.length) {
        i += 1;
        word += input[i];
        started = true;
      }
      continue;
    }
    if (ch === '#' && !started) {
      while (i < input.length && input[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '\n') {
      flush();
      tokens.push({ type: 'operator', value: ';' });
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      flush();
      continue;
    }
    if (ch === ';' || ch === '|' || ch === '&' || ch === '(' || ch === ')') {
      flush();
      let op = ch;
      if ((ch === '&' || ch === '|') && input[i + 1] === ch) {
        op += ch;
        i += 1;
      }
      tokens.push({ type: 'operator', value: op });
      continue;
    }
    if (ch === '>' || ch === '<') {
      flush();
      let op = ch;
      if (input[i + 1] === '>') {
        op += '>';
        i += 1;
      }
      tokens.push({ type: 'redirect', value: op });
      continue;
    }
    word += ch;
    started = true;
  }
  flush();
  return tokens;
}

function extractSubstitutions(input) {
  const found = [];
  let quote = null;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quote !== null) {
      if (ch === quote && input[i - 1] !== '\\') {
        quote = null;
        continue;
      }
      if (quote === "'") continue;
    }
    if (quote === null && (ch === "'" || ch === '"')) {
      quote = ch;
      continue;
    }
    if (ch === '`') {
      const end = input.indexOf('`', i + 1);
      if (end > i + 1) {
        found.push(input.slice(i + 1, end));
        i = end;
      }
      continue;
    }
    if (ch === '$' && input[i + 1] === '(') {
      let depth = 1;
      let end = i + 2;
      let innerQuote = null;
      for (; end < input.length; end += 1) {
        const inner = input[end];
        if (innerQuote !== null) {
          if (inner === innerQuote && input[end - 1] !== '\\') innerQuote = null;
          continue;
        }
        if (inner === "'" || inner === '"') {
          innerQuote = inner;
          continue;
        }
        if (inner === '(') depth += 1;
        if (inner === ')') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      if (depth === 0) {
        found.push(input.slice(i + 2, end));
        i = end;
      }
    }
  }
  return found;
}

function splitArgv(argv) {
  const result = [];
  let i = 0;
  while (i < argv.length) {
    const base = basename(argv[i]);
    if (base === 'sudo' || base === 'doas' || base === 'command' || base === 'builtin' || base === 'exec' || base === 'nohup') {
      i += 1;
      while (i < argv.length && argv[i].startsWith('-')) i += 1;
      continue;
    }
    if (base === 'env') {
      i += 1;
      while (i < argv.length && (argv[i].startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[i]))) i += 1;
      continue;
    }
    if (base === 'timeout') {
      i += 1;
      while (i < argv.length && argv[i].startsWith('-')) i += 1;
      if (i < argv.length) i += 1;
      continue;
    }
    if (base === 'xargs') {
      i += 1;
      while (i < argv.length && argv[i].startsWith('-')) i += 1;
      continue;
    }
    break;
  }
  return argv.slice(i);
}

function flagOf(argv, names) {
  return argv.some((arg) => names.has(String(arg).toLowerCase()));
}

function analyzeArgv(rawArgv, categories, reasons, depth) {
  const argv = splitArgv(rawArgv);
  if (argv.length === 0) return;
  const command = basename(argv[0]).replace(/\.exe$/, '');
  const lower = argv.map((value) => String(value).toLowerCase());

  if (SHELLS.has(command)) {
    const cIndex = lower.indexOf('-c');
    if (cIndex >= 0 && cIndex + 1 < argv.length && depth < 4) {
      analyze(argv[cIndex + 1], categories, reasons, depth + 1);
    }
    return;
  }

  if (command === 'cmd') {
    const cIndex = lower.findIndex((value) => value === '/c' || value === '/k');
    if (cIndex >= 0 && cIndex + 1 < argv.length && depth < 4) {
      analyze(argv.slice(cIndex + 1).join(' '), categories, reasons, depth + 1);
    }
    return;
  }

  if (command === 'eval' && depth < 4) {
    analyze(argv.slice(1).join(' '), categories, reasons, depth + 1);
    return;
  }

  if (command === 'powershell' || command === 'pwsh') {
    const commandIndex = lower.findIndex((value) => value === '-command' || value === '-c');
    const script = commandIndex >= 0 ? argv.slice(commandIndex + 1).join(' ') : argv.slice(1).join(' ');
    if (/(?:remove-item|\brm\b|\bdel\b|\berase\b|format-volume|diskpart|cipher\s+\/w|robocopy[\s\S]*?\/mir)/i.test(script)) {
      add(categories, reasons, /diskpart|format-volume|cipher\s+\/w/i.test(script) ? 'disk' : 'delete', 'Embedded PowerShell command performs a destructive operation.');
    }
    return;
  }

  if (command === 'rm' || command === 'unlink' || command === 'shred' || command === 'srm' || command === 'wipe') {
    if (argv.length > 1) add(categories, reasons, 'delete', 'Deletes files or directories.');
    return;
  }

  if (command === 'rmdir') {
    if (flagOf(argv, new Set(['/s', '/q']))) add(categories, reasons, 'delete', 'Recursively deletes a directory.');
    return;
  }

  if (command === 'rd') {
    if (flagOf(argv, new Set(['/s', '/q']))) add(categories, reasons, 'delete', 'Command Prompt rd recursively deletes a directory.');
    return;
  }

  if (command === 'del' || command === 'erase') {
    if (argv.length > 1) add(categories, reasons, 'delete', 'Command Prompt del/erase deletes files.');
    return;
  }

  if (command === 'robocopy') {
    if (flagOf(argv, new Set(['/l']))) return;
    if (flagOf(argv, new Set(['/mir', '/purge']))) {
      add(categories, reasons, 'delete', 'robocopy /MIR or /PURGE removes extra files in the destination.');
    }
    return;
  }

  if (command === 'git' && lower[1] === 'clean') {
    if (flagOf(argv, new Set(['-n', '--dry-run']))) return;
    const forced = argv.slice(2).some((arg) => /^-[a-z]*f[a-z]*$/i.test(arg) || arg === '--force');
    if (forced) add(categories, reasons, 'delete', 'git clean -f removes untracked and ignored files.');
    return;
  }

  if (command === 'find' && lower.includes('-delete')) {
    add(categories, reasons, 'delete', 'find -delete removes matching files.');
    return;
  }

  if (command === 'diskpart') {
    add(categories, reasons, 'disk', 'diskpart can erase or repartition disks.');
    return;
  }

  if (command === 'format' || command === 'format.com') {
    add(categories, reasons, 'disk', 'format erases a disk volume.');
    return;
  }

  if (command === 'cipher' && argv.some((arg) => /^\/w(?::|$)/i.test(arg))) {
    add(categories, reasons, 'disk', 'cipher /w overwrites free disk space.');
    return;
  }

  if (command === 'dd' && argv.some((arg) => /^of=/i.test(arg))) {
    add(categories, reasons, 'disk', 'dd writes directly to a device or file.');
    return;
  }

  if (command.startsWith('mkfs') || command === 'wipefs' || command === 'fdisk' || command === 'parted') {
    add(categories, reasons, 'disk', 'Disk partitioning or filesystem command.');
    return;
  }

  if (command === 'chmod' || command === 'chown' || command === 'takeown' || command === 'icacls' || command === 'attrib') {
    add(categories, reasons, 'permissions', 'Changes file ownership or permissions.');
  }
}

function analyze(input, categories, reasons, depth) {
  const tokens = tokenize(input);
  let argv = [];
  const flush = () => {
    if (argv.length > 0) analyzeArgv(argv, categories, reasons, depth + 1);
    argv = [];
  };
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type === 'word') {
      argv.push(token.value);
      continue;
    }
    if (token.type === 'redirect') {
      if (i + 1 < tokens.length && tokens[i + 1].type === 'word') i += 1;
      continue;
    }
    flush();
  }
  flush();
  for (const script of extractSubstitutions(input)) {
    if (depth < 4) analyze(script, categories, reasons, depth + 1);
  }
}

export function analyzeBash(command) {
  if (typeof command !== 'string' || command.trim() === '') {
    return { highRisk: false, reasons: [], categories: [] };
  }
  const categories = [];
  const reasons = [];
  analyze(command, categories, reasons, 0);
  return { highRisk: categories.length > 0, reasons, categories };
}
