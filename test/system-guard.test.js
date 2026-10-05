const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('../src/system-guard');

const reasons = (cmd, isWin) => g.classify(cmd, isWin).reasons;
// Runs planUndo with canned capture results, keyed by the capture's JSON.
const undo = (cmd, isWin, results = {}) => g.resolveUndo(g.planUndo(cmd, isWin), (c) => results[JSON.stringify(c)] ?? { ok: false, out: '' });

test('statements split on ; && || and newlines, not inside quotes', () => {
  assert.deepEqual(g.statements('a; b && c || d\ne "x; y"'), ['a', 'b', 'c', 'd', 'e "x; y"']);
});

test('command skips sudo and env prefixes', () => {
  assert.deepEqual(g.command('sudo -E FOO=1 systemctl stop x'), { name: 'systemctl', args: ['stop', 'x'], sudo: true });
  assert.equal(g.command('& "C:\\Windows\\System32\\reg.exe" add HKCU\\X').name, 'reg');
});

test('ordinary commands are not system changes', () => {
  for (const c of ['npm test', 'git status', 'ls -la /etc', 'cat /etc/fstab', 'reg query HKLM\\Software', 'Get-Service', 'powercfg /list', 'pacman -Ss foo', 'pacman -Qi bar', 'systemctl status sshd', 'sysctl -a', 'bcdedit /enum']) {
    for (const isWin of [true, false]) assert.deepEqual(reasons(c, isWin), [], `${c} (${isWin ? 'win' : 'linux'})`);
  }
});

test('commit messages and heredocs do not count', () => {
  assert.deepEqual(reasons('git commit -m "tune with sysctl -w vm.swappiness=10"', false), []);
  assert.deepEqual(reasons("cat > notes.md <<'EOF'\nsudo pacman -Syu\nEOF", false), []);
});

test('Windows system changes are classified', () => {
  assert.deepEqual(reasons('reg add HKLM\\SOFTWARE\\X /v Y /t REG_DWORD /d 1 /f', true), ['Registry']);
  assert.deepEqual(reasons("Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name MenuShowDelay -Value 0", true), ['Registry']);
  assert.deepEqual(reasons('Set-Service -Name SysMain -StartupType Disabled', true), ['Services']);
  assert.deepEqual(reasons('powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c', true), ['Power plan']);
  assert.deepEqual(reasons('bcdedit /set disabledynamictick yes', true), ['Boot configuration']);
  assert.deepEqual(reasons('nvidia-smi -pl 250', true), ['GPU settings']);
  assert.deepEqual(reasons("Add-Content C:\\Windows\\System32\\drivers\\etc\\hosts '0.0.0.0 ads'", true), ['Hosts file', 'System files']);
  assert.deepEqual(reasons("[Environment]::SetEnvironmentVariable('Path', $p, 'Machine')", true), ['Environment variables']);
});

test('Linux system changes are classified, root last', () => {
  assert.deepEqual(reasons('sudo pacman -Syu', false), ['Packages', 'Runs as root']);
  assert.deepEqual(reasons('sudo systemctl disable --now bluetooth', false), ['Services', 'Runs as root']);
  assert.deepEqual(reasons('echo 10 | sudo tee /proc/sys/vm/swappiness', false), ['Kernel settings', 'Runs as root']);
  assert.deepEqual(reasons("sudo sed -i 's/quiet/quiet mitigations=off/' /etc/default/grub", false), ['System config (/etc)', 'Runs as root']);
  assert.deepEqual(reasons('sudo grub-mkconfig -o /boot/grub/grub.cfg', false), ['Boot', 'Runs as root']);
  assert.deepEqual(reasons('cpupower frequency-set -g performance', false), ['CPU/GPU tuning']);
  assert.deepEqual(reasons('rm -rf /usr/lib/foo', false), ['Deletes system files']);
  assert.deepEqual(reasons('rm -rf /tmp/build', false), []);
});

test('reg add records the old value, or deletes a new one', () => {
  const cmd = 'reg add "HKLM\\SOFTWARE\\Policies\\X" /v Telemetry /t REG_DWORD /d 0 /f';
  const q = JSON.stringify({ run: ['reg', 'query', 'HKLM\\SOFTWARE\\Policies\\X', '/v', 'Telemetry'] });
  const existed = undo(cmd, true, { [q]: { ok: true, out: '\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\X\r\n    Telemetry    REG_DWORD    0x1\r\n' } });
  assert.deepEqual(existed, [{ label: 'Restore HKLM\\SOFTWARE\\Policies\\X\\Telemetry = 0x1', command: "reg add 'HKLM\\SOFTWARE\\Policies\\X' /v 'Telemetry' /t REG_DWORD /d '0x1' /f", admin: true }]);
  const added = undo(cmd, true);
  assert.equal(added[0].command, "reg delete 'HKLM\\SOFTWARE\\Policies\\X' /v 'Telemetry' /f");
});

test('Set-ItemProperty on HKCU maps to reg.exe keys and needs no admin', () => {
  const cmd = "Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name MenuShowDelay -Value 0";
  const q = JSON.stringify({ run: ['reg', 'query', 'HKCU\\Control Panel\\Desktop', '/v', 'MenuShowDelay'] });
  const steps = undo(cmd, true, { [q]: { ok: true, out: '    MenuShowDelay    REG_SZ    400' } });
  assert.deepEqual(steps, [{ label: 'Restore HKCU\\Control Panel\\Desktop\\MenuShowDelay = 400', command: "reg add 'HKCU\\Control Panel\\Desktop' /v 'MenuShowDelay' /t REG_SZ /d '400' /f", admin: false }]);
});

test('deleting a whole key exports it first', () => {
  const items = g.planUndo('reg delete HKCU\\Software\\Junk /f', true);
  assert.deepEqual(items[0].capture, { export: 'HKCU\\Software\\Junk' });
  assert.deepEqual(items[0].build({ ok: true, path: 'C:\\b\\1.reg' }), [{ label: 'Re-import HKCU\\Software\\Junk', command: "reg import 'C:\\b\\1.reg'", admin: false }]);
});

test('service changes restore startup type and running state', () => {
  const ps = JSON.stringify({ ps: "$s = Get-Service -Name 'SysMain' -ErrorAction Stop; \"$($s.StartType)|$($s.Status)\"" });
  const steps = undo('Stop-Service SysMain; Set-Service -Name SysMain -StartupType Disabled', true, { [ps]: { ok: true, out: 'Automatic|Running\r\n' } });
  assert.deepEqual(steps.map((s) => s.command), [
    "Set-Service -Name 'SysMain' -StartupType Automatic",
    "Start-Service -Name 'SysMain'"
  ]);
});

test('power plan switches back to the active one', () => {
  const steps = undo('powercfg /setactive SCHEME_MIN', true, { [JSON.stringify({ run: ['powercfg', '/getactivescheme'] })]: { ok: true, out: 'Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced)' } });
  assert.deepEqual(steps, [{ label: 'Switch back to the previous power plan', command: 'powercfg /setactive 381b4222-f694-41f0-9685-ff5bb260df2e', admin: false }]);
});

test('machine environment variables are restored or removed', () => {
  const cmd = "[Environment]::SetEnvironmentVariable('JAVA_HOME', 'C:\\jdk', 'Machine')";
  const [item] = g.planUndo(cmd, true);
  assert.deepEqual(item.build({ ok: true, out: '<<unset>>\r\n' }), [{ label: 'Remove the Machine variable JAVA_HOME', command: "[Environment]::SetEnvironmentVariable('JAVA_HOME', $null, 'Machine')", admin: true }]);
  assert.equal(item.build({ ok: true, out: "C:\\old's\r\n" })[0].command, "[Environment]::SetEnvironmentVariable('JAVA_HOME', 'C:\\old''s', 'Machine')");
});

test('sysctl and procfs writes restore the old value', () => {
  const steps = undo('sudo sysctl -w vm.swappiness=10', false, { [JSON.stringify({ run: ['sysctl', '-n', 'vm.swappiness'] })]: { ok: true, out: '60\n' } });
  assert.deepEqual(steps, [{ label: 'vm.swappiness back to 60', command: "sudo sysctl -w 'vm.swappiness=60'", admin: true }]);
  const thp = undo('echo never | sudo tee /sys/kernel/mm/transparent_hugepage/enabled', false,
    { [JSON.stringify({ run: ['cat', '/sys/kernel/mm/transparent_hugepage/enabled'] })]: { ok: true, out: 'always [madvise] never\n' } });
  assert.equal(thp[0].command, "echo 'madvise' | sudo tee '/sys/kernel/mm/transparent_hugepage/enabled' >/dev/null");
});

test('systemctl disable --now restores enablement and state', () => {
  const steps = undo('sudo systemctl disable --now bluetooth.service', false, {
    [JSON.stringify({ run: ['systemctl', 'is-enabled', 'bluetooth.service'] })]: { ok: true, out: 'enabled\n' },
    [JSON.stringify({ run: ['systemctl', 'is-active', 'bluetooth.service'] })]: { ok: true, out: 'active\n' }
  });
  assert.deepEqual(steps.map((s) => s.command), [
    "sudo systemctl start 'bluetooth.service'",
    "sudo systemctl unmask 'bluetooth.service' && sudo systemctl enable 'bluetooth.service'"
  ]);
});

test('pacman installs undo only the packages that were new', () => {
  const steps = undo('sudo pacman -S --needed htop git', false, { [JSON.stringify({ run: ['pacman', '-Q', 'htop', 'git'] })]: { ok: false, out: 'git 2.46.0-1\n' } });
  assert.deepEqual(steps, [{ label: 'Remove htop', command: "sudo pacman -Rns 'htop'", admin: true }]);
  assert.deepEqual(undo('sudo pacman -Syu', false), []);
});

test('/etc edits back the file up first', () => {
  const [item] = g.planUndo("sudo sed -i 's/a/b/' /etc/default/grub", false);
  assert.deepEqual(item.capture, { backup: '/etc/default/grub' });
  assert.deepEqual(item.build({ ok: true, path: '/home/u/b/grub' }), [{ label: 'Restore /etc/default/grub', command: "sudo cp '/home/u/b/grub' '/etc/default/grub'", admin: true }]);
  assert.deepEqual(item.build({ missing: true }), [{ label: 'Remove the new file /etc/default/grub', command: "sudo rm -f '/etc/default/grub'", admin: true }]);
  assert.deepEqual(item.build({ ok: false }), [], 'an unreadable file gets no undo');
  assert.deepEqual(g.planUndo('echo x | sudo tee -a /etc/sysctl.d/99-tune.conf', false)[0].capture, { backup: '/etc/sysctl.d/99-tune.conf' });
});

test('GPU power limit goes back to the old limit', () => {
  const steps = undo('nvidia-smi -pl 250', true, { [JSON.stringify({ run: ['nvidia-smi', '--query-gpu=power.limit', '--format=csv,noheader,nounits'] })]: { ok: true, out: '320.00\n' } });
  assert.deepEqual(steps, [{ label: 'GPU power limit back to 320.00 W', command: 'nvidia-smi -pl 320.00', admin: true }]);
});

test('undo steps come back last change first', () => {
  const steps = undo('Disable-ScheduledTask -TaskName A; Disable-ScheduledTask -TaskName B', true);
  assert.deepEqual(steps.map((s) => s.label), ['Enable the task B again', 'Enable the task A again']);
});

test('reduceChanges tracks ran and undone', () => {
  const list = g.reduceChanges([
    JSON.stringify({ t: 'change', id: 'a', at: 1, command: 'x' }),
    JSON.stringify({ t: 'change', id: 'b', at: 2, command: 'y' }),
    'not json',
    JSON.stringify({ t: 'ran', id: 'a', at: 3 }),
    JSON.stringify({ t: 'ran', id: 'b', at: 4 }),
    JSON.stringify({ t: 'undo', id: 'b', at: 5 })
  ]);
  assert.deepEqual(list.map((c) => [c.id, c.status]), [['b', 'undone'], ['a', 'applied']]);
});

test('undoScript stops at the first failing step', () => {
  const ps = g.undoScript([{ label: 'one', command: 'cmd1' }], true);
  assert.match(ps, /cmd1\nif \(-not \$\?\)/);
  assert.match(g.undoScript([{ label: 'one', command: 'cmd1' }], false), /cmd1 \|\| \{/);
});
