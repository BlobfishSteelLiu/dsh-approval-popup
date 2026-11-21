import assert from 'node:assert/strict';
import { analyzeBash } from '../lib/bash-analyze.js';

function categories(command) {
  return analyzeBash(command).categories;
}

function expect(command, category, message) {
  assert.ok(categories(command).includes(category), `${message}: ${command}`);
}

function reject(command, message) {
  assert.equal(analyzeBash(command).highRisk, false, `${message}: ${command}`);
}

expect('robocopy src dst /MIR', 'delete', 'robocopy mirror');
expect('robocopy src dst /PURGE', 'delete', 'robocopy purge');
expect('git clean -fdx', 'delete', 'git clean forced');
expect('git clean -fd', 'delete', 'git clean combined flags');
expect('rd /s /q C:\\temp', 'delete', 'cmd rd recursive');
expect('rmdir /s /q C:\\temp', 'delete', 'cmd rmdir recursive');
expect('del /f /s /q C:\\temp\\x.txt', 'delete', 'cmd del forced');
expect('erase /f /s /q C:\\temp\\x.txt', 'delete', 'cmd erase forced');
expect('diskpart /s clean.txt', 'disk', 'diskpart script');
expect('diskpart', 'disk', 'diskpart interactive is not flagged');
expect('format D:', 'disk', 'format volume');
expect('cipher /w:C:\\', 'disk', 'cipher wipe');
expect('rm -rf /tmp/x', 'delete', 'rm');
expect('sudo rm -rf /tmp/x', 'delete', 'sudo rm');
expect('bash -c "rm -rf /tmp/x"', 'delete', 'nested bash');
expect('cmd /c rd /s /q C:\\temp', 'delete', 'cmd wrapper');
expect('find . -name "*.tmp" -delete', 'delete', 'find delete');
expect('echo "$(rm -rf /tmp/x)"', 'delete', 'double-quoted substitution');
expect('powershell -Command "Remove-Item C:\\temp\\x -Recurse"', 'delete', 'embedded powershell');

reject('echo "robocopy src dst /MIR"', 'quoted robocopy is data');
reject('git clean -n', 'dry-run git clean');
reject('robocopy src dst /L /MIR', 'robocopy list-only');
reject('printf "rd /s /q"', 'quoted rd is data');

console.log('bash analyzer test passed');
