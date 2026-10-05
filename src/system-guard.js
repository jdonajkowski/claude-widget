// Safety net for system tuning. Decides which shell commands change the machine (registry, services,
// boot, packages, kernel settings, files under /etc or C:\Windows, ...) and how to undo the common ones.
// hooks/guard-hook.js runs it before Claude's Bash/PowerShell commands; the Workbench's Changes view
// reads what it recorded. Pure: commands that read the old state are returned as data and run by the caller.

// --- Splitting commands --------------------------------------------------------------------------

// Heredoc bodies and commit/PR messages are data, not commands ("git commit -m 'tune sysctl -w ...'").
function clean(command) {
  let s = String(command || '');
  s = s.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2[ \t]*(?=\n|$)/g, '<<heredoc');
  s = s.replace(/(\s(?:-m|--message|--body|--title|--notes)\s+)("(?:[^"\\]|\\.)*"|'[^']*')/g, '$1""');
  return s;
}

// Top-level statements: split on ; && || and newlines outside quotes. Pipes stay inside a statement.
function statements(command) {
  const s = clean(command);
  const out = [];
  let cur = '';
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; cur += c; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    const two = s.slice(i, i + 2);
    if (c === ';' || c === '\n' || two === '&&' || two === '||') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      if (two === '&&' || two === '||') i++;
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// Shell words with quotes removed. Backslashes are kept as they are (Windows paths).
function words(stmt) {
  const out = [];
  let cur = '';
  let q = null;
  let quoted = false;
  for (const c of String(stmt)) {
    if (q) { if (c === q) q = null; else cur += c; continue; }
    if (c === '"' || c === "'") { q = c; quoted = true; continue; }
    if (/\s/.test(c)) {
      if (cur || quoted) out.push(cur);
      cur = '';
      quoted = false;
      continue;
    }
    cur += c;
  }
  if (cur || quoted) out.push(cur);
  return out;
}

// The command word and its arguments, past sudo/doas/env/& prefixes. Lower-cased name without .exe.
function command(stmt) {
  const w = words(stmt);
  let i = 0;
  while (i < w.length) {
    const x = w[i].toLowerCase();
    if (x === '&' || x === 'sudo' || x === 'doas' || x === 'gsudo' || x === 'run0' || x === 'env' || x === 'nohup' || x === 'time') { i++; continue; }
    if (/^-/.test(w[i]) && i > 0 && /^(sudo|doas|env)$/i.test(w[i - 1])) { i++; continue; } // sudo -E, env -i
    if (/^[A-Za-z_]\w*=/.test(w[i])) { i++; continue; } // VAR=value
    break;
  }
  const name = (w[i] || '').replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase();
  return { name, args: w.slice(i + 1), sudo: i > 0 && w.slice(0, i).some((x) => /^(sudo|doas|gsudo|run0)$/i.test(x)) };
}

// --- What counts as a system change ---------------------------------------------------------------

const PACMAN_RISKY = (m) => {
  const flags = m[2].slice(1);
  if (/[RU]/.test(flags)) return true;
  return /S/.test(flags) && !/[silgpw]/.test(flags.replace('S', ''));
};

// [os, label, test]: os is 'any', 'win' or 'linux'; test is a regex or a function of the cleaned command.
const RULES = [
  ['any', 'GPU settings', /\bnvidia-smi\b[^;&|\n]*\s(-pl|--power-limit|-lgc|--lock-gpu-clocks|-lmc|--lock-memory-clocks|-rgc|-rmc|-pm|--persistence-mode|-ac|--applications-clocks|-rac|-e|--ecc-config|-c|--compute-mode)\b/i],

  ['win', 'Registry', /\breg(?:\.exe)?\s+(add|delete|import|restore|load|unload|copy)\b/i],
  ['win', 'Registry', /\b(Set|New|Remove|Rename|Clear|Move|Copy)-Item(Property)?\b[^;\n]*(HK(LM|CU|CR|U|CC):|Registry::)/i],
  ['win', 'Boot configuration', /\bbcdedit(?:\.exe)?\s+\/(set|deletevalue|delete|create|copy|default|timeout|bootsequence|displayorder|import|bootdebug|debug|hypervisorsettings|bootems|ems)\b/i],
  ['win', 'Boot configuration', /\b(bcdboot|bootrec)(?:\.exe)?\b/i],
  ['win', 'Power plan', /\bpowercfg(?:\.exe)?\s+[-/](s|setactive|setacvalueindex|setdcvalueindex|change|x|h|hibernate|delete|d|import|duplicatescheme|changename|attributes)\b/i],
  ['win', 'Services', /\b(Set|Stop|Start|Restart|Suspend|New|Remove)-Service\b/i],
  ['win', 'Services', /\bsc(?:\.exe)?\s+(config|stop|start|delete|create|failure|pause|sdset)\b/i],
  ['win', 'Services', /\bnet(?:\.exe)?\s+(stop|start)\s+\S/i],
  ['win', 'Scheduled tasks', /\bschtasks(?:\.exe)?\s+\/(create|delete|change|run|end)\b/i],
  ['win', 'Scheduled tasks', /\b(Register|Unregister|Disable|Enable|Set)-ScheduledTask\b/i],
  ['win', 'Apps and features', /\b(Enable|Disable)-WindowsOptionalFeature\b/i],
  ['win', 'Apps and features', /\bdism(?:\.exe)?\b[^;\n]*\/(enable-feature|disable-feature|remove-package|add-package|remove-provisionedappxpackage)/i],
  ['win', 'Apps and features', /\b(Add|Remove)-Appx(Provisioned)?Package\b/i],
  ['win', 'Apps and features', /\b(winget|choco)\s+(install|uninstall|upgrade|remove)\b/i],
  ['win', 'Network and security', /\b(Set|Add|Remove)-MpPreference\b|\bSet-ExecutionPolicy\b|\b(Set|New|Remove|Enable|Disable)-NetFirewall\w*/i],
  ['win', 'Network and security', /\bnetsh(?:\.exe)?\b[^;\n]*\b(set|add|delete|reset)\b/i],
  ['win', 'Network and security', /\b(Set|New|Remove|Enable|Disable|Rename|Restart)-Net(Adapter|IPAddress|IPInterface|Route|TCPSetting|OffloadGlobalSetting|QosPolicy)\w*|\bSet-DnsClient\w*/i],
  ['win', 'Disks', /\b(diskpart|Format-Volume|Clear-Disk|Initialize-Disk|(New|Remove|Resize|Set)-Partition|Optimize-Volume|manage-bde)\b|\bformat(?:\.com)?\s+[a-z]:|\bfsutil(?:\.exe)?\s+\w+\s+set\b|\bvssadmin(?:\.exe)?\s+(delete|resize)\b|\bcipher(?:\.exe)?\s+\/w/i],
  ['win', 'Restart', /\bshutdown(?:\.exe)?\s+[-/][rsph]\b|\b(Restart|Stop)-Computer\b/i],
  ['win', 'Environment variables', /\[(System\.)?Environment\]::SetEnvironmentVariable\([^)]*(Machine|User)|\bsetx(?:\.exe)?\s/i],
  ['win', 'System settings', /\b(Set-ProcessMitigation|(Enable|Disable)-MMAgent|Set-MMAgent|Set-WinSystemLocale|Set-TimeZone|Rename-Computer|Add-Computer|(Enable|Disable)-ComputerRestore|Restore-Computer)\b/i],
  ['win', 'System repair', /\bsfc(?:\.exe)?\s+\/scannow|\bdism(?:\.exe)?\s[^;\n]*\/restorehealth|\bchkdsk(?:\.exe)?\s[^;\n]*\/[frxb]\b/i],
  ['win', 'Hosts file', /\\drivers\\etc\\hosts\b/i],
  ['win', 'System files', /\b(Set-Content|Add-Content|Out-File|Copy-Item|Move-Item|Remove-Item|New-Item|Rename-Item)\b[^;\n]*(['"\s])([A-Za-z]:\\(Windows|Program Files|Program Files \(x86\)|ProgramData)\\|\$env:(windir|SystemRoot|ProgramFiles|ProgramData))/i],
  ['win', 'Permissions', /\bSet-Acl\b|\bicacls(?:\.exe)?\s[^;\n]*\/(grant|deny|remove|setowner|reset)\b|\btakeown(?:\.exe)?\b/i],
  ['win', 'Runs as administrator', /\bStart-Process\b[^;\n]*-Verb\s+['"]?RunAs|(^|[;&|\s])(sudo|gsudo)\s/i],

  ['linux', 'Runs as root', /(^|[;&|(\s])(sudo|doas|pkexec|run0)\s/],
  ['linux', 'Packages', (s) => [...s.matchAll(/\b(pacman|yay|paru)\s+(-[A-Za-z]+)/g)].some(PACMAN_RISKY)],
  ['linux', 'Packages', /\b(apt|apt-get|aptitude|dnf|yum|zypper)\s+(?:-\S+\s+)*(install|remove|purge|autoremove|upgrade|dist-upgrade|full-upgrade|reinstall|erase|downgrade|in|rm|up|dup)\b|\b(flatpak|snap)\s+(install|uninstall|remove|refresh|update)\b|\b(dpkg|rpm)\s+(-i|-r|-P|-e|-U|--install|--remove|--purge)\b/],
  ['linux', 'Services', /\bsystemctl\s+(?:--?[\w-]+\s+)*(enable|disable|mask|unmask|start|stop|restart|reload|try-restart|reload-or-restart|daemon-reload|set-default|isolate|edit|set-property|kill|reboot|poweroff|halt|suspend|hibernate|reenable|preset|revert|link)\b/],
  ['linux', 'Kernel settings', /\bsysctl\s+(?:-\w+\s+)*(-w|--write|-p|--load|--system|[\w.\/-]+=)/],
  ['linux', 'Kernel settings', /(>|\btee\b(?:\s+-\w+)*)\s*['"]?\/(proc\/sys|sys)\//],
  ['linux', 'System config (/etc)', /(>>?\s*|\btee\s+(?:-\w+\s+)*|\b(sed|cp|mv|install|ln|rm|truncate|chmod|chown|chattr|patch|nano|vim?|nvim|micro|emacs|sudoedit)\b[^;&|\n]*\s)['"]?\/etc\//],
  ['linux', 'Boot', /\b(grub-mkconfig|grub-install|update-grub|mkinitcpio|dracut|update-initramfs|bootctl|efibootmgr|kernelstub|refind-install)\b|(>>?\s*|\b(cp|mv|rm|sed|tee)\b[^;&|\n]*\s)['"]?\/boot\//],
  ['linux', 'Kernel modules', /\b(modprobe|rmmod|insmod|depmod)\b/],
  ['linux', 'Disks', /\b(mkfs(\.\w+)?|fdisk|sfdisk|gdisk|cfdisk|parted|wipefs|cryptsetup|mkswap|swapon|swapoff|losetup|lvcreate|lvremove|vgcreate|pvcreate|blkdiscard|hdparm|e2fsck|fsck)\b|\bbtrfs\s+(subvolume\s+delete|balance|device)\b|\b(u?mount)\s+\S|\bdd\b[^;&|\n]*\bof=\/dev\//],
  ['linux', 'CPU/GPU tuning', /\b(cpupower|tlp|x86_energy_perf_policy|intel-undervolt|ryzenadj|zenstates|corectrl)\b|\bpowerprofilesctl\s+set\b|\btuned-adm\s+profile\b|\bnvidia-settings\s+-a\b/],
  ['linux', 'Network', /\bufw\s+(enable|disable|allow|deny|reject|limit|reset|delete|default)\b|\b(iptables|ip6tables|firewall-cmd)\b|\bnft\s+(add|delete|flush|insert|replace)\b|\bnmcli\s+(c|con|connection|d|device|r|radio|networking)\s+\w+|\bip\s+(link|addr|address|route)\s+(set|add|del|delete|flush)\b/],
  ['linux', 'Users', /\b(useradd|userdel|usermod|groupadd|groupdel|gpasswd|passwd|chsh|chpasswd|visudo)\b/],
  ['linux', 'Deletes system files', /\brm\s+(?:-\w+\s+)*-\w*[rR]\w*\s+(?:-\w+\s+)*['"]?\/(?!home\/|tmp\/|var\/tmp\/)/],
  ['linux', 'Permissions', /\b(chmod|chown|chgrp)\s+(?:-\w+\s+)*-\w*R\w*[^;&|\n]*\s\/(usr|etc|bin|lib|var|opt|boot)\b/],
  ['linux', 'Restart', /(^|[;&|\s])(reboot|poweroff|halt)\b|\bshutdown\s+(-[rhP]|now|\+\d)/],
  ['linux', 'Scheduled tasks', /\bcrontab\s+-(e|r)\b/],
  ['linux', 'Snapshots', /\btimeshift\s+--(delete|restore)|\bsnapper\s+(delete|rollback|undochange)\b/],
  ['linux', 'Firmware', /\bfwupdmgr\s+(update|install|downgrade)\b/]
];

// { risky, reasons: [labels] } for one Bash/PowerShell command.
function classify(cmd, isWin) {
  const s = clean(cmd);
  const reasons = [];
  for (const [os, label, t] of RULES) {
    if (os !== 'any' && (os === 'win') !== !!isWin) continue;
    if (reasons.includes(label)) continue;
    const hit = typeof t === 'function' ? t(s) : t.test(s);
    if (hit) reasons.push(label);
  }
  // "Runs as root" alone says little next to a specific reason, so it goes last.
  reasons.sort((a, b) => (/^Runs as/.test(a) ? 1 : 0) - (/^Runs as/.test(b) ? 1 : 0));
  return { risky: reasons.length > 0, reasons };
}

// --- Undo -------------------------------------------------------------------------------------------
// planUndo returns items: { capture, build(result) } where capture is how to read the old state:
//   { run: [file, ...args] }  run a program (no shell); result { ok, out }
//   { ps: script }             run a PowerShell script;   result { ok, out }
//   { backup: path }           copy a file aside;         result { ok, path: backup copy } or { missing: true }
//   { export: regKey }         reg export the key;        result { ok, path }
//   null                       nothing to read;           result null
// and build returns undo steps [{ label, command, admin }] (PowerShell on Windows, bash on Linux), or [].

const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;
const sq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
const flagValue = (args, names) => {
  const lower = names.map((n) => n.toLowerCase());
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const eq = a.indexOf('=');
    const name = (eq > 0 && /^--/.test(a) ? a.slice(0, eq) : a).toLowerCase();
    if (!lower.includes(name)) {
      const colon = /^(\/\w+):(.*)$/.exec(a); // dism /featurename:X
      if (colon && lower.includes(colon[1].toLowerCase())) return colon[2];
      continue;
    }
    if (eq > 0 && /^--/.test(a)) return a.slice(eq + 1);
    return args[i + 1];
  }
  return undefined;
};

// HKLM:\X, Registry::HKEY_LOCAL_MACHINE\X and HKLM\X all become HKLM\X style keys for reg.exe.
function regKey(p) {
  if (!p) return null;
  let k = String(p).replace(/^(Microsoft\.PowerShell\.Core\\)?Registry::/i, '');
  k = k.replace(/^(HK(?:LM|CU|CR|U|CC)):\\?/i, (_m, h) => `${h.toUpperCase()}\\`).replace(/\\+$/, '');
  return /^(HK(LM|CU|CR|U|CC)|HKEY_[A-Z_]+)(\\|$)/i.test(k) ? k : null;
}
const regAdmin = (k) => !/^(HKCU|HKEY_CURRENT_USER)\b/i.test(k);

// One value from `reg query KEY /v NAME` output: { type, data } or null.
function parseRegValue(out, name) {
  for (const line of String(out || '').split(/\r?\n/)) {
    const m = /^ {4}(.*?) {4}(REG_\w+)(?: {4}(.*))?$/.exec(line);
    if (m && (name === null ? /^\(Default\)$|^\(Standard\)$/i.test(m[1]) || m[1] === '' : m[1].toLowerCase() === String(name).toLowerCase())) {
      return { type: m[2], data: (m[3] || '').trimEnd() };
    }
  }
  return null;
}

// Value-level registry change: query the value now, put it back (or delete it) on undo.
function regValueItem(key, name) {
  const v = name === null ? ['/ve'] : ['/v', name];
  return {
    capture: { run: ['reg', 'query', key, ...v] },
    build: (r) => {
      const old = r && r.ok ? parseRegValue(r.out, name) : null;
      const vArg = name === null ? '/ve' : `/v ${psq(name)}`;
      if (!old) return [{ label: `Remove ${key}\\${name ?? '(Default)'}`, command: `reg delete ${psq(key)} ${vArg} /f`, admin: regAdmin(key) }];
      const data = old.data === '' ? '' : ` /d ${psq(old.data)}`;
      return [{ label: `Restore ${key}\\${name ?? '(Default)'} = ${old.data || '(empty)'}`, command: `reg add ${psq(key)} ${vArg} /t ${old.type}${data} /f`, admin: regAdmin(key) }];
    }
  };
}

// New key: delete it on undo if it did not exist. Deleted key: export it first, import on undo.
const regNewKeyItem = (key) => ({
  capture: { run: ['reg', 'query', key] },
  build: (r) => (r && r.ok ? [] : [{ label: `Remove the new key ${key}`, command: `reg delete ${psq(key)} /f`, admin: regAdmin(key) }])
});
const regExportItem = (key) => ({
  capture: { export: key },
  build: (r) => (r && r.ok && r.path ? [{ label: `Re-import ${key}`, command: `reg import ${psq(r.path)}`, admin: regAdmin(key) }] : [])
});

const fileItem = (file, isWin) => ({
  capture: { backup: file },
  build: (r) => {
    // Neither copied nor missing (unreadable, say): no undo rather than a wrong one.
    if (!r || (!r.ok && !r.missing)) return [];
    if (isWin) {
      return r.ok
        ? [{ label: `Restore ${file}`, command: `Copy-Item -LiteralPath ${psq(r.path)} -Destination ${psq(file)} -Force`, admin: true }]
        : [{ label: `Remove the new file ${file}`, command: `Remove-Item -LiteralPath ${psq(file)} -Force`, admin: true }];
    }
    return r.ok
      ? [{ label: `Restore ${file}`, command: `sudo cp ${sq(r.path)} ${sq(file)}`, admin: true }]
      : [{ label: `Remove the new file ${file}`, command: `sudo rm -f ${sq(file)}`, admin: true }];
  }
});

const SERVICE_STATE = (name) => `$s = Get-Service -Name ${psq(name)} -ErrorAction Stop; "$($s.StartType)|$($s.Status)"`;

function serviceItem(name, { startup, status }) {
  return {
    capture: { ps: SERVICE_STATE(name) },
    build: (r) => {
      const m = r && r.ok ? /^(\w+)\|(\w+)/.exec(String(r.out).trim()) : null;
      if (!m) return [];
      const steps = [];
      if (startup && /^(Automatic|Manual|Disabled)$/.test(m[1])) {
        steps.push({ label: `Set ${name} startup back to ${m[1]}`, command: `Set-Service -Name ${psq(name)} -StartupType ${m[1]}`, admin: true });
      }
      if (status && m[2] === 'Running') steps.push({ label: `Start ${name} again`, command: `Start-Service -Name ${psq(name)}`, admin: true });
      if (status && m[2] === 'Stopped') steps.push({ label: `Stop ${name} again`, command: `Stop-Service -Name ${psq(name)} -Force`, admin: true });
      return steps;
    }
  };
}

const fixed = (steps) => ({ capture: null, build: () => steps });

// Paths a PowerShell file cmdlet writes to, if they are in a system folder or the hosts file.
const WIN_SYSTEM_PATH = /^([A-Za-z]:\\(Windows|Program Files|Program Files \(x86\)|ProgramData)\\|.*\\drivers\\etc\\hosts$)/i;

function winItems(name, args, stmt) {
  const items = [];
  const lower = args.map((a) => a.toLowerCase());
  if (name === 'reg') {
    const verb = lower[0];
    const key = regKey(args[1]);
    if (!key) return items;
    const vi = lower.indexOf('/v');
    const valueName = vi >= 0 ? args[vi + 1] : lower.includes('/ve') ? null : undefined;
    if (verb === 'add') items.push(valueName === undefined ? regNewKeyItem(key) : regValueItem(key, valueName));
    if (verb === 'delete') items.push(valueName === undefined ? regExportItem(key) : regValueItem(key, valueName));
    return items;
  }
  if (/^(set|new|remove)-itemproperty$/.test(name)) {
    const pos = args.filter((a, i) => !a.startsWith('-') && !(i > 0 && args[i - 1].startsWith('-') && !/^-(force|passthru|whatif|confirm)$/i.test(args[i - 1])));
    const key = regKey(flagValue(args, ['-Path', '-LiteralPath']) || pos[0]);
    const names = String(flagValue(args, ['-Name']) || pos[1] || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (key) for (const n of names) items.push(regValueItem(key, n));
    return items;
  }
  if (name === 'new-item' || name === 'remove-item') {
    const target = flagValue(args, ['-Path', '-LiteralPath']) || args.find((a) => !a.startsWith('-'));
    const key = regKey(target);
    if (key) items.push(name === 'new-item' ? regNewKeyItem(key) : regExportItem(key));
    else if (target && WIN_SYSTEM_PATH.test(target) && !/[*?]/.test(target)) items.push(fileItem(target, true));
    return items;
  }
  if (/^(set-content|add-content|out-file|copy-item|move-item|rename-item)$/.test(name)) {
    const target = name === 'copy-item' || name === 'move-item'
      ? flagValue(args, ['-Destination']) || args.filter((a) => !a.startsWith('-'))[1]
      : flagValue(args, ['-Path', '-LiteralPath', '-FilePath']) || args.find((a) => !a.startsWith('-'));
    if (target && WIN_SYSTEM_PATH.test(target) && !/[*?]/.test(target)) items.push(fileItem(target, true));
    return items;
  }
  if (name === 'powercfg') {
    const op = (lower[0] || '').replace(/^[-/]/, '');
    if (op === 'setactive' || op === 's') {
      items.push({
        capture: { run: ['powercfg', '/getactivescheme'] },
        build: (r) => {
          const g = r && r.ok && /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(r.out);
          return g ? [{ label: 'Switch back to the previous power plan', command: `powercfg /setactive ${g[1]}`, admin: false }] : [];
        }
      });
    } else if ((op === 'setacvalueindex' || op === 'setdcvalueindex') && args.length >= 5) {
      const [scheme, sub, setting] = args.slice(1, 4);
      const ac = op === 'setacvalueindex';
      items.push({
        capture: { run: ['powercfg', '/query', scheme, sub, setting] },
        build: (r) => {
          const m = r && r.ok && new RegExp(`Current ${ac ? 'AC' : 'DC'} Power Setting Index:\\s*(0x[0-9a-f]+)`, 'i').exec(r.out);
          return m ? [
            { label: `Put the ${ac ? 'plugged-in' : 'battery'} power setting back to ${m[1]}`, command: `powercfg /${op} ${scheme} ${sub} ${setting} ${m[1]}`, admin: false },
            { label: 'Apply the power plan', command: `powercfg /setactive ${scheme}`, admin: false }
          ] : [];
        }
      });
    }
    return items;
  }
  if (name === 'set-service') {
    const svc = flagValue(args, ['-Name']) || args.find((a) => !a.startsWith('-'));
    const startup = !!flagValue(args, ['-StartupType', '-StartType']);
    const status = !!flagValue(args, ['-Status']);
    if (svc && (startup || status)) items.push(serviceItem(svc, { startup, status }));
    return items;
  }
  if (/^(stop|start|restart|suspend)-service$/.test(name)) {
    const svcs = String(flagValue(args, ['-Name']) || args.find((a) => !a.startsWith('-')) || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (name !== 'restart-service') for (const s of svcs) items.push(serviceItem(s, { status: true }));
    return items;
  }
  if (name === 'sc') {
    const verb = lower[0];
    const svc = args[1];
    if (!svc) return items;
    if (verb === 'config' && lower.some((a) => a.startsWith('start='))) items.push(serviceItem(svc, { startup: true }));
    if (verb === 'stop' || verb === 'start') items.push(serviceItem(svc, { status: true }));
    return items;
  }
  if (name === 'net' && (lower[0] === 'stop' || lower[0] === 'start') && args[1]) {
    items.push(serviceItem(args.slice(1).filter((a) => !a.startsWith('/')).join(' '), { status: true }));
    return items;
  }
  if (name === 'disable-scheduledtask' || name === 'enable-scheduledtask') {
    const task = flagValue(args, ['-TaskName']) || args.find((a) => !a.startsWith('-'));
    const tp = flagValue(args, ['-TaskPath']);
    const verb = name.startsWith('disable') ? 'Enable' : 'Disable';
    if (task) items.push(fixed([{ label: `${verb} the task ${task} again`, command: `${verb}-ScheduledTask -TaskName ${psq(task)}${tp ? ` -TaskPath ${psq(tp)}` : ''}`, admin: true }]));
    return items;
  }
  if (name === 'schtasks' && lower[0] === '/change') {
    const tn = flagValue(args, ['/tn']);
    if (tn && lower.includes('/disable')) items.push(fixed([{ label: `Enable the task ${tn} again`, command: `schtasks /change /tn ${psq(tn)} /enable`, admin: true }]));
    if (tn && lower.includes('/enable')) items.push(fixed([{ label: `Disable the task ${tn} again`, command: `schtasks /change /tn ${psq(tn)} /disable`, admin: true }]));
    return items;
  }
  if (name === 'disable-windowsoptionalfeature' || name === 'enable-windowsoptionalfeature') {
    const f = flagValue(args, ['-FeatureName']);
    const verb = name.startsWith('disable') ? 'Enable' : 'Disable';
    if (f) items.push(fixed([{ label: `${verb} the feature ${f} again`, command: `${verb}-WindowsOptionalFeature -Online -FeatureName ${psq(f)} -NoRestart`, admin: true }]));
    return items;
  }
  if (name === 'dism') {
    const f = flagValue(args, ['/featurename']);
    if (f && lower.includes('/disable-feature')) items.push(fixed([{ label: `Enable the feature ${f} again`, command: `dism /online /enable-feature /featurename:${f} /norestart`, admin: true }]));
    if (f && lower.includes('/enable-feature')) items.push(fixed([{ label: `Disable the feature ${f} again`, command: `dism /online /disable-feature /featurename:${f} /norestart`, admin: true }]));
    return items;
  }
  if (name === 'winget' || name === 'choco') {
    const verb = lower[0];
    const id = flagValue(args, ['--id']) || args.slice(1).find((a) => !a.startsWith('-'));
    if (!id) return items;
    const idArg = name === 'winget' ? `--id ${psq(id)} -e` : psq(id);
    if (verb === 'install') items.push(fixed([{ label: `Uninstall ${id}`, command: `${name} uninstall ${idArg}`, admin: name === 'choco' }]));
    if (verb === 'uninstall' || verb === 'remove') items.push(fixed([{ label: `Install ${id} again`, command: `${name} install ${idArg}`, admin: name === 'choco' }]));
    return items;
  }
  if (name === 'set-executionpolicy') {
    const scope = flagValue(args, ['-Scope']) || 'LocalMachine';
    items.push({
      capture: { ps: `Get-ExecutionPolicy -Scope ${scope}` },
      build: (r) => (r && r.ok && /^\w+$/.test(r.out.trim())
        ? [{ label: `Execution policy (${scope}) back to ${r.out.trim()}`, command: `Set-ExecutionPolicy -ExecutionPolicy ${r.out.trim()} -Scope ${scope} -Force`, admin: /LocalMachine/i.test(scope) }]
        : [])
    });
    return items;
  }
  if (name === 'set-mppreference') {
    for (let i = 0; i < args.length; i++) {
      const m = /^-(\w+)$/.exec(args[i]);
      if (!m || /^(Force|WhatIf|Confirm)$/i.test(m[1]) || args[i + 1] === undefined || args[i + 1].startsWith('-')) continue;
      const prop = m[1];
      items.push({
        capture: { ps: `(Get-MpPreference).${prop} | ConvertTo-Json -Compress` },
        build: (r) => {
          let v;
          try { v = JSON.parse(String(r && r.out).trim()); } catch { return []; }
          const lit = v === true ? '$true' : v === false ? '$false' : typeof v === 'number' ? String(v) : typeof v === 'string' ? psq(v) : null;
          return lit === null ? [] : [{ label: `Defender ${prop} back to ${lit}`, command: `Set-MpPreference -${prop} ${lit}`, admin: true }];
        }
      });
    }
    return items;
  }
  if (name === 'bcdedit' && lower[0] === '/set') {
    const rest = args.slice(1);
    const id = /^\{.*\}$/.test(rest[0]) ? rest.shift() : null;
    if (rest[0]) items.push(fixed([{ label: `Remove the boot setting ${rest[0]} (back to its default)`, command: `bcdedit /deletevalue ${id ? `${psq(id)} ` : ''}${rest[0]}`, admin: true }]));
    return items;
  }
  if (name === 'setx' && args[0]) {
    const target = lower.includes('/m') ? 'Machine' : 'User';
    items.push(envItem(args[0], target));
    return items;
  }
  const env = /\[(?:System\.)?Environment\]::SetEnvironmentVariable\(\s*['"]([^'"]+)['"][\s\S]*?,\s*['"]?(?:\[(?:System\.)?EnvironmentVariableTarget\]::)?(Machine|User)['"]?\s*\)/i.exec(stmt);
  if (env) items.push(envItem(env[1], env[2][0].toUpperCase() + env[2].slice(1).toLowerCase()));
  return items;
}

function envItem(name, target) {
  return {
    capture: { ps: `$v = [Environment]::GetEnvironmentVariable(${psq(name)}, '${target}'); if ($null -eq $v) { '<<unset>>' } else { $v }` },
    build: (r) => {
      if (!r || !r.ok) return [];
      const old = String(r.out).replace(/\r?\n$/, '');
      const admin = target === 'Machine';
      return old === '<<unset>>'
        ? [{ label: `Remove the ${target} variable ${name}`, command: `[Environment]::SetEnvironmentVariable(${psq(name)}, $null, '${target}')`, admin }]
        : [{ label: `Restore the ${target} variable ${name}`, command: `[Environment]::SetEnvironmentVariable(${psq(name)}, ${psq(old)}, '${target}')`, admin }];
    }
  };
}

// The value a sysfs/procfs file shows; "[always] madvise never" style files show the chosen one in brackets.
function sysfsValue(out) {
  const s = String(out || '').trim();
  const m = /\[([^\]]+)\]/.exec(s);
  return m ? m[1] : s;
}

const ETC_TARGETS = [
  /(?:^|[^<\d&>])>>?\s*['"]?(\/etc\/[^\s;|&)'"]+)/g,
  /\btee\s+(?:-\w+\s+)*['"]?(\/etc\/[^\s;|&)'"]+)/g
];

function linuxItems(name, args, stmt) {
  const items = [];
  // Writes into /etc, /boot and kernel tunables: back the file up (or read the value).
  const etc = new Set();
  for (const re of ETC_TARGETS) for (const m of stmt.matchAll(re)) etc.add(m[1]);
  if (/^(sed|cp|mv|install|ln|rm|truncate|patch|nano|vi|vim|nvim|micro|emacs|sudoedit)$/.test(name)) {
    const paths = args.filter((a) => /^\/(etc|boot)\//.test(a));
    if (name === 'cp' || name === 'mv' || name === 'install' || name === 'ln') { if (paths.length && args[args.length - 1] === paths[paths.length - 1]) etc.add(paths[paths.length - 1]); }
    else for (const p of paths) etc.add(p);
  }
  for (const f of etc) if (!/[*?[]/.test(f)) items.push(fileItem(f, false));
  for (const m of stmt.matchAll(/(?:>|\btee\b(?:\s+-\w+)*)\s*['"]?(\/(?:proc\/sys|sys)\/[^\s;|&'"]+)/g)) {
    const file = m[1];
    if (/[*?[]/.test(file)) continue;
    items.push({
      capture: { run: ['cat', file] },
      build: (r) => (r && r.ok ? [{ label: `Put ${file} back to ${sysfsValue(r.out)}`, command: `echo ${sq(sysfsValue(r.out))} | sudo tee ${sq(file)} >/dev/null`, admin: true }] : [])
    });
  }

  if (name === 'sysctl') {
    for (const a of args) {
      const m = /^([\w.\/-]+)=(.*)$/.exec(a);
      if (!m) continue;
      items.push({
        capture: { run: ['sysctl', '-n', m[1]] },
        build: (r) => (r && r.ok ? [{ label: `${m[1]} back to ${r.out.trim()}`, command: `sudo sysctl -w ${sq(`${m[1]}=${r.out.trim().replace(/\t/g, ' ')}`)}`, admin: true }] : [])
      });
    }
  }

  if (name === 'systemctl') {
    const user = args.includes('--user');
    const now = args.includes('--now');
    const rest = args.filter((a) => !a.startsWith('-'));
    const verb = rest[0];
    const units = rest.slice(1);
    const sc = user ? 'systemctl --user' : 'sudo systemctl';
    if (/^(enable|disable|mask|unmask|reenable|preset)$/.test(verb || '')) {
      for (const u of units) {
        items.push({
          capture: { run: ['systemctl', ...(user ? ['--user'] : []), 'is-enabled', u] },
          build: (r) => {
            const old = String((r && r.out) || '').trim().split(/\s+/)[0];
            if (old === 'masked') return [{ label: `Mask ${u} again`, command: `${sc} mask ${sq(u)}`, admin: !user }];
            if (old === 'enabled') return [{ label: `Enable ${u} again`, command: `${sc} unmask ${sq(u)} && ${sc} enable ${sq(u)}`, admin: !user }];
            if (old === 'disabled') return [{ label: `Disable ${u} again`, command: `${sc} unmask ${sq(u)} && ${sc} disable ${sq(u)}`, admin: !user }];
            return [];
          }
        });
      }
    }
    if (/^(start|stop|kill)$/.test(verb || '') || (now && /^(enable|disable|mask)$/.test(verb || ''))) {
      for (const u of units) {
        items.push({
          capture: { run: ['systemctl', ...(user ? ['--user'] : []), 'is-active', u] },
          build: (r) => {
            const old = String((r && r.out) || '').trim().split(/\s+/)[0];
            if (old === 'active') return [{ label: `Start ${u} again`, command: `${sc} start ${sq(u)}`, admin: !user }];
            if (old === 'inactive' || old === 'failed') return [{ label: `Stop ${u} again`, command: `${sc} stop ${sq(u)}`, admin: !user }];
            return [];
          }
        });
      }
    }
    if (verb === 'set-default') {
      items.push({
        capture: { run: ['systemctl', 'get-default'] },
        build: (r) => (r && r.ok ? [{ label: `Default target back to ${r.out.trim()}`, command: `sudo systemctl set-default ${sq(r.out.trim())}`, admin: true }] : [])
      });
    }
  }

  if (name === 'pacman' || name === 'yay' || name === 'paru') {
    const op = args.find((a) => /^-[A-Za-z]+$/.test(a)) || '';
    const pkgs = args.filter((a) => !a.startsWith('-'));
    const flags = op.slice(1);
    const install = /S/.test(flags) && !/[silgpcw]/.test(flags.replace('S', '')) && !/[RU]/.test(flags);
    if (/R/.test(flags) && pkgs.length) {
      const again = name === 'pacman' ? 'sudo pacman -S --needed' : `${name} -S --needed`;
      items.push({
        capture: { run: ['pacman', '-Q', ...pkgs] },
        build: (r) => {
          const had = String((r && r.out) || '').split('\n').map((l) => l.split(' ')[0]).filter((p) => pkgs.includes(p));
          return had.length ? [{ label: `Install ${had.join(', ')} again`, command: `${again} ${had.map(sq).join(' ')}`, admin: true }] : [];
        }
      });
    } else if (install && pkgs.length) {
      items.push({
        capture: { run: ['pacman', '-Q', ...pkgs] },
        build: (r) => {
          const had = new Set(String((r && r.out) || '').split('\n').map((l) => l.split(' ')[0]));
          const added = pkgs.filter((p) => !had.has(p));
          return added.length ? [{ label: `Remove ${added.join(', ')}`, command: `sudo pacman -Rns ${added.map(sq).join(' ')}`, admin: true }] : [];
        }
      });
    }
  }

  if ((name === 'apt' || name === 'apt-get' || name === 'dnf' || name === 'yum') && args.length) {
    const verbs = args.filter((a) => !a.startsWith('-'));
    const verb = verbs[0];
    const pkgs = verbs.slice(1);
    const tool = name === 'yum' ? 'dnf' : name === 'apt-get' ? 'apt' : name;
    const query = tool === 'apt' ? ['dpkg-query', '-W', '-f=${Package} ${Status}\\n', ...pkgs] : ['rpm', '-q', ...pkgs];
    const installed = (out) => new Set(String(out || '').split('\n')
      .map((l) => (tool === 'apt' ? (/^(\S+) install ok installed/.exec(l) || [])[1] : (/^(\S+?)-\d/.exec(l) || [])[1]))
      .filter(Boolean));
    if (/^(install|in)$/.test(verb || '') && pkgs.length) {
      items.push({
        capture: { run: query },
        build: (r) => {
          const had = installed(r && r.out);
          const added = pkgs.filter((p) => !had.has(p));
          return added.length ? [{ label: `Remove ${added.join(', ')}`, command: `sudo ${tool} remove ${added.map(sq).join(' ')}`, admin: true }] : [];
        }
      });
    }
    if (/^(remove|purge|erase|rm)$/.test(verb || '') && pkgs.length) {
      items.push(fixed([{ label: `Install ${pkgs.join(', ')} again`, command: `sudo ${tool} install ${pkgs.map(sq).join(' ')}`, admin: true }]));
    }
  }

  if (name === 'cpupower' && args.includes('frequency-set')) {
    const gi = args.findIndex((a) => a === '-g' || a === '--governor');
    if (gi >= 0) {
      items.push({
        capture: { run: ['cat', '/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor'] },
        build: (r) => (r && r.ok ? [{ label: `CPU governor back to ${r.out.trim()}`, command: `sudo cpupower frequency-set -g ${sq(r.out.trim())}`, admin: true }] : [])
      });
    }
  }
  if (name === 'powerprofilesctl' && args[0] === 'set') {
    items.push({
      capture: { run: ['powerprofilesctl', 'get'] },
      build: (r) => (r && r.ok ? [{ label: `Power profile back to ${r.out.trim()}`, command: `powerprofilesctl set ${sq(r.out.trim())}`, admin: false }] : [])
    });
  }
  if (name === 'tuned-adm' && args[0] === 'profile') {
    items.push({
      capture: { run: ['tuned-adm', 'active'] },
      build: (r) => {
        const m = r && r.ok && /profile:\s*(\S+)/i.exec(r.out);
        return m ? [{ label: `tuned profile back to ${m[1]}`, command: `sudo tuned-adm profile ${sq(m[1])}`, admin: true }] : [];
      }
    });
  }
  if (name === 'ufw' && (args[0] === 'enable' || args[0] === 'disable')) {
    items.push(fixed([{ label: `Firewall ${args[0] === 'enable' ? 'off' : 'on'} again`, command: `sudo ufw ${args[0] === 'enable' ? 'disable' : 'enable'}`, admin: true }]));
  }
  return items;
}

// nvidia-smi limits work the same on both systems.
function nvidiaItems(args, isWin) {
  const items = [];
  const pre = isWin ? '' : 'sudo ';
  const pl = flagValue(args, ['-pl', '--power-limit']);
  if (pl !== undefined) {
    items.push({
      capture: { run: ['nvidia-smi', '--query-gpu=power.limit', '--format=csv,noheader,nounits'] },
      build: (r) => {
        const w = r && r.ok && /([\d.]+)/.exec(r.out);
        return w ? [{ label: `GPU power limit back to ${w[1]} W`, command: `${pre}nvidia-smi -pl ${w[1]}`, admin: true }] : [];
      }
    });
  }
  if (args.some((a) => /^(-lgc|--lock-gpu-clocks)/.test(a))) items.push(fixed([{ label: 'Unlock the GPU clocks', command: `${pre}nvidia-smi -rgc`, admin: true }]));
  if (args.some((a) => /^(-lmc|--lock-memory-clocks)/.test(a))) items.push(fixed([{ label: 'Unlock the GPU memory clocks', command: `${pre}nvidia-smi -rmc`, admin: true }]));
  return items;
}

// Every statement's undo items, in order.
function planUndo(cmd, isWin) {
  const items = [];
  for (const stmt of statements(cmd)) {
    // A pipeline's last command is where `| sudo tee /etc/x` lands, so look at each stage.
    for (const stage of stmt.split(/\|(?!\|)/)) {
      const { name, args } = command(stage);
      if (!name) continue;
      if (name === 'nvidia-smi') { items.push(...nvidiaItems(args, isWin)); continue; }
      items.push(...(isWin ? winItems(name, args, stage) : linuxItems(name, args, stage)));
    }
  }
  return items;
}

// Runs the captures through runCapture(capture) -> result (sync) and returns the undo steps, last change first.
function resolveUndo(items, runCapture) {
  const steps = [];
  for (const item of items) {
    let result = null;
    if (item.capture) {
      try { result = runCapture(item.capture); } catch { result = { ok: false, out: '' }; }
    }
    let built = [];
    try { built = item.build(result) || []; } catch { built = []; }
    steps.push(...built);
  }
  return steps.reverse();
}

// --- The change log ---------------------------------------------------------------------------------
// changes.jsonl holds { t: 'change', id, at, command, reasons, undo, cwd, sid } from the PreToolUse hook,
// { t: 'ran', id, at } from PostToolUse, and { t: 'undo', id, at } when the widget runs the undo.

function reduceChanges(lines) {
  const byId = new Map();
  for (const raw of lines) {
    let e = raw;
    if (typeof raw === 'string') { try { e = JSON.parse(raw); } catch { continue; } }
    if (!e || typeof e !== 'object' || !e.id) continue;
    if (e.t === 'change') byId.set(e.id, { ...e, ran: false, undone: false, status: 'pending' });
    const c = byId.get(e.id);
    if (!c) continue;
    if (e.t === 'ran') { c.ran = true; c.ranAt = e.at; }
    if (e.t === 'undo') { c.undone = true; c.undoneAt = e.at; }
    c.status = c.undone ? 'undone' : c.ran ? 'applied' : 'pending';
  }
  return [...byId.values()].sort((a, b) => b.at - a.at);
}

// One script that runs the undo steps in order and stops at the first failure.
function undoScript(steps, isWin) {
  if (isWin) {
    const body = steps.map((s) => `Write-Host ${psq(`> ${s.label}`)} -ForegroundColor Cyan\n${s.command}\nif (-not $?) { Write-Host 'That step failed; stopping here.' -ForegroundColor Red; return }`).join('\n');
    return `${body}\nWrite-Host 'Undo finished.' -ForegroundColor Green`;
  }
  const body = steps.map((s) => `echo ${sq(`> ${s.label}`)}\n${s.command} || { echo 'That step failed; stopping here.'; exit 1; }`).join('\n');
  return `set -o pipefail\n${body}\necho 'Undo finished.'`;
}

module.exports = {
  clean, statements, words, command, classify, regKey, parseRegValue, sysfsValue,
  planUndo, resolveUndo, reduceChanges, undoScript, RULES
};
